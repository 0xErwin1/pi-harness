import test from "node:test";
import assert from "node:assert/strict";
import {
	applyScroll,
	classifyScrollKey,
	ConversationViewer,
	type ScrollState,
	type ViewerRuntime,
} from "../../packages/subagent-manager-pi/tui/conversation-viewer.ts";
import type { TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

const VIEWPORT = 10;
const MAX_SCROLL = 40;

function fakeRuntime(): ViewerRuntime {
	return {
		subscribe: () => () => {},
		events: () => [],
		snapshot: () => undefined,
	};
}

function fakeTui(): TUI {
	return { requestRender: () => {} } as unknown as TUI;
}

test("ConversationViewer: a single Esc press closes the overlay (done called once)", () => {
	let closedCount = 0;
	const viewer = new ConversationViewer(
		fakeTui(),
		{} as Theme,
		fakeRuntime(),
		"r1",
		() => {
			closedCount += 1;
		},
	);

	viewer.handleInput("\x1b");

	assert.equal(closedCount, 1, "Esc must close the viewer on the first press");
});

function state(scrollOffset: number, autoScroll: boolean): ScrollState {
	return { scrollOffset, autoScroll };
}

test("applyScroll: up decrements and disengages autoScroll below the bottom", () => {
	const next = applyScroll("up", state(20, true), MAX_SCROLL, VIEWPORT);
	assert.equal(next.scrollOffset, 19);
	assert.equal(next.autoScroll, false);
});

test("applyScroll: up clamps at zero", () => {
	const next = applyScroll("up", state(0, false), MAX_SCROLL, VIEWPORT);
	assert.equal(next.scrollOffset, 0);
	assert.equal(next.autoScroll, false);
});

test("applyScroll: down re-engages autoScroll once it reaches the bottom", () => {
	const near = applyScroll("down", state(MAX_SCROLL - 1, false), MAX_SCROLL, VIEWPORT);
	assert.equal(near.scrollOffset, MAX_SCROLL);
	assert.equal(near.autoScroll, true);
});

test("applyScroll: down clamps at maxScroll", () => {
	const next = applyScroll("down", state(MAX_SCROLL, true), MAX_SCROLL, VIEWPORT);
	assert.equal(next.scrollOffset, MAX_SCROLL);
	assert.equal(next.autoScroll, true);
});

test("applyScroll: pageUp jumps a viewport and disables autoScroll", () => {
	const next = applyScroll("pageUp", state(35, true), MAX_SCROLL, VIEWPORT);
	assert.equal(next.scrollOffset, 25);
	assert.equal(next.autoScroll, false);
});

test("applyScroll: pageDown jumps a viewport, clamps, and re-engages autoScroll at bottom", () => {
	const mid = applyScroll("pageDown", state(5, false), MAX_SCROLL, VIEWPORT);
	assert.equal(mid.scrollOffset, 15);
	assert.equal(mid.autoScroll, false);

	const bottom = applyScroll("pageDown", state(35, false), MAX_SCROLL, VIEWPORT);
	assert.equal(bottom.scrollOffset, MAX_SCROLL);
	assert.equal(bottom.autoScroll, true);
});

test("applyScroll: halfPageUp jumps half a viewport and disables autoScroll", () => {
	const next = applyScroll("halfPageUp", state(35, true), MAX_SCROLL, VIEWPORT);
	assert.equal(next.scrollOffset, 30);
	assert.equal(next.autoScroll, false);
});

test("applyScroll: halfPageDown jumps half a viewport, clamps, and re-engages autoScroll at bottom", () => {
	const mid = applyScroll("halfPageDown", state(5, false), MAX_SCROLL, VIEWPORT);
	assert.equal(mid.scrollOffset, 10);
	assert.equal(mid.autoScroll, false);

	const bottom = applyScroll("halfPageDown", state(MAX_SCROLL - 2, false), MAX_SCROLL, VIEWPORT);
	assert.equal(bottom.scrollOffset, MAX_SCROLL);
	assert.equal(bottom.autoScroll, true);
});

test("applyScroll: halfPage uses at least 1 row when the viewport is tiny", () => {
	const next = applyScroll("halfPageDown", state(0, false), MAX_SCROLL, 1);
	assert.equal(next.scrollOffset, 1);
});

test("classifyScrollKey: vim bindings map to scroll actions", () => {
	assert.equal(classifyScrollKey("j"), "down");
	assert.equal(classifyScrollKey("k"), "up");
	assert.equal(classifyScrollKey("\x04"), "halfPageDown"); // Ctrl-D
	assert.equal(classifyScrollKey("\x15"), "halfPageUp"); // Ctrl-U
	assert.equal(classifyScrollKey("\x06"), "pageDown"); // Ctrl-F
	assert.equal(classifyScrollKey("\x02"), "pageUp"); // Ctrl-B
	assert.equal(classifyScrollKey("g"), "home");
	assert.equal(classifyScrollKey("G"), "end");
	assert.equal(classifyScrollKey("x"), undefined);
});

test("applyScroll: home goes to top, end goes to bottom with autoScroll", () => {
	const home = applyScroll("home", state(30, true), MAX_SCROLL, VIEWPORT);
	assert.deepEqual(home, { scrollOffset: 0, autoScroll: false });

	const end = applyScroll("end", state(0, false), MAX_SCROLL, VIEWPORT);
	assert.deepEqual(end, { scrollOffset: MAX_SCROLL, autoScroll: true });
});
