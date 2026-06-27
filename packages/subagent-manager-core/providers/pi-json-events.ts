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
