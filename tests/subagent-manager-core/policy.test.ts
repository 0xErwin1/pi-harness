import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicy } from "../../packages/subagent-manager-core/policy.ts";
import type { RegisteredAgent } from "../../packages/subagent-manager-core/registry.ts";

function registered(policyMode: string): RegisteredAgent {
	return {
		name: `${policyMode}-agent`,
		description: policyMode,
		promptRef: `prompt:${policyMode}`,
		policyMode,
		scope: "builtin",
		order: 0,
	};
}

test("advisory and reviewer modes block write-requiring runs", () => {
	for (const mode of ["advisory", "reviewer"]) {
		const decision = evaluatePolicy({ agent: registered(mode), requiresWrite: true });

		assert.equal(decision.allowed, false);
		assert.equal(decision.effectiveMode, mode);
		assert.match(decision.reason ?? "", /cannot modify/);
	}
});

test("writer mode allows write-requiring runs", () => {
	const decision = evaluatePolicy({ agent: registered("writer"), requiresWrite: true });

	assert.equal(decision.allowed, true);
	assert.equal(decision.effectiveMode, "writer");
});

test("fanout mode requires parallel dispatch", () => {
	const single = evaluatePolicy({ agent: registered("fanout"), strategy: "single" });
	const parallel = evaluatePolicy({ agent: registered("fanout"), strategy: "parallel" });

	assert.equal(single.allowed, false);
	assert.match(single.reason ?? "", /parallel/);
	assert.equal(parallel.allowed, true);
});
