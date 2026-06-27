import test from "node:test";
import assert from "node:assert/strict";
import {
	applyScroll,
	type ScrollState,
} from "../../packages/subagent-manager-pi/tui/conversation-viewer.ts";

const VIEWPORT = 10;
const MAX_SCROLL = 40;

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

test("applyScroll: home goes to top, end goes to bottom with autoScroll", () => {
	const home = applyScroll("home", state(30, true), MAX_SCROLL, VIEWPORT);
	assert.deepEqual(home, { scrollOffset: 0, autoScroll: false });

	const end = applyScroll("end", state(0, false), MAX_SCROLL, VIEWPORT);
	assert.deepEqual(end, { scrollOffset: MAX_SCROLL, autoScroll: true });
});
