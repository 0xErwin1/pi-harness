import type { RunRequest } from "../subagent-manager-core/runtime.ts";

export type CompatContext = "fresh" | "fork";
export type CompatOutput = string | boolean;
export type CompatReads = string[] | boolean;
export type CompatSkill = string | string[] | boolean;

export interface CompatTaskItem {
	agent: string;
	task?: string;
	cwd?: string;
	count?: number;
	output?: CompatOutput;
	reads?: CompatReads;
	progress?: boolean;
	model?: string;
	skill?: CompatSkill;
}

export interface CompatParallelStep {
	parallel: CompatTaskItem[];
	concurrency?: number;
	failFast?: boolean;
	worktree?: boolean;
}

export type CompatChainStep = CompatTaskItem | CompatParallelStep;

export interface CompatSinglePayload extends Partial<CompatTaskItem> {
	subagent_type?: string;
	prompt?: string;
	description?: string;
	message?: string;
	instructions?: string;
	input?: string;
	query?: string;
	context?: CompatContext;
	async?: boolean;
	clarify?: boolean;
	run_in_background?: boolean;
	inherit_context?: boolean;
	max_turns?: number;
	thinking?: string;
}

export interface CompatParallelPayload {
	tasks: CompatTaskItem[];
	context?: CompatContext;
	concurrency?: number;
	worktree?: boolean;
	async?: boolean;
	clarify?: boolean;
}

export interface CompatChainPayload {
	chain: CompatChainStep[];
	context?: CompatContext;
	chainDir?: string;
	async?: boolean;
	clarify?: boolean;
}

export interface CompatActionPayload {
	action: string;
	id?: string;
	agent?: string;
}

export type CompatPayload = CompatSinglePayload | CompatParallelPayload | CompatChainPayload | CompatActionPayload;

export interface CompatTranslationOptions {
	fixedAgentNames?: readonly string[];
}

export interface CompatTranslationSuccess {
	mode: "single" | "parallel" | "chain";
	requests: RunRequest[];
	unsupported: false;
	unsupportedReason?: undefined;
}

export interface CompatTranslationUnsupported {
	mode: "single" | "parallel" | "chain" | "action";
	requests: [];
	unsupported: true;
	unsupportedReason: string;
}

export type CompatTranslation = CompatTranslationSuccess | CompatTranslationUnsupported;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isParallelPayload(payload: CompatPayload): payload is CompatParallelPayload {
	return isRecord(payload) && Array.isArray(payload.tasks);
}

function isChainPayload(payload: CompatPayload): payload is CompatChainPayload {
	return isRecord(payload) && Array.isArray(payload.chain);
}

function isActionPayload(payload: CompatPayload): payload is CompatActionPayload {
	return isRecord(payload) && typeof payload.action === "string";
}

function isParallelStep(step: CompatChainStep): step is CompatParallelStep {
	return isRecord(step) && Array.isArray(step.parallel);
}

function repeatCount(count: number | undefined): number {
	if (count === undefined) return 1;
	return Number.isInteger(count) && count > 0 ? count : 1;
}

function withMetadata(
	request: RunRequest,
	metadata: Record<string, string | number | boolean | null>,
): RunRequest {
	return {
		...request,
		metadata: {
			...(request.metadata ?? {}),
			...metadata,
		},
	};
}

function translateTask(
	item: CompatTaskItem,
	strategy: RunRequest["strategy"],
	context: CompatContext | undefined,
	metadata: Record<string, string | number | boolean | null>,
): RunRequest[] {
	const requests: RunRequest[] = [];
	for (let index = 0; index < repeatCount(item.count); index++) {
		const request = withMetadata(
			{
				agent: item.agent,
				prompt: item.task ?? "",
				strategy,
			},
			{
				context: context ?? "fresh",
				cwd: item.cwd ?? null,
				output: typeof item.output === "string" ? item.output : item.output ?? null,
				reads: Array.isArray(item.reads) ? item.reads.join(",") : item.reads ?? null,
				progress: item.progress ?? false,
				model: item.model ?? null,
				skill: Array.isArray(item.skill) ? item.skill.join(",") : item.skill ?? null,
				repeatIndex: index,
				repeatCount: repeatCount(item.count),
				...metadata,
			},
		);
		requests.push(request);
	}
	return requests;
}

function unsupported(
	mode: CompatTranslationUnsupported["mode"],
	reason: string,
): CompatTranslationUnsupported {
	return {
		mode,
		requests: [],
		unsupported: true,
		unsupportedReason: reason,
	};
}

export const FIXED_SDD_AGENT_NAMES = [
	"sdd-init",
	"sdd-explore",
	"sdd-propose",
	"sdd-spec",
	"sdd-design",
	"sdd-tasks",
	"sdd-apply",
	"sdd-verify",
	"sdd-archive",
] as const;

export function isFixedSddAgent(name: string, fixedAgentNames: readonly string[] = FIXED_SDD_AGENT_NAMES): boolean {
	return fixedAgentNames.includes(name);
}

export function translateSubagentPayload(
	payload: CompatPayload,
	options: CompatTranslationOptions = {},
): CompatTranslation {
	if (isActionPayload(payload)) {
		return unsupported("action", `action '${payload.action}' is not implemented by the harness manager yet`);
	}

	if (isParallelPayload(payload)) {
		if (payload.async || payload.worktree) {
			return unsupported("parallel", "async or worktree parallel execution is not implemented by the harness manager yet");
		}

		return {
			mode: "parallel",
			unsupported: false,
			requests: payload.tasks.flatMap((task, index) =>
				translateTask(task, "parallel", payload.context, {
					parallelIndex: index,
					parallelConcurrency: payload.concurrency ?? payload.tasks.length,
				}),
			),
		};
	}

	if (isChainPayload(payload)) {
		if (payload.async) {
			return unsupported("chain", "async chain execution is not implemented by the harness manager yet");
		}

		const requests: RunRequest[] = [];
		for (let index = 0; index < payload.chain.length; index++) {
			const step = payload.chain[index];
			if (isParallelStep(step)) {
				return unsupported("chain", "parallel fan-out chain steps are not implemented by the harness manager yet");
			}
			if (!step.task && index === 0) {
				return unsupported("chain", "the first chain step requires an explicit task");
			}
			requests.push(
				...translateTask(step, "chain", payload.context, {
					chainIndex: index,
					chainDir: payload.chainDir ?? null,
				}),
			);
		}
		return { mode: "chain", unsupported: false, requests };
	}

	const single = payload as CompatSinglePayload;
	if (single.async || single.clarify || single.run_in_background) {
		return unsupported("single", "async, background, or clarify execution is not implemented by the harness manager yet");
	}
	const agent = single.agent ?? single.subagent_type ?? "general-purpose";
	const task = single.task ?? single.prompt ?? single.message ?? single.instructions ?? single.input ?? single.query ?? single.description ?? "";
	if (!task.trim()) {
		return unsupported("single", "single execution requires a task, prompt, description, message, input, query, or instructions");
	}

	const request = translateTask({ ...single, agent, task }, "single", single.context ?? (single.inherit_context ? "fork" : undefined), {
		fixedIdentity: isFixedSddAgent(agent, options.fixedAgentNames) ? true : null,
		description: single.description ?? null,
		maxTurns: single.max_turns ?? null,
		thinking: single.thinking ?? null,
	})[0];

	return { mode: "single", unsupported: false, requests: request ? [request] : [] };
}

export function canTranslateSubagentPayload(
	payload: CompatPayload,
	options: CompatTranslationOptions = {},
): boolean {
	return !translateSubagentPayload(payload, options).unsupported;
}
