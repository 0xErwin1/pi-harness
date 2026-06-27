export type RunStatus =
	| "queued"
	| "running"
	| "needs-attention"
	| "completed"
	| "failed"
	| "interrupted";

export type RunExecutionMode = "in-process" | "subprocess" | "fork";

/** Prefix marking a run.progress message that represents a tool invocation. */
export const TOOL_PROGRESS_PREFIX = "tool:";

export type RunEventType =
	| "run.started"
	| "run.progress"
	| "run.output"
	| "run.needs_attention"
	| "run.completed"
	| "run.failed"
	| "run.interrupted"
	| "run.summary_ready"
	| "interrupt.requested"
	| "interrupt.acknowledged"
	| "provider.degraded";

export interface RunSummary {
	text: string;
	executionMode: RunExecutionMode;
	routedBy: string;
}

export interface RunEventBase {
	id: string;
	runId: string;
	type: RunEventType;
	at: string;
}

export interface RunStartedEvent extends RunEventBase {
	type: "run.started";
	agent: string;
}

export interface RunProgressEvent extends RunEventBase {
	type: "run.progress";
	message: string;
	/**
	 * Optional short, human-readable summary of a tool invocation's primary
	 * argument (file path, command, or search pattern). Lets the live viewer show
	 * "read src/foo.ts" instead of a bare tool name. Absent for non-tool progress.
	 */
	target?: string;
}

export interface RunOutputEvent extends RunEventBase {
	type: "run.output";
	chunk: string;
	role?: "assistant";
	/**
	 * Distinguishes a final assistant text turn (`"assistant"`, the default when
	 * absent) from a separate reasoning/thinking stream (`"thinking"`). Thinking
	 * output is shown live but is never accumulated into the run result text nor
	 * counted as a turn.
	 */
	kind?: "assistant" | "thinking";
	text?: string;
	turn?: number;
	/**
	 * Total tokens (input + output) attributed to the message_end that produced
	 * this output, when the provider reported usage. Accumulated additively into
	 * the run snapshot; absent when usage was not present.
	 */
	tokens?: number;
}

export interface RunNeedsAttentionEvent extends RunEventBase {
	type: "run.needs_attention";
	reason: string;
}

export interface RunCompletedEvent extends RunEventBase {
	type: "run.completed";
	summary: RunSummary;
}

export interface RunFailedEvent extends RunEventBase {
	type: "run.failed";
	error: string;
}

export interface RunInterruptedEvent extends RunEventBase {
	type: "run.interrupted";
	reason?: string;
}

export interface RunSummaryReadyEvent extends RunEventBase {
	type: "run.summary_ready";
	summary: RunSummary;
}

export interface InterruptRequestedEvent extends RunEventBase {
	type: "interrupt.requested";
}

export interface InterruptAcknowledgedEvent extends RunEventBase {
	type: "interrupt.acknowledged";
}

export interface ProviderDegradedEvent extends RunEventBase {
	type: "provider.degraded";
	provider: string;
	reason: string;
}

export type RunEvent =
	| RunStartedEvent
	| RunProgressEvent
	| RunOutputEvent
	| RunNeedsAttentionEvent
	| RunCompletedEvent
	| RunFailedEvent
	| RunInterruptedEvent
	| RunSummaryReadyEvent
	| InterruptRequestedEvent
	| InterruptAcknowledgedEvent
	| ProviderDegradedEvent;

export type RunEventInput =
	| Omit<RunStartedEvent, "id" | "runId" | "at">
	| Omit<RunProgressEvent, "id" | "runId" | "at">
	| Omit<RunOutputEvent, "id" | "runId" | "at">
	| Omit<RunNeedsAttentionEvent, "id" | "runId" | "at">
	| Omit<RunCompletedEvent, "id" | "runId" | "at">
	| Omit<RunFailedEvent, "id" | "runId" | "at">
	| Omit<RunInterruptedEvent, "id" | "runId" | "at">
	| Omit<RunSummaryReadyEvent, "id" | "runId" | "at">
	| Omit<InterruptRequestedEvent, "id" | "runId" | "at">
	| Omit<InterruptAcknowledgedEvent, "id" | "runId" | "at">
	| Omit<ProviderDegradedEvent, "id" | "runId" | "at">;

export interface RunSnapshot {
	id: string;
	agent: string;
	status: RunStatus;
	requestedExecutionMode: RunExecutionMode | "auto";
	resolvedExecutionMode?: RunExecutionMode;
	policyMode: string;
	startedAt: string;
	updatedAt: string;
	summary?: RunSummary;
	error?: string;
	needsAttentionReason?: string;
	/** Running total of tokens (input + output) reported across the run's messages. */
	tokens?: number;
	/** Running count of tool invocations observed for the run. */
	toolCount?: number;
}
