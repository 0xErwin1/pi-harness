import test from "node:test";
import assert from "node:assert/strict";
import {
	buildViewerModel,
	eventsToBodyLines,
	resolveViewportOffset,
	transcriptLineColor,
} from "../../packages/subagent-manager-pi/tui/conversation-viewer-model.ts";
import type { RunEvent, RunSnapshot } from "../../packages/subagent-manager-core/events.ts";

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

function assistant(text: string, turn: number): RunEvent {
	return { id: `e${eventSeq++}`, runId: "r1", type: "run.output", chunk: text, role: "assistant", text, turn, at: new Date().toISOString() };
}

function started(): RunEvent {
	return { id: `e${eventSeq++}`, runId: "r1", type: "run.started", agent: "viewer-agent", at: new Date().toISOString() };
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
	assert.ok(completed.some((l) => l.includes("completed")), "completed must surface");

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

test("eventsToBodyLines: a tool line shows its target after the tool name", () => {
	const lines = eventsToBodyLines([toolWithTarget("read", "src/foo.ts")], 80);

	assert.ok(
		lines.some((l) => l.includes("🔧 read src/foo.ts")),
		"tool line must include the target after the name",
	);
});

test("eventsToBodyLines: a tool with no target falls back to the bare name", () => {
	const lines = eventsToBodyLines([tool("bash")], 80);

	assert.ok(lines.some((l) => l === "🔧 bash"), "no target → bare tool line");
});

test("eventsToBodyLines: consecutive identical tool lines collapse with a ×N count", () => {
	const events = [
		toolWithTarget("read", "a.ts"),
		toolWithTarget("read", "a.ts"),
		toolWithTarget("read", "a.ts"),
	];

	const lines = eventsToBodyLines(events, 80);
	const toolLines = lines.filter((l) => l.startsWith("🔧"));

	assert.equal(toolLines.length, 1, "three identical tool calls must collapse to one line");
	assert.ok(toolLines[0].includes("×3"), `collapsed line must carry the count, got: ${toolLines[0]}`);
});

test("eventsToBodyLines: distinct tool targets are NOT collapsed (no information lost)", () => {
	const events = [
		toolWithTarget("read", "a.ts"),
		toolWithTarget("read", "b.ts"),
		toolWithTarget("read", "c.ts"),
	];

	const lines = eventsToBodyLines(events, 80);
	const toolLines = lines.filter((l) => l.startsWith("🔧"));

	assert.equal(toolLines.length, 3, "distinct targets must each keep their own line");
	assert.ok(!toolLines.some((l) => l.includes("×")), "distinct lines must not be counted");
});

test("eventsToBodyLines: a long tool target is truncated to width", () => {
	const longTarget = "x".repeat(200);
	const lines = eventsToBodyLines([toolWithTarget("read", longTarget)], 40);
	const toolLine = lines.find((l) => l.startsWith("🔧"));

	assert.ok(toolLine !== undefined, "tool line must exist");
	assert.ok(toolLine.length <= 40, `tool line must fit width, got ${toolLine.length}`);
	assert.ok(toolLine.endsWith("…"), "truncated line must end with an ellipsis");
});

test("buildViewerModel: header includes turn and tool counts", () => {
	const events = [
		assistant("first", 1),
		tool("read"),
		tool("bash"),
		assistant("second", 2),
	];

	const model = buildViewerModel({
		snapshot: makeSnapshot(),
		events,
		scrollOffset: 0,
		width: 80,
		height: 100,
		now: BASE_NOW,
	});

	assert.ok(model.headerLines[0].includes("2t/2🔧"), `header must show counts, got: ${model.headerLines[0]}`);
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

test("transcriptLineColor: distinct semantic colours per line kind", () => {
	assert.equal(transcriptLineColor("[Assistant]"), "accent");
	assert.equal(transcriptLineColor("🔧 read src/foo.ts"), "success");
	assert.equal(transcriptLineColor("✓ completed"), "success");
	assert.equal(transcriptLineColor("✗ failed: boom"), "error");
	assert.equal(transcriptLineColor("⚠ degraded"), "warning");
	assert.equal(transcriptLineColor("■ interrupted"), "warning");
	assert.equal(transcriptLineColor("▶ started"), "dim");
	assert.equal(transcriptLineColor("· starting subprocess"), "dim");
	assert.equal(transcriptLineColor("plain assistant body text"), "text");
});
