import test from "node:test";
import assert from "node:assert/strict";

import { PALETTE, foreground, gradientText, sampleGradient } from "../../packages/header/gradient.ts";

const TRUECOLOR_SGR = "\x1b[38;2;";

test("sampleGradient at position 0 returns the first palette stop", () => {
	assert.deepEqual(sampleGradient(0), PALETTE[0]);
});

test("sampleGradient wraps positions outside [0,1) back into the loop", () => {
	assert.deepEqual(sampleGradient(1), sampleGradient(0));
	assert.deepEqual(sampleGradient(-1), sampleGradient(0));
	assert.deepEqual(sampleGradient(2.25), sampleGradient(0.25));
});

test("sampleGradient interpolates between adjacent stops", () => {
	const midpoint = sampleGradient(0.5 / PALETTE.length);
	const [r, g, b] = midpoint;

	assert.ok(Number.isInteger(r) && Number.isInteger(g) && Number.isInteger(b));
	// Halfway between stop 0 and stop 1 lies strictly between the two channel values.
	const low = Math.min(PALETTE[0]![0], PALETTE[1]![0]);
	const high = Math.max(PALETTE[0]![0], PALETTE[1]![0]);
	assert.ok(r >= low && r <= high);
});

test("foreground wraps text in a 24-bit SGR and resets", () => {
	const painted = foreground([10, 20, 30], "x");
	assert.equal(painted, "\x1b[38;2;10;20;30mx\x1b[0m");
});

test("gradientText colors every non-space character and preserves spaces", () => {
	const painted = gradientText("pi h", 0);

	assert.ok(painted.includes(TRUECOLOR_SGR), "expected truecolor escapes");
	// The single space is left untouched, never wrapped in an escape.
	assert.ok(painted.includes("m \x1b[0m") === false, "space must not be colored");
	assert.ok(painted.split(TRUECOLOR_SGR).length - 1 === 3, "three non-space chars are colored");
});
