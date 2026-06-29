import test from "node:test";
import assert from "node:assert/strict";
import { isOrchestratorRoot } from "../../extensions/harness.ts";

/** Runs `fn` with `PI_HARNESS_SUBAGENT_DEPTH` set to `value`, then restores it. */
function withDepth(value: string | undefined, fn: () => void): void {
	const prev = process.env.PI_HARNESS_SUBAGENT_DEPTH;
	if (value === undefined) delete process.env.PI_HARNESS_SUBAGENT_DEPTH;
	else process.env.PI_HARNESS_SUBAGENT_DEPTH = value;
	try {
		fn();
	} finally {
		if (prev === undefined) delete process.env.PI_HARNESS_SUBAGENT_DEPTH;
		else process.env.PI_HARNESS_SUBAGENT_DEPTH = prev;
	}
}

test("isOrchestratorRoot: true at the root process (unset or zero depth)", () => {
	withDepth(undefined, () => assert.equal(isOrchestratorRoot(), true));
	withDepth("0", () => assert.equal(isOrchestratorRoot(), true));
});

test("isOrchestratorRoot: false inside a spawned subagent (depth > 0)", () => {
	withDepth("1", () => assert.equal(isOrchestratorRoot(), false));
	withDepth("3", () => assert.equal(isOrchestratorRoot(), false));
});
