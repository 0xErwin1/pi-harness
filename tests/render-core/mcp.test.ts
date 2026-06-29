import test from "node:test";
import assert from "node:assert/strict";
import { formatMcpCall, formatMcpResult } from "../../packages/render-core/formatters/mcp.ts";
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

test("formatMcpCall: mcp__engram__mem_save produces a single line", () => {
	const lines = formatMcpCall("mcp__engram__mem_save", {}, makeCtx());
	assert.equal(lines.length, 1);
});

test("formatMcpCall: summary contains server name", () => {
	const lines = formatMcpCall("mcp__engram__mem_save", {}, makeCtx());
	assert.ok(lines[0].includes("engram"), `expected 'engram' in: ${lines[0]}`);
});

test("formatMcpCall: summary contains tool name", () => {
	const lines = formatMcpCall("mcp__engram__mem_save", {}, makeCtx());
	assert.ok(lines[0].includes("mem_save"), `expected 'mem_save' in: ${lines[0]}`);
});

test("formatMcpCall: multi-segment tool name is preserved", () => {
	const lines = formatMcpCall("mcp__some_server__tool__with__underscores", {}, makeCtx());
	assert.equal(lines.length, 1);
	assert.ok(lines[0].includes("some_server"), `expected 'some_server' in: ${lines[0]}`);
	assert.ok(lines[0].includes("tool__with__underscores"), `expected tool segment in: ${lines[0]}`);
});

test("formatMcpCall: line is clamped to maxWidth", () => {
	const lines = formatMcpCall("mcp__engram__mem_save", {}, makeCtx(10));
	assert.ok(
		lines.every((l) => l.length <= 10),
		`expected each line <= 10, got: ${JSON.stringify(lines)}`,
	);
});

test("formatMcpCall: non-mcp-prefixed name still produces one line", () => {
	const lines = formatMcpCall("some_random_tool", {}, makeCtx());
	assert.equal(lines.length, 1);
});

test("formatMcpResult: collapsed returns exactly one line", () => {
	const lines = formatMcpResult("mcp__engram__mem_save", "result text", false, makeCtx());
	assert.equal(lines.length, 1);
});

test("formatMcpResult: collapsed summary contains server name", () => {
	const lines = formatMcpResult("mcp__engram__mem_save", "some result", false, makeCtx());
	assert.ok(lines[0].includes("engram"), `expected 'engram' in: ${lines[0]}`);
});

test("formatMcpResult: collapsed summary contains tool name", () => {
	const lines = formatMcpResult("mcp__engram__mem_save", "some result", false, makeCtx());
	assert.ok(lines[0].includes("mem_save"), `expected 'mem_save' in: ${lines[0]}`);
});

test("formatMcpResult: expanded returns empty array (fall through to original)", () => {
	const lines = formatMcpResult("mcp__engram__mem_save", "some result", true, makeCtx());
	assert.deepEqual(lines, []);
});

test("formatMcpResult: no resultText still returns one line when collapsed", () => {
	const lines = formatMcpResult("mcp__engram__mem_save", undefined, false, makeCtx());
	assert.equal(lines.length, 1);
	assert.ok(lines[0].includes("engram"), `expected 'engram' in: ${lines[0]}`);
});

test("formatMcpResult: collapsed line clamped to maxWidth", () => {
	const lines = formatMcpResult("mcp__engram__mem_save", "some result text", false, makeCtx(12));
	assert.ok(
		lines.every((l) => l.length <= 12),
		`expected each line <= 12, got: ${JSON.stringify(lines)}`,
	);
});

test("formatMcpResult: expanded returns empty even when resultText is undefined", () => {
	const lines = formatMcpResult("mcp__engram__mem_save", undefined, true, makeCtx());
	assert.deepEqual(lines, []);
});
