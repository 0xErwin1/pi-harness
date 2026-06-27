import test from "node:test";
import assert from "node:assert/strict";
import {
	ManagerRuntime,
	selectExecutionRoute,
	type ExecutionProvider,
	type ProviderRunContext,
	type RunRequest,
} from "../../packages/subagent-manager-core/runtime.ts";
import type { RegisteredAgent } from "../../packages/subagent-manager-core/registry.ts";

const TEST_AGENT: RegisteredAgent = {
	name: "test-agent",
	description: "Test agent",
	promptRef: "You are a test agent.",
	policyMode: "writer",
	scope: "builtin",
	order: 0,
};

function makeRegistry() {
	return { builtin: [TEST_AGENT] };
}

function makeInstantProvider(): ExecutionProvider {
	return {
		kind: "subprocess" as const,
		canHandle: () => true,
		run: async (ctx: ProviderRunContext) => ({
			runId: ctx.runId,
			summary: { text: "done", executionMode: "subprocess" as const, routedBy: "test" },
		}),
	};
}

function makeAbortableProvider(): ExecutionProvider {
	return {
		kind: "subprocess" as const,
		canHandle: () => true,
		run: (ctx: ProviderRunContext) =>
			new Promise((_resolve, reject) => {
				if (ctx.signal?.aborted) {
					reject(new Error("aborted"));
					return;
				}
				ctx.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
			}),
	};
}

test("selectExecutionRoute resolves to subprocess for auto mode", () => {
	const plan = selectExecutionRoute({
		request: { agent: "test-agent", prompt: "hello" } as RunRequest,
		agent: TEST_AGENT,
		providers: [makeInstantProvider()],
	});
	assert.equal(plan.mode, "subprocess");
	assert.equal(plan.provider, "subprocess");
});

test("selectExecutionRoute resolves to subprocess when execution is explicitly in-process", () => {
	const plan = selectExecutionRoute({
		request: { agent: "test-agent", prompt: "hello", execution: "in-process" } as RunRequest,
		agent: TEST_AGENT,
		providers: [makeInstantProvider()],
	});
	assert.equal(plan.mode, "subprocess");
});

test("selectExecutionRoute resolves to subprocess when execution is explicitly fork", () => {
	const plan = selectExecutionRoute({
		request: { agent: "test-agent", prompt: "hello", execution: "fork" } as RunRequest,
		agent: TEST_AGENT,
		providers: [makeInstantProvider()],
	});
	assert.equal(plan.mode, "subprocess");
});

test("run lifecycle: store transitions to completed with correct agent and summary", async () => {
	const runtime = new ManagerRuntime({
		registry: makeRegistry(),
		providers: [makeInstantProvider()],
	});

	const result = await runtime.run({ agent: "test-agent", prompt: "hello" });

	assert.ok(result.runId, "runId must be set");
	assert.equal(result.summary.text, "done");

	const [snapshot] = await runtime.status(result.runId);
	assert.equal(snapshot.status, "completed");
	assert.equal(snapshot.agent, "test-agent");
});

test("interrupt(runId) aborts the per-run controller and emits run.interrupted", async () => {
	const runtime = new ManagerRuntime({
		registry: makeRegistry(),
		providers: [makeAbortableProvider()],
	});

	const runPromise = runtime.run({ agent: "test-agent", prompt: "hello" });

	const snapshots = await runtime.status();
	assert.equal(snapshots.length, 1, "run must be registered in the store before provider resolves");
	const runId = snapshots[0].id;

	await runtime.interrupt(runId);

	await assert.rejects(() => runPromise);

	const [final] = await runtime.status(runId);
	assert.equal(final.status, "interrupted");
});

test("external AbortSignal passed to run() aborts the run and emits run.interrupted", async () => {
	const runtime = new ManagerRuntime({
		registry: makeRegistry(),
		providers: [makeAbortableProvider()],
	});

	const external = new AbortController();
	const runPromise = runtime.run({ agent: "test-agent", prompt: "hello" }, { signal: external.signal });

	const snapshots = await runtime.status();
	const runId = snapshots[0].id;

	external.abort();

	await assert.rejects(() => runPromise);

	const [final] = await runtime.status(runId);
	assert.equal(final.status, "interrupted");
});

test("run throws for unknown agent", async () => {
	const runtime = new ManagerRuntime({
		registry: makeRegistry(),
		providers: [makeInstantProvider()],
	});

	await assert.rejects(
		() => runtime.run({ agent: "nonexistent", prompt: "hello" }),
		/Unknown agent/,
	);
});

test("policy-blocked run throws without creating a store entry", async () => {
	const runtime = new ManagerRuntime({
		registry: makeRegistry(),
		providers: [makeInstantProvider()],
	});

	await assert.rejects(
		() => runtime.run({ agent: "test-agent", prompt: "hello", requiresWrite: true, policyMode: "advisory" }),
		/advisory mode cannot modify/,
	);

	const snapshots = await runtime.status();
	assert.equal(snapshots.length, 0, "blocked run must not create a store entry");
});
