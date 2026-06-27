import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDelegationMessage, resolveDelegationTransport } from "../../extensions/sdd-orchestrator.ts";
import { runManagerDoctor } from "../../packages/subagent-manager-pi/index.ts";

function withSettings(settings?: Record<string, unknown>): string {
	const cwd = mkdtempSync(join(tmpdir(), "pi-harness-manager-"));
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	if (settings) {
		writeFileSync(join(cwd, ".pi", "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
	}
	return cwd;
}

test("runManagerDoctor reports mandatory harness manager", () => {
	const result = runManagerDoctor({ cwd: withSettings() });

	assert.equal(result.config.runtime, "manager");
	assert.match(result.lines.join("\n"), /Harness subagent manager is mandatory/);
	assert.match(result.lines.join("\n"), /No pi-subagents dependency/);
});

test("resolveDelegationTransport uses manager routing on default config", () => {
	const cwd = withSettings();
	const decision = resolveDelegationTransport(cwd, {
		agent: "sdd-apply",
		task: "Implement required manager path",
		context: "fresh",
	});
	const message = buildDelegationMessage({
		phase: "apply-progress",
		changeName: "best-subagent-manager",
		project: "pi-harness",
		cwd,
		dependencies: [],
	});

	assert.equal(decision.mode, "manager-compat");
	assert.match(decision.reason, /manager runtime/);
	assert.match(message, /Preserve fixed SDD agent identity/);
});

test("resolveDelegationTransport reports unsupported manager capabilities explicitly", () => {
	const cwd = withSettings({ subagentManager: { runtime: "manager" } });
	const decision = resolveDelegationTransport(cwd, {
		action: "status",
		id: "run-123",
	});

	assert.equal(decision.mode, "unsupported");
	assert.match(decision.note ?? "", /cannot translate this payload yet/);
});
