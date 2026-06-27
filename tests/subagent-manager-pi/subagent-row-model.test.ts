import test from "node:test";
import assert from "node:assert/strict";
import {
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
	assert.ok(model.lastLine.length > 0, "lastLine must be non-empty");
	assert.ok(model.lastLine.includes("Hello"), "lastLine should contain message start");
});

test("buildSubagentRowModel: lastLine is first line truncated at ~60 chars", () => {
	const longText = "A".repeat(100);
	const msgs = [makeMessage(longText, 1)];
	const access = makeAccess({ r1: makeSnapshot("r1") }, { r1: msgs });

	const model = buildSubagentRowModel(access, ["r1"], now);

	assert.ok(model.lastLine.length <= 63, `lastLine must be ≤63 chars, got ${model.lastLine.length}`);
});

test("buildSubagentRowModel: lastLine is first line of last message", () => {
	const msgs = [
		makeMessage("first message", 1),
		makeMessage("second message\ncontinued on next line", 2),
	];
	const access = makeAccess({ r1: makeSnapshot("r1") }, { r1: msgs });

	const model = buildSubagentRowModel(access, ["r1"], now);

	assert.equal(model.lastLine, "second message", "lastLine should be first line of the last message");
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

test("buildSubagentRowModel: empty messages → lastLine is empty string", () => {
	const access = makeAccess({ r1: makeSnapshot("r1") });

	const model = buildSubagentRowModel(access, ["r1"], now);

	assert.equal(model.lastLine, "");
	assert.equal(model.turns, 0);
});
