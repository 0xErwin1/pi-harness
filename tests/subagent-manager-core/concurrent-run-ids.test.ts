import test from "node:test";
import assert from "node:assert/strict";
import {
	ManagerRuntime,
	type ExecutionProvider,
	type ProviderRunContext,
	type RunResult,
} from "../../packages/subagent-manager-core/runtime.ts";
import { InMemoryRunStore } from "../../packages/subagent-manager-core/store.ts";
import { TOOL_PROGRESS_PREFIX } from "../../packages/subagent-manager-core/events.ts";
import { buildSubagentRowModel } from "../../packages/subagent-manager-pi/tui/subagent-row-model.ts";
import type { RegisteredAgent } from "../../packages/subagent-manager-core/registry.ts";

const AGENT: RegisteredAgent = {
	name: "sdd-apply",
	description: "Test agent",
	promptRef: "You are sdd-apply.",
	policyMode: "writer",
	scope: "builtin",
	order: 0,
};

function makeRegistry() {
	return { builtin: [AGENT] };
}

/**
 * Provider that emits one tool-progress event and then blocks until released, so
 * a run stays in `running` and a test can inspect both rows mid-flight.
 */
function makeGatedProvider(): { provider: ExecutionProvider; releaseAll: () => void } {
	const gates: Array<() => void> = [];
	const provider: ExecutionProvider = {
		kind: "subprocess",
		canHandle: () => true,
		run: (ctx: ProviderRunContext) =>
			new Promise<RunResult>((resolve) => {
				ctx.emit({ type: "run.progress", message: `${TOOL_PROGRESS_PREFIX} Read`, target: "x" });
				gates.push(() =>
					resolve({
						runId: ctx.runId,
						summary: { text: "done", executionMode: "subprocess", routedBy: "test" },
					}),
				);
			}),
	};
	return { provider, releaseAll: () => gates.splice(0).forEach((g) => g()) };
}

test("createRunId: ids are unique across runtimes in the same process and millisecond", async () => {
	const frozen = new Date("2024-01-01T00:00:00.000Z");
	const runtimeA = new ManagerRuntime({
		registry: makeRegistry(),
		providers: [makeGatedProvider().provider],
		now: () => frozen,
	});
	const runtimeB = new ManagerRuntime({
		registry: makeRegistry(),
		providers: [makeGatedProvider().provider],
		now: () => frozen,
	});

	const captured: string[] = [];
	void runtimeA.run({ agent: "sdd-apply", prompt: "A" }, { onStart: (id) => captured.push(id) });
	void runtimeB.run({ agent: "sdd-apply", prompt: "B" }, { onStart: (id) => captured.push(id) });

	assert.equal(captured.length, 2, "both runs must report a start id");
	assert.notEqual(
		captured[0],
		captured[1],
		"two same-agent runs in the same millisecond in different runtimes must not share a run id",
	);
});

test("concurrent same-agent runs in one process keep distinct snapshots and both rows resolve to their own run", async () => {
	const frozen = new Date("2024-01-01T00:00:00.000Z");

	// The harness keys one ManagerRuntime per cwd but all runs share a single
	// process-global identity space (the session file tree and run-id-keyed
	// consumers). Model that shared namespace with one store fed by two runtimes:
	// colliding ids clobber here exactly as they do in the real tree.
	const store = new InMemoryRunStore();
	const gateA = makeGatedProvider();
	const gateB = makeGatedProvider();

	const runtimeA = new ManagerRuntime({ registry: makeRegistry(), providers: [gateA.provider], store, now: () => frozen });
	const runtimeB = new ManagerRuntime({ registry: makeRegistry(), providers: [gateB.provider], store, now: () => frozen });

	const idA: string[] = [];
	const idB: string[] = [];
	const runA = runtimeA.run({ agent: "sdd-apply", prompt: "A" }, { onStart: (id) => idA.push(id) });
	const runB = runtimeB.run({ agent: "sdd-apply", prompt: "B" }, { onStart: (id) => idB.push(id) });

	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(store.list().length, 2, "each run must own a distinct snapshot in the shared store");

	const access = {
		snapshot: (id: string) => store.get(id),
		messages: () => [],
		events: (id: string) => store.eventsFor(id),
	};
	const rowA = buildSubagentRowModel(access, idA, Date.now());
	const rowB = buildSubagentRowModel(access, idB, Date.now());

	assert.notEqual(rowA.status, "starting", "row A must resolve its own run, not freeze at 'starting'");
	assert.notEqual(rowB.status, "starting", "row B must resolve its own run, not freeze at 'starting'");
	assert.equal(rowA.status, "running");
	assert.equal(rowB.status, "running");

	gateA.releaseAll();
	gateB.releaseAll();
	await Promise.all([runA, runB]);
});
