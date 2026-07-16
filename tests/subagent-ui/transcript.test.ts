import test from "node:test";
import assert from "node:assert/strict";

import { ICON_CATALOG } from "../../packages/icons/catalog.ts";
import {
	applyTranscriptEvent,
	buildTranscriptLines,
	emptyTranscript,
	sanitizeText,
	seedTranscript,
	type TranscriptEvent,
} from "../../packages/subagent-ui/transcript.ts";
import type { UiTheme } from "../../packages/subagent-ui/theme.ts";

const icons = ICON_CATALOG.nerdfont;

/** A no-op theme so assertions see the raw structural text, not ANSI. */
const theme: UiTheme = {
	fg: (_color, text) => text,
	bg: (_color, text) => text,
	bold: (text) => text,
	italic: (text) => text,
};

function lines(events: TranscriptEvent[], width = 60): string[] {
	let state = emptyTranscript();
	for (const event of events) state = applyTranscriptEvent(state, event);
	return buildTranscriptLines(state, width, theme, icons);
}

test("sanitizeText strips ANSI, expands tabs, and drops control chars", () => {
	const dirty = "\x1b[31mred\x1b[0m\ttab\x07bell";
	assert.equal(sanitizeText(dirty), "red  tabbell");
});

test("sanitizeText leaves clean text untouched", () => {
	assert.equal(sanitizeText("plain words 123"), "plain words 123");
});

test("a user message renders with the '> ' prefix", () => {
	const out = lines([{ type: "message_end", message: { role: "user", content: "hello there" } }]);
	assert.ok(
		out.some((l) => l.startsWith("> ") && l.includes("hello there")),
		`expected a '> ' user line, got: ${JSON.stringify(out)}`,
	);
});

test("assistant text renders without a role prefix, thinking with '~ '", () => {
	const out = lines([
		{
			type: "message_end",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "let me reason" },
					{ type: "text", text: "the answer is 42" },
				],
			},
		},
	]);

	assert.ok(out.some((l) => l.startsWith("~ ") && l.includes("let me reason")), `thinking line missing: ${JSON.stringify(out)}`);
	assert.ok(out.some((l) => l.includes("the answer is 42") && !l.startsWith("~ ") && !l.startsWith("> ")), `assistant text missing: ${JSON.stringify(out)}`);
});

test("an assistant tool call renders with the '→ ' prefix and the tool name", () => {
	const out = lines([
		{
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "toolCall", id: "t1", name: "Bash", arguments: { command: "ls" } }],
			},
		},
	]);

	assert.ok(out.some((l) => l.startsWith("→ ") && l.includes("Bash")), `tool call line missing: ${JSON.stringify(out)}`);
});

test("a finished tool execution renders an 'output:' line, an errored one 'error:'", () => {
	const ok = lines([
		{ type: "tool_execution_start", toolCallId: "t1", toolName: "Bash" },
		{ type: "tool_execution_end", toolCallId: "t1", toolName: "Bash", isError: false, result: "file.txt" },
	]);
	assert.ok(ok.some((l) => l.includes("output:") && l.includes("file.txt")), `output line missing: ${JSON.stringify(ok)}`);

	const bad = lines([
		{ type: "tool_execution_start", toolCallId: "t2", toolName: "Bash" },
		{ type: "tool_execution_end", toolCallId: "t2", toolName: "Bash", isError: true, result: "boom" },
	]);
	assert.ok(bad.some((l) => l.includes("error:") && l.includes("boom")), `error line missing: ${JSON.stringify(bad)}`);
});

test("a running tool (started, not ended) shows a live running marker", () => {
	const out = lines([{ type: "tool_execution_start", toolCallId: "t1", toolName: "Grep" }]);
	assert.ok(out.some((l) => l.includes("Grep") && l.toLowerCase().includes("running")), `running marker missing: ${JSON.stringify(out)}`);
});

test("streaming updates surface a live assistant buffer before the message ends", () => {
	const out = lines([
		{ type: "message_start", message: { role: "assistant", content: [] } },
		{ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "partial repl" }] } },
	]);
	assert.ok(out.some((l) => l.includes("partial repl")), `live buffer missing: ${JSON.stringify(out)}`);
});

test("message_end clears the live buffer so streamed text is not duplicated", () => {
	let state = emptyTranscript();
	state = applyTranscriptEvent(state, { type: "message_start", message: { role: "assistant", content: [] } });
	state = applyTranscriptEvent(state, { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "done reply" }] } });
	state = applyTranscriptEvent(state, { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done reply" }] } });

	const out = buildTranscriptLines(state, 60, theme, icons);
	const occurrences = out.filter((l) => l.includes("done reply")).length;
	assert.equal(occurrences, 1, `expected exactly one 'done reply', got ${occurrences}: ${JSON.stringify(out)}`);
});

test("redacted thinking renders a placeholder rather than leaking content", () => {
	const out = lines([
		{
			type: "message_end",
			message: { role: "assistant", content: [{ type: "thinking", thinking: "secret", redacted: true }] },
		},
	]);
	assert.ok(out.some((l) => l.includes("redacted")), `redacted placeholder missing: ${JSON.stringify(out)}`);
	assert.ok(!out.some((l) => l.includes("secret")), `redacted content leaked: ${JSON.stringify(out)}`);
});

test("wide streamed lines are sanitized so they cannot desync the overlay width", () => {
	const out = lines([{ type: "message_end", message: { role: "user", content: "a\x1b[31mb\tc" } }], 80);
	assert.ok(!out.some((l) => l.includes("\x1b")), `raw escape leaked into transcript: ${JSON.stringify(out)}`);
});

test("seedTranscript folds a running agent's prior messages into renderable history", () => {
	const state = seedTranscript([
		{ role: "user", content: "hello", timestamp: 1 },
		{ role: "assistant", content: [{ type: "text", text: "hi there" }], timestamp: 2 },
	]);

	const out = buildTranscriptLines(state, 60, theme, icons);
	assert.ok(out.some((l) => l.startsWith("> ") && l.includes("hello")), `seeded user message missing: ${JSON.stringify(out)}`);
	assert.ok(out.some((l) => l.includes("hi there")), `seeded assistant message missing: ${JSON.stringify(out)}`);
});

test("seedTranscript folds a settled agent's final transcript, including a tool result", () => {
	const state = seedTranscript([
		{ role: "user", content: "run ls", timestamp: 1 },
		{
			role: "toolResult",
			toolCallId: "t1",
			toolName: "Bash",
			content: [{ type: "text", text: "file.txt" }],
			isError: false,
			timestamp: 2,
		},
	]);

	const out = buildTranscriptLines(state, 60, theme, icons);
	// Asserting the exact rendered text is what pins the `result: { content }` wrapper:
	// a bare content array still yields a line containing "output:" and "file.txt",
	// because previewResult falls back to JSON.stringify.
	assert.ok(
		out.some((l) => l.includes("output: file.txt")),
		`seeded tool result missing: ${JSON.stringify(out)}`,
	);
});

test("seedTranscript skips custom-role messages it does not know how to render", () => {
	const state = seedTranscript([
		{ role: "user", content: "before", timestamp: 1 },
		{
			role: "bashExecution",
			command: "ls",
			output: "a.txt",
			exitCode: 0,
			cancelled: false,
			truncated: false,
			timestamp: 2,
		},
		{ role: "compactionSummary", summary: "summary text", tokensBefore: 100, timestamp: 3 },
	]);

	const out = buildTranscriptLines(state, 60, theme, icons);
	assert.ok(out.some((l) => l.includes("before")), `seeded user message missing: ${JSON.stringify(out)}`);
	assert.ok(!out.some((l) => l.includes("summary text")), `custom-role message must not render: ${JSON.stringify(out)}`);
});

test("seedTranscript on a genuinely empty session yields no items", () => {
	const state = seedTranscript([]);
	assert.deepEqual(buildTranscriptLines(state, 60, theme, icons), []);
});

test("live events appended after seedTranscript do not duplicate or lose seeded history", () => {
	let state = seedTranscript([{ role: "user", content: "seeded message", timestamp: 1 }]);

	const liveEvent: TranscriptEvent = {
		type: "message_end",
		message: { role: "assistant", content: [{ type: "text", text: "live reply" }] },
	};
	state = applyTranscriptEvent(state, liveEvent);

	const out = buildTranscriptLines(state, 60, theme, icons);
	assert.equal(out.filter((l) => l.includes("seeded message")).length, 1);
	assert.equal(out.filter((l) => l.includes("live reply")).length, 1);
});

test("applyTranscriptEvent does not mutate the previous state", () => {
	const start = applyTranscriptEvent(emptyTranscript(), {
		type: "message_end",
		message: { role: "user", content: "first" },
	});
	const beforeLen = buildTranscriptLines(start, 60, theme, icons).length;

	applyTranscriptEvent(start, { type: "message_end", message: { role: "user", content: "second" } });

	assert.equal(buildTranscriptLines(start, 60, theme, icons).length, beforeLen);
});
