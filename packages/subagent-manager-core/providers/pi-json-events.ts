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
