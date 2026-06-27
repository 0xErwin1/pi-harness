import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCompletedSummary, InMemoryRunStore } from "../../packages/subagent-manager-core/index.ts";
import { getManagerStatus } from "../../packages/subagent-manager-pi/index.ts";

function withConfig(runtime: "hybrid" | "manager"): string {
	const cwd = mkdtempSync(join(tmpdir(), "pi-harness-status-"));
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "settings.json"),
		`${JSON.stringify({ subagentManager: { runtime } }, null, 2)}\n`,
	);
	return cwd;
}

test("getManagerStatus renders manager-backed runs from store snapshots", async () => {
	const store = new InMemoryRunStore();
	store.create({
		id: "run-123",
		agent: "sdd-apply",
		policyMode: "workspace-write",
		requestedExecutionMode: "subprocess",
		resolvedExecutionMode: "subprocess",
		startedAt: "2026-06-26T21:00:00.000Z",
	});
	store.append({
		id: "run-123:run.completed:1",
		runId: "run-123",
		type: "run.completed",
		at: "2026-06-26T21:01:00.000Z",
		summary: buildCompletedSummary("done", "subprocess", "manager"),
	});

	const result = await getManagerStatus(
		{
			cwd: withConfig("hybrid"),
			backend: {
				status: async () => store.list(),
				interrupt: async () => undefined,
			},
		},
	);

	assert.equal(result.available, true);
	assert.equal(result.runs.length, 1);
	assert.match(result.lines.join("\n"), /run-123 \| sdd-apply \| completed \| mode=subprocess/);
});

test("getManagerStatus stays placeholder-safe when backend is not wired", async () => {
	const result = await getManagerStatus({ cwd: withConfig("manager") });

	assert.equal(result.available, false);
	assert.equal(result.backendPresent, false);
	assert.match(result.message, /not wired/);
	assert.deepEqual(result.lines, [result.message]);
});
