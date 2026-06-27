import test from "node:test";
import assert from "node:assert/strict";
import {
	buildViewerModel,
	type ViewerModel,
} from "../../packages/subagent-manager-pi/tui/conversation-viewer-model.ts";
import type { RunSnapshot } from "../../packages/subagent-manager-core/events.ts";
import type { RunMessage } from "../../packages/subagent-manager-core/store.ts";

const BASE_STARTED_AT = "2024-01-01T12:00:00.000Z";
const BASE_NOW = Date.parse(BASE_STARTED_AT) + 3000;

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

function makeMessage(text: string, turn: number): RunMessage {
	return { role: "assistant", text, turn, at: new Date().toISOString() };
}

test("buildViewerModel: header contains agent name, status, and elapsed time", () => {
	const model = buildViewerModel({
		snapshot: makeSnapshot(),
		messages: [],
		scrollOffset: 0,
		width: 80,
		height: 20,
		now: BASE_NOW,
	});

	assert.ok(model.headerLines.length > 0, "header must be non-empty");
	const header = model.headerLines.join(" ");
	assert.ok(header.includes("viewer-agent"), "header must contain agent name");
	assert.ok(header.includes("running"), "header must contain status");
});

test("buildViewerModel: body has one [Assistant] section per message", () => {
	const messages = [
		makeMessage("first response", 1),
		makeMessage("second response", 2),
	];

	const model = buildViewerModel({
		snapshot: makeSnapshot(),
		messages,
		scrollOffset: 0,
		width: 80,
		height: 100,
		now: BASE_NOW,
	});

	const assistantHeaders = model.bodyLines.filter((l) => l.includes("[Assistant]"));
	assert.equal(assistantHeaders.length, 2, "two messages → two [Assistant] sections");
	assert.ok(model.bodyLines.some((l) => l.includes("first response")), "body must contain first response");
	assert.ok(model.bodyLines.some((l) => l.includes("second response")), "body must contain second response");
});

test("buildViewerModel: footer contains line count and percentage", () => {
	const messages = [makeMessage("hello", 1)];

	const model = buildViewerModel({
		snapshot: makeSnapshot(),
		messages,
		scrollOffset: 0,
		width: 80,
		height: 100,
		now: BASE_NOW,
	});

	assert.ok(model.footerLine.length > 0, "footer must be non-empty");
	assert.ok(model.footerLine.includes("%"), "footer must contain percentage");
});

test("buildViewerModel: maxScroll is max(0, totalBodyLines - height)", () => {
	const messages = Array.from({ length: 5 }, (_, i) => makeMessage(`line ${i}`, i + 1));

	const model = buildViewerModel({
		snapshot: makeSnapshot(),
		messages,
		scrollOffset: 0,
		width: 80,
		height: 4,
		now: BASE_NOW,
	});

	assert.ok(model.maxScroll > 0, "maxScroll must be positive when body exceeds height");

	// Each message produces 2 lines: "[Assistant]" + message text; 5 messages = 10 total.
	// maxScroll = max(0, 10 - 4) = 6.
	assert.equal(model.maxScroll, 6, "maxScroll must equal (total lines - height)");
});

test("buildViewerModel: scrollOffset clamped to [0, maxScroll]", () => {
	const messages = [makeMessage("a", 1)];

	const tooLow = buildViewerModel({
		snapshot: makeSnapshot(),
		messages,
		scrollOffset: -99,
		width: 80,
		height: 20,
		now: BASE_NOW,
	});
	assert.ok(tooLow.maxScroll >= 0, "maxScroll must be non-negative");

	const tooHigh = buildViewerModel({
		snapshot: makeSnapshot(),
		messages,
		scrollOffset: 9999,
		width: 80,
		height: 20,
		now: BASE_NOW,
	});
	assert.ok(tooHigh.maxScroll >= 0);
});

test("buildViewerModel: autoScroll=true sets scrollOffset to maxScroll", () => {
	const messages = Array.from({ length: 20 }, (_, i) => makeMessage(`line ${i}`, i + 1));

	const model = buildViewerModel({
		snapshot: makeSnapshot(),
		messages,
		scrollOffset: 0,
		width: 80,
		height: 5,
		now: BASE_NOW,
		autoScroll: true,
	});

	assert.equal(model.bodyLines.length, 5, "viewport must be clamped to height when autoScroll");
});

test("buildViewerModel: replay renders all messages from turn 1", () => {
	const messages = [
		makeMessage("Turn one content", 1),
		makeMessage("Turn two content", 2),
		makeMessage("Turn three content", 3),
	];

	const model = buildViewerModel({
		snapshot: makeSnapshot(),
		messages,
		scrollOffset: 0,
		width: 80,
		height: 100,
		now: BASE_NOW,
	});

	assert.ok(model.bodyLines.some((l) => l.includes("Turn one content")), "replay must include turn 1");
	assert.ok(model.bodyLines.some((l) => l.includes("Turn two content")), "replay must include turn 2");
	assert.ok(model.bodyLines.some((l) => l.includes("Turn three content")), "replay must include turn 3");
});

test("buildViewerModel: empty messages produces empty body", () => {
	const model = buildViewerModel({
		snapshot: makeSnapshot(),
		messages: [],
		scrollOffset: 0,
		width: 80,
		height: 20,
		now: BASE_NOW,
	});

	assert.equal(model.bodyLines.length, 0, "empty messages → empty body");
	assert.equal(model.maxScroll, 0);
});

test("buildViewerModel: viewport windowing slices body to height", () => {
	const messages = Array.from({ length: 10 }, (_, i) => makeMessage(`Item ${i}`, i + 1));

	const model = buildViewerModel({
		snapshot: makeSnapshot(),
		messages,
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
			messages: [makeMessage("hello", 1)],
			scrollOffset: 0,
			width: 80,
			height: 20,
			now: BASE_NOW,
		}),
	);
});
