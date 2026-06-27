import { TOOL_PROGRESS_PREFIX } from "./events";
import type { RunExecutionMode, RunEvent, RunSnapshot, RunSummary, RunStatus } from "./events";

export interface RunMessage {
	role: "assistant";
	text: string;
	turn: number;
	at: string;
}

export type RunStoreListener = (event: RunEvent, snapshot: RunSnapshot) => void;

export interface CreateRunInput {
	id: string;
	agent: string;
	policyMode: string;
	requestedExecutionMode: RunExecutionMode | "auto";
	resolvedExecutionMode?: RunExecutionMode;
	startedAt?: string;
}

export class InMemoryRunStore {
	private readonly snapshots = new Map<string, RunSnapshot>();
	private readonly events = new Map<string, RunEvent[]>();
	private readonly listeners = new Set<RunStoreListener>();
	private readonly messages = new Map<string, RunMessage[]>();

	create(input: CreateRunInput): RunSnapshot {
		const at = input.startedAt ?? new Date().toISOString();
		const snapshot: RunSnapshot = {
			id: input.id,
			agent: input.agent,
			status: "queued",
			policyMode: input.policyMode,
			requestedExecutionMode: input.requestedExecutionMode,
			resolvedExecutionMode: input.resolvedExecutionMode,
			startedAt: at,
			updatedAt: at,
		};
		this.snapshots.set(snapshot.id, snapshot);
		this.events.set(snapshot.id, []);
		this.messages.set(snapshot.id, []);
		return snapshot;
	}

	list(): RunSnapshot[] {
		return [...this.snapshots.values()].sort((left, right) =>
			right.updatedAt.localeCompare(left.updatedAt),
		);
	}

	get(id: string): RunSnapshot | undefined {
		return this.snapshots.get(id);
	}

	append(event: RunEvent): void {
		const snapshot = this.snapshots.get(event.runId);
		if (!snapshot) return;

		const runEvents = this.events.get(event.runId);
		if (runEvents) runEvents.push(event);

		snapshot.updatedAt = event.at;
		this.applyEvent(snapshot, event);

		for (const listener of this.listeners) {
			try {
				listener(event, snapshot);
			} catch {
				// isolate UI faults from the execution path
			}
		}
	}

	subscribe(listener: RunStoreListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	messagesFor(id: string): RunMessage[] {
		return [...(this.messages.get(id) ?? [])];
	}

	eventsFor(id: string): RunEvent[] {
		return [...(this.events.get(id) ?? [])];
	}

	private applyEvent(snapshot: RunSnapshot, event: RunEvent): void {
		switch (event.type) {
			case "run.started":
				snapshot.status = "running";
				break;
			case "run.progress":
				snapshot.status = "running";
				if (event.message.startsWith(TOOL_PROGRESS_PREFIX)) {
					snapshot.toolCount = (snapshot.toolCount ?? 0) + 1;
				}
				break;
			case "run.output":
				snapshot.status = "running";
				if (typeof event.tokens === "number") {
					snapshot.tokens = (snapshot.tokens ?? 0) + event.tokens;
				}
				if (event.role === "assistant" && event.text) {
					const log = this.messages.get(event.runId);
					if (log) {
						log.push({ role: "assistant", text: event.text, turn: event.turn ?? 0, at: event.at });
					}
				}
				break;
			case "run.needs_attention":
				snapshot.status = "needs-attention";
				snapshot.needsAttentionReason = event.reason;
				break;
			case "run.completed":
			case "run.summary_ready":
				snapshot.status = "completed";
				snapshot.summary = event.summary;
				snapshot.resolvedExecutionMode = event.summary.executionMode;
				break;
			case "run.failed":
				snapshot.status = "failed";
				snapshot.error = event.error;
				break;
			case "run.interrupted":
				this.finish(snapshot, "interrupted");
				break;
			case "interrupt.requested":
				snapshot.status = "needs-attention";
				break;
			case "interrupt.acknowledged":
				snapshot.status = "interrupted";
				break;
			case "provider.degraded":
				snapshot.needsAttentionReason = `${event.provider}: ${event.reason}`;
				break;
		}
	}

	private finish(snapshot: RunSnapshot, status: RunStatus): void {
		snapshot.status = status;
	}
}

export function buildCompletedSummary(text: string, executionMode: RunSummary["executionMode"], routedBy: string): RunSummary {
	return { text, executionMode, routedBy };
}
