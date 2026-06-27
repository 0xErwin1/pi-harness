import test from "node:test";
import assert from "node:assert/strict";
import { translateSubagentPayload } from "../../packages/subagent-manager-pi/index.ts";

test("translateSubagentPayload: message alias used as prompt for single", () => {
	const result = translateSubagentPayload({ message: "Explore the codebase" });

	assert.equal(result.unsupported, false);
	assert.equal(result.mode, "single");
	assert.equal(result.requests[0]?.prompt, "Explore the codebase");
	assert.equal(result.requests[0]?.agent, "general-purpose");
});

test("translateSubagentPayload: input alias used as prompt for single", () => {
	const result = translateSubagentPayload({ input: "Summarize this file" });

	assert.equal(result.unsupported, false);
	assert.equal(result.mode, "single");
	assert.equal(result.requests[0]?.prompt, "Summarize this file");
});

test("translateSubagentPayload: query alias used as prompt for single", () => {
	const result = translateSubagentPayload({ query: "What does this function do?" });

	assert.equal(result.unsupported, false);
	assert.equal(result.mode, "single");
	assert.equal(result.requests[0]?.prompt, "What does this function do?");
});

test("translateSubagentPayload: task alias takes precedence over message/input/query", () => {
	const result = translateSubagentPayload({
		agent: "scout",
		task: "primary task",
		message: "secondary",
		input: "tertiary",
	});

	assert.equal(result.unsupported, false);
	assert.equal(result.requests[0]?.prompt, "primary task");
});

test("translateSubagentPayload: prompt takes precedence over message, input, query", () => {
	const result = translateSubagentPayload({
		prompt: "use this",
		message: "not this",
		input: "not this either",
	});

	assert.equal(result.unsupported, false);
	assert.equal(result.requests[0]?.prompt, "use this");
});

test("translateSubagentPayload: action payload is unsupported", () => {
	const result = translateSubagentPayload({ action: "status", id: "run-42" });

	assert.equal(result.unsupported, true);
	assert.equal(result.mode, "action");
	assert.equal(result.requests.length, 0);
	assert.match(result.unsupportedReason, /action 'status'/);
});

test("translateSubagentPayload: chain sequential two-step succeeds", () => {
	const result = translateSubagentPayload({
		chain: [
			{ agent: "scout", task: "Gather context" },
			{ agent: "writer", task: "Draft output" },
		],
	});

	assert.equal(result.unsupported, false);
	assert.equal(result.mode, "chain");
	assert.equal(result.requests.length, 2);
	assert.equal(result.requests[0]?.agent, "scout");
	assert.equal(result.requests[0]?.strategy, "chain");
	assert.equal(result.requests[0]?.metadata?.chainIndex, 0);
	assert.equal(result.requests[1]?.agent, "writer");
	assert.equal(result.requests[1]?.metadata?.chainIndex, 1);
});

test("translateSubagentPayload: async chain is unsupported", () => {
	const result = translateSubagentPayload({
		chain: [{ agent: "scout", task: "Gather" }],
		async: true,
	});

	assert.equal(result.unsupported, true);
	assert.equal(result.mode, "chain");
	assert.match(result.unsupportedReason, /async chain/);
});

test("translateSubagentPayload: chain first step without task is unsupported", () => {
	const result = translateSubagentPayload({
		chain: [{ agent: "scout" }],
	});

	assert.equal(result.unsupported, true);
	assert.equal(result.mode, "chain");
	assert.match(result.unsupportedReason, /first chain step requires an explicit task/);
});

test("translateSubagentPayload: async parallel is unsupported", () => {
	const result = translateSubagentPayload({
		tasks: [{ agent: "worker", task: "do work" }],
		async: true,
	});

	assert.equal(result.unsupported, true);
	assert.equal(result.mode, "parallel");
	assert.match(result.unsupportedReason, /async or worktree/);
});

test("translateSubagentPayload: worktree parallel is unsupported", () => {
	const result = translateSubagentPayload({
		tasks: [{ agent: "worker", task: "do work" }],
		worktree: true,
	});

	assert.equal(result.unsupported, true);
	assert.equal(result.mode, "parallel");
});

test("translateSubagentPayload: single with blank task is unsupported", () => {
	const result = translateSubagentPayload({ agent: "scout", task: "   " });

	assert.equal(result.unsupported, true);
	assert.equal(result.mode, "single");
	assert.match(result.unsupportedReason, /requires a task/);
});

test("translateSubagentPayload: single async is unsupported", () => {
	const result = translateSubagentPayload({ prompt: "Do something", async: true });

	assert.equal(result.unsupported, true);
	assert.equal(result.mode, "single");
	assert.match(result.unsupportedReason, /async/);
});

test("translateSubagentPayload: single clarify is unsupported", () => {
	const result = translateSubagentPayload({ prompt: "Do something", clarify: true });

	assert.equal(result.unsupported, true);
	assert.equal(result.mode, "single");
});

test("translateSubagentPayload: single run_in_background is unsupported", () => {
	const result = translateSubagentPayload({
		prompt: "Do something",
		run_in_background: true,
	});

	assert.equal(result.unsupported, true);
	assert.equal(result.mode, "single");
});

test("translateSubagentPayload: chain propagates chainDir into request metadata", () => {
	const result = translateSubagentPayload({
		chain: [{ agent: "writer", task: "Write report" }],
		chainDir: "/tmp/mychain",
	});

	assert.equal(result.unsupported, false);
	assert.equal(result.requests[0]?.metadata?.chainDir, "/tmp/mychain");
});
