export interface PiMessage {
	role?: string;
	content?: Array<{ type?: string; text?: string }>;
	usage?: unknown;
	stopReason?: string;
}

export interface PiJsonEvent {
	type?: string;
	message?: PiMessage;
	toolName?: string;
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
