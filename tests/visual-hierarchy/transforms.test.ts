import test from "node:test";
import assert from "node:assert/strict";
import { applyAssistantGutter, type LineStyler } from "../../packages/visual-hierarchy/transforms.ts";
import { stripOsc133, reapplyOsc133 } from "../../packages/visual-hierarchy/osc133.ts";

const ZONE_START    = "\x1b]133;A\x07";
const ZONE_END      = "\x1b]133;B\x07";
const ZONE_FINAL    = "\x1b]133;C\x07";
const ZONE_TRAILING = ZONE_END + ZONE_FINAL;

const testStyler: LineStyler = {
	fg: (role, text) => `[${role}:${text}]`,
};

test("applyAssistantGutter: adds dim gutter prefix to every line", () => {
	const input = ["hello", "world"];
	const result = applyAssistantGutter(input, testStyler);

	assert.equal(result.length, 2);
	assert.equal(result[0], "[dim:│ ]hello");
	assert.equal(result[1], "[dim:│ ]world");
});

test("applyAssistantGutter: line count is preserved", () => {
	const input = ["a", "b", "c", "d", "e"];
	const result = applyAssistantGutter(input, testStyler);

	assert.equal(result.length, input.length);
});

test("applyAssistantGutter: returns empty array for empty input", () => {
	const result = applyAssistantGutter([], testStyler);

	assert.deepEqual(result, []);
});

test("applyAssistantGutter: single-line input produces single-line output", () => {
	const result = applyAssistantGutter(["only"], testStyler);

	assert.equal(result.length, 1);
	assert.equal(result[0], "[dim:│ ]only");
});

test("applyAssistantGutter: uses dim role for the gutter glyph, never accent", () => {
	const rolesUsed: string[] = [];
	const trackingStyler: LineStyler = {
		fg: (role, text) => {
			rolesUsed.push(role);
			return text;
		},
	};

	applyAssistantGutter(["line one", "line two"], trackingStyler);

	assert.ok(rolesUsed.length > 0, "fg called at least once");
	assert.ok(rolesUsed.every((r) => r === "dim"), "only the dim role is used for the gutter");
});

test("applyAssistantGutter: OSC133 markers preserved through strip-gutter-reapply pipeline", () => {
	const input = [
		ZONE_START + "first rendered line",
		"middle line",
		ZONE_TRAILING + "last rendered line",
	];

	const { body, markers } = stripOsc133(input);
	const guttered = applyAssistantGutter(body, testStyler);
	const output = reapplyOsc133(guttered, markers);

	assert.equal(output.length, 3);
	assert.ok(output[0].startsWith(ZONE_START), "first line retains leading OSC133 marker");
	assert.ok(output[2].startsWith(ZONE_TRAILING), "last line retains trailing OSC133 marker");
	assert.ok(output[0].includes("[dim:│ ]"), "first line still has gutter");
	assert.ok(output[2].includes("[dim:│ ]"), "last line still has gutter");
});

test("applyAssistantGutter: OSC133 single-line round-trip preserved", () => {
	const ZONE_SINGLE = ZONE_TRAILING + ZONE_START;
	const input = [ZONE_SINGLE + "only line"];

	const { body, markers } = stripOsc133(input);
	const guttered = applyAssistantGutter(body, testStyler);
	const output = reapplyOsc133(guttered, markers);

	assert.equal(output.length, 1);
	assert.ok(output[0].startsWith(ZONE_SINGLE), "single-line dual markers preserved");
	assert.ok(output[0].includes("[dim:│ ]only line"), "gutter and content present");
});
