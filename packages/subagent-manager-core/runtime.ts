import type { RunEvent, RunEventInput, RunExecutionMode, RunSnapshot, RunSummary } from "./events";
import { evaluatePolicy, type PolicyMode, type RunStrategy } from "./policy";
import {
	mergeRegistryLayers,
	resolveAgent,
	type ExecutionMode,
	type RegisteredAgent,
	type RegistryLayers,
} from "./registry";
import { InMemoryRunStore, type RunMessage, type RunStoreListener } from "./store";

export type ResolvedExecutionMode = RunExecutionMode;

export interface RunRequest {
	agent: string;
	prompt: string;
	policyMode?: PolicyMode;
	execution?: ExecutionMode;
	strategy?: RunStrategy;
	requiresWrite?: boolean;
	preferIsolation?: boolean;
	metadata?: Record<string, string | number | boolean | null>;
}

export interface RunResult {
	runId: string;
	summary: RunSummary;
	rawOutput?: string;
}

export interface ProviderRunContext {
	runId: string;
	agent: RegisteredAgent;
	request: RunRequest;
	emit: (event: RunEventInput) => void;
	signal?: AbortSignal;
}

export interface ExecutionProvider {
	kind: ResolvedExecutionMode;
	canHandle: (request: RunRequest, agent: RegisteredAgent) => boolean;
	run: (context: ProviderRunContext) => Promise<RunResult>;
}

export interface RoutePlan {
	mode: ResolvedExecutionMode;
	reason: string;
	provider: ResolvedExecutionMode;
}

export interface ManagerFacade {
	listAgents(scope?: "builtin" | "user" | "project" | "ephemeral" | "all"): Promise<RegisteredAgent[]>;
	run(request: RunRequest, options?: { signal?: AbortSignal }): Promise<RunResult>;
	status(id?: string): Promise<RunSnapshot[]>;
	interrupt(id: string): Promise<void>;
}

export interface ManagerRuntimeOptions {
	registry: RegistryLayers;
	providers: ExecutionProvider[];
	store?: InMemoryRunStore;
	now?: () => Date;
}

const MAX_TASK_LENGTH = 80;

/**
 * Reduces a request prompt to a short, single-line task label for the run
 * snapshot. Takes the first non-empty line and hard-truncates it so the fleet
 * group can render one agent per line without wrapping.
 */
export function deriveRunTask(prompt: string): string | undefined {
	const firstLine = prompt
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.length > 0);

	if (!firstLine) return undefined;
	if (firstLine.length <= MAX_TASK_LENGTH) return firstLine;
	return `${firstLine.slice(0, MAX_TASK_LENGTH - 1)}…`;
}

export function selectExecutionRoute(options: {
	request: RunRequest;
	agent: RegisteredAgent;
	providers: ExecutionProvider[];
}): RoutePlan {
	const requestedMode = options.request.execution ?? options.agent.execution ?? "auto";
	const desiredMode = resolveDesiredMode(requestedMode, options.request);
	const provider = options.providers.find(
		(candidate) => candidate.kind === desiredMode && candidate.canHandle(options.request, options.agent),
	);

	if (!provider) {
		throw new Error(`No execution provider available for '${options.agent.name}' in ${desiredMode} mode`);
	}

	return {
		mode: desiredMode,
		reason: requestedMode === "auto" ? `auto-selected ${desiredMode}` : `requested ${desiredMode}`,
		provider: provider.kind,
	};
}

function resolveDesiredMode(_mode: ExecutionMode, _request: RunRequest): ResolvedExecutionMode {
	return "subprocess";
}

export class ManagerRuntime implements ManagerFacade {
	private readonly registry: RegistryLayers;
	private readonly providers: ExecutionProvider[];
	private readonly store: InMemoryRunStore;
	private readonly now: () => Date;
	private readonly controllers = new Map<string, AbortController>();
	private runSeq = 0;

	constructor(options: ManagerRuntimeOptions) {
		this.registry = options.registry;
		this.providers = options.providers;
		this.store = options.store ?? new InMemoryRunStore();
		this.now = options.now ?? (() => new Date());
	}

	async listAgents(scope: "builtin" | "user" | "project" | "ephemeral" | "all" = "all"): Promise<RegisteredAgent[]> {
		const agents = mergeRegistryLayers(this.registry);
		if (scope === "all") return agents;
		return agents.filter((agent) => agent.scope === scope);
	}

	subscribe(listener: RunStoreListener): () => void {
		return this.store.subscribe(listener);
	}

	messages(id: string): RunMessage[] {
		return this.store.messagesFor(id);
	}

	events(id: string): RunEvent[] {
		return this.store.eventsFor(id);
	}

	snapshot(id: string): RunSnapshot | undefined {
		return this.store.get(id);
	}

	async run(request: RunRequest, options?: { signal?: AbortSignal; onStart?: (runId: string) => void }): Promise<RunResult> {
		const agent = resolveAgent(this.registry, request.agent);
		if (!agent) throw new Error(`Unknown agent '${request.agent}'`);

		const policy = evaluatePolicy({
			agent,
			policyMode: request.policyMode,
			requiresWrite: request.requiresWrite,
			strategy: request.strategy,
		});
		if (!policy.allowed) throw new Error(policy.reason ?? "Policy blocked request");

		const route = selectExecutionRoute({
			request,
			agent,
			providers: this.providers,
		});

		const runId = this.createRunId(agent.name);
		const controller = new AbortController();
		this.controllers.set(runId, controller);

		if (options?.signal) {
			if (options.signal.aborted) {
				controller.abort();
			} else {
				options.signal.addEventListener("abort", () => controller.abort(), { once: true });
			}
		}

		this.store.create({
			id: runId,
			agent: agent.name,
			task: deriveRunTask(request.prompt),
			prompt: request.prompt,
			policyMode: policy.effectiveMode,
			requestedExecutionMode: request.execution ?? agent.execution ?? "auto",
			resolvedExecutionMode: route.mode,
			startedAt: this.now().toISOString(),
		});
		options?.onStart?.(runId);
		this.emit(runId, { type: "run.started", agent: agent.name });

		const provider = this.providers.find((candidate) => candidate.kind === route.provider);
		if (!provider) throw new Error(`Selected provider '${route.provider}' is not registered`);

		try {
			const result = await provider.run({
				runId,
				agent,
				request,
				emit: (event) => this.emit(runId, event),
				signal: controller.signal,
			});
			this.complete(runId, result.summary);
			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (controller.signal.aborted) {
				this.emit(runId, { type: "run.interrupted" });
			} else {
				this.emit(runId, { type: "run.failed", error: message });
			}
			throw error;
		} finally {
			this.controllers.delete(runId);
		}
	}

	async status(id?: string): Promise<RunSnapshot[]> {
		if (!id) return this.store.list();
		const snapshot = this.store.get(id);
		return snapshot ? [snapshot] : [];
	}

	async interrupt(id: string): Promise<void> {
		if (!this.store.get(id)) throw new Error(`Unknown run '${id}'`);
		this.emit(id, { type: "interrupt.requested" });
		const controller = this.controllers.get(id);
		if (controller) {
			controller.abort();
		}
	}

	/**
	 * Builds a run id that is unique within this runtime even when several runs of
	 * the same agent are created in the same millisecond (parallel same-agent
	 * batches). The timestamp keeps ids sortable/readable; a per-runtime monotonic
	 * counter guarantees uniqueness, so a second `store.create` can never collide
	 * with and clobber an in-flight run's snapshot.
	 */
	private createRunId(agent: string): string {
		const ms = this.now().getTime().toString(36);
		const seq = (this.runSeq++).toString(36);
		return `${agent}-${ms}-${seq}`;
	}

	private complete(runId: string, summary: RunSummary): void {
		this.emit(runId, { type: "run.completed", summary });
		this.emit(runId, { type: "run.summary_ready", summary });
	}

	private emit(runId: string, event: RunEventInput): void {
		const at = this.now().toISOString();
		this.store.append({
			...event,
			id: `${runId}:${event.type}:${this.now().getTime().toString(36)}`,
			runId,
			at,
		} as RunEvent);
	}
}
