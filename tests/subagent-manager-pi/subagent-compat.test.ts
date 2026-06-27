import test from "node:test";
import assert from "node:assert/strict";
import {
	FIXED_SDD_AGENT_NAMES,
	translateSubagentPayload,
} from "../../packages/subagent-manager-pi/index.ts";

test("translateSubagentPayload accepts Claude-style subagent_type and prompt", () => {
	const result = translateSubagentPayload({
		subagent_type: "Explore",
		prompt: "Tell me what this project does",
		description: "Explore project",
	});

	assert.equal(result.unsupported, false);
	assert.equal(result.mode, "single");
	assert.equal(result.requests[0]?.agent, "Explore");
	assert.equal(result.requests[0]?.prompt, "Tell me what this project does");
	assert.equal(result.requests[0]?.metadata?.description, "Explore project");
});

test("translateSubagentPayload accepts description-only Explore calls", () => {
	const result = translateSubagentPayload({
		subagent_type: "Explore",
		description: "Explora el proyecto y dime de que va",
	});

	assert.equal(result.unsupported, false);
	assert.equal(result.requests[0]?.agent, "Explore");
	assert.equal(result.requests[0]?.prompt, "Explora el proyecto y dime de que va");
});

test("translateSubagentPayload accepts instruction aliases for generic calls", () => {
	const result = translateSubagentPayload({ instructions: "Analyze the repository" });

	assert.equal(result.unsupported, false);
	assert.equal(result.requests[0]?.agent, "general-purpose");
	assert.equal(result.requests[0]?.prompt, "Analyze the repository");
});

test("translateSubagentPayload defaults to generic subagent when parent only provides a prompt", () => {
	const result = translateSubagentPayload({ prompt: "Do exactly what the parent asks" });

	assert.equal(result.unsupported, false);
	assert.equal(result.requests[0]?.agent, "general-purpose");
});

test("translateSubagentPayload preserves fixed SDD identities for single runs", () => {
	const result = translateSubagentPayload({
		agent: "sdd-apply",
		task: "Implement WU2",
		context: "fresh",
	});

	assert.equal(result.unsupported, false);
	assert.equal(result.mode, "single");
	assert.equal(result.requests.length, 1);
	assert.equal(result.requests[0]?.agent, "sdd-apply");
	assert.equal(result.requests[0]?.strategy, "single");
	assert.equal(result.requests[0]?.metadata?.fixedIdentity, true);
	assert.equal(FIXED_SDD_AGENT_NAMES.includes("sdd-apply"), true);
});

test("translateSubagentPayload expands parallel tasks into manager requests", () => {
	const result = translateSubagentPayload({
		tasks: [
			{ agent: "scout", task: "Map auth", count: 2 },
			{ agent: "reviewer", task: "Review auth" },
		],
		context: "fork",
		concurrency: 2,
	});

	assert.equal(result.unsupported, false);
	assert.equal(result.mode, "parallel");
	assert.equal(result.requests.length, 3);
	assert.deepEqual(
		result.requests.map((request) => [request.agent, request.strategy, request.metadata?.parallelConcurrency]),
		[
			["scout", "parallel", 2],
			["scout", "parallel", 2],
			["reviewer", "parallel", 2],
		],
	);
	assert.equal(result.requests[1]?.metadata?.repeatIndex, 1);
	assert.equal(result.requests[0]?.metadata?.context, "fork");
});

test("translateSubagentPayload reports unsupported chain fan-out", () => {
	const result = translateSubagentPayload({
		chain: [
			{ agent: "scout", task: "Gather context" },
			{ parallel: [{ agent: "worker", task: "Implement {previous}" }] },
		],
	});

	assert.equal(result.unsupported, true);
	assert.equal(result.mode, "chain");
	assert.match(result.unsupportedReason, /parallel fan-out/);
	assert.equal(result.requests.length, 0);
});
