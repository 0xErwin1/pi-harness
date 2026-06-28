import test from "node:test";
import assert from "node:assert/strict";
import {
	runPiProcessProvider,
	buildChildEnv,
	StdoutLineBuffer,
	summarizeToolArgs,
} from "../../packages/subagent-manager-core/providers/process-runner.ts";
import { agentIdFor } from "../../packages/subagent-manager-core/file-tree/paths.ts";
import { InMemoryRunStore } from "../../packages/subagent-manager-core/store.ts";
import type { ProviderRunContext } from "../../packages/subagent-manager-core/runtime.ts";
import type { RunEvent, RunOutputEvent, RunProgressEvent } from "../../packages/subagent-manager-core/events.ts";
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

test("process-runner: token usage accumulates a running total on the run snapshot", async () => {
	const store = new InMemoryRunStore();
	const ctx = makeContext(store);

	const previousBin = process.env.PI_HARNESS_PI_BIN;
	process.env.PI_HARNESS_PI_BIN = fakePiBin;
	process.env.PI_TOKENS = "1";

	try {
		await runPiProcessProvider(ctx);
	} finally {
		process.env.PI_HARNESS_PI_BIN = previousBin;
		delete process.env.PI_TOKENS;
	}

	const snapshot = store.get("r1");
	assert.equal(snapshot?.tokens, 375, "running token total must sum both messages' input+output (150 + 225)");

	const outputs = store.eventsFor("r1").filter((e): e is RunOutputEvent => e.type === "run.output");
	const withTokens = outputs.filter((e) => typeof e.tokens === "number");
	assert.equal(withTokens.length, 2, "each message_end with usage must carry its token total once");
	assert.equal(withTokens[0].tokens, 150);
	assert.equal(withTokens[1].tokens, 225);
});

test("process-runner: a run with no usage reports no token total (never crashes)", async () => {
	const store = new InMemoryRunStore();
	const ctx = makeContext(store);

	const previousBin = process.env.PI_HARNESS_PI_BIN;
	process.env.PI_HARNESS_PI_BIN = fakePiBin;

	try {
		await runPiProcessProvider(ctx);
	} finally {
		process.env.PI_HARNESS_PI_BIN = previousBin;
	}

	const snapshot = store.get("r1");
	assert.equal(snapshot?.tokens, undefined, "absent usage must leave the token total unset, not 0-from-a-phantom-emit");
});

test("StdoutLineBuffer: a multi-byte UTF-8 character split across two chunks is never corrupted", () => {
	const payload = '{"type":"message_end","text":"café 日本語 — résumé"}\n';
	const bytes = Buffer.from(payload, "utf8");

	for (let split = 1; split < bytes.length; split++) {
		const buffer = new StdoutLineBuffer();
		const lines = [
			...buffer.push(bytes.subarray(0, split)),
			...buffer.push(bytes.subarray(split)),
		];
		const flushed = buffer.flush();
		if (flushed) lines.push(flushed);

		const joined = lines.join("");
		assert.ok(!joined.includes("�"), `split at byte ${split} corrupted a code point into the replacement char`);
		assert.equal(joined, payload.replace(/\n$/, ""), `split at byte ${split} did not reconstruct the original line`);
	}
});

test("StdoutLineBuffer: line buffering yields whole lines and holds the trailing partial", () => {
	const buffer = new StdoutLineBuffer();

	assert.deepEqual(buffer.push(Buffer.from("alpha\nbra", "utf8")), ["alpha"], "complete lines emit; the partial is held");
	assert.deepEqual(buffer.push(Buffer.from("vo\ncharlie", "utf8")), ["bravo"], "the held partial completes on the next chunk");
	assert.equal(buffer.flush(), "charlie", "flush returns the trailing partial line at close");
});

test("summarizeToolArgs: picks the path for file tools", () => {
	assert.equal(summarizeToolArgs("read", { path: "src/foo.ts" }), "src/foo.ts");
	assert.equal(summarizeToolArgs("edit", { path: "packages/a.ts", edits: [] }), "packages/a.ts");
	assert.equal(summarizeToolArgs("write", { path: "out.txt", content: "x" }), "out.txt");
	assert.equal(summarizeToolArgs("ls", { path: "src" }), "src");
});

test("summarizeToolArgs: picks the command for bash and the pattern for search tools", () => {
	assert.equal(summarizeToolArgs("bash", { command: "pnpm test" }), "pnpm test");
	assert.equal(summarizeToolArgs("grep", { pattern: "TODO", glob: "*.ts" }), "TODO");
	assert.equal(summarizeToolArgs("find", { pattern: "*.test.ts" }), "*.test.ts");
});

test("summarizeToolArgs: tool name matching is case-insensitive", () => {
	assert.equal(summarizeToolArgs("Read", { path: "src/foo.ts" }), "src/foo.ts");
	assert.equal(summarizeToolArgs("BASH", { command: "ls" }), "ls");
});

test("summarizeToolArgs: unknown tool falls back to the first meaningful field", () => {
	assert.equal(summarizeToolArgs("mystery", { command: "do-thing" }), "do-thing");
	assert.equal(summarizeToolArgs("mystery", { file: "x.ts" }), "x.ts");
});

test("summarizeToolArgs: returns undefined when no useful field is present", () => {
	assert.equal(summarizeToolArgs("read", {}), undefined);
	assert.equal(summarizeToolArgs("read", undefined), undefined);
	assert.equal(summarizeToolArgs("read", { path: "   " }), undefined);
	assert.equal(summarizeToolArgs("bash", { command: 42 }), undefined);
});

test("process-runner: a tool_execution_start with args emits a progress event carrying the target", async () => {
	const store = new InMemoryRunStore();
	const ctx = makeContext(store);

	const previousBin = process.env.PI_HARNESS_PI_BIN;
	process.env.PI_HARNESS_PI_BIN = fakePiBin;
	process.env.PI_TOOL_WITH_ARGS = "1";

	try {
		await runPiProcessProvider(ctx);
	} finally {
		process.env.PI_HARNESS_PI_BIN = previousBin;
		delete process.env.PI_TOOL_WITH_ARGS;
	}

	const toolProgress = store.eventsFor("r1")
		.filter((e): e is RunProgressEvent => e.type === "run.progress")
		.find((e) => e.message.startsWith("tool:"));

	assert.ok(toolProgress !== undefined, "a tool progress event must be emitted");
	assert.equal(toolProgress.message, "tool: read");
	assert.equal(toolProgress.target, "src/foo.ts", "the progress event must carry the extracted target");
	assert.equal(toolProgress.toolCall, "read src/foo.ts", "the progress event must carry the richer tool call");
});

test("process-runner: an MCP tool_execution_start emits a progress event with the richer toolCall", async () => {
	const store = new InMemoryRunStore();
	const ctx = makeContext(store);

	const previousBin = process.env.PI_HARNESS_PI_BIN;
	process.env.PI_HARNESS_PI_BIN = fakePiBin;
	process.env.PI_TOOL_MCP = "1";

	try {
		await runPiProcessProvider(ctx);
	} finally {
		process.env.PI_HARNESS_PI_BIN = previousBin;
		delete process.env.PI_TOOL_MCP;
	}

	const toolProgress = store.eventsFor("r1")
		.filter((e): e is RunProgressEvent => e.type === "run.progress")
		.find((e) => e.message.startsWith("tool:"));

	assert.ok(toolProgress !== undefined, "a tool progress event must be emitted");
	assert.equal(toolProgress.message, "tool: engram_mem_save");
	assert.equal(
		toolProgress.toolCall,
		'engram_mem_save (query: "auth bug root cause", project: "pi-harness")',
		"the MCP tool call must show its key args with the prefixed name preserved",
	);
	assert.equal(
		toolProgress.toolCallFull,
		'engram_mem_save (query: "auth bug root cause", project: "pi-harness")',
		"with short args the full form equals the summarized form",
	);
});

test("process-runner: a tool_execution_start emits BOTH the summarized toolCall and the full toolCallFull", async () => {
	const store = new InMemoryRunStore();
	const ctx = makeContext(store);

	const previousBin = process.env.PI_HARNESS_PI_BIN;
	process.env.PI_HARNESS_PI_BIN = fakePiBin;
	process.env.PI_TOOL_MCP_FULL = "1";

	try {
		await runPiProcessProvider(ctx);
	} finally {
		process.env.PI_HARNESS_PI_BIN = previousBin;
		delete process.env.PI_TOOL_MCP_FULL;
	}

	const toolProgress = store.eventsFor("r1")
		.filter((e): e is RunProgressEvent => e.type === "run.progress")
		.find((e) => e.message.startsWith("tool:"));

	assert.ok(toolProgress !== undefined, "a tool progress event must be emitted");

	assert.ok(toolProgress.toolCall !== undefined, "the summarized toolCall must be present");
	assert.ok(toolProgress.toolCall.includes(", …)"), "the summarized form caps its key list");
	assert.ok(toolProgress.toolCall.includes("…"), "the summarized form truncates the over-long value");

	assert.ok(toolProgress.toolCallFull !== undefined, "the full toolCallFull must be present alongside toolCall");
	assert.ok(!toolProgress.toolCallFull.includes("…"), "the full form must contain no ellipsis");
	assert.ok(toolProgress.toolCallFull.includes("topic_key:"), "the full form must show every key");
	assert.ok(
		toolProgress.toolCallFull.includes("Proposed LSP references hardening and resolver fix across modules and packages"),
		"the full form must carry the complete, untruncated value",
	);
});

test("process-runner: a thinking block emits a separate kind:'thinking' run.output, excluded from result and turns", async () => {
	const store = new InMemoryRunStore();
	const ctx = makeContext(store);

	const previousBin = process.env.PI_HARNESS_PI_BIN;
	process.env.PI_HARNESS_PI_BIN = fakePiBin;
	process.env.PI_THINKING = "1";

	let result: Awaited<ReturnType<typeof runPiProcessProvider>> | undefined;
	try {
		result = await runPiProcessProvider(ctx);
	} finally {
		process.env.PI_HARNESS_PI_BIN = previousBin;
		delete process.env.PI_THINKING;
	}

	const outputs = store.eventsFor("r1").filter((e): e is RunOutputEvent => e.type === "run.output");
	const thinkingOutputs = outputs.filter((e) => e.kind === "thinking");
	const assistantOutputs = outputs.filter((e) => e.role === "assistant");

	assert.equal(thinkingOutputs.length, 1, "the thinking block must emit one kind:'thinking' run.output");
	assert.equal(thinkingOutputs[0].text, "Let me weigh the options first.");
	assert.equal(thinkingOutputs[0].role, undefined, "thinking output must not carry the assistant role");

	assert.equal(assistantOutputs.length, 1, "the final text must emit one assistant run.output");
	assert.equal(assistantOutputs[0].text, "final answer");

	const msgs = store.messagesFor("r1");
	assert.equal(msgs.length, 1, "thinking must not be accumulated as a message");
	assert.equal(msgs[0].text, "final answer");

	assert.equal(result!.summary.text, "final answer", "run result text must be the final answer, not the thinking");
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

// ---------------------------------------------------------------------------
// buildChildEnv
// ---------------------------------------------------------------------------

test("buildChildEnv: PI_HARNESS_RUN_ROOT is set to the session root", () => {
	const savedRoot = process.env.PI_HARNESS_RUN_ROOT;
	try {
		process.env.PI_HARNESS_RUN_ROOT = "/tmp/test-session-root";
		const env = buildChildEnv("run-abc");
		assert.equal(env.PI_HARNESS_RUN_ROOT, "/tmp/test-session-root");
	} finally {
		if (savedRoot === undefined) delete process.env.PI_HARNESS_RUN_ROOT;
		else process.env.PI_HARNESS_RUN_ROOT = savedRoot;
	}
});

test("buildChildEnv: PI_HARNESS_SUBAGENT_DEPTH is parent depth + 1", () => {
	const savedRoot = process.env.PI_HARNESS_RUN_ROOT;
	const savedDepth = process.env.PI_HARNESS_SUBAGENT_DEPTH;
	try {
		process.env.PI_HARNESS_RUN_ROOT = "/tmp/test-session-root";
		process.env.PI_HARNESS_SUBAGENT_DEPTH = "2";

		const env = buildChildEnv("run-xyz");
		assert.equal(env.PI_HARNESS_SUBAGENT_DEPTH, "3");
	} finally {
		if (savedRoot === undefined) delete process.env.PI_HARNESS_RUN_ROOT;
		else process.env.PI_HARNESS_RUN_ROOT = savedRoot;
		if (savedDepth === undefined) delete process.env.PI_HARNESS_SUBAGENT_DEPTH;
		else process.env.PI_HARNESS_SUBAGENT_DEPTH = savedDepth;
	}
});

test("buildChildEnv: PI_HARNESS_SUBAGENT_DEPTH defaults to 1 (parent at depth 0)", () => {
	const savedRoot = process.env.PI_HARNESS_RUN_ROOT;
	const savedDepth = process.env.PI_HARNESS_SUBAGENT_DEPTH;
	try {
		process.env.PI_HARNESS_RUN_ROOT = "/tmp/test-session-root";
		delete process.env.PI_HARNESS_SUBAGENT_DEPTH;

		const env = buildChildEnv("run-default");
		assert.equal(env.PI_HARNESS_SUBAGENT_DEPTH, "1");
	} finally {
		if (savedRoot === undefined) delete process.env.PI_HARNESS_RUN_ROOT;
		else process.env.PI_HARNESS_RUN_ROOT = savedRoot;
		if (savedDepth === undefined) delete process.env.PI_HARNESS_SUBAGENT_DEPTH;
		else process.env.PI_HARNESS_SUBAGENT_DEPTH = savedDepth;
	}
});

test("buildChildEnv: PI_HARNESS_PARENT_AGENT_ID matches agentIdFor(runId)", () => {
	const savedRoot = process.env.PI_HARNESS_RUN_ROOT;
	try {
		process.env.PI_HARNESS_RUN_ROOT = "/tmp/test-session-root";
		const runId = "specific-run-id";
		const env = buildChildEnv(runId);
		assert.equal(env.PI_HARNESS_PARENT_AGENT_ID, agentIdFor(runId));
	} finally {
		if (savedRoot === undefined) delete process.env.PI_HARNESS_RUN_ROOT;
		else process.env.PI_HARNESS_RUN_ROOT = savedRoot;
	}
});

// ---------------------------------------------------------------------------
// run.tool_result emission
// ---------------------------------------------------------------------------

test("process-runner: tool_execution_end emits a run.tool_result event with tool result fields", async () => {
	const store = new InMemoryRunStore();
	const ctx = makeContext(store);

	const previousBin = process.env.PI_HARNESS_PI_BIN;
	process.env.PI_HARNESS_PI_BIN = fakePiBin;
	process.env.PI_TOOL_WITH_RESULT = "1";

	try {
		await runPiProcessProvider(ctx);
	} finally {
		process.env.PI_HARNESS_PI_BIN = previousBin;
		delete process.env.PI_TOOL_WITH_RESULT;
	}

	const events = store.eventsFor("r1");
	const toolResultEvents = events.filter((e) => e.type === "run.tool_result");

	assert.equal(toolResultEvents.length, 1, "one run.tool_result event must be emitted for the tool_execution_end");

	const ev = toolResultEvents[0] as RunEvent & { type: "run.tool_result"; toolName: string; toolCallId?: string; resultText?: string };
	assert.equal(ev.toolName, "read");
	assert.equal(ev.toolCallId, "call-r001");
	assert.equal(ev.resultText, "README contents here");
});

test("process-runner: run.tool_result does not alter snapshot status (status stays running until runtime completes it)", async () => {
	const store = new InMemoryRunStore();
	const ctx = makeContext(store);

	const previousBin = process.env.PI_HARNESS_PI_BIN;
	process.env.PI_HARNESS_PI_BIN = fakePiBin;
	process.env.PI_TOOL_WITH_RESULT = "1";

	try {
		await runPiProcessProvider(ctx);
	} finally {
		process.env.PI_HARNESS_PI_BIN = previousBin;
		delete process.env.PI_TOOL_WITH_RESULT;
	}

	const snapshot = store.get("r1");
	assert.ok(snapshot?.status !== "failed", "run must not be in failed state after a tool result event");
	assert.ok(snapshot?.status !== "interrupted", "run must not be in interrupted state after a tool result event");

	const toolResultEvents = store.eventsFor("r1").filter((e) => e.type === "run.tool_result");
	assert.equal(toolResultEvents.length, 1, "the run.tool_result event must still be in the log");
});
