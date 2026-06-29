import test from "node:test";
import assert from "node:assert/strict";
import { applyUserMarker, clampLineWidths, type LineStyler } from "../../packages/visual-hierarchy/transforms.ts";
import { stripOsc133, reapplyOsc133 } from "../../packages/visual-hierarchy/osc133.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

const ZONE_START    = "\x1b]133;A\x07";
const ZONE_END      = "\x1b]133;B\x07";
const ZONE_FINAL    = "\x1b]133;C\x07";
const ZONE_TRAILING = ZONE_END + ZONE_FINAL;

const testStyler: LineStyler = {
	fg: (role, text) => `[${role}:${text}]`,
};

test("applyUserMarker: first line receives accent marker prefix", () => {
	const input = ["hello", "world"];
	const result = applyUserMarker(input, testStyler);

	assert.equal(result.length, 2);
	assert.equal(result[0], "[accent:❯ ]hello");
});

test("applyUserMarker: subsequent lines receive two-space indent", () => {
	const input = ["hello", "world", "third"];
	const result = applyUserMarker(input, testStyler);

	assert.equal(result[1], "  world");
	assert.equal(result[2], "  third");
});

test("applyUserMarker: line count is preserved", () => {
	const input = ["a", "b", "c", "d", "e"];
	const result = applyUserMarker(input, testStyler);

	assert.equal(result.length, input.length);
});

test("applyUserMarker: returns empty array for empty input", () => {
	const result = applyUserMarker([], testStyler);

	assert.deepEqual(result, []);
});

test("applyUserMarker: single-line input receives accent marker, no indent", () => {
	const result = applyUserMarker(["only"], testStyler);

	assert.equal(result.length, 1);
	assert.equal(result[0], "[accent:❯ ]only");
});

test("applyUserMarker: uses accent role for the marker glyph, never dim", () => {
	const rolesUsed: string[] = [];
	const trackingStyler: LineStyler = {
		fg: (role, text) => {
			rolesUsed.push(role);
			return text;
		},
	};

	applyUserMarker(["line one", "line two"], trackingStyler);

	assert.ok(rolesUsed.length > 0, "fg called at least once");
	assert.ok(rolesUsed.every((r) => r === "accent"), "only the accent role is used for the marker");
});

test("applyUserMarker: OSC133 markers preserved through strip-marker-reapply pipeline", () => {
	const input = [
		ZONE_START + "first rendered line",
		"middle line",
		ZONE_TRAILING + "last rendered line",
	];

	const { body, markers } = stripOsc133(input);
	const marked = applyUserMarker(body, testStyler);
	const output = reapplyOsc133(marked, markers);

	assert.equal(output.length, 3);
	assert.ok(output[0].startsWith(ZONE_START), "first line retains leading OSC133 marker");
	assert.ok(output[2].startsWith(ZONE_TRAILING), "last line retains trailing OSC133 marker");
	assert.ok(output[0].includes("[accent:❯ ]"), "first line still has accent marker");
	assert.ok(output[2].includes("  "), "last line still has indent");
});

test("clampLineWidths: truncates a marker-prefixed line that exceeds the render width", () => {
	// A line the SDK rendered at full width, then prefixed by the accent marker,
	// overshoots the terminal width — pi-tui treats that as a fatal render error.
	const width = 10;
	const marked = applyUserMarker(["abcdefghij"], testStyler); // marker + 10 cols > 10
	const clamped = clampLineWidths(marked, width);

	assert.ok(visibleWidth(clamped[0]) <= width, `clamped line must fit ${width} cols`);
});

test("clampLineWidths: leaves lines within width untouched and is ANSI-aware", () => {
	const styled = "\x1b[36m❯\x1b[39m hi"; // visible width 4
	const out = clampLineWidths([styled, "short"], 20);

	assert.equal(out[0], styled, "a line within width is returned unchanged");
	assert.equal(out[1], "short");
});

test("clampLineWidths: a non-positive width is a passthrough", () => {
	assert.deepEqual(clampLineWidths(["anything"], 0), ["anything"]);
});

test("applyUserMarker: OSC133 single-line round-trip preserved", () => {
	const ZONE_SINGLE = ZONE_TRAILING + ZONE_START;
	const input = [ZONE_SINGLE + "only line"];

	const { body, markers } = stripOsc133(input);
	const marked = applyUserMarker(body, testStyler);
	const output = reapplyOsc133(marked, markers);

	assert.equal(output.length, 1);
	assert.ok(output[0].startsWith(ZONE_SINGLE), "single-line dual markers preserved");
	assert.ok(output[0].includes("[accent:❯ ]only line"), "marker and content present");
});
