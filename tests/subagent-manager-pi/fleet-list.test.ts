import test from "node:test";
import assert from "node:assert/strict";
import {
	reduceFleetNav,
	resolveRestoreIndex,
	shouldFleetHandleKey,
} from "../../packages/subagent-manager-pi/tui/fleet-list.ts";

const ROWS = 3;

test("shouldFleetHandleKey: acts only at an empty prompt with no overlay open", () => {
	assert.equal(shouldFleetHandleKey(true, false), true, "empty prompt, no overlay → act");
});

test("shouldFleetHandleKey: stays inert while a conversation overlay is open", () => {
	assert.equal(shouldFleetHandleKey(true, true), false, "overlay open → must not consume keys (Esc must reach the overlay)");
});

test("shouldFleetHandleKey: never acts when the editor has text", () => {
	assert.equal(shouldFleetHandleKey(false, false), false, "typing must never be swallowed");
	assert.equal(shouldFleetHandleKey(false, true), false);
});

test("reduceFleetNav: down at the inactive prompt no longer activates and passes through", () => {
	assert.deepEqual(reduceFleetNav("down", -1, ROWS), {
		selectedIndex: -1,
		consume: false,
		open: null,
	});
});

test("reduceFleetNav: down still advances and clamps the selection once the fleet is active", () => {
	assert.deepEqual(reduceFleetNav("down", 0, ROWS).selectedIndex, 1);
	assert.deepEqual(reduceFleetNav("down", ROWS - 1, ROWS), {
		selectedIndex: ROWS - 1,
		consume: true,
		open: null,
	});
});

test("reduceFleetNav: up at the inactive prompt passes through to the editor", () => {
	assert.deepEqual(reduceFleetNav("up", -1, ROWS), {
		selectedIndex: -1,
		consume: false,
		open: null,
	});
});

test("reduceFleetNav: up from the first row clears selection and consumes", () => {
	assert.deepEqual(reduceFleetNav("up", 0, ROWS), {
		selectedIndex: -1,
		consume: true,
		open: null,
	});
});

test("reduceFleetNav: up moves the selection up within the list", () => {
	assert.deepEqual(reduceFleetNav("up", 2, ROWS), {
		selectedIndex: 1,
		consume: true,
		open: null,
	});
});

test("reduceFleetNav: enter opens the selected row", () => {
	assert.deepEqual(reduceFleetNav("enter", 1, ROWS), {
		selectedIndex: 1,
		consume: true,
		open: 1,
	});
});

test("reduceFleetNav: enter at the inactive prompt passes through", () => {
	assert.deepEqual(reduceFleetNav("enter", -1, ROWS), {
		selectedIndex: -1,
		consume: false,
		open: null,
	});
});

test("reduceFleetNav: escape clears an active selection, passes through when inactive", () => {
	assert.deepEqual(reduceFleetNav("escape", 2, ROWS), {
		selectedIndex: -1,
		consume: true,
		open: null,
	});
	assert.deepEqual(reduceFleetNav("escape", -1, ROWS), {
		selectedIndex: -1,
		consume: false,
		open: null,
	});
});

test("reduceFleetNav: no rows means nothing is consumed", () => {
	for (const key of ["up", "down", "left", "enter", "escape"] as const) {
		assert.deepEqual(reduceFleetNav(key, -1, 0), {
			selectedIndex: -1,
			consume: false,
			open: null,
		});
	}
});

test("reduceFleetNav: left activates the inactive fleet (P6, now the sole activator)", () => {
	assert.deepEqual(reduceFleetNav("left", -1, ROWS), {
		selectedIndex: 0,
		consume: true,
		open: null,
	});
});

test("reduceFleetNav: left is not consumed once the fleet is already active (P6)", () => {
	assert.deepEqual(reduceFleetNav("left", 1, ROWS), {
		selectedIndex: 1,
		consume: false,
		open: null,
	});
});

test("resolveRestoreIndex: returns the row index when the viewed run is still in the roster (P3)", () => {
	assert.equal(resolveRestoreIndex(["a", "b", "c"], "b"), 1);
});

test("resolveRestoreIndex: returns -1 (inactive) when the viewed run has left the roster (P3)", () => {
	assert.equal(resolveRestoreIndex(["a", "c"], "b"), -1);
});
