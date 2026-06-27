import test from "node:test";
import assert from "node:assert/strict";
import {
	ManagerRuntime,
	selectExecutionRoute,
	type ExecutionProvider,
} from "../../packages/subagent-manager-core/runtime.ts";
import { buildCompletedSummary } from "../../packages/subagent-manager-core/store.ts";
import type { RegisteredAgent } from "../../packages/subagent-manager-core/registry.ts";

const baseAgent: RegisteredAgent = {
	name: "worker",
	description: "Worker",
	promptRef: "prompt:worker",
	policyMode: "writer",
	scope: "builtin",
	order: 0,
};

function provider(kind: ExecutionProvider["kind"], canHandle = true): ExecutionProvider {
	return {
		kind,
		canHandle: () => canHandle,
		run: async ({ runId }) => ({
			runId,
			summary: buildCompletedSummary(`${kind} ok`, kind, `provider:${kind}`),
		}),
	};
}

test("selectExecutionRoute always resolves to subprocess regardless of requested mode", () => {
	for (const execution of ["in-process", "fork", "subprocess", "auto"] as const) {
		const route = selectExecutionRoute({
			request: { agent: "worker", prompt: "do it", execution },
			agent: baseAgent,
			providers: [provider("subprocess")],
		});

		assert.equal(route.mode, "subprocess", `expected subprocess for execution=${execution}`);
		assert.equal(route.provider, "subprocess");
	}
});

test("selectExecutionRoute maps parallel and chain runs to subprocess", () => {
	for (const strategy of ["parallel", "chain"] as const) {
		const route = selectExecutionRoute({
			request: { agent: "worker", prompt: "do it", strategy },
			agent: baseAgent,
			providers: [provider("subprocess")],
		});

		assert.equal(route.mode, "subprocess");
		assert.equal(route.provider, "subprocess");
	}
});

test("selectExecutionRoute maps isolation-preferring runs to subprocess", () => {
	const route = selectExecutionRoute({
		request: { agent: "worker", prompt: "do it", preferIsolation: true },
		agent: baseAgent,
		providers: [provider("subprocess")],
	});

	assert.equal(route.mode, "subprocess");
	assert.equal(route.provider, "subprocess");
});

test("selectExecutionRoute fails explicitly when no manager provider can handle a run", () => {
	assert.throws(
		() => selectExecutionRoute({
			request: { agent: "worker", prompt: "do it", execution: "fork" },
			agent: baseAgent,
			providers: [provider("fork", false)],
		}),
		/No execution provider available/,
	);
});

test("ManagerRuntime records status from provider execution", async () => {
	const runtime = new ManagerRuntime({
		registry: { builtin: [baseAgent] },
		providers: [provider("subprocess")],
		now: () => new Date("2026-06-26T00:00:00.000Z"),
	});

	const result = await runtime.run({ agent: "worker", prompt: "do it" });
	const [snapshot] = await runtime.status(result.runId);

	assert.equal(result.summary.executionMode, "subprocess");
	assert.equal(snapshot?.status, "completed");
	assert.equal(snapshot?.resolvedExecutionMode, "subprocess");
});
