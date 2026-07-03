import test from "node:test";
import assert from "node:assert/strict";
import {
	buildDelegationMessage,
	buildInitDelegationMessage,
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
	assert.match(message, /Artifact store: atlas\+engram/);
	assert.match(message, /Target topic_key: sdd\/best-subagent-manager\/apply-progress/);
	assert.match(message, /Engram role: agent memory summary\/pointer/);
	assert.match(message, /Atlas logical path: sdd\/best-subagent-manager\/apply-progress\.md/);
	assert.match(message, /Approval state: needs-approval/);
	assert.match(message, /Mutation permitted: false/);
	assert.match(message, /Do not create or update Atlas records unless mutationPermitted is true/);
	assert.match(message, /"topicKey": "sdd\/best-subagent-manager\/apply-progress"/);
	assert.match(message, /"logicalPath": "sdd\/best-subagent-manager\/apply-progress\.md"/);
	assert.match(message, /"allowEngramOnlyPartial": true/);

	assert.doesNotMatch(message, /Artifact store: engram\b/);
	assert.doesNotMatch(message, /context: "fresh"/);
	assert.doesNotMatch(message, /- agent:/);
});

test("buildInitDelegationMessage includes deterministic detector output and init persistence contract", () => {
	const message = buildInitDelegationMessage({
		project: "pi-harness",
		cwd: "/tmp/pi-harness",
		detection: {
			projectName: "pi-harness",
			cwd: "/tmp/pi-harness",
			detectedAt: "2026-07-03T00:00:00.000Z",
			packageManagers: [{ name: "pnpm", version: "10.33.4", source: "package.json#packageManager" }],
			stack: [
				{ name: "Node.js", confidence: "high", evidence: ["package.json"] },
				{ name: "TypeScript", confidence: "high", evidence: ["tsconfig.json"] },
				{ name: "ESM", confidence: "high", evidence: ["package.json#type=module"] },
			],
			scripts: { test: "tsx --test tests/**/*.test.ts", check: "tsc --noEmit" },
			commands: {
				test: { command: "pnpm test", purpose: "test", source: "package.json#scripts.test", reliable: true },
				check: { command: "pnpm run check", purpose: "check", source: "package.json#scripts.check", reliable: true },
				runtimeVerify: { command: "pnpm run verify:runtime", purpose: "runtime-verify", source: "package.json#scripts.verify:runtime", reliable: true },
				byPurpose: {},
			},
			strictTdd: true,
			evidence: ["package.json", "tsconfig.json", "pnpm-lock.yaml"],
			legacy: { openspecConfigFound: false },
		},
	});

	assert.match(message, /subagent_type: "sdd-init"/);
	assert.match(message, /Artifact store: atlas\+engram/);
	assert.match(message, /Target topic_key: sdd-init\/pi-harness/);
	assert.match(message, /Atlas logical path: sdd-init\/pi-harness\.md/);
	assert.match(message, /Engram role: agent memory summary\/pointer/);
	assert.match(message, /Approval state: needs-approval/);
	assert.match(message, /Mutation permitted: false/);
	assert.match(message, /Detected project facts:/);
	assert.match(message, /Package managers: pnpm@10\.33\.4/);
	assert.match(message, /Stack: Node\.js, TypeScript, ESM/);
	assert.match(message, /Primary test command: pnpm test/);
	assert.match(message, /Primary check command: pnpm run check/);
	assert.match(message, /Runtime verification command: pnpm run verify:runtime/);
	assert.match(message, /Strict TDD: true/);
	assert.match(message, /"topicKey": "sdd-init\/pi-harness"/);
	assert.match(message, /"logicalPath": "sdd-init\/pi-harness\.md"/);
	assert.doesNotMatch(message, /Artifact store: engram\b/);
});

test("buildDelegationMessage emits sdd-tasks Atlas task tracking contract without mutation approval", () => {
	const message = buildDelegationMessage({
		phase: "tasks",
		changeName: "atlas-sdd-preflight-init",
		project: "pi-harness",
		cwd: "/tmp/pi-harness",
		dependencies: [],
	});

	assert.match(message, /- subagent_type: "sdd-tasks"/);
	assert.match(message, /"taskTracking": \{/);
	assert.match(message, /"enabled": false/);
	assert.match(message, /"approvalState": "not-requested"/);
	assert.match(message, /"mutationPermitted": false/);
	assert.match(message, /"noMutationBeforeApproval": true/);
	assert.match(message, /"topicKey": "sdd\/atlas-sdd-preflight-init\/tasks"/);
	assert.match(message, /"documentLogicalPaths": \[/);
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
	assert.match(message, /Artifact store: atlas\+engram/);
	assert.match(message, /Atlas logical path: sdd\/demo\/explore\.md/);
	assert.match(message, /Atlas logical path: sdd\/demo\/proposal\.md/);
	assert.match(message, /Target topic_key: sdd\/demo\/explore/);
	assert.match(message, /Target topic_key: sdd\/demo\/proposal/);

	assert.doesNotMatch(message, /Artifact store: engram\b/);
	assert.doesNotMatch(message, /context: "fresh"/);

	const exploreIdx = message.indexOf(`subagent_type: "sdd-explore"`);
	const proposeIdx = message.indexOf(`subagent_type: "sdd-propose"`);
	assert.ok(
		exploreIdx >= 0 && proposeIdx > exploreIdx,
		"explore step precedes proposal step",
	);
});
