import test from "node:test";
import assert from "node:assert/strict";
import { safeRenderWrapper } from "../../packages/visual-hierarchy/render-safe.ts";
import type { LineTransform, RenderFn } from "../../packages/visual-hierarchy/render-safe.ts";

test("safeRenderWrapper: returns transform result on success", () => {
	const orig: RenderFn = (_width) => ["line-a", "line-b"];
	const transform: LineTransform = (lines, _self, _width) => lines.map((l) => "t:" + l);

	const wrapped = safeRenderWrapper(transform)(orig);
	const result = wrapped.call(null, 80);

	assert.deepEqual(result, ["t:line-a", "t:line-b"]);
});

test("safeRenderWrapper: falls back to baseline when transform throws", () => {
	const orig: RenderFn = (_width) => ["safe-line"];
	const transform: LineTransform = (_lines, _self, _width) => {
		throw new Error("transform failed");
	};

	const wrapped = safeRenderWrapper(transform)(orig);
	const result = wrapped.call(null, 80);

	assert.deepEqual(result, ["safe-line"]);
});

test("safeRenderWrapper: baseline is captured from original before transform", () => {
	let callCount = 0;
	const orig: RenderFn = (_width) => {
		callCount++;
		return ["original"];
	};

	const transform: LineTransform = (_lines, _self, _width) => {
		throw new Error("boom");
	};

	const wrapped = safeRenderWrapper(transform)(orig);
	wrapped.call(null, 80);

	assert.equal(callCount, 1, "original called exactly once");
});

test("safeRenderWrapper: passes this context to transform", () => {
	const obj = { value: "ctx-test" };
	const orig: RenderFn = function (this: unknown, _width) {
		return ["orig"];
	};

	let capturedSelf: unknown = undefined;
	const transform: LineTransform = (_lines, self, _width) => {
		capturedSelf = self;
		return ["transformed"];
	};

	const wrapped = safeRenderWrapper(transform)(orig);
	wrapped.call(obj, 80);

	assert.equal(capturedSelf, obj);
});

test("safeRenderWrapper: passes width to both original and transform", () => {
	let origWidth = 0;
	let transformWidth = 0;

	const orig: RenderFn = (width) => {
		origWidth = width;
		return ["x"];
	};

	const transform: LineTransform = (_lines, _self, width) => {
		transformWidth = width;
		return ["y"];
	};

	const wrapped = safeRenderWrapper(transform)(orig);
	wrapped.call(null, 120);

	assert.equal(origWidth, 120);
	assert.equal(transformWidth, 120);
});

test("safeRenderWrapper: handles empty original output", () => {
	const orig: RenderFn = (_width) => [];
	const transform: LineTransform = (lines, _self, _width) => lines.map((l) => "prefix:" + l);

	const wrapped = safeRenderWrapper(transform)(orig);
	const result = wrapped.call(null, 80);

	assert.deepEqual(result, []);
});
