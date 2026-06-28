import test from "node:test";
import assert from "node:assert/strict";
import {
	parseNdjsonLine,
	isMessageEnd,
	assistantTextOf,
	assistantThinkingOf,
	finalAssistantText,
	formatToolCall,
	tokensOf,
	toolResultOf,
	TOOL_CALL_VALUE_MAX,
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

test("formatToolCall: built-in file tools mirror Pi's native `<name> <path>` title", () => {
	assert.equal(formatToolCall("read", { path: ".gitignore" }), "read .gitignore");
	assert.equal(formatToolCall("read", { file_path: "src/foo.ts" }), "read src/foo.ts");
	assert.equal(formatToolCall("edit", { path: "packages/a.ts", edits: [] }), "edit packages/a.ts");
	assert.equal(formatToolCall("write", { path: "out.txt", content: "x" }), "write out.txt");
	assert.equal(formatToolCall("ls", { path: "src" }), "ls src");
});

test("formatToolCall: read carries the line range when offset/limit are present", () => {
	assert.equal(formatToolCall("read", { path: "a.ts", offset: 1, limit: 60 }), "read a.ts:1-60");
	assert.equal(formatToolCall("read", { path: "a.ts", limit: 60 }), "read a.ts:1-60");
	assert.equal(formatToolCall("read", { path: "a.ts", offset: 40 }), "read a.ts:40");
});

test("formatToolCall: bash shows the command, search tools show the pattern", () => {
	assert.equal(formatToolCall("bash", { command: "pnpm run test" }), "bash pnpm run test");
	assert.equal(formatToolCall("find", { pattern: "*.test.ts" }), "find *.test.ts");
	assert.equal(formatToolCall("grep", { pattern: "TODO", glob: "*.ts" }), "grep /TODO/");
});

test("formatToolCall: an array primary arg renders as a brace list", () => {
	assert.equal(
		formatToolCall("find", { pattern: ["README.md", "package.json"] }),
		"find {README.md,package.json}",
	);
});

test("formatToolCall: tool name matching is case-insensitive", () => {
	assert.equal(formatToolCall("Read", { path: "src/foo.ts" }), "Read src/foo.ts");
	assert.equal(formatToolCall("BASH", { command: "ls" }), "BASH ls");
});

test("formatToolCall: generic/MCP tools show key args as (key: \"value\", …)", () => {
	assert.equal(
		formatToolCall("engram_mem_save", { query: "auth bug", project: "pi-harness" }),
		'engram_mem_save (query: "auth bug", project: "pi-harness")',
	);
	assert.equal(formatToolCall("some_tool", { count: 3, enabled: true }), "some_tool (count: 3, enabled: true)");
});

test("formatToolCall: the MCP/plugin prefix in the tool name is preserved verbatim", () => {
	assert.equal(
		formatToolCall("mcp__engram__mem_search", { query: "q" }),
		'mcp__engram__mem_search (query: "q")',
	);
	assert.equal(
		formatToolCall("plugin:engram:engram - Search Memory", { query: "q" }),
		'plugin:engram:engram - Search Memory (query: "q")',
	);
});

test("formatToolCall: a long value is truncated PER VALUE, not the whole line", () => {
	const longPath = "a".repeat(100);
	const result = formatToolCall("read", { path: longPath });
	const value = result.slice("read ".length);

	assert.equal(value.length, TOOL_CALL_VALUE_MAX, "the value alone is capped at the per-value max");
	assert.ok(value.endsWith("…"), "an over-long value ends with an ellipsis");
	assert.ok(result.startsWith("read "), "the tool name and structure stay visible");
});

test("formatToolCall: a generic tool caps its key count with a trailing ellipsis", () => {
	const result = formatToolCall("big_tool", { a: "1", b: "2", c: "3", d: "4", e: "5", f: "6" });
	assert.ok(result.includes(", …)"), `over-cap key lists end with an ellipsis, got: ${result}`);
	assert.ok(!result.includes("e:"), "keys beyond the cap are not shown");
});

test("formatToolCall: always returns at least the tool name", () => {
	assert.equal(formatToolCall("read", {}), "read");
	assert.equal(formatToolCall("read", undefined), "read");
	assert.equal(formatToolCall("mystery", { nested: { deep: 1 } }), "mystery");
});

// ---------------------------------------------------------------------------
// toolResultOf
// ---------------------------------------------------------------------------

test("toolResultOf: returns undefined for non-tool_execution_end events", () => {
	assert.equal(toolResultOf({ type: "tool_execution_start", toolName: "read" }), undefined);
	assert.equal(toolResultOf({ type: "message_end" }), undefined);
	assert.equal(toolResultOf({ type: "message_start" }), undefined);
	assert.equal(toolResultOf({}), undefined);
});

test("toolResultOf: returns undefined when tool_execution_end has no toolName", () => {
	assert.equal(toolResultOf({ type: "tool_execution_end" }), undefined);
});

test("toolResultOf: extracts toolName, toolCallId, resultText, details, isError from a tool_execution_end event", () => {
	const event: PiJsonEvent = {
		type: "tool_execution_end",
		toolName: "read",
		toolCallId: "call-abc",
		result: {
			content: [
				{ type: "text", text: "file content here" },
			],
			details: { truncation: null },
		},
		isError: false,
	};
	const result = toolResultOf(event);
	assert.ok(result !== undefined);
	assert.equal(result.toolName, "read");
	assert.equal(result.toolCallId, "call-abc");
	assert.equal(result.resultText, "file content here");
	assert.deepEqual(result.details, { truncation: null });
	assert.equal(result.isError, false);
});

test("toolResultOf: prefers the first type:text content item for resultText", () => {
	const event: PiJsonEvent = {
		type: "tool_execution_end",
		toolName: "bash",
		result: {
			content: [
				{ type: "image", text: "" },
				{ type: "text", text: "exit code: 0" },
			],
		},
	};
	const result = toolResultOf(event);
	assert.ok(result !== undefined);
	assert.equal(result.resultText, "exit code: 0");
});

test("toolResultOf: falls back to content[0].text when no type:text item exists", () => {
	const event: PiJsonEvent = {
		type: "tool_execution_end",
		toolName: "bash",
		result: {
			content: [{ type: "image", text: "data-url" }],
		},
	};
	const result = toolResultOf(event);
	assert.ok(result !== undefined);
	assert.equal(result.resultText, "data-url");
});

test("toolResultOf: resultText is undefined when content is absent or empty", () => {
	const noContent = toolResultOf({ type: "tool_execution_end", toolName: "read", result: {} });
	assert.ok(noContent !== undefined);
	assert.equal(noContent.resultText, undefined);

	const emptyContent = toolResultOf({ type: "tool_execution_end", toolName: "read", result: { content: [] } });
	assert.ok(emptyContent !== undefined);
	assert.equal(emptyContent.resultText, undefined);
});

test("toolResultOf: is defensive when result is absent", () => {
	const event: PiJsonEvent = { type: "tool_execution_end", toolName: "write" };
	const result = toolResultOf(event);
	assert.ok(result !== undefined);
	assert.equal(result.toolName, "write");
	assert.equal(result.toolCallId, undefined);
	assert.equal(result.resultText, undefined);
	assert.equal(result.details, undefined);
	assert.equal(result.isError, undefined);
});

test("toolResultOf: isError:true is carried through", () => {
	const event: PiJsonEvent = {
		type: "tool_execution_end",
		toolName: "bash",
		result: { content: [{ type: "text", text: "error output" }] },
		isError: true,
	};
	const result = toolResultOf(event);
	assert.ok(result !== undefined);
	assert.equal(result.isError, true);
	assert.equal(result.resultText, "error output");
});

// ---------------------------------------------------------------------------
// parseNdjsonLine: new fields populated for tool_execution_end
// ---------------------------------------------------------------------------

test("parseNdjsonLine: populates toolCallId, result, and isError for a tool_execution_end line", () => {
	const line = JSON.stringify({
		type: "tool_execution_end",
		toolCallId: "call-x99",
		toolName: "edit",
		result: {
			content: [{ type: "text", text: "edit applied" }],
			details: { diff: "@@ -1 +1 @@\n-old\n+new" },
		},
		isError: false,
	});
	const event = parseNdjsonLine(line);
	assert.ok(event !== undefined);
	assert.equal(event.type, "tool_execution_end");
	assert.equal(event.toolCallId, "call-x99");
	assert.equal(event.toolName, "edit");
	assert.ok(event.result !== undefined);
	assert.deepEqual(event.result!.content, [{ type: "text", text: "edit applied" }]);
	assert.deepEqual(event.result!.details, { diff: "@@ -1 +1 @@\n-old\n+new" });
	assert.equal(event.isError, false);
});
