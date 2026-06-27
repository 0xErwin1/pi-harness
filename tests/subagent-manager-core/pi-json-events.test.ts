import test from "node:test";
import assert from "node:assert/strict";
import {
	parseNdjsonLine,
	isMessageEnd,
	assistantTextOf,
	assistantThinkingOf,
	finalAssistantText,
	tokensOf,
	type PiJsonEvent,
	type PiMessage,
} from "../../packages/subagent-manager-core/providers/pi-json-events.ts";

test("parseNdjsonLine returns parsed object for valid JSON", () => {
	const result = parseNdjsonLine('{"type":"message_end","message":{"role":"assistant"}}');
	assert.deepEqual(result, { type: "message_end", message: { role: "assistant" } });
});

test("parseNdjsonLine returns undefined for blank line", () => {
	assert.equal(parseNdjsonLine(""), undefined);
	assert.equal(parseNdjsonLine("   "), undefined);
	assert.equal(parseNdjsonLine("\t"), undefined);
});

test("parseNdjsonLine returns undefined for non-JSON text", () => {
	assert.equal(parseNdjsonLine("not json at all"), undefined);
	assert.equal(parseNdjsonLine("partial {json"), undefined);
});

test("isMessageEnd returns true only for message_end events", () => {
	const end: PiJsonEvent = { type: "message_end" };
	const other: PiJsonEvent = { type: "tool_execution_start" };
	const missing: PiJsonEvent = {};

	assert.equal(isMessageEnd(end), true);
	assert.equal(isMessageEnd(other), false);
	assert.equal(isMessageEnd(missing), false);
});

test("assistantTextOf returns trimmed first text content for assistant messages", () => {
	const message: PiMessage = {
		role: "assistant",
		content: [
			{ type: "text", text: "  hello world  " },
			{ type: "text", text: "second" },
		],
	};
	assert.equal(assistantTextOf(message), "hello world");
});

test("assistantTextOf returns undefined for non-assistant messages", () => {
	const message: PiMessage = {
		role: "user",
		content: [{ type: "text", text: "user text" }],
	};
	assert.equal(assistantTextOf(message), undefined);
});

test("assistantTextOf returns undefined when content has no text parts", () => {
	const message: PiMessage = {
		role: "assistant",
		content: [{ type: "tool_use" }],
	};
	assert.equal(assistantTextOf(message), undefined);
});

test("finalAssistantText returns undefined for empty event list", () => {
	assert.equal(finalAssistantText([]), undefined);
});

test("finalAssistantText returns the last assistant message_end text via reverse scan", () => {
	const events: PiJsonEvent[] = [
		{
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "first" }] },
		},
		{
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "second" }] },
		},
	];
	assert.equal(finalAssistantText(events), "second");
});

test("finalAssistantText ignores non-assistant message_end events", () => {
	const events: PiJsonEvent[] = [
		{
			type: "message_end",
			message: { role: "user", content: [{ type: "text", text: "user text" }] },
		},
		{
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "assistant text" }] },
		},
	];
	assert.equal(finalAssistantText(events), "assistant text");
});

test("finalAssistantText ignores tool_result_end and tool_execution_start events", () => {
	const events: PiJsonEvent[] = [
		{ type: "tool_result_end", message: { role: "tool" } },
		{ type: "tool_execution_start", toolName: "bash" },
		{
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "real answer" }] },
		},
	];
	assert.equal(finalAssistantText(events), "real answer");
});

test("finalAssistantText ignores partial events without message_end type", () => {
	const events: PiJsonEvent[] = [
		{ type: "message_delta" },
		{ type: "content_block_delta" },
		{
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "complete" }] },
		},
	];
	assert.equal(finalAssistantText(events), "complete");
});

test("finalAssistantText returns undefined when no assistant message_end exists", () => {
	const events: PiJsonEvent[] = [
		{ type: "tool_execution_start", toolName: "read" },
		{ type: "tool_result_end" },
	];
	assert.equal(finalAssistantText(events), undefined);
});

test("assistantTextOf: per-message streaming — returns text from a single intermediate message_end", () => {
	const partialMessage: PiMessage = {
		role: "assistant",
		content: [{ type: "text", text: "Thinking about the problem…" }],
	};
	assert.equal(assistantTextOf(partialMessage), "Thinking about the problem…");
});

test("assistantThinkingOf: reads the `thinking` field of a thinking block", () => {
	const message: PiMessage = {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "  let me reason  " },
			{ type: "text", text: "answer" },
		],
	};
	assert.equal(assistantThinkingOf(message), "let me reason");
});

test("assistantThinkingOf: falls back to the `text` field of a thinking block", () => {
	const message: PiMessage = {
		role: "assistant",
		content: [{ type: "thinking", text: "reasoning in text field" }],
	};
	assert.equal(assistantThinkingOf(message), "reasoning in text field");
});

test("assistantThinkingOf: reads a `reasoning` block via text or reasoning field", () => {
	assert.equal(
		assistantThinkingOf({ role: "assistant", content: [{ type: "reasoning", text: "via text" }] }),
		"via text",
	);
	assert.equal(
		assistantThinkingOf({ role: "assistant", content: [{ type: "reasoning", reasoning: "via reasoning" }] }),
		"via reasoning",
	);
});

test("assistantThinkingOf: redacted_thinking carries no readable text → undefined", () => {
	const message: PiMessage = {
		role: "assistant",
		content: [{ type: "redacted_thinking" }, { type: "text", text: "answer" }],
	};
	assert.equal(assistantThinkingOf(message), undefined);
});

test("assistantThinkingOf: returns undefined when there is no thinking and for non-assistant roles", () => {
	assert.equal(assistantThinkingOf({ role: "assistant", content: [{ type: "text", text: "just an answer" }] }), undefined);
	assert.equal(assistantThinkingOf({ role: "user", content: [{ type: "thinking", thinking: "x" }] }), undefined);
	assert.equal(assistantThinkingOf({ role: "assistant" }), undefined);
});

test("thinking is a separate stream: assistantTextOf and finalAssistantText return only final text", () => {
	const message: PiMessage = {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "internal reasoning that must not leak" },
			{ type: "text", text: "public answer" },
		],
	};

	assert.equal(assistantTextOf(message), "public answer", "final text only, never the thinking");
	assert.equal(
		finalAssistantText([{ type: "message_end", message }]),
		"public answer",
		"run result text must exclude thinking",
	);
});

test("tokensOf: sums input and output from the canonical fields", () => {
	assert.deepEqual(tokensOf({ role: "assistant", usage: { input: 100, output: 50 } }), {
		input: 100,
		output: 50,
		total: 150,
	});
});

test("tokensOf: reads the Anthropic-style and camelCase field aliases", () => {
	assert.deepEqual(tokensOf({ role: "assistant", usage: { input_tokens: 200, output_tokens: 25 } }), {
		input: 200,
		output: 25,
		total: 225,
	});
	assert.deepEqual(tokensOf({ role: "assistant", usage: { inputTokens: 10, outputTokens: 5 } }), {
		input: 10,
		output: 5,
		total: 15,
	});
});

test("tokensOf: falls back to an explicit total when input/output are absent", () => {
	assert.deepEqual(tokensOf({ role: "assistant", usage: { total_tokens: 900 } }), {
		input: 0,
		output: 0,
		total: 900,
	});
});

test("tokensOf: returns undefined when usage is missing or empty (never a phantom zero)", () => {
	assert.equal(tokensOf({ role: "assistant" }), undefined);
	assert.equal(tokensOf({ role: "assistant", usage: {} }), undefined);
	assert.equal(tokensOf({ role: "assistant", usage: null }), undefined);
	assert.equal(tokensOf({ role: "assistant", usage: "nope" }), undefined);
});

test("tokensOf: ignores non-numeric field values", () => {
	assert.equal(tokensOf({ role: "assistant", usage: { input: "100", output: "50" } }), undefined);
});

test("assistantTextOf: per-message streaming — distinct from finalAssistantText (single vs last-scan)", () => {
	const firstMessage: PiMessage = {
		role: "assistant",
		content: [{ type: "text", text: "first turn" }],
	};
	const secondMessage: PiMessage = {
		role: "assistant",
		content: [{ type: "text", text: "second turn" }],
	};

	assert.equal(assistantTextOf(firstMessage), "first turn", "assistantTextOf reads the provided message directly");
	assert.equal(assistantTextOf(secondMessage), "second turn", "assistantTextOf reads the provided message directly");

	const events: PiJsonEvent[] = [
		{ type: "message_end", message: firstMessage },
		{ type: "message_end", message: secondMessage },
	];
	assert.equal(finalAssistantText(events), "second turn", "finalAssistantText returns the LAST assistant text");
});
