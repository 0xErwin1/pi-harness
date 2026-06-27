import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicy } from "../../packages/subagent-manager-core/policy.ts";
import { mergeRegistryLayers, type EphemeralAgentSpec } from "../../packages/subagent-manager-core/registry.ts";

function ephemeral(name: string, template: EphemeralAgentSpec["template"], ttl: EphemeralAgentSpec["ttl"]): EphemeralAgentSpec {
	return {
		name,
		description: `${template} helper`,
		promptRef: `prompt:${name}`,
		template,
		ttl,
	};
}

test("ephemeral agents expose bounded template metadata including ttl and scope", () => {
	const [agent] = mergeRegistryLayers({
		ephemeral: [ephemeral("research-helper", "research", "run")],
	});

	assert.equal(agent?.scope, "ephemeral");
	assert.equal(agent?.policyMode, "advisory");
	assert.deepEqual(agent?.policy, {
		visible: true,
		locked: true,
		template: "research",
		ttl: "run",
	});
});

test("ephemeral session agents keep their bounded template metadata after merge", () => {
	const [agent] = mergeRegistryLayers({
		ephemeral: [ephemeral("review-helper", "review", "session")],
	});

	assert.equal(agent?.scope, "ephemeral");
	assert.equal(agent?.policyMode, "reviewer");
	assert.equal(agent?.policy?.ttl, "session");
	assert.equal(agent?.policy?.template, "review");
});

test("ephemeral agents do not silently escalate beyond their template policy", () => {
	const [agent] = mergeRegistryLayers({
		ephemeral: [ephemeral("implement-helper", "implement", "run")],
	});

	const sameMode = evaluatePolicy({ agent, policyMode: "writer", requiresWrite: true });
	const escalated = evaluatePolicy({ agent, policyMode: "fanout", strategy: "parallel" });
	const downgraded = evaluatePolicy({ agent, policyMode: "reviewer", requiresWrite: false });

	assert.equal(sameMode.allowed, true);
	assert.equal(sameMode.effectiveMode, "writer");
	assert.equal(escalated.allowed, false);
	assert.match(escalated.reason ?? "", /locked to writer policy/);
	assert.equal(downgraded.allowed, false);
	assert.match(downgraded.reason ?? "", /locked to writer policy/);
});
