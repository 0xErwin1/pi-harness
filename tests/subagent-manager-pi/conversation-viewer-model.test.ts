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
	styleOutputLine,
	styleThinkingBodyLine,
	styleThinkingHeadLine,
	styleToolLine,
	styleTranscriptLine,
	styleUserLine,
	transcriptLineColor,
} from "../../packages/subagent-manager-pi/tui/conversation-viewer-model.ts";
import type { RunEvent, RunSnapshot } from "../../packages/subagent-manager-core/events.ts";

/**
 * Deterministic styler double: `fg` wraps text in `<color>…</color>` and `bold`
 * in `<b><accent>…</accent></b>`, so the styled output of a body line is fully assertable without a
 * real theme. The verb is bold+accent, the args muted, the summary dim/success/error.
 */
const STYLER = {
	fg: (color: string, text: string): string => `<${color}>${text}</${color}>`,
	bold: (text: string): string => `<b>${text}</b>`,
	italic: (text: string): string => `<i>${text}</i>`,
};

/** Strips the internal kind markers (control chars) so a raw body line's visible width can be measured. */
function stripMarkers(line: string): string {
	return line.replace(/[\u0001-\u0007\u000b\u000c\u000e\u001f]/g, "");
}

/** Strips the deterministic `<tag>` markup so a styled line's visible width can be measured. */
function stripTags(line: string): string {
	return line.replace(/<\/?[a-z]+>/g, "");
}

const isToolLine = (line: string): boolean => styleToolLine(line, STYLER) !== undefined;
const isDiffLine = (line: string): boolean => styleDiffLine(line, STYLER) !== undefined;
const isOutputLine = (line: string): boolean => styleOutputLine(line, STYLER) !== undefined;
const isThinkHead = (line: string): boolean => styleThinkingHeadLine(line, STYLER) !== undefined;
const isThinkBody = (line: string): boolean => styleThinkingBodyLine(line, STYLER) !== undefined;
const isUserLine = (line: string): boolean => styleUserLine(line, STYLER) !== undefined;

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

function toolWithCallFull(name: string, toolCall: string, toolCallFull: string): RunEvent {
	return {
		id: `e${eventSeq++}`,
		runId: "r1",
		type: "run.progress",
		message: `tool: ${name}`,
		toolCall,
		toolCallFull,
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

test("eventsToBodyLines: assistant output flows without a section header, matching the main thread", () => {
	const lines = eventsToBodyLines([assistant("response body", 1)], 80);

	assert.ok(!lines.some((l) => l.includes("[Assistant]")), "the [Assistant] section header is gone");
	assert.ok(lines.some((l) => l.includes("response body")), "assistant text must be present");
});

test("eventsToBodyLines: completion emits no [done] header; failure still surfaces its reason", () => {
	const completed = eventsToBodyLines(
		[{ id: "c1", runId: "r1", type: "run.completed", summary: { text: "ok", executionMode: "subprocess", routedBy: "t" }, at: BASE_STARTED_AT }],
		80,
	);
	assert.ok(!completed.some((l) => l.includes("[done]")), "the [done] section header is gone");

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

	// Each assistant message now produces 1 line (no [Assistant] header); 5 messages = 5 total.
	// maxScroll = max(0, 5 - 4) = 1.
	assert.equal(model.maxScroll, 1, "maxScroll must equal (total lines - height)");
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

	assert.equal(styleTranscriptLine(line, STYLER), "<dim>→</dim> <muted>read</muted> <muted>src/foo.ts</muted>");
	assert.ok(isToolLine(line), "the line must be classified as a tool line");
	assert.ok(!stripMarkers(line).includes("▸"), "the tool glyph prefix must be gone");
	assert.ok(!line.includes("[tool]"), "the literal [tool] prefix must be gone");
});

test("eventsToBodyLines: a tool with no args renders just the bold verb", () => {
	const [line] = eventsToBodyLines([tool("read")], 80);

	assert.equal(styleTranscriptLine(line, STYLER), "<dim>→</dim> <muted>read</muted>");
});

test("eventsToBodyLines: a tool line uses the richer toolCall verbatim (verb bold, args accent)", () => {
	const [line] = eventsToBodyLines(
		[toolWithCall("engram_mem_save", 'engram_mem_save (query: "auth bug", project: "pi-harness")')],
		120,
	);

	assert.equal(
		styleTranscriptLine(line, STYLER),
		'<dim>→</dim> <muted>engram_mem_save</muted> <muted>(query: "auth bug", project: "pi-harness")</muted>',
	);
});

test("eventsToBodyLines: bash renders `$ <cmd>` with no bold verb prefix", () => {
	const [line] = eventsToBodyLines([toolWithTarget("bash", "pnpm test")], 80);

	assert.equal(styleTranscriptLine(line, STYLER), "<b><accent>$</accent></b> <muted>pnpm test</muted>");
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

test("eventsToBodyLines: a long tool call wraps to width instead of truncating", () => {
	const longTarget = Array.from({ length: 16 }, (_, i) => `seg${i}`).join(" ");
	const lines = eventsToBodyLines([toolWithTarget("read", longTarget)], 40);
	const toolLines = lines.filter(isToolLine);

	assert.ok(toolLines.length > 1, `a long tool call must wrap into multiple lines, got ${toolLines.length}`);
	for (const l of toolLines) {
		const visible = stripMarkers(l);
		assert.ok(!visible.includes("…"), `wrapped tool lines must never be truncated: ${JSON.stringify(visible)}`);
		assert.ok(visible.length <= 40, `each wrapped line must fit width, got ${visible.length}`);
	}
});

test("styleToolLine: verb bold, args accent", () => {
	const [line] = eventsToBodyLines([toolWithTarget("read", "src/foo.ts")], 80);
	assert.equal(styleToolLine(line, STYLER), "<dim>→</dim> <muted>read</muted> <muted>src/foo.ts</muted>");
});

test("styleToolLine: a no-args tool styles only the bold verb", () => {
	const [line] = eventsToBodyLines([tool("read")], 80);
	assert.equal(styleToolLine(line, STYLER), "<dim>→</dim> <muted>read</muted>");
});

test("styleToolLine: returns undefined for a non-tool line so the caller can fall through", () => {
	assert.equal(styleToolLine("[Assistant]", STYLER), undefined);
	assert.equal(styleToolLine("plain body text", STYLER), undefined);
});

// ── per-tool result summaries ──────────────────────────────────────────────────

test("read result renders a dim `N lines` summary", () => {
	const [line] = eventsToBodyLines([tool("read"), toolResult("read", { resultText: "a\nb\nc" })], 80);
	assert.equal(styleTranscriptLine(line, STYLER), "<dim>→</dim> <muted>read</muted> · <dim>3 lines</dim>");
});

test("read result uses details.truncation line counts, and the `out/total` form when truncated", () => {
	const exact = eventsToBodyLines(
		[tool("read"), toolResult("read", { resultText: "ignored", details: { truncation: { outputLines: 14 } } })],
		80,
	)[0];
	assert.equal(styleTranscriptLine(exact, STYLER), "<dim>→</dim> <muted>read</muted> · <dim>14 lines</dim>");

	const truncated = eventsToBodyLines(
		[tool("read"), toolResult("read", { details: { truncation: { truncated: true, outputLines: 50, totalLines: 200 } } })],
		80,
	)[0];
	assert.equal(styleTranscriptLine(truncated, STYLER), "<dim>→</dim> <muted>read</muted> · <dim>50/200 lines</dim>");
});

test("bash result shows `exit 0 · N lines` coloured success", () => {
	const [line] = eventsToBodyLines(
		[toolWithTarget("bash", "pnpm test"), toolResult("bash", { resultText: "line1\nline2\nexit code: 0" })],
		80,
	);
	assert.equal(styleTranscriptLine(line, STYLER), "<b><accent>$</accent></b> <muted>pnpm test</muted> · <success>exit 0 · 3 lines</success>");
});

test("bash nonzero exit colours the summary error", () => {
	const [line] = eventsToBodyLines(
		[toolWithTarget("bash", "false"), toolResult("bash", { resultText: "boom\nexit code: 1" })],
		80,
	);
	assert.equal(styleTranscriptLine(line, STYLER), "<b><accent>$</accent></b> <muted>false</muted> · <error>exit 1 · 2 lines</error>");
});

test("bash result renders the printed output as muted lines under the summary", () => {
	const lines = eventsToBodyLines(
		[toolWithTarget("bash", "echo hi"), toolResult("bash", { resultText: "hello\nworld\nexit code: 0" })],
		80,
	);

	const summary = lines[0];
	assert.ok(isToolLine(summary), "first line is the tool summary");

	const outputs = lines.filter(isOutputLine);
	assert.deepEqual(
		outputs.map((l) => styleTranscriptLine(l, STYLER)),
		["<muted>hello</muted>", "<muted>world</muted>"],
		"the command output is shown muted, with the exit-code trailer dropped",
	);
});

test("bash output block caps at 20 lines with a '… +N more' continuation", () => {
	const body = `${Array.from({ length: 25 }, (_, i) => `out ${i + 1}`).join("\n")}\nexit code: 0`;
	const outputs = eventsToBodyLines(
		[toolWithTarget("bash", "seq"), toolResult("bash", { resultText: body })],
		80,
	).filter(isOutputLine);

	assert.equal(outputs.length, 21, "20 output lines + 1 continuation");
	assert.equal(stripMarkers(outputs[20]), "… +5 more");
});

test("bash with no real output (only the exit trailer) shows the summary but no output lines", () => {
	const lines = eventsToBodyLines(
		[toolWithTarget("bash", "true"), toolResult("bash", { resultText: "exit code: 0" })],
		80,
	);
	assert.ok(!lines.some(isOutputLine), "an empty body produces no output block");
});

test("non-bash tools do not get an output block", () => {
	const lines = eventsToBodyLines(
		[tool("read"), toolResult("read", { resultText: "a\nb\nc" })],
		80,
	);
	assert.ok(!lines.some(isOutputLine), "read still summarizes, with no inline output dump");
});

test("styleOutputLine returns undefined for non-output lines", () => {
	assert.equal(styleOutputLine("plain text", STYLER), undefined);
	const [summary] = eventsToBodyLines([toolWithTarget("bash", "x")], 80);
	assert.equal(styleOutputLine(summary, STYLER), undefined, "a tool line is not an output line");
});

test("grep result shows `N matches`, singular for one", () => {
	const many = eventsToBodyLines(
		[toolWithCall("grep", "grep /foo/"), toolResult("grep", { resultText: "a.ts:1: foo\nb.ts:2: foo" })],
		80,
	)[0];
	assert.equal(styleTranscriptLine(many, STYLER), "<dim>→</dim> <muted>grep</muted> <muted>/foo/</muted> · <dim>2 matches</dim>");

	const one = eventsToBodyLines(
		[toolWithCall("grep", "grep /foo/"), toolResult("grep", { resultText: "a.ts:1: foo" })],
		80,
	)[0];
	assert.equal(styleTranscriptLine(one, STYLER), "<dim>→</dim> <muted>grep</muted> <muted>/foo/</muted> · <dim>1 match</dim>");
});

test("find / ls result shows `N results`", () => {
	const find = eventsToBodyLines(
		[toolWithCall("find", "find {*.ts}"), toolResult("find", { resultText: "a.ts\nb.ts\nc.ts" })],
		80,
	)[0];
	assert.equal(styleTranscriptLine(find, STYLER), "<dim>→</dim> <muted>find</muted> <muted>{*.ts}</muted> · <dim>3 results</dim>");

	const ls = eventsToBodyLines(
		[toolWithTarget("ls", "src"), toolResult("ls", { resultText: "only" })],
		80,
	)[0];
	assert.equal(styleTranscriptLine(ls, STYLER), "<dim>→</dim> <muted>ls</muted> <muted>src</muted> · <dim>1 result</dim>");
});

test("write result shows `N lines`", () => {
	const [line] = eventsToBodyLines(
		[toolWithTarget("write", "out.txt"), toolResult("write", { resultText: "x\ny" })],
		80,
	);
	assert.equal(styleTranscriptLine(line, STYLER), "<dim>→</dim> <muted>write</muted> <muted>out.txt</muted> · <dim>2 lines</dim>");
});

test("an unknown tool omits the summary, but shows `error` when it errored", () => {
	const ok = eventsToBodyLines(
		[toolWithCall("custom_tool", "custom_tool (x: 1)"), toolResult("custom_tool", { resultText: "whatever" })],
		80,
	)[0];
	assert.equal(styleTranscriptLine(ok, STYLER), "<dim>→</dim> <muted>custom_tool</muted> <muted>(x: 1)</muted>");

	const errored = eventsToBodyLines(
		[toolWithCall("custom_tool", "custom_tool (x: 1)"), toolResult("custom_tool", { isError: true })],
		80,
	)[0];
	assert.equal(styleTranscriptLine(errored, STYLER), "<dim>→</dim> <muted>custom_tool</muted> <muted>(x: 1)</muted> · <error>error</error>");
});

test("an errored known tool still shows its summary but in error colour", () => {
	const [line] = eventsToBodyLines([tool("read"), toolResult("read", { resultText: "nope", isError: true })], 80);
	assert.equal(styleTranscriptLine(line, STYLER), "<dim>→</dim> <muted>read</muted> · <error>1 lines</error>");
});

// ── edit diff rendering ─────────────────────────────────────────────────────────

test("edit result shows `+A -R` and renders the diff block with coloured +/- lines", () => {
	const diff = "--- a/x.rs\n+++ b/x.rs\n@@ -1,3 +1,3 @@\n context\n-old line\n+new line\n+added line";
	const styled = eventsToBodyLines([toolWithTarget("edit", "crates/x.rs"), toolResult("edit", { details: { diff } })], 80).map(
		(l) => styleTranscriptLine(l, STYLER),
	);

	assert.equal(styled[0], "<dim>→</dim> <muted>edit</muted> <muted>crates/x.rs</muted> · <dim>+2 -1</dim>");
	assert.ok(styled.includes("<dim>@@ -1,3 +1,3 @@</dim>"), "hunk header dim");
	assert.ok(styled.includes("<dim>  1 1 │ </dim><dim>context</dim>"), "context line: dim gutter + dim content");
	assert.ok(
		styled.includes("<dim>- 2   │ </dim><b><error>old</error></b><error> line</error>"),
		"removed line: dim gutter, error content, emphasized 'old'",
	);
	assert.ok(
		styled.includes("<dim>+   2 │ </dim><b><success>new</success></b><success> line</success>"),
		"added line: dim gutter, success content, emphasized 'new'",
	);
	assert.ok(
		styled.includes("<dim>+   3 │ </dim><success>added line</success>"),
		"unpaired added line: success content, no emphasis",
	);
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
	assert.equal(styleTranscriptLine(toolLine, STYLER), "<dim>→</dim> <muted>edit</muted> <muted>f.ts</muted> · <dim>+1 -1</dim>");
});

// ── result/call correlation ─────────────────────────────────────────────────────

test("a result attaches to the most recent tool call by adjacency when no toolCallId", () => {
	const events = [tool("read"), tool("bash"), toolResult("bash", { resultText: "exit code: 0" })];
	const styled = eventsToBodyLines(events, 80).filter(isToolLine).map((l) => styleTranscriptLine(l, STYLER));

	assert.ok(styled.includes("<dim>→</dim> <muted>read</muted>"), "the earlier read keeps no summary");
	assert.ok(styled.some((l) => l.startsWith("<b><accent>$</accent></b>") && l.includes("exit 0")), "the adjacent bash gets the result");
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

test("transcriptLineColor: distinct semantic colours for status lines (no section-header labels)", () => {
	assert.equal(transcriptLineColor("[failed] boom"), "error");
	assert.equal(transcriptLineColor("[attention] needs input"), "warning");
	assert.equal(transcriptLineColor("[degraded] provider: down"), "warning");
	assert.equal(transcriptLineColor("[interrupted]"), "warning");
	assert.equal(transcriptLineColor("· starting subprocess"), "dim");
	assert.equal(transcriptLineColor("plain assistant body text"), "text");
});

test("eventsToBodyLines: thinking renders as a grouped block (italic header + muted flush body), no per-line tag, no gutter", () => {
	const lines = eventsToBodyLines([thinking("I should read the spec before editing"), assistant("the answer", 1)], 80);
	const styled = lines.map((l) => styleTranscriptLine(l, STYLER));

	assert.ok(!lines.some((l) => l.includes("[thinking]")), "the old per-line [thinking] tag must be gone");
	assert.ok(!lines.some((l) => l.includes("[Assistant]")), "the assistant section header must be gone");
	assert.ok(!styled.some((l) => l.includes("│")), "the reasoning body must have no gutter");

	const header = styled.find((l) => l.includes("<i><thinking>Thinking</thinking></i>"));
	assert.ok(header !== undefined, `the block opens with an italic thinking-tinted header: ${JSON.stringify(styled)}`);

	const bodyLines = lines.filter(isThinkBody).map((l) => styleTranscriptLine(l, STYLER));
	assert.ok(bodyLines.length > 0, "the reasoning body must render");
	assert.ok(bodyLines.every((l) => l.includes("<muted>")), "every body line is muted");
	assert.ok(bodyLines.some((l) => l.includes("read the spec")), "the reasoning text must be present");

	assert.ok(styled.some((l) => l.includes("the answer")), "the final assistant text flows after the block");
	assert.ok(!lines.some((l) => isThinkBody(l) && l.includes("the answer")), "final text is not folded into the thinking block");
});

test("eventsToBodyLines: consecutive thinking events group under ONE header", () => {
	const lines = eventsToBodyLines([thinking("first thought"), thinking("second thought"), tool("Read")], 80);

	assert.equal(lines.filter(isThinkHead).length, 1, "consecutive thinking events must produce a single grouped header");

	const body = lines.filter(isThinkBody).map(stripMarkers);
	assert.ok(body.some((l) => l.includes("first thought")), "first thought must be in the body");
	assert.ok(body.some((l) => l.includes("second thought")), "second thought must be in the same body");
});

test("eventsToBodyLines: a model-supplied title becomes a bold header without doubling 'Thinking:'", () => {
	const titled = eventsToBodyLines([thinking("Thinking: weighing the options\nnow I will read the file")], 80);
	const styledT = titled.map((l) => styleTranscriptLine(l, STYLER));
	assert.ok(
		styledT.some((l) => l.includes("<i><thinking>Thinking:</thinking></i> <b>weighing the options</b>")),
		`the title must be lifted into a bold header: ${JSON.stringify(styledT)}`,
	);
	assert.ok(!styledT.some((l) => l.includes("Thinking: Thinking:")), "the header must never double the 'Thinking:' label");
	assert.ok(titled.filter(isThinkBody).map(stripMarkers).some((l) => l.includes("read the file")), "the remaining text is the body");

	const bold = eventsToBodyLines([thinking("**Weighing options**\nthe body follows")], 80);
	const styledB = bold.map((l) => styleTranscriptLine(l, STYLER));
	assert.ok(
		styledB.some((l) => l.includes("<i><thinking>Thinking:</thinking></i> <b>Weighing options</b>")),
		"a bold markdown title must become the header",
	);
	assert.ok(!styledB.some((l) => l.includes("**")), "the bold markers must be stripped from the header");
});

test("eventsToBodyLines: thinking body wraps flush to width, no gutter, no per-line tag", () => {
	const longThought = "reasoning ".repeat(30).trim();
	const lines = eventsToBodyLines([thinking(longThought)], 40);
	const bodyLines = lines.filter(isThinkBody);

	assert.ok(!lines.some((l) => l.includes("[thinking]")), "no per-line [thinking] tag");
	assert.ok(bodyLines.length > 1, "a long thought must wrap into multiple body lines");
	assert.ok(bodyLines.every((l) => !stripMarkers(l).startsWith("│")), "body lines carry no gutter");
	assert.ok(bodyLines.every((l) => stripMarkers(l).length <= 40), "wrapped body lines must fit the width");
});

test("eventsToBodyLines: prompt is prepended as a user-marked block (no [prompt] header) before the event stream", () => {
	const lines = eventsToBodyLines([started(), tool("Read")], 80, "Do the task now");
	const toolIdx = lines.findIndex((l) => l.includes("Read"));

	assert.ok(!lines.some((l) => l.includes("[prompt]")), "the [prompt] section header must be gone");
	assert.ok(isUserLine(lines[0]), "the first line is the user-marked prompt");
	assert.ok(stripMarkers(lines[0]).includes("Do the task now"), "the prompt text is shown");

	const styledFirst = styleTranscriptLine(lines[0], STYLER);
	assert.ok(styledFirst.includes("<accent>❯ </accent>"), "the prompt carries the accent user-marker glyph");
	assert.ok(lines.findIndex(isUserLine) < toolIdx, "the prompt comes before the tool lines");
});

test("eventsToBodyLines: prompt text is untruncated (full, not the 80-char task label)", () => {
	const longPrompt = "word ".repeat(40).trim();
	const lines = eventsToBodyLines([], 40, longPrompt);

	const promptLines = lines.filter(isUserLine);
	assert.ok(promptLines.length > 1, "long prompt must wrap into multiple lines");
	assert.ok(promptLines.map(stripMarkers).join(" ").includes("word"), "full prompt text must be present");
});

test("eventsToBodyLines: no prompt block when prompt is absent", () => {
	const lines = eventsToBodyLines([started()], 80);

	assert.ok(!lines.some(isUserLine), "no user-marked prompt without a prompt");
	assert.ok(!lines.some((l) => l.includes("[started]")), "the [started] section header is gone");
});

test("eventsToBodyLines: no prompt block when prompt is empty string", () => {
	const lines = eventsToBodyLines([started()], 80, "");

	assert.ok(!lines.some(isUserLine), "empty prompt must not emit a user-marked block");
});

test("eventsToBodyLines: prompt wraps to width", () => {
	const longPrompt = "word ".repeat(20).trim();
	const lines = eventsToBodyLines([], 40, longPrompt);

	const promptLines = lines.filter(isUserLine);
	assert.ok(promptLines.every((l) => stripMarkers(l).length <= 40), "prompt body lines must fit the width");
	assert.ok(promptLines.length > 1, "long prompt must wrap into multiple lines");
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
	assert.ok(isUserLine(model.bodyLines[0]), "first body line is the user-marked prompt");
	assert.ok(model.bodyLines.some((l) => stripMarkers(l).includes("Analyze the codebase")), "prompt text must appear in body");
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

	assert.ok(!model.bodyLines.some(isUserLine), "no user-marked prompt when snapshot lacks a prompt");
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

// ── C0 control-char sanitization (defense-in-depth, W1) ────────────────────────

/**
 * Returns true if the string contains a raw C0 control character (U+0000–U+001F,
 * excluding tab) or U+007F. After the styling layer runs, the output must not
 * carry any such byte — all structural markers are stripped by the stylers and
 * child-sourced C0 must be removed before encoding.
 */
function hasRawControlChars(text: string): boolean {
	for (const char of text) {
		const code = char.charCodeAt(0);
		if (code === 0x09) continue; // tab is allowed
		if (code <= 0x1f || code === 0x7f) return true;
	}
	return false;
}

test("C0 defense: assistant line starting with TOOL_MARK is not misclassified as a tool line", () => {
	const events = [assistant("injected-marker rest of text", 1)];
	const lines = eventsToBodyLines(events, 80);

	const contentLine = lines.find((l) => l.includes("injected-marker"));
	assert.ok(contentLine !== undefined, "the assistant content must appear in body lines");

	assert.ok(!isToolLine(contentLine!), "a line whose source started with TOOL_MARK must not be classified as a tool line");

	const styled = styleTranscriptLine(contentLine!, STYLER);
	assert.ok(!hasRawControlChars(styled), `styled output must have no raw C0 chars, got: ${JSON.stringify(styled)}`);
});

test("C0 defense: assistant line starting with SUM_DIM leaks no raw control char to TUI", () => {
	const events = [assistant("summary-looking text", 1)];
	const lines = eventsToBodyLines(events, 80);

	const contentLine = lines.find((l) => l.includes("summary-looking"));
	assert.ok(contentLine !== undefined, "content must appear in body lines");

	const styled = styleTranscriptLine(contentLine!, STYLER);
	assert.ok(!hasRawControlChars(styled), `styled output must contain no raw C0, got: ${JSON.stringify(styled)}`);
});

test("C0 defense: diff line starting with DIFF_MARK produces no raw control char after styling", () => {
	const diff = "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\ninjected-diff-marker content\n+normal add";
	const events = [toolWithTarget("edit", "x.ts"), toolResult("edit", { details: { diff } })];
	const lines = eventsToBodyLines(events, 80);

	const diffLines = lines.filter(isDiffLine);
	assert.ok(diffLines.length > 0, "diff lines must be present");

	for (const line of diffLines) {
		const styled = styleDiffLine(line, STYLER)!;
		assert.ok(!hasRawControlChars(styled), `styled diff must have no raw C0: ${JSON.stringify(styled)}`);
	}

	const addLine = diffLines.find((l) => l.includes("normal add"));
	assert.ok(addLine !== undefined, "+normal add must survive");
	assert.equal(
		styleDiffLine(addLine!, STYLER),
		"<dim>+   2 │ </dim><success>normal add</success>",
		"normal add: dim gutter + success content",
	);
});

test("C0 defense: embedded DIFF_MARK in diff line content is stripped, line is still success-colored", () => {
	const diff = "--- a/f.ts\n+++ b/f.ts\n@@ -1 +1 @@\n+contentwith-embedded-diff-mark";
	const events = [toolWithTarget("edit", "f.ts"), toolResult("edit", { details: { diff } })];
	const lines = eventsToBodyLines(events, 80);

	const addLine = lines.find((l) => isDiffLine(l) && l.includes("content") && l.includes("embedded-diff-mark"));
	assert.ok(addLine !== undefined, "add line with embedded marker must appear");

	const styled = styleDiffLine(addLine!, STYLER)!;
	assert.ok(!hasRawControlChars(styled), `no raw C0 in embedded case: ${JSON.stringify(styled)}`);
	assert.ok(
		styled.includes("<success>contentwith-embedded-diff-mark</success>"),
		`content must be success-colored with the embedded marker stripped: ${JSON.stringify(styled)}`,
	);
});

test("C0 defense: tool target containing TOOL_MARK produces no raw control char in styled output", () => {
	const events = [toolWithTarget("read", "injected/path/file.ts")];
	const lines = eventsToBodyLines(events, 80);

	const toolLine = lines.find(isToolLine);
	assert.ok(toolLine !== undefined, "tool line must exist");

	const styled = styleToolLine(toolLine!, STYLER)!;
	assert.ok(!hasRawControlChars(styled), `styled tool line must have no raw C0: ${JSON.stringify(styled)}`);
	assert.ok(styled.includes("injected/path/file.ts"), "path content must survive after stripping the leading C0");
});

test("C0 defense: tab inside assistant text is preserved after sanitization", () => {
	const events = [assistant("code with\ttab indentation", 1)];
	const lines = eventsToBodyLines(events, 80);

	const contentLine = lines.find((l) => l.includes("code with"));
	assert.ok(contentLine !== undefined, "content must appear");
	assert.ok(contentLine!.includes("\t"), "tab must be preserved in the body line");

	const styled = styleTranscriptLine(contentLine!, STYLER);
	assert.ok(styled.includes("\t"), "tab must survive styling");
});

test("C0 defense: tab inside a diff line is preserved after sanitization", () => {
	const diff = "--- a/f.ts\n+++ b/f.ts\n@@ -1 +1 @@\n+\tindented code line";
	const events = [toolWithTarget("edit", "f.ts"), toolResult("edit", { details: { diff } })];
	const lines = eventsToBodyLines(events, 80);

	const addLine = lines.find((l) => isDiffLine(l) && l.includes("\t"));
	assert.ok(addLine !== undefined, "tab-indented diff line must be preserved");
	assert.equal(styleDiffLine(addLine!, STYLER), "<dim>+   1 │ </dim><success>\tindented code line</success>");
});

test("C0 defense: normal content without control chars renders byte-identically to baseline", () => {
	const events = [assistant("normal assistant output without any controls", 1)];
	const lines = eventsToBodyLines(events, 80);

	const contentLine = lines.find((l) => l.includes("normal assistant output"));
	assert.ok(contentLine !== undefined, "content must appear");
	assert.ok(
		contentLine!.includes("normal assistant output without any controls"),
		"full clean content must be unchanged — no accidental stripping",
	);
});

// ── ANSI escape sequence stripping (regression fix — W1 ESC-only stripping left residue) ──

test("ANSI: thinking event with 24-bit SGR sequences renders with no [39m, [38;2, or ESC residue", () => {
	const events = [thinking("\x1b[38;2;138;190;183mThinking:\x1b[39m **x**")];
	const lines = eventsToBodyLines(events, 80);

	const thinkingLines = lines.filter((l) => isThinkHead(l) || isThinkBody(l));
	assert.ok(thinkingLines.length > 0, "thinking block must produce lines");

	for (const line of thinkingLines) {
		assert.ok(!line.includes("[39m"), `thinking line must not contain [39m residue: ${JSON.stringify(line)}`);
		assert.ok(!line.includes("[38;2"), `thinking line must not contain [38;2 residue: ${JSON.stringify(line)}`);
		assert.ok(!line.includes("\x1b"), `thinking line must not contain bare ESC byte: ${JSON.stringify(line)}`);
	}
	assert.ok(thinkingLines.map(stripMarkers).some((l) => l.includes("Thinking:")), "clean Thinking: text must be present");
});

test("ANSI: assistant text line with trailing SGR sequence renders without residue", () => {
	const events = [assistant("text\x1b[39m", 1)];
	const lines = eventsToBodyLines(events, 80);

	const contentLine = lines.find((l) => l.startsWith("text"));
	assert.ok(contentLine !== undefined, "content line must appear in body lines");
	assert.ok(!contentLine!.includes("[39m"), "no [39m residue in assistant line");
	assert.ok(!contentLine!.includes("\x1b"), "no bare ESC byte in assistant line");
	assert.equal(contentLine, "text", "text must be clean after ANSI stripping");
});

test("ANSI: a lone ESC byte (not part of a CSI sequence) is removed", () => {
	const events = [assistant("before\x1bafter", 1)];
	const lines = eventsToBodyLines(events, 80);

	const contentLine = lines.find((l) => l.includes("before") || l.includes("after"));
	assert.ok(contentLine !== undefined, "content must appear in body lines");
	assert.ok(!contentLine!.includes("\x1b"), "lone ESC byte must be stripped");
	assert.ok(contentLine!.includes("beforeafter"), "surrounding text around lone ESC must be preserved");
});

test("ANSI: tab inside ANSI-decorated content is preserved after sequence stripping", () => {
	const events = [assistant("\x1b[32mcode:\x1b[0m\there", 1)];
	const lines = eventsToBodyLines(events, 80);

	const contentLine = lines.find((l) => l.includes("code:"));
	assert.ok(contentLine !== undefined, "content must appear in body lines");
	assert.ok(contentLine!.includes("\t"), "tab must be preserved after ANSI stripping");
	assert.ok(!contentLine!.includes("\x1b"), "no ESC residue in ANSI-decorated content");
	assert.ok(!contentLine!.includes("[32m"), "no partial [32m sequence residue");
	assert.ok(!contentLine!.includes("[0m"), "no partial [0m sequence residue");
});

test("ANSI: normal content without control chars or sequences renders byte-identically (no accidental stripping)", () => {
	const events = [assistant("plain content, no controls", 1)];
	const lines = eventsToBodyLines(events, 80);

	const contentLine = lines.find((l) => l.includes("plain content"));
	assert.ok(contentLine !== undefined, "content must appear");
	assert.equal(contentLine, "plain content, no controls", "clean content must be unchanged by the fix");
});

// ── tool-call wrapping (long calls wrap, never truncate) ───────────────────────

test("eventsToBodyLines: a tool call wider than the viewport wraps into indented continuation lines", () => {
	const longArgs = Array.from({ length: 14 }, (_, i) => `seg${i}`).join(" ");
	const toolLines = eventsToBodyLines([toolWithCall("read", `read ${longArgs}`)], 24).filter(isToolLine);

	assert.ok(toolLines.length > 1, `a wide tool call must wrap, got ${toolLines.length} lines`);

	// First line leads with the bold-accent verb; no ellipsis anywhere.
	const head = styleTranscriptLine(toolLines[0], STYLER);
	assert.ok(head.startsWith("<dim>→</dim> <muted>read</muted>"), `head line must lead with the bold-accent verb, got ${head}`);

	for (const l of toolLines) {
		const visible = stripMarkers(l);
		assert.ok(!visible.includes("…"), `no wrapped line may be truncated: ${JSON.stringify(visible)}`);
		assert.ok(visible.length <= 24, `each wrapped line must fit the width, got ${visible.length}`);
	}

	// Continuation lines are indented and carry the args (muted) styling, never the verb.
	for (const l of toolLines.slice(1)) {
		assert.ok(stripMarkers(l).startsWith("  "), `continuation line must be indented: ${JSON.stringify(stripMarkers(l))}`);
		const styled = styleTranscriptLine(l, STYLER);
		assert.ok(styled.includes("<muted>"), `continuation must use the muted args colour: ${styled}`);
		assert.ok(!styled.includes("<b>"), `continuation must not repeat the bold verb: ${styled}`);
	}

	// The full args text is recoverable across the wrapped lines.
	const recovered = toolLines.map(stripMarkers).join(" ");
	for (let i = 0; i < 14; i++) {
		assert.ok(recovered.includes(`seg${i}`), `arg fragment seg${i} must survive wrapping, got: ${recovered}`);
	}
});

test("eventsToBodyLines: the viewer renders toolCallFull (complete args) wrapped, never the summarized toolCall", () => {
	const summarized =
		'engram_mem_save (project: "ignis", scope: "project", type: "architecture", title: "Proposed LSP refe…", …)';
	const fullArgs = Array.from({ length: 14 }, (_, i) => `key${i}: "value${i}"`).join(", ");
	const full = `engram_mem_save (${fullArgs})`;

	const toolLines = eventsToBodyLines([toolWithCallFull("engram_mem_save", summarized, full)], 24).filter(isToolLine);

	assert.ok(toolLines.length > 1, `the full args must wrap across multiple lines, got ${toolLines.length}`);

	for (const l of toolLines) {
		assert.ok(!stripMarkers(l).includes("…"), `no wrapped line may contain an ellipsis: ${JSON.stringify(stripMarkers(l))}`);
	}

	const recovered = toolLines.map(stripMarkers).join(" ");
	for (let i = 0; i < 14; i++) {
		assert.ok(recovered.includes(`key${i}`), `full arg key${i} must survive wrapping, got: ${recovered}`);
	}
	assert.ok(!recovered.includes("Proposed LSP refe"), "the summarized (truncated) form must not be used by the viewer");
});

test("eventsToBodyLines: the viewer falls back to toolCall when toolCallFull is absent", () => {
	const [line] = eventsToBodyLines([toolWithCall("read", "read src/foo.ts")], 80);
	assert.equal(styleToolLine(line, STYLER), "<dim>→</dim> <muted>read</muted> <muted>src/foo.ts</muted>");
});

test("eventsToBodyLines: a wrapped tool call keeps its ` · summary` attached and status-coloured", () => {
	const longArgs = Array.from({ length: 14 }, (_, i) => `seg${i}`).join(" ");
	const toolLines = eventsToBodyLines(
		[toolWithCall("read", `read ${longArgs}`), toolResult("read", { resultText: "a\nb\nc" })],
		24,
	).filter(isToolLine);

	assert.ok(toolLines.length > 1, "the tool call must wrap");

	const styled = toolLines.map((l) => styleTranscriptLine(l, STYLER));
	const carryingSummary = styled.filter((s) => s.includes("· <dim>3 lines</dim>"));
	assert.equal(carryingSummary.length, 1, `exactly one wrapped line must carry the summary, got: ${JSON.stringify(styled)}`);
});

test("styleToolLine: every tool kind renders verb bold+accent and args in a distinct muted colour", () => {
	const cases: Array<{ event: RunEvent; verb: string; args: string }> = [
		{ event: toolWithTarget("read", "src/foo.ts"), verb: "read", args: "src/foo.ts" },
		{ event: toolWithTarget("bash", "pnpm test"), verb: "$", args: "pnpm test" },
		{ event: toolWithCall("engram_mem_save", 'engram_mem_save (project: "ignis", title: "x")'), verb: "engram_mem_save", args: '(project: "ignis", title: "x")' },
		{ event: toolWithCall("todo", "todo (write 3 items)"), verb: "todo", args: "(write 3 items)" },
	];

	for (const { event, verb, args } of cases) {
		const [line] = eventsToBodyLines([event], 200);
		const styled = styleTranscriptLine(line, STYLER);

		assert.ok(isToolLine(line), `${verb} must be classified as a tool line`);
		const expectedHead = verb === "$" ? "<b><accent>$</accent></b>" : `<dim>→</dim> <muted>${verb}</muted>`;
		assert.equal(
			styled,
			`${expectedHead} <muted>${args}</muted>`,
			`${verb} must render the styled head with muted args`,
		);

		// Visibly distinct from a plain assistant body line of the same text.
		const plain = styleTranscriptLine(`${verb} ${args}`, STYLER);
		assert.notEqual(styled, plain, `${verb} tool line must look different from plain assistant text`);
		assert.equal(plain, `<text>${verb} ${args}</text>`, "the plain assistant line must use the default text colour");
	}
});

test("eventsToBodyLines: wrapped tool calls leak no marker or raw control char after styling", () => {
	const longArgs = Array.from({ length: 14 }, (_, i) => `seg${i}`).join(" ");
	const lines = eventsToBodyLines(
		[toolWithCall("engram_mem_save", `engram_mem_save ${longArgs}`), toolResult("engram_mem_save", { resultText: "x\ny" })],
		24,
	);

	for (const l of lines) {
		const styled = styleTranscriptLine(l, STYLER);
		assert.ok(!hasRawControlChars(styled), `styled wrapped line must have no raw C0: ${JSON.stringify(styled)}`);
	}
});
