export interface PiMessage {
	role?: string;
	content?: Array<{ type?: string; text?: string; thinking?: string; reasoning?: string }>;
	usage?: unknown;
	stopReason?: string;
}

export interface PiJsonEvent {
	type?: string;
	message?: PiMessage;
	toolName?: string;
	args?: unknown;
	/** Present on `tool_execution_start` and `tool_execution_end` events. */
	toolCallId?: string;
	/**
	 * Present on `tool_execution_end` events. Carries the tool's output:
	 * `content` holds the textual result, `details` holds tool-specific structured
	 * metadata (e.g. a diff string for Edit, truncation info for Read).
	 */
	result?: {
		content?: Array<{ type: string; text: string }>;
		details?: unknown;
	};
	/** Present on `tool_execution_end`; true when the tool raised an error. */
	isError?: boolean;
}

export function parseNdjsonLine(line: string): PiJsonEvent | undefined {
	if (!line.trim()) return undefined;

	try {
		return JSON.parse(line) as PiJsonEvent;
	} catch {
		return undefined;
	}
}

export function isMessageEnd(event: PiJsonEvent): boolean {
	return event.type === "message_end";
}

export function assistantTextOf(message: PiMessage): string | undefined {
	if (message.role !== "assistant") return undefined;

	const textPart = message.content?.find((part) => part.type === "text" && part.text?.trim());
	return textPart?.text?.trim() ?? undefined;
}

/**
 * Extracts the assistant's reasoning/thinking text from a message, if any.
 *
 * The exact serialization emitted by `pi --mode json` is not pinned to a single
 * shape, so this is deliberately defensive across the standard ones:
 *   - `{ type: "thinking", thinking | text: "…" }`
 *   - `{ type: "redacted_thinking" }` — encrypted, carries no readable text
 *   - `{ type: "reasoning", text | reasoning: "…" }`
 *
 * Returns the first non-empty reasoning text, or `undefined` when the message
 * carries no readable thinking. It NEVER returns final `type:"text"` content:
 * thinking is a separate stream and must not leak into the run result text.
 */
export function assistantThinkingOf(message: PiMessage): string | undefined {
	if (message.role !== "assistant") return undefined;

	for (const part of message.content ?? []) {
		if (part.type === "thinking") {
			const text = part.thinking?.trim() || part.text?.trim();
			if (text) return text;
		}
		if (part.type === "reasoning") {
			const text = part.text?.trim() || part.reasoning?.trim();
			if (text) return text;
		}
	}
	return undefined;
}

export interface TokenUsage {
	input: number;
	output: number;
	total: number;
}

/**
 * Extracts token usage from a message, if the provider reported it.
 *
 * The `pi --mode json` usage payload is not pinned to a single field naming, so
 * this is defensive across the standard shapes:
 *   - `{ input, output }` / `{ total }`
 *   - `{ input_tokens, output_tokens }` / `{ total_tokens }`
 *   - `{ inputTokens, outputTokens }` / `{ totalTokens }`
 *   - `{ promptTokens, completionTokens }`
 *
 * `total` is the sum of input and output when both are present; otherwise it
 * falls back to an explicit total field. Returns `undefined` when no usage is
 * present so callers never accumulate a phantom zero or crash on a missing field.
 */
export function tokensOf(message: PiMessage): TokenUsage | undefined {
	const usage = message.usage;
	if (!usage || typeof usage !== "object") return undefined;

	const fields = usage as Record<string, unknown>;
	const num = (...keys: string[]): number => {
		for (const key of keys) {
			const value = fields[key];
			if (typeof value === "number" && Number.isFinite(value)) return value;
		}
		return 0;
	};

	const input = num("input", "input_tokens", "inputTokens", "promptTokens", "prompt_tokens");
	const output = num("output", "output_tokens", "outputTokens", "completionTokens", "completion_tokens");

	if (input === 0 && output === 0) {
		const total = num("total", "total_tokens", "totalTokens");
		if (total === 0) return undefined;
		return { input: 0, output: 0, total };
	}

	return { input, output, total: input + output };
}

/**
 * Per-value cap for a tool argument. A single huge value (a pasted blob, a long
 * command) is truncated to this many characters so it cannot blow out the line,
 * while the structure — tool name and which arguments — stays visible. The cap is
 * applied PER VALUE, never to the whole formatted line.
 */
export const TOOL_CALL_VALUE_MAX = 40;

/** How many key/value pairs a generic (e.g. MCP) tool shows before a trailing `…`. */
const TOOL_CALL_MAX_KEYS = 4;

/** Collapses internal whitespace and truncates a single value to the per-value cap. */
function compactValue(value: string, max = TOOL_CALL_VALUE_MAX): string {
	const collapsed = value.trim().replace(/\s+/g, " ");
	if (collapsed.length <= max) return collapsed;
	if (max <= 1) return "…";
	return `${collapsed.slice(0, max - 1)}…`;
}

/** Picks the first present primary argument (path / command / pattern) as a bare value. */
function primaryValue(fields: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = fields[key];
		if (typeof value === "string" && value.trim().length > 0) return compactValue(value);
		if (Array.isArray(value) && value.length > 0) {
			const items = value.filter((x) => typeof x === "string" || typeof x === "number").map(String);
			if (items.length > 0) return `{${compactValue(items.join(","))}}`;
		}
	}
	return undefined;
}

/** Mirrors Pi's native `read` title suffix: `:start-end` when offset/limit are set. */
function lineRange(fields: Record<string, unknown>): string {
	const offset = fields.offset;
	const limit = fields.limit;
	const hasOffset = typeof offset === "number" && Number.isFinite(offset);
	const hasLimit = typeof limit === "number" && Number.isFinite(limit);
	if (!hasOffset && !hasLimit) return "";

	const start = hasOffset ? (offset as number) : 1;
	const end = hasLimit ? start + (limit as number) - 1 : undefined;
	return `:${start}${end !== undefined ? `-${end}` : ""}`;
}

/** Renders one scalar argument value for the generic `(key: value)` form (strings quoted). */
function renderScalar(value: unknown): string | undefined {
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length === 0) return undefined;
		return `"${compactValue(trimmed)}"`;
	}
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) {
		const items = value.filter((x) => typeof x === "string" || typeof x === "number").map(String);
		if (items.length === 0) return undefined;
		return `{${compactValue(items.join(","))}}`;
	}
	return undefined;
}

/** Formats a generic/MCP tool as `<name> (key: "value", …)`, capped at a few keys. */
function formatGenericCall(name: string, fields: Record<string, unknown>): string {
	const shown: string[] = [];
	let total = 0;

	for (const [key, value] of Object.entries(fields)) {
		const rendered = renderScalar(value);
		if (rendered === undefined) continue;
		total += 1;
		if (shown.length < TOOL_CALL_MAX_KEYS) shown.push(`${key}: ${rendered}`);
	}

	if (shown.length === 0) return name;

	const more = total > shown.length ? ", …" : "";
	return `${name} (${shown.join(", ")}${more})`;
}

/**
 * Formats a tool invocation into one richer, human-readable line that mirrors
 * Pi's native thread: the tool name plus its key arguments compacted together.
 *
 * Built-in tools follow Pi's native title style — `read <path>` (with a
 * `:start-end` suffix when offset/limit are present), `bash <command>`,
 * `edit|write|ls <path>`, `find <pattern>`, `grep /<pattern>/`. Any other tool
 * (including MCP/plugin tools) keeps its name VERBATIM — the MCP/plugin prefix is
 * preserved — and shows its key arguments as `(key: "value", …)`.
 *
 * Long values are truncated PER VALUE (not the whole line) so the call's shape
 * stays legible. Always returns at least the tool name, even with no usable args.
 */
export function formatToolCall(toolName: string, args: unknown): string {
	const name = toolName.trim();
	const fields = args && typeof args === "object" ? (args as Record<string, unknown>) : {};

	switch (name.toLowerCase()) {
		case "read": {
			const path = primaryValue(fields, ["file_path", "path"]);
			return path ? `${name} ${path}${lineRange(fields)}` : name;
		}
		case "edit":
		case "write":
		case "ls": {
			const path = primaryValue(fields, ["file_path", "path"]);
			return path ? `${name} ${path}` : name;
		}
		case "bash": {
			const command = primaryValue(fields, ["command", "cmd"]);
			return command ? `${name} ${command}` : name;
		}
		case "find": {
			const pattern = primaryValue(fields, ["pattern", "glob", "query"]);
			return pattern ? `${name} ${pattern}` : name;
		}
		case "grep": {
			const pattern = primaryValue(fields, ["pattern", "query"]);
			return pattern ? `${name} /${pattern}/` : name;
		}
		default:
			return formatGenericCall(name, fields);
	}
}

/**
 * Extracts a structured tool result summary from a `tool_execution_end` event.
 *
 * Returns `undefined` for any other event type or when `toolName` is absent (the
 * two minimum fields needed to identify which tool produced the result). All other
 * fields are optional so callers never need to check for missing intermediate
 * structures — `resultText` resolves the first text-typed content item, falling back
 * to the first content item regardless of type, and is `undefined` when content is
 * absent or empty.
 */
export function toolResultOf(event: PiJsonEvent): {
	toolName: string;
	toolCallId?: string;
	resultText?: string;
	details?: unknown;
	isError?: boolean;
} | undefined {
	if (event.type !== "tool_execution_end") return undefined;
	if (!event.toolName) return undefined;

	const result = event.result;
	const textItem = result?.content?.find((c) => c.type === "text");
	const resultText = textItem?.text ?? result?.content?.[0]?.text;

	return {
		toolName: event.toolName,
		toolCallId: event.toolCallId,
		resultText,
		details: result?.details,
		isError: event.isError,
	};
}

export function finalAssistantText(events: PiJsonEvent[]): string | undefined {
	for (let i = events.length - 1; i >= 0; i--) {
		const event = events[i];
		if (!isMessageEnd(event)) continue;
		if (!event.message) continue;

		const text = assistantTextOf(event.message);
		if (text) return text;
	}
	return undefined;
}
