import test from "node:test";
import assert from "node:assert/strict";
import {
	ManagerRuntime,
	type ExecutionProvider,
	type ProviderRunContext,
} from "../../packages/subagent-manager-core/runtime.ts";
import type { RunEvent, RunSnapshot } from "../../packages/subagent-manager-core/events.ts";
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
		run: async (ctx: ProviderRunContext) => {
			ctx.emit({ type: "run.output", chunk: "hello", role: "assistant", text: "hello", turn: 1 });
			return {
				runId: ctx.runId,
				summary: { text: "done", executionMode: "subprocess" as const, routedBy: "test" },
			};
		},
	};
}

test("runtime.subscribe: listener called when store appends an event", async () => {
	const runtime = new ManagerRuntime({ registry: makeRegistry(), providers: [makeInstantProvider()] });
	const received: RunEvent[] = [];

	runtime.subscribe((event) => received.push(event));
	await runtime.run({ agent: "test-agent", prompt: "hello" });

	assert.ok(received.length > 0, "at least one event must be delivered to the subscriber");
	const types = received.map((e) => e.type);
	assert.ok(types.includes("run.started"), "run.started must be delivered");
	assert.ok(types.includes("run.output"), "run.output must be delivered");
});

test("runtime.subscribe: unsubscribe stops listener delivery", async () => {
	const runtime = new ManagerRuntime({ registry: makeRegistry(), providers: [makeInstantProvider()] });
	const received: RunEvent[] = [];

	const unsub = runtime.subscribe((event) => received.push(event));
	await runtime.run({ agent: "test-agent", prompt: "first" });
	const countAfterFirst = received.length;

	unsub();
	await runtime.run({ agent: "test-agent", prompt: "second" });

	assert.equal(received.length, countAfterFirst, "no new events after unsubscribe");
});

test("runtime.messages: returns accumulated assistant messages for a run", async () => {
	const runtime = new ManagerRuntime({ registry: makeRegistry(), providers: [makeInstantProvider()] });
	let capturedRunId = "";

	runtime.subscribe((event) => {
		if (event.type === "run.started") capturedRunId = event.runId;
	});

	await runtime.run({ agent: "test-agent", prompt: "hello" });

	assert.ok(capturedRunId, "runId must be captured from run.started");
	const msgs = runtime.messages(capturedRunId);
	assert.equal(msgs.length, 1, "one assistant message should be accumulated");
	assert.equal(msgs[0].text, "hello");
	assert.equal(msgs[0].turn, 1);
});

test("runtime.snapshot: returns the run snapshot from the store", async () => {
	const runtime = new ManagerRuntime({ registry: makeRegistry(), providers: [makeInstantProvider()] });
	let capturedRunId = "";

	runtime.subscribe((event) => {
		if (event.type === "run.started") capturedRunId = event.runId;
	});

	await runtime.run({ agent: "test-agent", prompt: "hello" });

	const snap = runtime.snapshot(capturedRunId);
	assert.ok(snap, "snapshot must be returned for a known runId");
	assert.equal((snap as RunSnapshot).status, "completed");
	assert.equal((snap as RunSnapshot).agent, "test-agent");
});

test("runtime.snapshot: returns undefined for unknown runId", () => {
	const runtime = new ManagerRuntime({ registry: makeRegistry(), providers: [makeInstantProvider()] });
	assert.equal(runtime.snapshot("no-such-run"), undefined);
});

test("runtime.run: onStart option is called with the runId before run completes", async () => {
	const runtime = new ManagerRuntime({ registry: makeRegistry(), providers: [makeInstantProvider()] });
	const startedIds: string[] = [];
	let runResult: { runId: string } | undefined;

	runResult = await runtime.run(
		{ agent: "test-agent", prompt: "hello" },
		{ onStart: (id) => startedIds.push(id) },
	);

	assert.equal(startedIds.length, 1, "onStart must be called exactly once");
	assert.equal(startedIds[0], runResult.runId, "onStart runId must match the result runId");
});

test("runtime.run: onStart is called before run.started event reaches subscribers", async () => {
	const runtime = new ManagerRuntime({ registry: makeRegistry(), providers: [makeInstantProvider()] });
	const log: string[] = [];

	runtime.subscribe((event) => {
		if (event.type === "run.started") log.push("started-event");
	});

	await runtime.run(
		{ agent: "test-agent", prompt: "hello" },
		{ onStart: () => log.push("onStart") },
	);

	assert.ok(log.indexOf("onStart") <= log.indexOf("started-event"), "onStart must fire before or at run.started");
});

test("runtime.status: output is identical after adding accessors", async () => {
	const runtime = new ManagerRuntime({ registry: makeRegistry(), providers: [makeInstantProvider()] });

	await runtime.run({ agent: "test-agent", prompt: "hello" });
	const snapshots = await runtime.status();

	assert.equal(snapshots.length, 1);
	assert.equal(snapshots[0].agent, "test-agent");
	assert.equal(snapshots[0].status, "completed");
});
