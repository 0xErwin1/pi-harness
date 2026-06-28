export type RunStatus =
	| "queued"
	// Renderer-only transient: a row whose run snapshot has not been observed yet
	// (in-flight before the store resolves it). The store never persists this; it
	// keeps an unresolved row from masquerading as a frozen `queued` run.
	| "starting"
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
	| "run.tool_result"
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
	/**
	 * Optional richer, fully formatted tool call — the tool name plus its key
	 * arguments compacted into one line (e.g. `read .gitignore`, `bash pnpm test`,
	 * `engram_mem_save (query: "…", project: "…")`). Built-in tools mirror Pi's
	 * native title style; MCP/plugin tools keep their prefixed name and show their
	 * key args as `(key: "value", …)`. Preferred over `target` by the viewers when
	 * present; absent for non-tool progress.
	 */
	toolCall?: string;
	/**
	 * Optional COMPLETE, uncapped variant of `toolCall`: every key and the full
	 * value of each argument, with no per-value truncation and no trailing `, …`.
	 * Whitespace is collapsed so the viewer can wrap it across lines. The overlay
	 * conversation viewer renders this (so it shows the entire args), while the
	 * collapsed inline row keeps using the summarized `toolCall`. Absent for
	 * non-tool progress.
	 */
	toolCallFull?: string;
}

/**
 * Carries the result of a completed tool invocation from the child process.
 * Appended to the run's event log for downstream viewers to render result
 * summaries (line counts, exit codes, diff stats). Does not affect run status.
 */
export interface RunToolResultEvent extends RunEventBase {
	type: "run.tool_result";
	toolName: string;
	toolCallId?: string;
	/** First text-typed output from the tool result content array, if any. */
	resultText?: string;
	/** Tool-specific structured metadata (e.g. diff string for Edit, truncation info for Read). */
	details?: unknown;
	isError?: boolean;
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
	| RunToolResultEvent
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
	| Omit<RunToolResultEvent, "id" | "runId" | "at">
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
	/**
	 * Short, single-line description of what the run was asked to do, derived from
	 * the request prompt. Lets the fleet group label each agent with its task.
	 */
	task?: string;
	status: RunStatus;
	requestedExecutionMode: RunExecutionMode | "auto";
	resolvedExecutionMode?: RunExecutionMode;
	policyMode: string;
	startedAt: string;
	updatedAt: string;
	/**
	 * Timestamp of the first terminal transition (completed, failed, or
	 * interrupted). Absent while the run is still active. Lets the fleet group
	 * linger a finished run for a short window before dropping it.
	 */
	endedAt?: string;
	/** Full launch prompt, stored for display in the conversation viewer. */
	prompt?: string;
	summary?: RunSummary;
	error?: string;
	needsAttentionReason?: string;
	/** Running total of tokens (input + output) reported across the run's messages. */
	tokens?: number;
	/** Running count of tool invocations observed for the run. */
	toolCount?: number;
	/** Model id used for the run, sourced from the agent spec or per-call metadata override. */
	model?: string;
	/** Thinking level for the run (e.g. "medium", "high"), sourced from agent spec or metadata. */
	thinking?: string;
}
