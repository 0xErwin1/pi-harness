import test from "node:test";
import assert from "node:assert/strict";
import {
	buildExpandedBodyLines,
	buildPerAgentRowModels,
	buildSubagentRowModel,
	type SubagentRowAccess,
} from "../../packages/subagent-manager-pi/tui/subagent-row-model.ts";
import type { RunSnapshot, RunEvent } from "../../packages/subagent-manager-core/events.ts";
import type { RunMessage } from "../../packages/subagent-manager-core/store.ts";

const BASE_STARTED_AT = "2024-01-01T12:00:00.000Z";

function makeSnapshot(id: string, overrides: Partial<RunSnapshot> = {}): RunSnapshot {
	return {
		id,
		agent: "test-agent",
		status: "running",
		requestedExecutionMode: "auto",
		policyMode: "normal",
		startedAt: BASE_STARTED_AT,
		updatedAt: BASE_STARTED_AT,
		...overrides,
	};
}

function makeMessage(text: string, turn: number): RunMessage {
	return { role: "assistant", text, turn, at: new Date().toISOString() };
}

function makeAccess(
	snapshots: Record<string, RunSnapshot>,
	messages: Record<string, RunMessage[]> = {},
	events: Record<string, RunEvent[]> = {},
): SubagentRowAccess {
	return {
		snapshot: (id) => snapshots[id],
		messages: (id) => messages[id] ?? [],
		events: (id) => events[id] ?? [],
	};
}

const now = Date.parse(BASE_STARTED_AT) + 5000;

test("buildSubagentRowModel: basic single run with one message", () => {
	const snap = makeSnapshot("r1");
	const msgs = [makeMessage("Hello, this is the agent response.", 1)];
	const access = makeAccess({ r1: snap }, { r1: msgs });

	const model = buildSubagentRowModel(access, ["r1"], now);

	assert.equal(model.agent, "test-agent");
	assert.equal(model.status, "running");
	assert.equal(model.turns, 1);
	assert.equal(model.elapsedMs, 5000);
	assert.ok(model.currentActivity.length > 0, "currentActivity must be non-empty");
	assert.ok(model.currentActivity.includes("Hello"), "currentActivity should surface the latest message");
});

test("buildSubagentRowModel: a missing snapshot renders a transient 'starting' state, not a frozen queued row", () => {
	const access = makeAccess({});

	const model = buildSubagentRowModel(access, ["ghost"], now);

	assert.equal(model.status, "starting", "an unresolved run must not present as a stuck 'queued' run");
	assert.equal(model.agent, "");
	assert.equal(model.currentActivity, "starting…", "the row must read as in-flight, not frozen");
});

test("buildSubagentRowModel: empty runIds render the transient 'starting' state", () => {
	const access = makeAccess({});

	const model = buildSubagentRowModel(access, [], now);

	assert.equal(model.status, "starting");
	assert.equal(model.currentActivity, "starting…");
});

test("buildSubagentRowModel: a resolved snapshot still drives the status (regression guard for the starting default)", () => {
	const access = makeAccess({ r1: makeSnapshot("r1", { status: "running" }) });

	const model = buildSubagentRowModel(access, ["r1"], now);

	assert.equal(model.status, "running", "a resolvable run keeps its real status");
});

test("buildSubagentRowModel: currentActivity is hard-truncated to a single short line", () => {
	const longText = "A".repeat(100);
	const msgs = [makeMessage(longText, 1)];
	const access = makeAccess({ r1: makeSnapshot("r1") }, { r1: msgs });

	const model = buildSubagentRowModel(access, ["r1"], now);

	assert.ok(model.currentActivity.length <= 50, `currentActivity must be ≤50 chars, got ${model.currentActivity.length}`);
	assert.ok(model.currentActivity.endsWith("…"), "an over-long activity must be truncated with an ellipsis");
});

test("buildSubagentRowModel: currentActivity is the first line of the latest message", () => {
	const msgs = [
		makeMessage("first message", 1),
		makeMessage("second message\ncontinued on next line", 2),
	];
	const access = makeAccess({ r1: makeSnapshot("r1") }, { r1: msgs });

	const model = buildSubagentRowModel(access, ["r1"], now);

	assert.equal(model.currentActivity, "second message", "currentActivity should be the first line of the last message");
});

test("buildPerAgentRowModels: N runIds yield N independent row models in order (P2)", () => {
	const snap1 = makeSnapshot("r1", { agent: "alpha", status: "running" });
	const snap2 = makeSnapshot("r2", { agent: "beta", status: "completed" });
	const snap3 = makeSnapshot("r3", { agent: "gamma", status: "failed" });
	const access = makeAccess(
		{ r1: snap1, r2: snap2, r3: snap3 },
		{ r1: [makeMessage("alpha working", 1)] },
	);

	const models = buildPerAgentRowModels(access, ["r1", "r2", "r3"], now);

	assert.equal(models.length, 3, "one model per run id");
	assert.deepEqual(models.map((m) => m.agent), ["alpha", "beta", "gamma"]);
	assert.deepEqual(models.map((m) => m.status), ["running", "completed", "failed"]);
	assert.equal(models[0].turns, 1, "each model reflects only its own run's messages");
	assert.equal(models[1].turns, 0);
});

test("buildPerAgentRowModels: an empty runIds list yields no rows (P2)", () => {
	const access = makeAccess({});
	assert.deepEqual(buildPerAgentRowModels(access, [], now), []);
});

test("buildSubagentRowModel: turns counts total messages across runIds", () => {
	const snap1 = makeSnapshot("r1");
	const snap2 = makeSnapshot("r2", { agent: "other-agent" });
	const msgs1 = [makeMessage("msg 1", 1), makeMessage("msg 2", 2)];
	const msgs2 = [makeMessage("msg 3", 1)];
	const access = makeAccess({ r1: snap1, r2: snap2 }, { r1: msgs1, r2: msgs2 });

	const model = buildSubagentRowModel(access, ["r1", "r2"], now);

	assert.equal(model.turns, 3, "turns must sum messages across all runIds");
});

test("buildSubagentRowModel: tools counts progress events starting with 'tool:'", () => {
	const progressEvents: RunEvent[] = [
		{ id: "e1", runId: "r1", type: "run.progress", message: "tool: read_file", at: new Date().toISOString() },
		{ id: "e2", runId: "r1", type: "run.progress", message: "tool: write_file", at: new Date().toISOString() },
		{ id: "e3", runId: "r1", type: "run.progress", message: "starting subprocess", at: new Date().toISOString() },
	];
	const access = makeAccess({ r1: makeSnapshot("r1") }, {}, { r1: progressEvents });

	const model = buildSubagentRowModel(access, ["r1"], now);

	assert.equal(model.tools, 2, "tools must count only 'tool:' progress events");
});

test("buildSubagentRowModel: tools aggregates across multiple runIds", () => {
	const events1: RunEvent[] = [
		{ id: "e1", runId: "r1", type: "run.progress", message: "tool: bash", at: new Date().toISOString() },
	];
	const events2: RunEvent[] = [
		{ id: "e2", runId: "r2", type: "run.progress", message: "tool: read", at: new Date().toISOString() },
		{ id: "e3", runId: "r2", type: "run.progress", message: "tool: write", at: new Date().toISOString() },
	];
	const access = makeAccess(
		{ r1: makeSnapshot("r1"), r2: makeSnapshot("r2") },
		{},
		{ r1: events1, r2: events2 },
	);

	const model = buildSubagentRowModel(access, ["r1", "r2"], now);

	assert.equal(model.tools, 3);
});

test("buildSubagentRowModel: activity defaults to status string when no progress messages", () => {
	const access = makeAccess({ r1: makeSnapshot("r1", { status: "completed" }) });

	const model = buildSubagentRowModel(access, ["r1"], now);

	assert.ok(model.activity.length > 0, "activity must be non-empty");
});

test("buildSubagentRowModel: activity is last progress message text", () => {
	const events: RunEvent[] = [
		{ id: "e1", runId: "r1", type: "run.progress", message: "starting subprocess", at: new Date().toISOString() },
		{ id: "e2", runId: "r1", type: "run.progress", message: "tool: bash", at: new Date().toISOString() },
	];
	const access = makeAccess({ r1: makeSnapshot("r1") }, {}, { r1: events });

	const model = buildSubagentRowModel(access, ["r1"], now);

	assert.equal(model.activity, "tool: bash", "activity should be the last progress message");
});

test("buildSubagentRowModel: elapsedMs computed from startedAt to now", () => {
	const startedAt = "2024-01-01T12:00:00.000Z";
	const nowMs = Date.parse(startedAt) + 12345;
	const access = makeAccess({ r1: makeSnapshot("r1", { startedAt }) });

	const model = buildSubagentRowModel(access, ["r1"], nowMs);

	assert.equal(model.elapsedMs, 12345);
});

test("buildSubagentRowModel: status is from first snapshot", () => {
	const access = makeAccess({ r1: makeSnapshot("r1", { status: "needs-attention" }) });

	const model = buildSubagentRowModel(access, ["r1"], now);

	assert.equal(model.status, "needs-attention");
});

test("buildSubagentRowModel: agent name from first snapshot", () => {
	const access = makeAccess({ r1: makeSnapshot("r1", { agent: "my-specialist" }) });

	const model = buildSubagentRowModel(access, ["r1"], now);

	assert.equal(model.agent, "my-specialist");
});

test("buildSubagentRowModel: no messages and no events → currentActivity falls back to status", () => {
	const access = makeAccess({ r1: makeSnapshot("r1", { status: "running" }) });

	const model = buildSubagentRowModel(access, ["r1"], now);

	assert.equal(model.currentActivity, "running");
	assert.equal(model.turns, 0);
});

test("buildSubagentRowModel: currentActivity is the latest tool with its target while a tool runs", () => {
	const events: RunEvent[] = [
		{ id: "e1", runId: "r1", type: "run.progress", message: "starting subprocess", at: new Date().toISOString() },
		{ id: "e2", runId: "r1", type: "run.progress", message: "tool: Bash", target: "pnpm test", at: new Date().toISOString() },
	];
	const access = makeAccess({ r1: makeSnapshot("r1") }, {}, { r1: events });

	const model = buildSubagentRowModel(access, ["r1"], now);

	assert.equal(model.turns, 0, "no assistant messages were accumulated");
	assert.equal(model.currentActivity, "Bash pnpm test", "currentActivity must be the running tool and its target");
	assert.ok(!model.currentActivity.startsWith("tool:"), "the raw 'tool:' marker must not leak into the row");
});

test("buildSubagentRowModel: currentActivity collapses thinking to a state word, never the reasoning prose", () => {
	const events: RunEvent[] = [
		{ id: "e1", runId: "r1", type: "run.progress", message: "tool: Read", at: new Date().toISOString() },
		{ id: "e2", runId: "r1", type: "run.output", chunk: "weighing options", kind: "thinking", text: "weighing options carefully", turn: 1, at: new Date().toISOString() },
	];
	const access = makeAccess({ r1: makeSnapshot("r1") }, {}, { r1: events });

	const model = buildSubagentRowModel(access, ["r1"], now);

	assert.equal(model.turns, 0, "thinking output must not count as an assistant turn");
	assert.equal(model.currentActivity, "thinking", "thinking shows as a state word only");
	assert.ok(!model.currentActivity.includes("weighing"), "reasoning prose must never be dumped into the row");
});

test("buildSubagentRowModel: the latest event wins — a tool after assistant text shows the tool", () => {
	const events: RunEvent[] = [
		{ id: "e1", runId: "r1", type: "run.output", chunk: "", role: "assistant", text: "the actual answer", turn: 1, at: new Date().toISOString() },
		{ id: "e2", runId: "r1", type: "run.progress", message: "tool: Bash", at: new Date().toISOString() },
	];
	const access = makeAccess(
		{ r1: makeSnapshot("r1") },
		{ r1: [makeMessage("the actual answer", 1)] },
		{ r1: events },
	);

	const model = buildSubagentRowModel(access, ["r1"], now);

	assert.equal(model.currentActivity, "Bash", "the most recent activity is the running tool");
});

test("buildSubagentRowModel: the latest assistant text is shown when it is the most recent event", () => {
	const events: RunEvent[] = [
		{ id: "e1", runId: "r1", type: "run.progress", message: "tool: Bash", at: new Date().toISOString() },
		{ id: "e2", runId: "r1", type: "run.output", chunk: "", role: "assistant", text: "the actual answer", turn: 1, at: new Date().toISOString() },
	];
	const access = makeAccess(
		{ r1: makeSnapshot("r1") },
		{ r1: [makeMessage("the actual answer", 1)] },
		{ r1: events },
	);

	const model = buildSubagentRowModel(access, ["r1"], now);

	assert.equal(model.currentActivity, "the actual answer");
});

test("buildSubagentRowModel: tokens sum the snapshot running totals across runIds", () => {
	const access = makeAccess({
		r1: makeSnapshot("r1", { tokens: 1200 }),
		r2: makeSnapshot("r2", { tokens: 3400 }),
	});

	const model = buildSubagentRowModel(access, ["r1", "r2"], now);

	assert.equal(model.tokens, 4600, "tokens must sum the per-run snapshot totals");
});

test("buildSubagentRowModel: tokens default to 0 when no usage was reported", () => {
	const access = makeAccess({ r1: makeSnapshot("r1") });

	const model = buildSubagentRowModel(access, ["r1"], now);

	assert.equal(model.tokens, 0);
});

test("buildExpandedBodyLines: tool-only run yields the tool activity, not an empty transcript", () => {
	const events: RunEvent[] = [
		{ id: "e1", runId: "r1", type: "run.started", agent: "test-agent", at: new Date().toISOString() },
		{ id: "e2", runId: "r1", type: "run.progress", message: "tool: Read", at: new Date().toISOString() },
		{ id: "e3", runId: "r1", type: "run.progress", message: "tool: Bash", at: new Date().toISOString() },
	];
	const access = makeAccess({ r1: makeSnapshot("r1") }, {}, { r1: events });

	const lines = buildExpandedBodyLines(access, ["r1"], 0);

	assert.ok(lines.length > 0, "expanded body must not be empty during a tool-only run");
	assert.ok(lines.some((l) => l.includes("[tool]") && l.includes("Read")), "must surface the Read tool line");
	assert.ok(lines.some((l) => l.includes("[tool]") && l.includes("Bash")), "must surface the Bash tool line");
});

test("buildExpandedBodyLines: merges tool activity and assistant text chronologically", () => {
	const events: RunEvent[] = [
		{ id: "e1", runId: "r1", type: "run.progress", message: "tool: Read", at: new Date().toISOString() },
		{ id: "e2", runId: "r1", type: "run.output", chunk: "", role: "assistant", text: "here is the answer", turn: 1, at: new Date().toISOString() },
	];
	const access = makeAccess({ r1: makeSnapshot("r1") }, {}, { r1: events });

	const lines = buildExpandedBodyLines(access, ["r1"], 0);

	const toolIndex = lines.findIndex((l) => l.includes("[tool]") && l.includes("Read"));
	const textIndex = lines.findIndex((l) => l.includes("here is the answer"));

	assert.ok(toolIndex >= 0, "tool line must be present");
	assert.ok(textIndex >= 0, "assistant text must still be present");
	assert.ok(toolIndex < textIndex, "tool activity must precede the later assistant text (chronological order)");
});

test("buildExpandedBodyLines: falls back to accumulated messages when no event stream exists", () => {
	const access: SubagentRowAccess = {
		snapshot: (id) => (id === "r1" ? makeSnapshot("r1") : undefined),
		messages: (id) => (id === "r1" ? [makeMessage("message body", 2)] : []),
	};

	const lines = buildExpandedBodyLines(access, ["r1"], 0);

	assert.ok(lines.some((l) => l.includes("[Assistant · turn 2]")), "must keep the turn-labelled assistant header");
	assert.ok(lines.some((l) => l.includes("message body")), "must render the assistant message body");
});

test("buildExpandedBodyLines: empty run yields no lines", () => {
	const access = makeAccess({ r1: makeSnapshot("r1") });

	assert.deepEqual(buildExpandedBodyLines(access, ["r1"], 0), []);
});
