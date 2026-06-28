import test from "node:test";
import assert from "node:assert/strict";
import {
	buildViewerModel,
	eventsToBodyLines,
	formatInvocationSubline,
	formatModelEffort,
	matchResultToCall,
	resolveViewportOffset,
	styleDiffLine,
	styleToolLine,
	styleTranscriptLine,
	transcriptLineColor,
} from "../../packages/subagent-manager-pi/tui/conversation-viewer-model.ts";
import type { RunEvent, RunSnapshot } from "../../packages/subagent-manager-core/events.ts";

/**
 * Deterministic styler double: `fg` wraps text in `<color>…</color>` and `bold`
 * in `<b>…</b>`, so the styled output of a body line is fully assertable without a
 * real theme. The verb is bold, the args accent, the summary dim/success/error.
 */
const STYLER = {
	fg: (color: string, text: string): string => `<${color}>${text}</${color}>`,
	bold: (text: string): string => `<b>${text}</b>`,
};

/** Strips the internal kind markers (control chars) so a raw body line's visible width can be measured. */
function stripMarkers(line: string): string {
	return line.replace(/[\u0001-\u0006]/g, "");
}

const isToolLine = (line: string): boolean => styleToolLine(line, STYLER) !== undefined;
const isDiffLine = (line: string): boolean => styleDiffLine(line, STYLER) !== undefined;

const BASE_STARTED_AT = "2024-01-01T12:00:00.000Z";
const BASE_NOW = Date.parse(BASE_STARTED_AT) + 3000;

let eventSeq = 0;

function makeSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
	return {
		id: "r1",
		agent: "viewer-agent",
		status: "running",
		requestedExecutionMode: "auto",
		policyMode: "normal",
		startedAt: BASE_STARTED_AT,
		updatedAt: BASE_STARTED_AT,
		...overrides,
	};
}

function progress(message: string): RunEvent {
	return { id: `e${eventSeq++}`, runId: "r1", type: "run.progress", message, at: new Date().toISOString() };
}

function tool(name: string): RunEvent {
	return progress(`tool: ${name}`);
}

function toolWithTarget(name: string, target: string): RunEvent {
	return {
		id: `e${eventSeq++}`,
		runId: "r1",
		type: "run.progress",
		message: `tool: ${name}`,
		target,
		at: new Date().toISOString(),
	};
}

function toolWithCall(name: string, toolCall: string): RunEvent {
	return {
		id: `e${eventSeq++}`,
		runId: "r1",
		type: "run.progress",
		message: `tool: ${name}`,
		toolCall,
		at: new Date().toISOString(),
	};
}

function assistant(text: string, turn: number): RunEvent {
	return { id: `e${eventSeq++}`, runId: "r1", type: "run.output", chunk: text, role: "assistant", text, turn, at: new Date().toISOString() };
}

function thinking(text: string): RunEvent {
	return { id: `e${eventSeq++}`, runId: "r1", type: "run.output", chunk: text, kind: "thinking", text, turn: 1, at: new Date().toISOString() };
}

function started(): RunEvent {
	return { id: `e${eventSeq++}`, runId: "r1", type: "run.started", agent: "viewer-agent", at: new Date().toISOString() };
}

function toolResult(
	toolName: string,
	opts: { toolCallId?: string; resultText?: string; details?: unknown; isError?: boolean } = {},
): RunEvent {
	return { id: `e${eventSeq++}`, runId: "r1", type: "run.tool_result", toolName, ...opts, at: new Date().toISOString() };
}

test("buildViewerModel: header contains agent name, status, and elapsed time", () => {
	const model = buildViewerModel({
		snapshot: makeSnapshot(),
		events: [],
		scrollOffset: 0,
		width: 80,
		height: 20,
		now: BASE_NOW,
	});

	const header = model.headerLines.join(" ");
	assert.ok(header.includes("viewer-agent"), "header must contain agent name");
	assert.ok(header.includes("running"), "header must contain status");
});

test("eventsToBodyLines: a tool-only run (no assistant text) still produces non-empty lines", () => {
	const events = [started(), progress("starting subprocess for viewer-agent"), tool("Read"), tool("Bash")];

	const lines = eventsToBodyLines(events, 80);

	assert.ok(lines.length > 0, "tool activity must surface even with no assistant text");
	assert.ok(lines.some((l) => l.includes("Read")), "must show the Read tool");
	assert.ok(lines.some((l) => l.includes("Bash")), "must show the Bash tool");
});

test("eventsToBodyLines: mixed events render chronologically (tool → assistant → tool)", () => {
	const events = [tool("Read"), assistant("Here is what I found", 1), tool("Write")];

	const lines = eventsToBodyLines(events, 80);

	const readIdx = lines.findIndex((l) => l.includes("Read"));
	const textIdx = lines.findIndex((l) => l.includes("Here is what I found"));
	const writeIdx = lines.findIndex((l) => l.includes("Write"));

	assert.ok(readIdx >= 0 && textIdx >= 0 && writeIdx >= 0, "all three events must be present");
	assert.ok(readIdx < textIdx, "Read tool must come before the assistant text");
	assert.ok(textIdx < writeIdx, "assistant text must come before the Write tool");
});

test("eventsToBodyLines: assistant output gets an [Assistant] section header", () => {
	const lines = eventsToBodyLines([assistant("response body", 1)], 80);

	assert.ok(lines.some((l) => l.includes("[Assistant]")), "assistant output must be sectioned");
	assert.ok(lines.some((l) => l.includes("response body")), "assistant text must be present");
});

test("eventsToBodyLines: terminal events surface completed/failed", () => {
	const completed = eventsToBodyLines(
		[{ id: "c1", runId: "r1", type: "run.completed", summary: { text: "ok", executionMode: "subprocess", routedBy: "t" }, at: BASE_STARTED_AT }],
		80,
	);
	assert.ok(completed.some((l) => l.includes("[done]")), "completion must surface");

	const failed = eventsToBodyLines(
		[{ id: "f1", runId: "r1", type: "run.failed", error: "boom", at: BASE_STARTED_AT }],
		80,
	);
	assert.ok(failed.some((l) => l.includes("boom")), "failure reason must surface");
});

test("buildViewerModel: footer contains line count and percentage", () => {
	const model = buildViewerModel({
		snapshot: makeSnapshot(),
		events: [assistant("hello", 1)],
		scrollOffset: 0,
		width: 80,
		height: 100,
		now: BASE_NOW,
	});

	assert.ok(model.footerLine.includes("%"), "footer must contain percentage");
});

test("buildViewerModel: maxScroll is max(0, totalBodyLines - height)", () => {
	const events = Array.from({ length: 5 }, (_, i) => assistant(`line ${i}`, i + 1));

	const model = buildViewerModel({
		snapshot: makeSnapshot(),
		events,
		scrollOffset: 0,
		width: 80,
		height: 4,
		now: BASE_NOW,
	});

	// Each assistant message produces 2 lines: "[Assistant]" + text; 5 messages = 10 total.
	// maxScroll = max(0, 10 - 4) = 6.
	assert.equal(model.maxScroll, 6, "maxScroll must equal (total lines - height)");
});

test("buildViewerModel: autoScroll=true clamps the viewport to the height", () => {
	const events = Array.from({ length: 20 }, (_, i) => assistant(`line ${i}`, i + 1));

	const model = buildViewerModel({
		snapshot: makeSnapshot(),
		events,
		scrollOffset: 0,
		width: 80,
		height: 5,
		now: BASE_NOW,
		autoScroll: true,
	});

	assert.equal(model.bodyLines.length, 5, "viewport must be clamped to height when autoScroll");
});

test("buildViewerModel: replay renders all turns from turn 1", () => {
	const events = [assistant("Turn one content", 1), tool("Read"), assistant("Turn two content", 2)];

	const model = buildViewerModel({
		snapshot: makeSnapshot(),
		events,
		scrollOffset: 0,
		width: 80,
		height: 100,
		now: BASE_NOW,
	});

	assert.ok(model.bodyLines.some((l) => l.includes("Turn one content")), "replay must include turn 1");
	assert.ok(model.bodyLines.some((l) => l.includes("Turn two content")), "replay must include turn 2");
});

test("buildViewerModel: empty events produce an empty body", () => {
	const model = buildViewerModel({
		snapshot: makeSnapshot(),
		events: [],
		scrollOffset: 0,
		width: 80,
		height: 20,
		now: BASE_NOW,
	});

	assert.equal(model.bodyLines.length, 0, "no events → empty body");
	assert.equal(model.maxScroll, 0);
});

test("buildViewerModel: viewport windowing slices body to height", () => {
	const events = Array.from({ length: 10 }, (_, i) => assistant(`Item ${i}`, i + 1));

	const model = buildViewerModel({
		snapshot: makeSnapshot(),
		events,
		scrollOffset: 0,
		width: 80,
		height: 5,
		now: BASE_NOW,
	});

	assert.equal(model.bodyLines.length, 5, "bodyLines must be sliced to height");
});

test("buildViewerModel: works without snapshot (no elapsed shown)", () => {
	assert.doesNotThrow(() =>
		buildViewerModel({
			events: [assistant("hello", 1)],
			scrollOffset: 0,
			width: 80,
			height: 20,
			now: BASE_NOW,
		}),
	);
});

test("eventsToBodyLines: a tool line renders `<verb> <args>` with NO glyph prefix", () => {
	const [line] = eventsToBodyLines([toolWithTarget("read", "src/foo.ts")], 80);

	assert.equal(styleTranscriptLine(line, STYLER), "<b>read</b> <accent>src/foo.ts</accent>");
	assert.ok(isToolLine(line), "the line must be classified as a tool line");
	assert.ok(!stripMarkers(line).includes("▸"), "the tool glyph prefix must be gone");
	assert.ok(!line.includes("[tool]"), "the literal [tool] prefix must be gone");
});

test("eventsToBodyLines: a tool with no args renders just the bold verb", () => {
	const [line] = eventsToBodyLines([tool("bash")], 80);

	assert.equal(styleTranscriptLine(line, STYLER), "<b>bash</b>");
});

test("eventsToBodyLines: a tool line uses the richer toolCall verbatim (verb bold, args accent)", () => {
	const [line] = eventsToBodyLines(
		[toolWithCall("engram_mem_save", 'engram_mem_save (query: "auth bug", project: "pi-harness")')],
		120,
	);

	assert.equal(
		styleTranscriptLine(line, STYLER),
		'<b>engram_mem_save</b> <accent>(query: "auth bug", project: "pi-harness")</accent>',
	);
});

test("eventsToBodyLines: bash keeps the `$ <cmd>` arg style", () => {
	const [line] = eventsToBodyLines([toolWithTarget("bash", "pnpm test")], 80);

	assert.equal(styleTranscriptLine(line, STYLER), "<b>bash</b> <accent>$ pnpm test</accent>");
});

test("eventsToBodyLines: identical toolCall lines collapse with a ×N count", () => {
	const events = [
		toolWithCall("read", "read a.ts"),
		toolWithCall("read", "read a.ts"),
		toolWithCall("read", "read a.ts"),
	];

	const toolLines = eventsToBodyLines(events, 80).filter(isToolLine);

	assert.equal(toolLines.length, 1, "three identical rich tool calls must collapse to one line");
	assert.ok(stripMarkers(toolLines[0]).includes("×3"), `collapsed line must carry the count, got: ${stripMarkers(toolLines[0])}`);
});

test("eventsToBodyLines: consecutive identical tool lines collapse with a ×N count", () => {
	const events = [
		toolWithTarget("read", "a.ts"),
		toolWithTarget("read", "a.ts"),
		toolWithTarget("read", "a.ts"),
	];

	const toolLines = eventsToBodyLines(events, 80).filter(isToolLine);

	assert.equal(toolLines.length, 1, "three identical tool calls must collapse to one line");
	assert.ok(stripMarkers(toolLines[0]).includes("×3"), `collapsed line must carry the count, got: ${stripMarkers(toolLines[0])}`);
});

test("eventsToBodyLines: distinct tool targets are NOT collapsed (no information lost)", () => {
	const events = [
		toolWithTarget("read", "a.ts"),
		toolWithTarget("read", "b.ts"),
		toolWithTarget("read", "c.ts"),
	];

	const toolLines = eventsToBodyLines(events, 80).filter(isToolLine);

	assert.equal(toolLines.length, 3, "distinct targets must each keep their own line");
	assert.ok(!toolLines.some((l) => stripMarkers(l).includes("×")), "distinct lines must not be counted");
});

test("eventsToBodyLines: a long tool arg is truncated to width", () => {
	const longTarget = "x".repeat(200);
	const [line] = eventsToBodyLines([toolWithTarget("read", longTarget)], 40);
	const visible = stripMarkers(line);

	assert.ok(isToolLine(line), "tool line must exist");
	assert.ok(visible.length <= 40, `tool line must fit width, got ${visible.length}`);
	assert.ok(visible.endsWith("…"), "truncated line must end with an ellipsis");
});

test("styleToolLine: verb bold, args accent", () => {
	const [line] = eventsToBodyLines([toolWithTarget("read", "src/foo.ts")], 80);
	assert.equal(styleToolLine(line, STYLER), "<b>read</b> <accent>src/foo.ts</accent>");
});

test("styleToolLine: a no-args tool styles only the bold verb", () => {
	const [line] = eventsToBodyLines([tool("bash")], 80);
	assert.equal(styleToolLine(line, STYLER), "<b>bash</b>");
});

test("styleToolLine: returns undefined for a non-tool line so the caller can fall through", () => {
	assert.equal(styleToolLine("[Assistant]", STYLER), undefined);
	assert.equal(styleToolLine("plain body text", STYLER), undefined);
});

// ── per-tool result summaries ──────────────────────────────────────────────────

test("read result renders a dim `N lines` summary", () => {
	const [line] = eventsToBodyLines([tool("read"), toolResult("read", { resultText: "a\nb\nc" })], 80);
	assert.equal(styleTranscriptLine(line, STYLER), "<b>read</b> · <dim>3 lines</dim>");
});

test("read result uses details.truncation line counts, and the `out/total` form when truncated", () => {
	const exact = eventsToBodyLines(
		[tool("read"), toolResult("read", { resultText: "ignored", details: { truncation: { outputLines: 14 } } })],
		80,
	)[0];
	assert.equal(styleTranscriptLine(exact, STYLER), "<b>read</b> · <dim>14 lines</dim>");

	const truncated = eventsToBodyLines(
		[tool("read"), toolResult("read", { details: { truncation: { truncated: true, outputLines: 50, totalLines: 200 } } })],
		80,
	)[0];
	assert.equal(styleTranscriptLine(truncated, STYLER), "<b>read</b> · <dim>50/200 lines</dim>");
});

test("bash result shows `exit 0 · N lines` coloured success", () => {
	const [line] = eventsToBodyLines(
		[toolWithTarget("bash", "pnpm test"), toolResult("bash", { resultText: "line1\nline2\nexit code: 0" })],
		80,
	);
	assert.equal(styleTranscriptLine(line, STYLER), "<b>bash</b> <accent>$ pnpm test</accent> · <success>exit 0 · 3 lines</success>");
});

test("bash nonzero exit colours the summary error", () => {
	const [line] = eventsToBodyLines(
		[toolWithTarget("bash", "false"), toolResult("bash", { resultText: "boom\nexit code: 1" })],
		80,
	);
	assert.equal(styleTranscriptLine(line, STYLER), "<b>bash</b> <accent>$ false</accent> · <error>exit 1 · 2 lines</error>");
});

test("grep result shows `N matches`, singular for one", () => {
	const many = eventsToBodyLines(
		[toolWithCall("grep", "grep /foo/"), toolResult("grep", { resultText: "a.ts:1: foo\nb.ts:2: foo" })],
		80,
	)[0];
	assert.equal(styleTranscriptLine(many, STYLER), "<b>grep</b> <accent>/foo/</accent> · <dim>2 matches</dim>");

	const one = eventsToBodyLines(
		[toolWithCall("grep", "grep /foo/"), toolResult("grep", { resultText: "a.ts:1: foo" })],
		80,
	)[0];
	assert.equal(styleTranscriptLine(one, STYLER), "<b>grep</b> <accent>/foo/</accent> · <dim>1 match</dim>");
});

test("find / ls result shows `N results`", () => {
	const find = eventsToBodyLines(
		[toolWithCall("find", "find {*.ts}"), toolResult("find", { resultText: "a.ts\nb.ts\nc.ts" })],
		80,
	)[0];
	assert.equal(styleTranscriptLine(find, STYLER), "<b>find</b> <accent>{*.ts}</accent> · <dim>3 results</dim>");

	const ls = eventsToBodyLines(
		[toolWithTarget("ls", "src"), toolResult("ls", { resultText: "only" })],
		80,
	)[0];
	assert.equal(styleTranscriptLine(ls, STYLER), "<b>ls</b> <accent>src</accent> · <dim>1 result</dim>");
});

test("write result shows `N lines`", () => {
	const [line] = eventsToBodyLines(
		[toolWithTarget("write", "out.txt"), toolResult("write", { resultText: "x\ny" })],
		80,
	);
	assert.equal(styleTranscriptLine(line, STYLER), "<b>write</b> <accent>out.txt</accent> · <dim>2 lines</dim>");
});

test("an unknown tool omits the summary, but shows `error` when it errored", () => {
	const ok = eventsToBodyLines(
		[toolWithCall("custom_tool", "custom_tool (x: 1)"), toolResult("custom_tool", { resultText: "whatever" })],
		80,
	)[0];
	assert.equal(styleTranscriptLine(ok, STYLER), "<b>custom_tool</b> <accent>(x: 1)</accent>");

	const errored = eventsToBodyLines(
		[toolWithCall("custom_tool", "custom_tool (x: 1)"), toolResult("custom_tool", { isError: true })],
		80,
	)[0];
	assert.equal(styleTranscriptLine(errored, STYLER), "<b>custom_tool</b> <accent>(x: 1)</accent> · <error>error</error>");
});

test("an errored known tool still shows its summary but in error colour", () => {
	const [line] = eventsToBodyLines([tool("read"), toolResult("read", { resultText: "nope", isError: true })], 80);
	assert.equal(styleTranscriptLine(line, STYLER), "<b>read</b> · <error>1 lines</error>");
});

// ── edit diff rendering ─────────────────────────────────────────────────────────

test("edit result shows `+A -R` and renders the diff block with coloured +/- lines", () => {
	const diff = "--- a/x.rs\n+++ b/x.rs\n@@ -1,3 +1,3 @@\n context\n-old line\n+new line\n+added line";
	const styled = eventsToBodyLines([toolWithTarget("edit", "crates/x.rs"), toolResult("edit", { details: { diff } })], 80).map(
		(l) => styleTranscriptLine(l, STYLER),
	);

	assert.equal(styled[0], "<b>edit</b> <accent>crates/x.rs</accent> · <dim>+2 -1</dim>");
	assert.ok(styled.includes("<dim>@@ -1,3 +1,3 @@</dim>"), "hunk header dim");
	assert.ok(styled.includes("<dim> context</dim>"), "context line dim");
	assert.ok(styled.includes("<error>-old line</error>"), "removed line error");
	assert.ok(styled.includes("<success>+new line</success>"), "added line success");
	assert.ok(styled.includes("<success>+added line</success>"), "second added line success");
	assert.ok(!styled.some((s) => s.includes("+++")), "the +++ file header is skipped");
	assert.ok(!styled.some((s) => s.includes("--- a/")), "the --- file header is skipped");
});

test("a long edit diff caps the block and shows a `… +N more` continuation", () => {
	const body = Array.from({ length: 30 }, (_, i) => `+line ${i}`).join("\n");
	const diff = `--- a\n+++ b\n@@ -1 +1 @@\n${body}`;
	const lines = eventsToBodyLines([toolWithTarget("edit", "f.ts"), toolResult("edit", { details: { diff } })], 200);

	const diffLines = lines.filter(isDiffLine);
	assert.equal(diffLines.length, 21, "the block caps at 20 lines plus one continuation");
	assert.ok(
		stripMarkers(diffLines[20]).includes("11 more"),
		`continuation must report the remainder, got: ${stripMarkers(diffLines[20])}`,
	);
});

test("the collapsed-row body line for an edit carries the +A -R summary, never the full diff", () => {
	// The diff block lives only after the tool line in the transcript; the tool line's
	// own summary stays compact so the inline row shows just `+A -R`.
	const diff = "@@ -1 +1 @@\n-x\n+y";
	const [toolLine] = eventsToBodyLines([toolWithTarget("edit", "f.ts"), toolResult("edit", { details: { diff } })], 80);
	assert.equal(styleTranscriptLine(toolLine, STYLER), "<b>edit</b> <accent>f.ts</accent> · <dim>+1 -1</dim>");
});

// ── result/call correlation ─────────────────────────────────────────────────────

test("a result attaches to the most recent tool call by adjacency when no toolCallId", () => {
	const events = [tool("read"), tool("bash"), toolResult("bash", { resultText: "exit code: 0" })];
	const styled = eventsToBodyLines(events, 80).filter(isToolLine).map((l) => styleTranscriptLine(l, STYLER));

	assert.ok(styled.includes("<b>read</b>"), "the earlier read keeps no summary");
	assert.ok(styled.some((l) => l.startsWith("<b>bash</b>") && l.includes("exit 0")), "the adjacent bash gets the result");
});

test("matchResultToCall: exact toolCallId match wins over adjacency", () => {
	const slots = [
		{ toolCallId: "A", matched: false },
		{ toolCallId: "B", matched: false },
	];
	assert.equal(matchResultToCall(slots, { toolCallId: "A" }), 0);
});

test("matchResultToCall: falls back to the most recent unmatched slot when no id matches", () => {
	const slots = [
		{ toolCallId: undefined, matched: true },
		{ toolCallId: undefined, matched: false },
	];
	assert.equal(matchResultToCall(slots, { toolCallId: "Z" }), 1);
	assert.equal(matchResultToCall(slots, {}), 1);
});

test("matchResultToCall: returns undefined when every slot is already matched", () => {
	assert.equal(matchResultToCall([{ matched: true }], {}), undefined);
});

// ── model + effort ──────────────────────────────────────────────────────────────

test("formatInvocationSubline: both, one, or neither of model and thinking", () => {
	assert.equal(formatInvocationSubline("anthropic/claude-haiku-4-5", "high"), "  ↳ claude-haiku-4-5 · thinking: high");
	assert.equal(formatInvocationSubline("anthropic/claude-haiku-4-5", undefined), "  ↳ claude-haiku-4-5");
	assert.equal(formatInvocationSubline(undefined, "low"), "  ↳ thinking: low");
	assert.equal(formatInvocationSubline(undefined, undefined), undefined);
	assert.equal(formatInvocationSubline("", ""), undefined);
});

test("formatModelEffort: shortens the slash-qualified model id and joins thinking", () => {
	assert.equal(formatModelEffort("anthropic/claude-haiku-4-5", "high"), "claude-haiku-4-5 · thinking: high");
	assert.equal(formatModelEffort("claude-opus", undefined), "claude-opus");
	assert.equal(formatModelEffort(undefined, undefined), undefined);
});

test("buildViewerModel: exposes the snapshot model and thinking", () => {
	const model = buildViewerModel({
		snapshot: makeSnapshot({ model: "anthropic/claude-haiku-4-5", thinking: "high" }),
		events: [],
		scrollOffset: 0,
		width: 80,
		height: 20,
		now: BASE_NOW,
	});

	assert.equal(model.model, "anthropic/claude-haiku-4-5");
	assert.equal(model.thinking, "high");
});

test("buildViewerModel: counts every tool call regardless of result events", () => {
	const events = [tool("read"), tool("bash"), toolResult("bash", { resultText: "exit code: 0" })];

	const model = buildViewerModel({
		snapshot: makeSnapshot(),
		events,
		scrollOffset: 0,
		width: 80,
		height: 100,
		now: BASE_NOW,
	});

	assert.ok(model.headerLines[0].includes("2 tools"), `header must count 2 tools, got: ${model.headerLines[0]}`);
});

test("buildViewerModel: header shows tokens and tool count, never the old Nt/M shape", () => {
	const events = [
		assistant("first", 1),
		tool("read"),
		tool("bash"),
		assistant("second", 2),
	];

	const model = buildViewerModel({
		snapshot: makeSnapshot({ tokens: 5300 }),
		events,
		scrollOffset: 0,
		width: 80,
		height: 100,
		now: BASE_NOW,
	});

	assert.ok(model.headerLines[0].includes("5.3k tok"), `header must show tokens, got: ${model.headerLines[0]}`);
	assert.ok(model.headerLines[0].includes("2 tools"), `header must show the tool count, got: ${model.headerLines[0]}`);
	assert.ok(!model.headerLines[0].includes("2t/"), `header must not use the old turns/tools shape, got: ${model.headerLines[0]}`);
});

test("buildViewerModel: header tokens default to 0 tok when usage is absent", () => {
	const model = buildViewerModel({
		snapshot: makeSnapshot(),
		events: [tool("read")],
		scrollOffset: 0,
		width: 80,
		height: 100,
		now: BASE_NOW,
	});

	assert.ok(model.headerLines[0].includes("0 tok"), `header must show 0 tok with no usage, got: ${model.headerLines[0]}`);
});

test("buildViewerModel: footer shows 'following' when pinned to the bottom", () => {
	const events = Array.from({ length: 20 }, (_, i) => assistant(`line ${i}`, i + 1));

	const model = buildViewerModel({
		snapshot: makeSnapshot(),
		events,
		scrollOffset: 0,
		width: 80,
		height: 5,
		now: BASE_NOW,
		autoScroll: true,
	});

	assert.ok(model.footerLine.includes("following"), `footer must read 'following', got: ${model.footerLine}`);
});

test("buildViewerModel: footer shows 'paused' when scrolled away from the bottom", () => {
	const events = Array.from({ length: 20 }, (_, i) => assistant(`line ${i}`, i + 1));

	const model = buildViewerModel({
		snapshot: makeSnapshot(),
		events,
		scrollOffset: 2,
		width: 80,
		height: 5,
		now: BASE_NOW,
		autoScroll: false,
	});

	assert.ok(model.footerLine.includes("paused"), `footer must read 'paused', got: ${model.footerLine}`);
});

test("resolveViewportOffset: following tracks the growing tail (maxScroll)", () => {
	assert.equal(resolveViewportOffset(0, 20, true), 20);
	assert.equal(resolveViewportOffset(5, 40, true), 40);
});

test("resolveViewportOffset: paused stays put as the transcript grows", () => {
	// Same user offset, larger maxScroll after new events stream in → offset unchanged.
	assert.equal(resolveViewportOffset(5, 10, false), 5);
	assert.equal(resolveViewportOffset(5, 30, false), 5);
});

test("resolveViewportOffset: paused offset is clamped into range", () => {
	assert.equal(resolveViewportOffset(50, 20, false), 20);
	assert.equal(resolveViewportOffset(-3, 20, false), 0);
});

test("buildViewerModel: a paused viewport stays anchored when new events arrive", () => {
	const base = Array.from({ length: 10 }, (_, i) => assistant(`L${i}`, i + 1));

	const before = buildViewerModel({
		snapshot: makeSnapshot(),
		events: base,
		scrollOffset: 3,
		width: 80,
		height: 4,
		now: BASE_NOW,
		autoScroll: false,
	});

	const after = buildViewerModel({
		snapshot: makeSnapshot(),
		events: [...base, assistant("NEW", 11), tool("read")],
		scrollOffset: 3,
		width: 80,
		height: 4,
		now: BASE_NOW,
		autoScroll: false,
	});

	assert.deepEqual(after.bodyLines, before.bodyLines, "paused viewport must show the same window after new events");
});

test("transcriptLineColor: distinct semantic colours per line kind (plain-text markers, no emoji)", () => {
	assert.equal(transcriptLineColor("[Assistant]"), "accent");
	assert.equal(transcriptLineColor("[done]"), "success");
	assert.equal(transcriptLineColor("[failed] boom"), "error");
	assert.equal(transcriptLineColor("[attention] needs input"), "warning");
	assert.equal(transcriptLineColor("[degraded] provider: down"), "warning");
	assert.equal(transcriptLineColor("[interrupted]"), "warning");
	assert.equal(transcriptLineColor("[started]"), "dim");
	assert.equal(transcriptLineColor("Thinking"), "dim");
	assert.equal(transcriptLineColor("Thinking: weighing the options"), "dim");
	assert.equal(transcriptLineColor("│ a reasoning body line"), "dim");
	assert.equal(transcriptLineColor("· starting subprocess"), "dim");
	assert.equal(transcriptLineColor("plain assistant body text"), "text");
});

test("eventsToBodyLines: thinking renders as a grouped dim block (header + body), never a per-line [thinking] tag", () => {
	const lines = eventsToBodyLines([thinking("I should read the spec before editing"), assistant("the answer", 1)], 80);

	assert.ok(!lines.some((l) => l.includes("[thinking]")), "the old per-line [thinking] tag must be gone");

	const headerIdx = lines.findIndex((l) => l === "Thinking");
	assert.ok(headerIdx >= 0, "a grouped block must start with a plain 'Thinking' header");
	assert.equal(transcriptLineColor(lines[headerIdx]), "dim", "the header must classify dim");

	const bodyLines = lines.filter((l) => l.startsWith("│ "));
	assert.ok(bodyLines.length > 0, "the reasoning body must render under the dim gutter");
	assert.ok(bodyLines.every((l) => transcriptLineColor(l) === "dim"), "every body line must classify dim");
	assert.ok(bodyLines.some((l) => l.includes("read the spec")), "the reasoning text must be present");

	assert.ok(lines.includes("[Assistant]"), "final assistant text keeps its own [Assistant] header");
	assert.ok(!lines.some((l) => l.startsWith("│ ") && l.includes("the answer")), "final text must not be folded into the thinking block");
});

test("eventsToBodyLines: consecutive thinking events group under ONE header", () => {
	const lines = eventsToBodyLines([thinking("first thought"), thinking("second thought"), tool("Read")], 80);

	const headers = lines.filter((l) => l === "Thinking" || l.startsWith("Thinking: "));
	assert.equal(headers.length, 1, "consecutive thinking events must produce a single grouped header");
	assert.ok(lines.some((l) => l.startsWith("│ ") && l.includes("first thought")), "first thought must be in the body");
	assert.ok(lines.some((l) => l.startsWith("│ ") && l.includes("second thought")), "second thought must be in the same body");
});

test("eventsToBodyLines: a model-supplied title becomes the header without doubling 'Thinking:'", () => {
	const titled = eventsToBodyLines([thinking("Thinking: weighing the options\nnow I will read the file")], 80);
	assert.ok(titled.some((l) => l === "Thinking: weighing the options"), "the title line must be lifted into the header");
	assert.ok(!titled.some((l) => l.includes("Thinking: Thinking:")), "the header must never double the 'Thinking:' label");
	assert.ok(titled.some((l) => l.startsWith("│ ") && l.includes("read the file")), "the remaining text is the body");

	const bold = eventsToBodyLines([thinking("**Weighing options**\nthe body follows")], 80);
	assert.ok(bold.some((l) => l === "Thinking: Weighing options"), "a bold markdown title must become the header");
	assert.ok(!bold.some((l) => l.includes("**")), "the bold markers must be stripped from the header");
});

test("eventsToBodyLines: thinking body wraps to width under the dim gutter, no [thinking] tag", () => {
	const longThought = "reasoning ".repeat(30).trim();
	const lines = eventsToBodyLines([thinking(longThought)], 40);
	const bodyLines = lines.filter((l) => l.startsWith("│ "));

	assert.ok(!lines.some((l) => l.includes("[thinking]")), "no per-line [thinking] tag");
	assert.ok(bodyLines.length > 1, "a long thought must wrap into multiple body lines");
	assert.ok(bodyLines.every((l) => l.length <= 40), "wrapped body lines must fit the width");
});

test("eventsToBodyLines: prompt block prepended before event stream when prompt is present", () => {
	const lines = eventsToBodyLines([started(), tool("Read")], 80, "Do the task now");

	const promptIdx = lines.findIndex((l) => l === "[prompt]");
	const startedIdx = lines.findIndex((l) => l === "[started]");
	const toolIdx = lines.findIndex((l) => l.includes("Read"));

	assert.ok(promptIdx >= 0, "[prompt] header must be present");
	assert.ok(promptIdx < startedIdx, "[prompt] header must come before [started]");
	assert.ok(promptIdx < toolIdx, "[prompt] header must come before tool lines");
	assert.ok(lines[promptIdx + 1] === "Do the task now", "prompt text must follow the [prompt] header");
});

test("eventsToBodyLines: prompt text is untruncated (full, not the 80-char task label)", () => {
	const longPrompt = "word ".repeat(40).trim();
	const lines = eventsToBodyLines([], 40, longPrompt);

	const promptIdx = lines.findIndex((l) => l === "[prompt]");
	assert.ok(promptIdx >= 0, "[prompt] header must be present");

	const bodyLines = lines.slice(promptIdx + 1);
	const combined = bodyLines.join(" ");
	assert.ok(combined.includes("word"), "full prompt text must be present");
	assert.ok(bodyLines.length > 1, "long prompt must wrap into multiple lines");
});

test("eventsToBodyLines: no prompt block when prompt is absent", () => {
	const lines = eventsToBodyLines([started()], 80);

	assert.ok(!lines.some((l) => l === "[prompt]"), "no [prompt] header without a prompt");
	assert.equal(lines[0], "[started]", "first line must be [started] with no prompt");
});

test("eventsToBodyLines: no prompt block when prompt is empty string", () => {
	const lines = eventsToBodyLines([started()], 80, "");

	assert.ok(!lines.some((l) => l === "[prompt]"), "empty prompt must not emit a [prompt] block");
});

test("eventsToBodyLines: prompt wraps to width", () => {
	const longPrompt = "word ".repeat(20).trim();
	const lines = eventsToBodyLines([], 40, longPrompt);

	const promptIdx = lines.findIndex((l) => l === "[prompt]");
	const bodyLines = lines.slice(promptIdx + 1);

	assert.ok(bodyLines.every((l) => l.length <= 40), "prompt body lines must fit the width");
	assert.ok(bodyLines.length > 1, "long prompt must wrap into multiple lines");
});

test("transcriptLineColor: [prompt] label classifies as dim", () => {
	assert.equal(transcriptLineColor("[prompt]"), "dim");
});

test("buildViewerModel: prompt block is first in body when snapshot has a prompt", () => {
	const model = buildViewerModel({
		snapshot: makeSnapshot({ prompt: "Analyze the codebase" }),
		events: [started()],
		scrollOffset: 0,
		width: 80,
		height: 100,
		now: BASE_NOW,
	});

	assert.ok(model.bodyLines.length > 0, "body must not be empty");
	assert.equal(model.bodyLines[0], "[prompt]", "first body line must be [prompt]");
	assert.ok(model.bodyLines.some((l) => l.includes("Analyze the codebase")), "prompt text must appear in body");
});

test("buildViewerModel: no prompt block when snapshot has no prompt", () => {
	const model = buildViewerModel({
		snapshot: makeSnapshot(),
		events: [started()],
		scrollOffset: 0,
		width: 80,
		height: 100,
		now: BASE_NOW,
	});

	assert.ok(!model.bodyLines.some((l) => l === "[prompt]"), "no [prompt] block when snapshot lacks a prompt");
});

test("buildViewerModel: no crash when snapshot is absent (no prompt available)", () => {
	assert.doesNotThrow(() =>
		buildViewerModel({
			events: [started()],
			scrollOffset: 0,
			width: 80,
			height: 100,
			now: BASE_NOW,
		}),
	);
});
