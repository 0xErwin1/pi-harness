import test from "node:test";
import assert from "node:assert/strict";
import {
	buildFleetModel,
	fleetActivityFromEvent,
	type FleetRow,
	type FleetModel,
} from "../../packages/subagent-manager-pi/tui/fleet-model.ts";
import type { RunEvent, RunSnapshot } from "../../packages/subagent-manager-core/events.ts";

const BASE_STARTED_AT = "2024-01-01T12:00:00.000Z";
const BASE_NOW = Date.parse(BASE_STARTED_AT) + 5000;

function makeSnapshot(id: string, overrides: Partial<RunSnapshot> = {}): RunSnapshot {
	return {
		id,
		agent: `agent-${id}`,
		status: "running",
		requestedExecutionMode: "auto",
		policyMode: "normal",
		startedAt: BASE_STARTED_AT,
		updatedAt: BASE_STARTED_AT,
		...overrides,
	};
}

test("buildFleetModel: maps snapshots to FleetRow correctly", () => {
	const snapshots = [makeSnapshot("r1"), makeSnapshot("r2")];

	const model = buildFleetModel(snapshots, -1, BASE_NOW, 10);

	assert.equal(model.rows.length, 2);
	assert.equal(model.rows[0].id, "r1");
	assert.equal(model.rows[0].agent, "agent-r1");
	assert.equal(model.rows[0].status, "running");
	assert.equal(model.rows[0].elapsedMs, 5000);
});

test("buildFleetModel: selected=true on selectedIndex row", () => {
	const snapshots = [makeSnapshot("r1"), makeSnapshot("r2"), makeSnapshot("r3")];

	const model = buildFleetModel(snapshots, 1, BASE_NOW, 10);

	assert.equal(model.rows[0].selected, false);
	assert.equal(model.rows[1].selected, true);
	assert.equal(model.rows[2].selected, false);
});

test("buildFleetModel: no row selected when selectedIndex is -1", () => {
	const snapshots = [makeSnapshot("r1"), makeSnapshot("r2")];

	const model = buildFleetModel(snapshots, -1, BASE_NOW, 10);

	assert.ok(model.rows.every((r) => !r.selected), "no row should be selected with index -1");
});

test("buildFleetModel: rows capped at maxRows", () => {
	const snapshots = Array.from({ length: 8 }, (_, i) => makeSnapshot(`r${i}`));

	const model = buildFleetModel(snapshots, -1, BASE_NOW, 5);

	assert.equal(model.rows.length, 5, "rows must be capped at maxRows");
});

test("buildFleetModel: overflow = max(0, total - maxRows)", () => {
	const snapshots = Array.from({ length: 8 }, (_, i) => makeSnapshot(`r${i}`));

	const model = buildFleetModel(snapshots, -1, BASE_NOW, 5);

	assert.equal(model.overflow, 3, "overflow must count rows beyond maxRows cap");
});

test("buildFleetModel: overflow=0 when all rows fit", () => {
	const snapshots = [makeSnapshot("r1"), makeSnapshot("r2")];

	const model = buildFleetModel(snapshots, -1, BASE_NOW, 10);

	assert.equal(model.overflow, 0);
});

test("buildFleetModel: elapsedMs computed from startedAt to now", () => {
	const startedAt = "2024-01-01T12:00:00.000Z";
	const nowMs = Date.parse(startedAt) + 9876;
	const snapshots = [makeSnapshot("r1", { startedAt })];

	const model = buildFleetModel(snapshots, -1, nowMs, 10);

	assert.equal(model.rows[0].elapsedMs, 9876);
});

test("buildFleetModel: empty snapshots → empty rows and overflow=0", () => {
	const model = buildFleetModel([], -1, BASE_NOW, 10);

	assert.equal(model.rows.length, 0);
	assert.equal(model.overflow, 0);
});

test("buildFleetModel: status is reflected in each row", () => {
	const snapshots = [
		makeSnapshot("r1", { status: "completed" }),
		makeSnapshot("r2", { status: "failed" }),
	];

	const model = buildFleetModel(snapshots, -1, BASE_NOW, 10);

	assert.equal(model.rows[0].status, "completed");
	assert.equal(model.rows[1].status, "failed");
});

test("buildFleetModel: maps the snapshot's running tool count and token total onto the row", () => {
	const snapshots = [makeSnapshot("r1", { toolCount: 7, tokens: 4200 })];

	const model = buildFleetModel(snapshots, -1, BASE_NOW, 10);

	assert.equal(model.rows[0].tools, 7);
	assert.equal(model.rows[0].tokens, 4200);
});

test("buildFleetModel: tools and tokens default to 0 when the snapshot has no counters", () => {
	const model = buildFleetModel([makeSnapshot("r1")], -1, BASE_NOW, 10);

	assert.equal(model.rows[0].tools, 0);
	assert.equal(model.rows[0].tokens, 0);
});

test("buildFleetModel: selectedIndex out of range does not crash and selects nothing", () => {
	const snapshots = [makeSnapshot("r1")];

	const model = buildFleetModel(snapshots, 99, BASE_NOW, 10);

	assert.ok(model.rows.every((r) => !r.selected), "out-of-range index selects no row");
});

test("buildFleetModel: each row carries its snapshot task label", () => {
	const snapshots = [
		makeSnapshot("r1", { task: "Find TODO/FIXME comments" }),
		makeSnapshot("r2", { task: "Count files and LOC" }),
	];

	const model = buildFleetModel(snapshots, -1, BASE_NOW, 10);

	assert.equal(model.rows[0].task, "Find TODO/FIXME comments");
	assert.equal(model.rows[1].task, "Count files and LOC");
});

test("buildFleetModel: task defaults to empty string when the snapshot has none", () => {
	const model = buildFleetModel([makeSnapshot("r1")], -1, BASE_NOW, 10);

	assert.equal(model.rows[0].task, "");
});

test("buildFleetModel: a long task is hard-truncated with an ellipsis", () => {
	const longTask = "x".repeat(120);
	const model = buildFleetModel([makeSnapshot("r1", { task: longTask })], -1, BASE_NOW, 10);

	assert.ok(model.rows[0].task.length <= 60, "task must be capped");
	assert.ok(model.rows[0].task.endsWith("…"), "truncated task ends with an ellipsis");
});

test("buildFleetModel: activity comes from the live activity map when present", () => {
	const activity = new Map<string, string>([["r1", "read src/foo.ts"]]);
	const model = buildFleetModel([makeSnapshot("r1")], -1, BASE_NOW, 10, activity);

	assert.equal(model.rows[0].activity, "read src/foo.ts");
});

test("buildFleetModel: activity falls back to the status when none observed yet", () => {
	const model = buildFleetModel([makeSnapshot("r1", { status: "running" })], -1, BASE_NOW, 10);

	assert.equal(model.rows[0].activity, "running");
});

test("buildFleetModel: a long activity is hard-truncated with an ellipsis", () => {
	const activity = new Map<string, string>([["r1", "y".repeat(120)]]);
	const model = buildFleetModel([makeSnapshot("r1")], -1, BASE_NOW, 10, activity);

	assert.ok(model.rows[0].activity.length <= 50, "activity must be capped");
	assert.ok(model.rows[0].activity.endsWith("…"), "truncated activity ends with an ellipsis");
});

test("buildFleetModel: runningCount counts only running snapshots across the full roster", () => {
	const snapshots = [
		makeSnapshot("r1", { status: "running" }),
		makeSnapshot("r2", { status: "running" }),
		makeSnapshot("r3", { status: "needs-attention" }),
	];

	const model = buildFleetModel(snapshots, -1, BASE_NOW, 1);

	assert.equal(model.runningCount, 2, "running count spans beyond the visible cap");
	assert.equal(model.rows.length, 1, "rows are still capped");
});

test("fleetActivityFromEvent: a tool progress event yields '<tool> <target>'", () => {
	const event = {
		type: "run.progress",
		id: "e1",
		runId: "r1",
		at: BASE_STARTED_AT,
		message: "tool:read",
		target: "src/foo.ts",
	} as RunEvent;

	assert.equal(fleetActivityFromEvent(event), "read src/foo.ts");
});

test("fleetActivityFromEvent: a tool progress event without a target yields the bare tool name", () => {
	const event = {
		type: "run.progress",
		id: "e1",
		runId: "r1",
		at: BASE_STARTED_AT,
		message: "tool:bash",
	} as RunEvent;

	assert.equal(fleetActivityFromEvent(event), "bash");
});

test("fleetActivityFromEvent: non-tool progress leaves the activity unchanged (null)", () => {
	const event = {
		type: "run.progress",
		id: "e1",
		runId: "r1",
		at: BASE_STARTED_AT,
		message: "starting up",
	} as RunEvent;

	assert.equal(fleetActivityFromEvent(event), null);
});

test("fleetActivityFromEvent: a thinking output yields 'thinking…', never the reasoning prose", () => {
	const event = {
		type: "run.output",
		id: "e1",
		runId: "r1",
		at: BASE_STARTED_AT,
		chunk: "",
		kind: "thinking",
		text: "Let me reason about the secret plan in detail",
	} as RunEvent;

	assert.equal(fleetActivityFromEvent(event), "thinking…");
});

test("fleetActivityFromEvent: an assistant output yields its first line", () => {
	const event = {
		type: "run.output",
		id: "e1",
		runId: "r1",
		at: BASE_STARTED_AT,
		chunk: "",
		role: "assistant",
		text: "Here is the summary\nand more detail",
	} as RunEvent;

	assert.equal(fleetActivityFromEvent(event), "Here is the summary");
});
