import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildDelegationMessage,
	resolveDelegationTransport,
} from "../../extensions/sdd-orchestrator.ts";

function withManagerConfig(runtime: "hybrid" | "manager"): string {
	const cwd = mkdtempSync(join(tmpdir(), "pi-harness-sdd-orchestrator-"));
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "settings.json"),
		`${JSON.stringify({ subagentManager: { runtime } }, null, 2)}\n`,
	);
	return cwd;
}

test("buildDelegationMessage adds fixed-identity guidance when manager compat is enabled", () => {
	const message = buildDelegationMessage({
		phase: "apply-progress",
		changeName: "best-subagent-manager",
		project: "pi-harness",
		cwd: withManagerConfig("manager"),
		dependencies: [],
	});

	assert.match(message, /Preserve fixed SDD agent identity: "sdd-apply"/);
	assert.match(message, /Call the subagent tool/);
});

test("resolveDelegationTransport reports unsupported manager control payloads", () => {
	const decision = resolveDelegationTransport(withManagerConfig("manager"), {
		action: "status",
		id: "run-123",
	});

	assert.equal(decision.mode, "unsupported");
	assert.match(decision.reason, /not implemented by the harness manager/);
	assert.match(decision.note ?? "", /Adjust the delegation request/);
});
