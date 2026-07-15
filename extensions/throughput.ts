/**
 * Throughput producer.
 *
 * Watches the assistant message stream and, at each message end, publishes an
 * output-token-per-second figure on the `harness:throughput` channel for the
 * footer to render. A turn with no observable text cadence (tool-call-only, a
 * single delta, or a sub-threshold burst) publishes `null` rather than a
 * fabricated figure. This is a non-visual extension: it registers no command or
 * tool and owns no chrome.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { publish } from "../packages/events/index.ts";
import {
	type StreamAccumulator,
	emptyStream,
	finalizeTokensPerSecond,
	markToolCall,
	recordContentDelta,
} from "../packages/statusbar/throughput.ts";

function isAssistantMessage(message: unknown): boolean {
	return typeof message === "object" && message !== null && (message as { role?: unknown }).role === "assistant";
}

function readOutputTokens(message: unknown): number {
	const usage = (message as { usage?: { output?: unknown } }).usage;
	return typeof usage?.output === "number" ? usage.output : 0;
}

function messageHasToolCall(message: unknown): boolean {
	const content = (message as { content?: unknown }).content;
	return Array.isArray(content) && content.some((block) => (block as { type?: unknown }).type === "toolCall");
}

export default function throughput(pi: ExtensionAPI): void {
	let stream: StreamAccumulator = emptyStream();
	let turnId = "";

	pi.on("turn_start", (event) => {
		turnId = String(event.turnIndex);
		stream = emptyStream();
	});

	pi.on("message_start", (event) => {
		if (isAssistantMessage(event.message)) stream = emptyStream();
	});

	pi.on("message_update", (event) => {
		if (!isAssistantMessage(event.message)) return;

		const delta = event.assistantMessageEvent;
		if (delta.type === "toolcall_delta") {
			stream = markToolCall(stream);
			return;
		}

		if (delta.type !== "text_delta" && delta.type !== "thinking_delta") return;
		if (!delta.delta) return;

		stream = recordContentDelta(stream, delta.delta.length, Date.now());
	});

	pi.on("message_end", (event) => {
		if (!isAssistantMessage(event.message)) return;

		if (messageHasToolCall(event.message)) stream = markToolCall(stream);

		const tokensPerSecond = finalizeTokensPerSecond(stream, readOutputTokens(event.message));
		publish(pi, "harness:throughput", { tokensPerSecond, turnId });

		stream = emptyStream();
	});
}
