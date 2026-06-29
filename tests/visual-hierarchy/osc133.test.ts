import test from "node:test";
import assert from "node:assert/strict";
import { stripOsc133, reapplyOsc133 } from "../../packages/visual-hierarchy/osc133.ts";

const ZONE_START    = "\x1b]133;A\x07";
const ZONE_END      = "\x1b]133;B\x07";
const ZONE_FINAL    = "\x1b]133;C\x07";
const ZONE_TRAILING = ZONE_END + ZONE_FINAL;

// In the SDK: lines[0] gets START prepended, then lines[last] gets TRAILING prepended.
// Single-line case: both mutations apply to lines[0], yielding TRAILING + START + content.
const ZONE_SINGLE = ZONE_TRAILING + ZONE_START;

test("stripOsc133 + reapplyOsc133: multi-line round-trip", () => {
	const input = [
		ZONE_START + "first line",
		"middle line",
		ZONE_TRAILING + "last line",
	];

	const { body, markers } = stripOsc133(input);
	const output = reapplyOsc133(body, markers);

	assert.deepEqual(output, input);
});

test("stripOsc133: multi-line strips leading marker from first line only", () => {
	const input = [ZONE_START + "first", "second", ZONE_TRAILING + "last"];

	const { body, markers } = stripOsc133(input);

	assert.deepEqual(body, ["first", "second", "last"]);
	assert.equal(markers.leading, ZONE_START);
	assert.equal(markers.trailing, ZONE_TRAILING);
});

test("stripOsc133 + reapplyOsc133: single-line round-trip (dual-marker case)", () => {
	const content = "only line";
	const input = [ZONE_SINGLE + content];

	const { body, markers } = stripOsc133(input);
	const output = reapplyOsc133(body, markers);

	assert.deepEqual(output, input);
});

test("stripOsc133: single-line extracts both markers correctly", () => {
	const content = "the content";
	const input = [ZONE_SINGLE + content];

	const { body, markers } = stripOsc133(input);

	assert.deepEqual(body, [content]);
	assert.equal(markers.leading, ZONE_START, "leading is ZONE_START");
	assert.equal(markers.trailing, ZONE_TRAILING, "trailing is ZONE_END+ZONE_FINAL");
});

test("stripOsc133: no-marker passthrough leaves body unchanged", () => {
	const input = ["plain a", "plain b"];

	const { body, markers } = stripOsc133(input);

	assert.deepEqual(body, input);
	assert.equal(markers.leading, "");
	assert.equal(markers.trailing, "");
});

test("stripOsc133 + reapplyOsc133: no-marker passthrough round-trip", () => {
	const input = ["line x", "line y", "line z"];

	const { body, markers } = stripOsc133(input);
	const output = reapplyOsc133(body, markers);

	assert.deepEqual(output, input);
});

test("stripOsc133: empty array passthrough", () => {
	const { body, markers } = stripOsc133([]);

	assert.deepEqual(body, []);
	assert.equal(markers.leading, "");
	assert.equal(markers.trailing, "");
});

test("reapplyOsc133: empty body passthrough", () => {
	const output = reapplyOsc133([], { leading: ZONE_START, trailing: ZONE_TRAILING });

	assert.deepEqual(output, []);
});

test("reapplyOsc133: transformed body gets markers re-added correctly", () => {
	const original = [ZONE_START + "first", "mid", ZONE_TRAILING + "last"];

	const { body, markers } = stripOsc133(original);
	const transformed = body.map((l) => "> " + l);
	const output = reapplyOsc133(transformed, markers);

	assert.equal(output.length, 3);
	assert.ok(output[0].startsWith(ZONE_START), "first line has leading marker");
	assert.equal(output[0], ZONE_START + "> first");
	assert.equal(output[1], "> mid");
	assert.ok(output[2].startsWith(ZONE_TRAILING), "last line has trailing marker");
	assert.equal(output[2], ZONE_TRAILING + "> last");
});
