import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagerRuntime, InMemoryRunStore } from "../../packages/subagent-manager-core/index.ts";
import { requestManagerInterrupt } from "../../packages/subagent-manager-pi/index.ts";

function withConfig(runtime: "hybrid" | "manager"): string {
	const cwd = mkdtempSync(join(tmpdir(), "pi-harness-interrupt-"));
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "settings.json"),
		`${JSON.stringify({ subagentManager: { runtime } }, null, 2)}\n`,
	);
	return cwd;
}

test("requestManagerInterrupt delegates to a manager backend when available", async () => {
	const store = new InMemoryRunStore();
	store.create({
		id: "run-456",
		agent: "worker",
		policyMode: "workspace-write",
		requestedExecutionMode: "subprocess",
		resolvedExecutionMode: "subprocess",
		startedAt: "2026-06-26T21:02:00.000Z",
	});
	const runtime = new ManagerRuntime({ registry: {}, providers: [], store });

	const result = await requestManagerInterrupt(
		{
			cwd: withConfig("hybrid"),
			backend: runtime,
		},
		"run-456",
	);

	assert.equal(result.available, true);
	assert.equal(store.get("run-456")?.status, "needs-attention");
	assert.deepEqual(result.lines, ["Interrupt requested for manager run 'run-456'."]);
});

test("requestManagerInterrupt fails safely without a manager backend", async () => {
	const result = await requestManagerInterrupt({ cwd: withConfig("manager") }, "run-789");

	assert.equal(result.available, false);
	assert.match(result.message, /not wired/);
	assert.deepEqual(result.lines, [result.message]);
});
