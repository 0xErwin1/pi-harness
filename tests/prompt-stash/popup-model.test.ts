import test from "node:test";
import assert from "node:assert/strict";
import {
	classifyPopupKey,
	clampIndex,
	followScroll,
	moveIndex,
	type PopupAction,
} from "../../packages/prompt-stash/popup-model.ts";

/** Raw byte sequences for the keys the classifier is expected to recognise. */
const KEY = {
	esc: "\x1b",
	enter: "\r",
	tab: "\t",
	backspace: "\x7f",
	up: "\x1b[A",
	down: "\x1b[B",
	ctrlD: "\x04",
	ctrlU: "\x15",
};

function kind(action: PopupAction | undefined): string | undefined {
	return action?.kind;
}

// ── classifyPopupKey: normal mode ───────────────────────────────────────────

test("normal mode: vim and arrow navigation map to move/page/top/bottom", () => {
	assert.deepEqual(classifyPopupKey("j", false), { kind: "move", rows: 1 });
	assert.deepEqual(classifyPopupKey("k", false), { kind: "move", rows: -1 });
	assert.deepEqual(classifyPopupKey(KEY.down, false), { kind: "move", rows: 1 });
	assert.deepEqual(classifyPopupKey(KEY.up, false), { kind: "move", rows: -1 });
	assert.deepEqual(classifyPopupKey("g", false), { kind: "top" });
	assert.deepEqual(classifyPopupKey("G", false), { kind: "bottom" });
	assert.deepEqual(classifyPopupKey(KEY.ctrlD, false), { kind: "page", dir: 1 });
	assert.deepEqual(classifyPopupKey(KEY.ctrlU, false), { kind: "page", dir: -1 });
});

test("normal mode: action keys map to select/toggleMark/delete/switchTab/filterStart/close", () => {
	assert.deepEqual(classifyPopupKey(KEY.enter, false), { kind: "select" });
	assert.deepEqual(classifyPopupKey(" ", false), { kind: "toggleMark" }, "Space marks a row");
	assert.deepEqual(classifyPopupKey("d", false), { kind: "delete" });
	assert.deepEqual(classifyPopupKey(KEY.tab, false), { kind: "switchTab" });
	assert.deepEqual(classifyPopupKey("/", false), { kind: "filterStart" });
	assert.equal(kind(classifyPopupKey(KEY.esc, false)), "close");
	assert.equal(kind(classifyPopupKey("q", false)), "close");
});

test("normal mode: an unmapped printable key is ignored, not typed", () => {
	assert.equal(classifyPopupKey("z", false), undefined);
});

// ── classifyPopupKey: filter mode ───────────────────────────────────────────

test("filter mode: printable keys build the query, including j/k/q/d", () => {
	assert.deepEqual(classifyPopupKey("j", true), { kind: "filterChar", ch: "j" });
	assert.deepEqual(classifyPopupKey("q", true), { kind: "filterChar", ch: "q" });
	assert.deepEqual(classifyPopupKey("d", true), { kind: "filterChar", ch: "d" });
	assert.deepEqual(classifyPopupKey(" ", true), { kind: "filterChar", ch: " " });
});

test("filter mode: backspace shortens, arrows still navigate, enter/esc end the filter", () => {
	assert.deepEqual(classifyPopupKey(KEY.backspace, true), { kind: "filterBackspace" });
	assert.deepEqual(classifyPopupKey(KEY.up, true), { kind: "move", rows: -1 });
	assert.deepEqual(classifyPopupKey(KEY.down, true), { kind: "move", rows: 1 });
	assert.deepEqual(classifyPopupKey(KEY.enter, true), { kind: "filterEnd" });
	assert.deepEqual(classifyPopupKey(KEY.esc, true), { kind: "filterEnd" });
});

test("filter mode: escape sequences are not captured as filter text", () => {
	// A bare arrow that isn't up/down must not become a filterChar.
	assert.equal(classifyPopupKey("\x1b[C", true), undefined);
});

// ── selection + scroll math ─────────────────────────────────────────────────

test("clampIndex and moveIndex stay within bounds, empty list pins to 0", () => {
	assert.equal(clampIndex(5, 3), 2);
	assert.equal(clampIndex(-1, 3), 0);
	assert.equal(clampIndex(0, 0), 0);
	assert.equal(moveIndex(2, 1, 3), 2, "cannot move past the last row");
	assert.equal(moveIndex(0, -1, 3), 0, "cannot move before the first row");
	assert.equal(moveIndex(1, 1, 3), 2);
});

test("followScroll keeps the selection inside the viewport window", () => {
	assert.equal(followScroll(0, 100, 10, 0), 0, "no scroll needed at the top");
	assert.equal(followScroll(5, 100, 10, 0), 0, "selection inside window: stay");
	assert.equal(followScroll(12, 100, 10, 0), 3, "selection below window: scroll down");
	assert.equal(followScroll(2, 100, 10, 8), 2, "selection above window: scroll up");
	assert.equal(followScroll(99, 100, 10, 0), 90, "clamped to the last full window");
	assert.equal(followScroll(3, 5, 10, 0), 0, "list shorter than viewport: never scroll");
});
