import test from "node:test";
import assert from "node:assert/strict";
import {
	nextSpinner,
	buildBashCallLine,
	type SpinnerState,
} from "../../packages/render-core/formatters/bash-spinner.ts";
import type { RenderCtx, WidthOps } from "../../packages/render-core/width.ts";
import type { RenderStyler } from "../../packages/render-core/styler.ts";
import { RENDER_DEFAULTS } from "../../packages/render-core/config.ts";

const PLAIN: RenderStyler = {
	fg: (_color, text) => text,
	bold: (text) => text,
};

const ASCII: WidthOps = {
	visibleWidth: (s) => s.length,
	truncateToWidth: (s, w) => (s.length <= w ? s : s.slice(0, w)),
};

function makeCtx(maxWidth = 80): RenderCtx {
	return { styler: PLAIN, width: ASCII, maxWidth, config: RENDER_DEFAULTS };
}

// ── nextSpinner ──────────────────────────────────────────────────────────────

test("nextSpinner: returns the current frame's braille character", () => {
	const state: SpinnerState = { frame: 0, startedAt: 1000 };
	const { frame } = nextSpinner(state, 1100);
	assert.equal(frame, "⠋");
});

test("nextSpinner: advances the frame index by one", () => {
	const state: SpinnerState = { frame: 0, startedAt: 1000 };
	const { state: next } = nextSpinner(state, 1100);
	assert.equal(next.frame, 1);
});

test("nextSpinner: returns frame 1 on the second call", () => {
	const state: SpinnerState = { frame: 1, startedAt: 1000 };
	const { frame } = nextSpinner(state, 1200);
	assert.equal(frame, "⠙");
});

test("nextSpinner: preserves startedAt across advances", () => {
	const state: SpinnerState = { frame: 3, startedAt: 999 };
	const { state: next } = nextSpinner(state, 2000);
	assert.equal(next.startedAt, 999);
});

test("nextSpinner: wraps frame index to 0 after last frame", () => {
	const state: SpinnerState = { frame: 9, startedAt: 0 };
	const { frame, state: next } = nextSpinner(state, 100);
	assert.equal(frame, "⠏");
	assert.equal(next.frame, 0);
});

test("nextSpinner: no frame character contains the emoji variation selector U+FE0F", () => {
	for (let i = 0; i < 10; i++) {
		const state: SpinnerState = { frame: i, startedAt: 0 };
		const { frame } = nextSpinner(state, 100);
		assert.ok(
			!frame.includes("️"),
			`frame ${i} contains U+FE0F: ${JSON.stringify(frame)}`,
		);
	}
});

// ── buildBashCallLine ────────────────────────────────────────────────────────

test("buildBashCallLine: running phase returns exactly one line", () => {
	const lines = buildBashCallLine("ls -la", "running", "⠋", 1500, makeCtx());
	assert.equal(lines.length, 1);
});

test("buildBashCallLine: running phase includes the command string", () => {
	const lines = buildBashCallLine("ls -la", "running", "⠋", 1500, makeCtx());
	assert.ok(lines[0].includes("ls -la"), `expected command in: ${lines[0]}`);
});

test("buildBashCallLine: running phase includes the spinner frame character", () => {
	const lines = buildBashCallLine("ls -la", "running", "⠹", 500, makeCtx());
	assert.ok(lines[0].includes("⠹"), `expected spinner frame in: ${lines[0]}`);
});

test("buildBashCallLine: running phase includes elapsed time in seconds", () => {
	const lines = buildBashCallLine("ls -la", "running", "⠋", 3000, makeCtx());
	assert.ok(lines[0].includes("3s"), `expected '3s' in: ${lines[0]}`);
});

test("buildBashCallLine: running phase formats elapsed >= 60s as minutes+seconds", () => {
	const lines = buildBashCallLine("cmd", "running", "⠋", 65_000, makeCtx());
	assert.ok(lines[0].includes("1m5s"), `expected '1m5s' in: ${lines[0]}`);
});

test("buildBashCallLine: done phase returns exactly one line", () => {
	const lines = buildBashCallLine("ls -la", "done", "", 0, makeCtx());
	assert.equal(lines.length, 1);
});

test("buildBashCallLine: done phase includes the command string", () => {
	const lines = buildBashCallLine("ls -la", "done", "", 0, makeCtx());
	assert.ok(lines[0].includes("ls -la"), `expected command in: ${lines[0]}`);
});

test("buildBashCallLine: done phase does not include a spinner frame character", () => {
	const lines = buildBashCallLine("ls -la", "done", "⠋", 1000, makeCtx());
	assert.ok(
		!lines[0].includes("⠋"),
		`expected no spinner frame in done phase: ${lines[0]}`,
	);
});

test("buildBashCallLine: running phase line is clamped to maxWidth", () => {
	const cmd = "a".repeat(200);
	const lines = buildBashCallLine(cmd, "running", "⠋", 1000, makeCtx(40));
	assert.ok(
		lines.every((l) => l.length <= 40),
		`expected all lines <= 40, got: ${JSON.stringify(lines)}`,
	);
});

test("buildBashCallLine: done phase line is clamped to maxWidth", () => {
	const cmd = "a".repeat(200);
	const lines = buildBashCallLine(cmd, "done", "", 0, makeCtx(40));
	assert.ok(
		lines.every((l) => l.length <= 40),
		`expected all lines <= 40, got: ${JSON.stringify(lines)}`,
	);
});

test("buildBashCallLine: zero elapsed shows 0s", () => {
	const lines = buildBashCallLine("cmd", "running", "⠋", 0, makeCtx());
	assert.ok(lines[0].includes("0s"), `expected '0s' in: ${lines[0]}`);
});
