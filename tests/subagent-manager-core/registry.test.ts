import test from "node:test";
import assert from "node:assert/strict";
import { mergeRegistryLayers, resolveAgent, type AgentSpec } from "../../packages/subagent-manager-core/registry.ts";

function agent(name: string, description = name): AgentSpec {
	return {
		name,
		description,
		promptRef: `prompt:${name}`,
		policyMode: "advisory",
	};
}

test("mergeRegistryLayers lets higher-precedence scopes override lower ones", () => {
	const merged = mergeRegistryLayers({
		builtin: [agent("reviewer", "builtin reviewer"), agent("scout")],
		user: [agent("reviewer", "user reviewer")],
		project: [agent("project-only")],
		ephemeral: [agent("scout", "ephemeral scout")],
	});

	assert.equal(merged.find((entry) => entry.name === "reviewer")?.description, "user reviewer");
	assert.equal(merged.find((entry) => entry.name === "reviewer")?.scope, "user");
	assert.equal(merged.find((entry) => entry.name === "scout")?.description, "ephemeral scout");
	assert.equal(merged.find((entry) => entry.name === "scout")?.scope, "ephemeral");
	assert.equal(merged.find((entry) => entry.name === "project-only")?.scope, "project");
});

test("resolveAgent returns the effective agent after layered merge", () => {
	const resolved = resolveAgent(
		{
			builtin: [agent("worker", "builtin worker")],
			project: [agent("worker", "project worker")],
		},
		"worker",
	);

	assert.equal(resolved?.description, "project worker");
	assert.equal(resolved?.scope, "project");
});
