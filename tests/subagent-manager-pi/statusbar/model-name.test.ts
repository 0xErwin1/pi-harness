import test from "node:test";
import assert from "node:assert/strict";

import {
	type EffortLevel,
	effortColorRole,
	formatEffortLabel,
	formatModelName,
} from "../../../packages/subagent-manager-pi/statusbar/model-name.ts";

test("formatModelName prefers the friendly name", () => {
	assert.equal(formatModelName({ name: "Claude Sonnet 4.5", id: "claude-sonnet-4-5" }), "Claude Sonnet 4.5");
});

test("formatModelName falls back to id, then to no-model", () => {
	assert.equal(formatModelName({ id: "gpt-5" }), "gpt-5");
	assert.equal(formatModelName({ name: "  ", id: "gpt-5" }), "gpt-5");
	assert.equal(formatModelName({}), "no-model");
	assert.equal(formatModelName(undefined), "no-model");
	assert.equal(formatModelName(null), "no-model");
});

test("effortColorRole maps each level to its thinking color role", () => {
	const expected: Record<EffortLevel, string> = {
		off: "thinkingOff",
		minimal: "thinkingMinimal",
		low: "thinkingLow",
		medium: "thinkingMedium",
		high: "thinkingHigh",
		xhigh: "thinkingXhigh",
	};
	for (const [level, role] of Object.entries(expected)) {
		assert.equal(effortColorRole(level as EffortLevel), role);
	}
});

test("formatEffortLabel returns the level verbatim", () => {
	assert.equal(formatEffortLabel("high"), "high");
	assert.equal(formatEffortLabel("off"), "off");
});
