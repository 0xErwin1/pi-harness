import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildCompletedSummary,
	InMemoryRunStore,
	ManagerRuntime,
} from "../../packages/subagent-manager-core/index.ts";
import { createManagerCommandSurface } from "../../packages/subagent-manager-pi/index.ts";

function withCwd(): string {
	const cwd = mkdtempSync(join(tmpdir(), "pi-harness-cmdsurface-"));
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	return cwd;
}

function makeRuntime(store?: InMemoryRunStore): ManagerRuntime {
	return new ManagerRuntime({ registry: {}, providers: [], store });
}

test("createManagerCommandSurface status lists in-flight and completed runs", async () => {
	const store = new InMemoryRunStore();

	store.create({
		id: "run-in-flight",
		agent: "sdd-apply",
		policyMode: "workspace-write",
		requestedExecutionMode: "subprocess",
		resolvedExecutionMode: "subprocess",
		startedAt: "2026-06-27T10:00:00.000Z",
	});

	store.create({
		id: "run-done",
		agent: "general-purpose",
		policyMode: "workspace-write",
		requestedExecutionMode: "subprocess",
		resolvedExecutionMode: "subprocess",
		startedAt: "2026-06-27T10:01:00.000Z",
	});
	store.append({
		id: "run-done:run.completed:1",
		runId: "run-done",
		type: "run.completed",
		at: "2026-06-27T10:02:00.000Z",
		summary: buildCompletedSummary("done", "subprocess", "manager"),
	});

	const surface = createManagerCommandSurface({ cwd: withCwd(), backend: makeRuntime(store) });
	const result = await surface.status();

	assert.equal(result.available, true);
	assert.equal(result.runs.length, 2);

	const runIds = result.runs.map((r) => r.id);
	assert.ok(runIds.includes("run-in-flight"), "in-flight run must appear in status");
	assert.ok(runIds.includes("run-done"), "completed run must appear in status");

	const rendered = result.lines.join("\n");
	assert.match(rendered, /run-in-flight \| sdd-apply \| queued/);
	assert.match(rendered, /run-done \| general-purpose \| completed/);
});

test("createManagerCommandSurface status with a run id filters to that run", async () => {
	const store = new InMemoryRunStore();

	store.create({
		id: "run-abc",
		agent: "worker",
		policyMode: "workspace-write",
		requestedExecutionMode: "subprocess",
		resolvedExecutionMode: "subprocess",
		startedAt: "2026-06-27T10:00:00.000Z",
	});
	store.create({
		id: "run-other",
		agent: "reviewer",
		policyMode: "workspace-write",
		requestedExecutionMode: "subprocess",
		resolvedExecutionMode: "subprocess",
		startedAt: "2026-06-27T10:01:00.000Z",
	});

	const surface = createManagerCommandSurface({ cwd: withCwd(), backend: makeRuntime(store) });
	const result = await surface.status("run-abc");

	assert.equal(result.available, true);
	assert.equal(result.runs.length, 1);
	assert.equal(result.runs[0]?.id, "run-abc");
});

test("createManagerCommandSurface interrupt delegates to backend and moves the run to needs-attention", async () => {
	const store = new InMemoryRunStore();

	store.create({
		id: "run-xyz",
		agent: "sdd-design",
		policyMode: "workspace-write",
		requestedExecutionMode: "subprocess",
		resolvedExecutionMode: "subprocess",
		startedAt: "2026-06-27T10:00:00.000Z",
	});
	const runtime = makeRuntime(store);

	const surface = createManagerCommandSurface({ cwd: withCwd(), backend: runtime });
	const result = await surface.interrupt("run-xyz");

	assert.equal(result.available, true);
	assert.equal(result.runId, "run-xyz");
	assert.equal(store.get("run-xyz")?.status, "needs-attention");
	assert.deepEqual(result.lines, ["Interrupt requested for manager run 'run-xyz'."]);
});

test("createManagerCommandSurface doctor reports status-surface ok when backend is present", () => {
	const surface = createManagerCommandSurface({ cwd: withCwd(), backend: makeRuntime() });
	const result = surface.doctor();

	const statusCheck = result.checks.find((c) => c.name === "status-surface");
	assert.ok(statusCheck, "status-surface check must exist in doctor result");
	assert.equal(statusCheck.ok, true);
	assert.match(result.lines.join("\n"), /\[ok\] status-surface/);
});

test("createManagerCommandSurface status without backend returns unavailable", async () => {
	const surface = createManagerCommandSurface({ cwd: withCwd() });
	const result = await surface.status();

	assert.equal(result.available, false);
	assert.equal(result.backendPresent, false);
	assert.match(result.message, /not wired/);
});

test("createManagerCommandSurface doctor without backend reports status-surface failing", () => {
	const surface = createManagerCommandSurface({ cwd: withCwd() });
	const result = surface.doctor();

	const statusCheck = result.checks.find((c) => c.name === "status-surface");
	assert.ok(statusCheck, "status-surface check must exist in doctor result");
	assert.equal(statusCheck.ok, false);
	assert.match(result.lines.join("\n"), /\[warn\] status-surface/);
});
