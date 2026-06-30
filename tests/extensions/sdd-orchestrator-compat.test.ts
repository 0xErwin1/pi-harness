import test from "node:test";
import assert from "node:assert/strict";
import {
	buildDelegationMessage,
	buildMultiPhaseDelegationMessage,
} from "../../extensions/sdd-orchestrator.ts";

test("buildDelegationMessage emits the pi-subagents Agent tool format", () => {
	const message = buildDelegationMessage({
		phase: "apply-progress",
		changeName: "best-subagent-manager",
		project: "pi-harness",
		cwd: "/tmp/pi-harness",
		dependencies: [],
	});

	assert.match(message, /Call the Agent tool with these parameters:/);
	assert.match(message, /- subagent_type: "sdd-apply"/);
	assert.match(message, /- prompt: \|/);
	assert.match(message, /Target topic_key: sdd\/best-subagent-manager\/apply-progress/);

	assert.doesNotMatch(message, /context: "fresh"/);
	assert.doesNotMatch(message, /- agent:/);
});

test("buildMultiPhaseDelegationMessage emits Agent-tool steps in phase order", () => {
	const message = buildMultiPhaseDelegationMessage({
		phases: ["explore", "proposal"],
		changeName: "demo",
		project: "pi-harness",
		cwd: "/tmp/pi-harness",
		status: {
			explore: undefined,
			proposal: undefined,
			spec: undefined,
			design: undefined,
			tasks: undefined,
			"apply-progress": undefined,
			"verify-report": undefined,
			"archive-report": undefined,
		},
	});

	assert.match(message, /Call the Agent tool with:/);
	assert.match(message, /- subagent_type: "sdd-explore"/);
	assert.match(message, /- subagent_type: "sdd-propose"/);
	assert.match(message, /- prompt: \|/);
	assert.match(message, /Wait for each Agent call/);

	assert.doesNotMatch(message, /context: "fresh"/);

	const exploreIdx = message.indexOf(`subagent_type: "sdd-explore"`);
	const proposeIdx = message.indexOf(`subagent_type: "sdd-propose"`);
	assert.ok(
		exploreIdx >= 0 && proposeIdx > exploreIdx,
		"explore step precedes proposal step",
	);
});
