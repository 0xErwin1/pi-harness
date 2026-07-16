import test from "node:test";
import assert from "node:assert/strict";
import { setKittyProtocolActive } from "@earendil-works/pi-tui";

import { classifyDashboardKey, classifyTakeoverKey } from "../../packages/subagent-ui/keys.ts";

test("takeover: escape closes (byte literal)", () => {
	assert.deepEqual(classifyTakeoverKey("\x1b"), { kind: "close" });
});

test("takeover: escape closes (Kitty CSI-u encoding)", () => {
	setKittyProtocolActive(true);
	try {
		assert.deepEqual(classifyTakeoverKey("\x1b[27u"), { kind: "close" });
	} finally {
		setKittyProtocolActive(false);
	}
});

test("takeover: ctrl+c closes", () => {
	assert.deepEqual(classifyTakeoverKey("\x03"), { kind: "close" });
});

test("dashboard: escape closes (byte literal)", () => {
	assert.deepEqual(classifyDashboardKey("\x1b"), { kind: "close" });
});

test("dashboard: escape closes (Kitty CSI-u encoding)", () => {
	setKittyProtocolActive(true);
	try {
		assert.deepEqual(classifyDashboardKey("\x1b[27u"), { kind: "close" });
	} finally {
		setKittyProtocolActive(false);
	}
});

test("dashboard: ctrl+c closes", () => {
	assert.deepEqual(classifyDashboardKey("\x03"), { kind: "close" });
});

test("dashboard: q closes", () => {
	assert.deepEqual(classifyDashboardKey("q"), { kind: "close" });
});

test("dashboard: enter selects", () => {
	assert.deepEqual(classifyDashboardKey("\r"), { kind: "select" });
});

test("dashboard: up/k move selection up, down/j move it down", () => {
	assert.deepEqual(classifyDashboardKey("\x1b[A"), { kind: "move", rows: -1 });
	assert.deepEqual(classifyDashboardKey("k"), { kind: "move", rows: -1 });
	assert.deepEqual(classifyDashboardKey("\x1b[B"), { kind: "move", rows: 1 });
	assert.deepEqual(classifyDashboardKey("j"), { kind: "move", rows: 1 });
});

test("takeover: up/down scroll, preserving today's direction", () => {
	assert.deepEqual(classifyTakeoverKey("\x1b[A"), { kind: "scroll", dir: 1 });
	assert.deepEqual(classifyTakeoverKey("\x1b[B"), { kind: "scroll", dir: -1 });
});

test("takeover: ctrl+d forwards to Input as an owned editing key, it does not close or go inert", () => {
	assert.deepEqual(classifyTakeoverKey("\x04"), { kind: "toInput" });
});

test("dashboard: ctrl+d is genuinely unowned (no Input to forward to) and stays inert", () => {
	assert.equal(classifyDashboardKey("\x04"), undefined);
});

test("takeover: ctrl+z is genuinely unowned and stays inert", () => {
	assert.equal(classifyTakeoverKey("\x1a"), undefined);
});

test("dashboard: ctrl+z is genuinely unowned and stays inert", () => {
	assert.equal(classifyDashboardKey("\x1a"), undefined);
});

test("takeover: printable characters forward to Input for steering", () => {
	assert.deepEqual(classifyTakeoverKey("a"), { kind: "toInput" });
	assert.deepEqual(classifyTakeoverKey(" "), { kind: "toInput" });
});

test("takeover: tab forwards to Input", () => {
	assert.deepEqual(classifyTakeoverKey("\t"), { kind: "toInput" });
});

test("dashboard: unrecognized printable characters are inert", () => {
	assert.equal(classifyDashboardKey("x"), undefined);
});
