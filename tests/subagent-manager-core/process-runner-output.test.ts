import test from "node:test";
import assert from "node:assert/strict";
import { runPiProcessProvider } from "../../packages/subagent-manager-core/providers/process-runner.ts";
import { InMemoryRunStore } from "../../packages/subagent-manager-core/store.ts";
import type { ProviderRunContext } from "../../packages/subagent-manager-core/runtime.ts";
import type { RunEvent, RunOutputEvent } from "../../packages/subagent-manager-core/events.ts";
import type { RegisteredAgent } from "../../packages/subagent-manager-core/registry.ts";

const fakePiBin = new URL("../../tests/fixtures/fake-pi.mjs", import.meta.url).pathname;

const agent: RegisteredAgent = {
	name: "tester",
	description: "Test agent for process-runner output",
	scope: "ephemeral",
	promptRef: "You are a test agent.",
	execution: "subprocess",
	policyMode: "normal",
	order: 0,
};

function makeContext(store: InMemoryRunStore, runId = "r1"): ProviderRunContext {
	store.create({ id: runId, agent: agent.name, policyMode: "normal", requestedExecutionMode: "subprocess" });
	return {
		runId,
		agent,
		request: { agent: agent.name, prompt: "hello" },
		emit(input) {
			store.append({
				...input,
				id: `${runId}:${input.type}:${Date.now()}`,
				runId,
				at: new Date().toISOString(),
			} as RunEvent);
		},
	};
}

test("process-runner: emits run.output per assistant message_end with role, text, and turn", async () => {
	const store = new InMemoryRunStore();
	const ctx = makeContext(store);

	const previousBin = process.env.PI_HARNESS_PI_BIN;
	process.env.PI_HARNESS_PI_BIN = fakePiBin;
	process.env.PI_MULTI_MESSAGE = "2";

	try {
		await runPiProcessProvider(ctx);
	} finally {
		process.env.PI_HARNESS_PI_BIN = previousBin;
		delete process.env.PI_MULTI_MESSAGE;
	}

	const outputEvents = store.eventsFor("r1").filter((e): e is RunOutputEvent => e.type === "run.output");
	const assistantOutputs = outputEvents.filter((e) => e.role === "assistant");

	assert.equal(assistantOutputs.length, 2, "should emit one run.output per assistant message_end");

	assert.equal(assistantOutputs[0].role, "assistant");
	assert.equal(assistantOutputs[0].text, "message 1");
	assert.equal(assistantOutputs[0].turn, 1);

	assert.equal(assistantOutputs[1].role, "assistant");
	assert.equal(assistantOutputs[1].text, "message 2");
	assert.equal(assistantOutputs[1].turn, 2);
});

test("process-runner: store accumulates messages for each assistant message_end", async () => {
	const store = new InMemoryRunStore();
	const ctx = makeContext(store);

	const previousBin = process.env.PI_HARNESS_PI_BIN;
	process.env.PI_HARNESS_PI_BIN = fakePiBin;
	process.env.PI_MULTI_MESSAGE = "3";

	try {
		await runPiProcessProvider(ctx);
	} finally {
		process.env.PI_HARNESS_PI_BIN = previousBin;
		delete process.env.PI_MULTI_MESSAGE;
	}

	const msgs = store.messagesFor("r1");
	assert.equal(msgs.length, 3, "store should accumulate 3 assistant messages");

	assert.equal(msgs[0].text, "message 1");
	assert.equal(msgs[0].turn, 1);
	assert.equal(msgs[1].text, "message 2");
	assert.equal(msgs[1].turn, 2);
	assert.equal(msgs[2].text, "message 3");
	assert.equal(msgs[2].turn, 3);
});

test("process-runner: final summary text comes from the last message_end (finalAssistantText)", async () => {
	const store = new InMemoryRunStore();
	const ctx = makeContext(store);

	const previousBin = process.env.PI_HARNESS_PI_BIN;
	process.env.PI_HARNESS_PI_BIN = fakePiBin;
	process.env.PI_MULTI_MESSAGE = "2";

	let result: Awaited<ReturnType<typeof runPiProcessProvider>> | undefined;
	try {
		result = await runPiProcessProvider(ctx);
	} finally {
		process.env.PI_HARNESS_PI_BIN = previousBin;
		delete process.env.PI_MULTI_MESSAGE;
	}

	assert.equal(result!.summary.text, "message 2", "summary should come from the LAST assistant message_end");
});

test("process-runner: single-message run.output (default fake-pi, no PI_MULTI_MESSAGE)", async () => {
	const store = new InMemoryRunStore();
	const ctx = makeContext(store);

	const previousBin = process.env.PI_HARNESS_PI_BIN;
	process.env.PI_HARNESS_PI_BIN = fakePiBin;

	try {
		await runPiProcessProvider(ctx);
	} finally {
		process.env.PI_HARNESS_PI_BIN = previousBin;
	}

	const assistantOutputs = store.eventsFor("r1")
		.filter((e): e is RunOutputEvent => e.type === "run.output" && e.role === "assistant");

	assert.equal(assistantOutputs.length, 1, "single message_end → single assistant run.output");
	assert.equal(assistantOutputs[0].text, "fake-pi response");
	assert.equal(assistantOutputs[0].turn, 1);
});
