import test from "node:test";
import assert from "node:assert/strict";
import { LineBuffer, type RenderCtx, type WidthOps } from "../../packages/render-core/width.ts";
import type { RenderStyler } from "../../packages/render-core/styler.ts";
import { RENDER_DEFAULTS } from "../../packages/render-core/config.ts";

/** Pass-through styler: does nothing to text so lengths are predictable. */
const PLAIN_STYLER: RenderStyler = {
	fg: (_color, text) => text,
	bold: (text) => text,
};

/** ASCII-width ops: treat every character as one column and slice for truncation. */
const ASCII_WIDTH: WidthOps = {
	visibleWidth: (s) => s.length,
	truncateToWidth: (s, w) => (s.length <= w ? s : s.slice(0, w)),
};

function makeCtx(maxWidth: number): RenderCtx {
	return { styler: PLAIN_STYLER, width: ASCII_WIDTH, maxWidth, config: RENDER_DEFAULTS };
}

test("LineBuffer.done: empty buffer returns empty array", () => {
	const lb = new LineBuffer(makeCtx(80));
	assert.deepEqual(lb.done(), []);
});

test("LineBuffer.push: a short line passes through unchanged", () => {
	const lb = new LineBuffer(makeCtx(80));
	lb.push("hello");
	assert.deepEqual(lb.done(), ["hello"]);
});

test("LineBuffer.push: a line at exactly maxWidth passes through unchanged", () => {
	const lb = new LineBuffer(makeCtx(5));
	lb.push("hello");
	assert.deepEqual(lb.done(), ["hello"]);
});

test("LineBuffer.push: a line wider than maxWidth is clamped", () => {
	const lb = new LineBuffer(makeCtx(5));
	lb.push("hello world");
	const result = lb.done();
	assert.equal(result.length, 1);
	assert.equal(result[0].length, 5);
	assert.equal(result[0], "hello");
});

test("LineBuffer.push: multiple pushes accumulate in order", () => {
	const lb = new LineBuffer(makeCtx(80));
	lb.push("first");
	lb.push("second");
	lb.push("third");
	assert.deepEqual(lb.done(), ["first", "second", "third"]);
});

test("LineBuffer.push: each pushed line is clamped independently", () => {
	const lb = new LineBuffer(makeCtx(4));
	lb.push("ab");
	lb.push("abcdef");
	lb.push("xy");
	assert.deepEqual(lb.done(), ["ab", "abcd", "xy"]);
});

test("LineBuffer.pushAll: pushes every element from an array", () => {
	const lb = new LineBuffer(makeCtx(80));
	lb.pushAll(["a", "b", "c"]);
	assert.deepEqual(lb.done(), ["a", "b", "c"]);
});

test("LineBuffer.pushAll: each element in the array is clamped independently", () => {
	const lb = new LineBuffer(makeCtx(3));
	lb.pushAll(["ok", "toolong", "hi"]);
	assert.deepEqual(lb.done(), ["ok", "too", "hi"]);
});

test("LineBuffer.pushAll: empty array adds nothing", () => {
	const lb = new LineBuffer(makeCtx(80));
	lb.push("existing");
	lb.pushAll([]);
	assert.deepEqual(lb.done(), ["existing"]);
});

test("LineBuffer.done: can be called multiple times and each call returns the same snapshot", () => {
	const lb = new LineBuffer(makeCtx(80));
	lb.push("a");
	const first = lb.done();
	const second = lb.done();
	assert.deepEqual(first, second);
});

test("LineBuffer: maxWidth of 0 does not clamp (non-positive width is a passthrough)", () => {
	const lb = new LineBuffer(makeCtx(0));
	lb.push("a very long line that would normally be truncated");
	const result = lb.done();
	assert.equal(result.length, 1);
	assert.ok(result[0].length > 10);
});
