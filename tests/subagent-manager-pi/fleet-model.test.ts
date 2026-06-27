import test from "node:test";
import assert from "node:assert/strict";
import {
	buildFleetModel,
	fleetActivityFromEvent,
	flattenForest,
	FLEET_LINGER_MS,
	isActiveFleetStatus,
	isFleetNodeVisible,
	mergeForest,
	selectFleetNodeRoster,
	selectFleetRoster,
	type FleetLocalContext,
	type FleetNode,
} from "../../packages/subagent-manager-pi/tui/fleet-model.ts";
import type { RunEvent, RunSnapshot } from "../../packages/subagent-manager-core/events.ts";
import type { AgentNode } from "../../packages/subagent-manager-core/file-tree/reader.ts";

const BASE_STARTED_AT = "2024-01-01T12:00:00.000Z";
const BASE_NOW = Date.parse(BASE_STARTED_AT) + 5000;

const LOCAL_CTX: FleetLocalContext = { processToken: "P", depth: 1, parentAgentId: null };

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

function makeNode(id: string, overrides: Partial<FleetNode> = {}): FleetNode {
	return {
		agentId: id,
		parentAgentId: null,
		depth: 1,
		local: true,
		runId: id,
		agent: `agent-${id}`,
		status: "running",
		task: "",
		activity: "running",
		startedAt: BASE_STARTED_AT,
		updatedAt: BASE_STARTED_AT,
		tools: 0,
		tokens: 0,
		staleRunning: false,
		children: [],
		...overrides,
	};
}

function makeAgentNode(agentId: string, overrides: Partial<AgentNode> = {}): AgentNode {
	return {
		agentId,
		parentAgentId: null,
		rootSessionId: "sess",
		depth: 1,
		agentType: `agent-${agentId}`,
		status: "running",
		startedAt: BASE_STARTED_AT,
		updatedAt: BASE_STARTED_AT,
		cwd: "/repo",
		pid: 1234,
		children: [],
		...overrides,
	};
}

test("buildFleetModel: maps nodes to FleetRow correctly", () => {
	const nodes = [makeNode("r1"), makeNode("r2")];

	const model = buildFleetModel(nodes, -1, BASE_NOW, 10);

	assert.equal(model.rows.length, 2);
	assert.equal(model.rows[0].id, "r1");
	assert.equal(model.rows[0].agent, "agent-r1");
	assert.equal(model.rows[0].status, "running");
	assert.equal(model.rows[0].elapsedMs, 5000);
});

test("buildFleetModel: selected=true on selectedIndex row", () => {
	const nodes = [makeNode("r1"), makeNode("r2"), makeNode("r3")];

	const model = buildFleetModel(nodes, 1, BASE_NOW, 10);

	assert.equal(model.rows[0].selected, false);
	assert.equal(model.rows[1].selected, true);
	assert.equal(model.rows[2].selected, false);
});

test("buildFleetModel: no row selected when selectedIndex is -1", () => {
	const nodes = [makeNode("r1"), makeNode("r2")];

	const model = buildFleetModel(nodes, -1, BASE_NOW, 10);

	assert.ok(model.rows.every((r) => !r.selected), "no row should be selected with index -1");
});

test("buildFleetModel: rows capped at maxRows", () => {
	const nodes = Array.from({ length: 8 }, (_, i) => makeNode(`r${i}`));

	const model = buildFleetModel(nodes, -1, BASE_NOW, 5);

	assert.equal(model.rows.length, 5, "rows must be capped at maxRows");
});

test("buildFleetModel: at an inactive prompt the window anchors at the top with all overflow below", () => {
	const nodes = Array.from({ length: 8 }, (_, i) => makeNode(`r${i}`));

	const model = buildFleetModel(nodes, -1, BASE_NOW, 5);

	assert.equal(model.hiddenAbove, 0, "nothing hidden above when anchored at the top");
	assert.equal(model.hiddenBelow, 3, "rows beyond the window are hidden below");
	assert.equal(model.rows[0].id, "r0", "window starts at the first row");
});

test("buildFleetModel: no rows are hidden when all fit within maxRows", () => {
	const nodes = [makeNode("r1"), makeNode("r2")];

	const model = buildFleetModel(nodes, -1, BASE_NOW, 10);

	assert.equal(model.hiddenAbove, 0);
	assert.equal(model.hiddenBelow, 0);
});

test("buildFleetModel: elapsedMs computed from startedAt to now", () => {
	const startedAt = "2024-01-01T12:00:00.000Z";
	const nowMs = Date.parse(startedAt) + 9876;
	const nodes = [makeNode("r1", { startedAt })];

	const model = buildFleetModel(nodes, -1, nowMs, 10);

	assert.equal(model.rows[0].elapsedMs, 9876);
});

test("buildFleetModel: empty nodes → empty rows and nothing hidden", () => {
	const model = buildFleetModel([], -1, BASE_NOW, 10);

	assert.equal(model.rows.length, 0);
	assert.equal(model.hiddenAbove, 0);
	assert.equal(model.hiddenBelow, 0);
});

test("buildFleetModel: window centres on the selection and keeps it visible (P7)", () => {
	const nodes = Array.from({ length: 10 }, (_, i) => makeNode(`r${i}`));

	const model = buildFleetModel(nodes, 5, BASE_NOW, 5);

	assert.equal(model.rows.length, 5, "window is capped at maxRows");
	const selected = model.rows.find((row) => row.selected);
	assert.ok(selected, "the selected row stays inside the window");
	assert.equal(selected?.id, "r5");
	assert.equal(model.hiddenAbove, 3, "rows above the window are counted");
	assert.equal(model.hiddenBelow, 2, "rows below the window are counted");
	assert.equal(model.hiddenAbove + model.rows.length + model.hiddenBelow, 10);
});

test("buildFleetModel: selecting the last row pins the window to the bottom (P7)", () => {
	const nodes = Array.from({ length: 10 }, (_, i) => makeNode(`r${i}`));

	const model = buildFleetModel(nodes, 9, BASE_NOW, 5);

	assert.equal(model.rows[model.rows.length - 1].id, "r9", "last row is visible");
	assert.ok(model.rows[model.rows.length - 1].selected, "last row is selected");
	assert.equal(model.hiddenAbove, 5);
	assert.equal(model.hiddenBelow, 0, "nothing is hidden below the bottom of the list");
});

test("buildFleetModel: selecting the first row pins the window to the top (P7)", () => {
	const nodes = Array.from({ length: 10 }, (_, i) => makeNode(`r${i}`));

	const model = buildFleetModel(nodes, 0, BASE_NOW, 5);

	assert.equal(model.rows[0].id, "r0", "first row is visible");
	assert.ok(model.rows[0].selected, "first row is selected");
	assert.equal(model.hiddenAbove, 0, "nothing is hidden above the top of the list");
	assert.equal(model.hiddenBelow, 5);
});

test("buildFleetModel: status is reflected in each row", () => {
	const nodes = [
		makeNode("r1", { status: "completed" }),
		makeNode("r2", { status: "failed" }),
	];

	const model = buildFleetModel(nodes, -1, BASE_NOW, 10);

	assert.equal(model.rows[0].status, "completed");
	assert.equal(model.rows[1].status, "failed");
});

test("buildFleetModel: maps the node's running tool count and token total onto the row", () => {
	const nodes = [makeNode("r1", { tools: 7, tokens: 4200 })];

	const model = buildFleetModel(nodes, -1, BASE_NOW, 10);

	assert.equal(model.rows[0].tools, 7);
	assert.equal(model.rows[0].tokens, 4200);
});

test("buildFleetModel: selectedIndex out of range does not crash and selects nothing", () => {
	const nodes = [makeNode("r1")];

	const model = buildFleetModel(nodes, 99, BASE_NOW, 10);

	assert.ok(model.rows.every((r) => !r.selected), "out-of-range index selects no row");
});

test("buildFleetModel: each row carries its node task label", () => {
	const nodes = [
		makeNode("r1", { task: "Find TODO/FIXME comments" }),
		makeNode("r2", { task: "Count files and LOC" }),
	];

	const model = buildFleetModel(nodes, -1, BASE_NOW, 10);

	assert.equal(model.rows[0].task, "Find TODO/FIXME comments");
	assert.equal(model.rows[1].task, "Count files and LOC");
});

test("buildFleetModel: a long task is hard-truncated with an ellipsis", () => {
	const longTask = "x".repeat(120);
	const model = buildFleetModel([makeNode("r1", { task: longTask })], -1, BASE_NOW, 10);

	assert.ok(model.rows[0].task.length <= 60, "task must be capped");
	assert.ok(model.rows[0].task.endsWith("…"), "truncated task ends with an ellipsis");
});

test("buildFleetModel: a long activity is hard-truncated with an ellipsis", () => {
	const model = buildFleetModel([makeNode("r1", { activity: "y".repeat(120) })], -1, BASE_NOW, 10);

	assert.ok(model.rows[0].activity.length <= 50, "activity must be capped");
	assert.ok(model.rows[0].activity.endsWith("…"), "truncated activity ends with an ellipsis");
});

test("buildFleetModel: each row carries its tree depth for indentation", () => {
	const nodes = [makeNode("a", { depth: 1 }), makeNode("b", { depth: 2 }), makeNode("c", { depth: 3 })];

	const model = buildFleetModel(nodes, -1, BASE_NOW, 10);

	assert.deepEqual(model.rows.map((r) => r.depth), [1, 2, 3]);
});

test("buildFleetModel: runningCount counts only running, non-stale nodes across the full roster", () => {
	const nodes = [
		makeNode("r1", { status: "running" }),
		makeNode("r2", { status: "running" }),
		makeNode("r3", { status: "needs-attention" }),
		makeNode("r4", { status: "running", staleRunning: true }),
	];

	const model = buildFleetModel(nodes, -1, BASE_NOW, 1);

	assert.equal(model.runningCount, 2, "running count spans the roster but excludes stale and attention rows");
	assert.equal(model.rows.length, 1, "rows are still capped");
});

test("flattenForest: pre-order — each parent immediately followed by its children", () => {
	const tree = makeNode("a", {
		children: [
			makeNode("a1", { children: [makeNode("a1a")] }),
			makeNode("a2"),
		],
	});
	const sibling = makeNode("b");

	const flat = flattenForest([tree, sibling]);

	assert.deepEqual(flat.map((n) => n.agentId), ["a", "a1", "a1a", "a2", "b"]);
});

test("flattenForest: preserves sibling order from the input", () => {
	const tree = makeNode("root", {
		children: [makeNode("first"), makeNode("second"), makeNode("third")],
	});

	const flat = flattenForest([tree]);

	assert.deepEqual(flat.map((n) => n.agentId), ["root", "first", "second", "third"]);
});

test("mergeForest: a live in-memory snapshot overrides file meta for a local node", () => {
	const fileNode = makeAgentNode("P-r1", { status: "completed", tokens: 10, tools: 1 });
	const live = makeSnapshot("r1", { status: "running", tokens: 999, toolCount: 7, agent: "agent-live" });
	const liveByAgentId = new Map([["P-r1", live]]);
	const activityById = new Map([["r1", "read src/foo.ts"]]);

	const merged = mergeForest([fileNode], LOCAL_CTX, liveByAgentId, activityById);

	assert.equal(merged.length, 1);
	assert.equal(merged[0].local, true);
	assert.equal(merged[0].runId, "r1");
	assert.equal(merged[0].status, "running", "live status wins over the lagging file");
	assert.equal(merged[0].tokens, 999);
	assert.equal(merged[0].tools, 7);
	assert.equal(merged[0].activity, "read src/foo.ts");
	assert.equal(merged[0].staleRunning, false, "a node with a live snapshot is never stale");
});

test("mergeForest: a local node with no live activity falls back to its status", () => {
	const fileNode = makeAgentNode("P-r1", { status: "running" });
	const live = makeSnapshot("r1", { status: "running" });

	const merged = mergeForest([fileNode], LOCAL_CTX, new Map([["P-r1", live]]), new Map());

	assert.equal(merged[0].activity, "running");
});

test("mergeForest: a nested (file-only) node uses meta fields and is not local", () => {
	const child = makeAgentNode("Q-c1", { depth: 2, parentAgentId: "P-r1", status: "running", tokens: 5, tools: 2 });
	const root = makeAgentNode("P-r1", { children: [child] });

	const merged = mergeForest([root], LOCAL_CTX, new Map(), new Map());
	const nested = merged[0].children[0];

	assert.equal(nested.local, false);
	assert.equal(nested.depth, 2);
	assert.equal(nested.status, "running");
	assert.equal(nested.tokens, 5);
	assert.ok(nested.activity.includes("2 tools"), "nested activity summarises counts from meta");
	assert.ok(nested.activity.includes("5 tok"));
});

test("mergeForest: a staleRunning nested node is carried through and reads as gone", () => {
	const stale = makeAgentNode("Q-s1", { status: "running", staleRunning: true });

	const merged = mergeForest([stale], LOCAL_CTX, new Map(), new Map());

	assert.equal(merged[0].staleRunning, true);
	assert.equal(merged[0].activity, "stale (process gone)");
});

test("mergeForest: synthesises a local run the file sink has not flushed yet", () => {
	const live = makeSnapshot("r9", { status: "running" });
	const liveByAgentId = new Map([["P-r9", live]]);

	const merged = mergeForest([], LOCAL_CTX, liveByAgentId, new Map());

	assert.equal(merged.length, 1);
	assert.equal(merged[0].agentId, "P-r9");
	assert.equal(merged[0].local, true);
	assert.equal(merged[0].depth, 1, "synthesised local node takes the local context depth");
	assert.equal(merged[0].runId, "r9");
});

test("mergeForest: does not duplicate a local run that is already in the file forest", () => {
	const fileNode = makeAgentNode("P-r1", { status: "running" });
	const live = makeSnapshot("r1", { status: "running" });

	const merged = mergeForest([fileNode], LOCAL_CTX, new Map([["P-r1", live]]), new Map());

	assert.equal(merged.length, 1, "the live snapshot overlays the existing node rather than adding a row");
});

test("mergeForest: roots are sorted by start time", () => {
	const later = makeAgentNode("P-late", { startedAt: new Date(Date.parse(BASE_STARTED_AT) + 2000).toISOString() });
	const earlier = makeAgentNode("P-early", { startedAt: BASE_STARTED_AT });

	const merged = mergeForest([later, earlier], LOCAL_CTX, new Map(), new Map());

	assert.deepEqual(merged.map((n) => n.agentId), ["P-early", "P-late"]);
});

test("isFleetNodeVisible: active nodes are always visible", () => {
	assert.equal(isFleetNodeVisible(makeNode("a", { status: "running" }), BASE_NOW), true);
	assert.equal(isFleetNodeVisible(makeNode("a", { status: "needs-attention" }), BASE_NOW), true);
});

test("isFleetNodeVisible: a terminal node lingers within the window then drops", () => {
	const endedAt = BASE_STARTED_AT;
	const endedMs = Date.parse(endedAt);
	const node = makeNode("done", { status: "completed", endedAt });

	assert.equal(isFleetNodeVisible(node, endedMs + FLEET_LINGER_MS), true, "visible at the boundary");
	assert.equal(isFleetNodeVisible(node, endedMs + FLEET_LINGER_MS + 1), false, "dropped past the window");
});

test("isFleetNodeVisible: a staleRunning node lingers against its last write, not forever", () => {
	const updatedAt = BASE_STARTED_AT;
	const updatedMs = Date.parse(updatedAt);
	const stale = makeNode("s", { status: "running", staleRunning: true, updatedAt });

	assert.equal(isFleetNodeVisible(stale, updatedMs + FLEET_LINGER_MS), true, "shown briefly after the process is gone");
	assert.equal(isFleetNodeVisible(stale, updatedMs + FLEET_LINGER_MS + 1), false, "not shown forever");
});

test("selectFleetNodeRoster: keeps the visible nodes and preserves pre-order", () => {
	const expiredEnded = new Date(Date.parse(BASE_STARTED_AT) - 100000).toISOString();
	const flat = [
		makeNode("active", { status: "running" }),
		makeNode("expired", { status: "completed", endedAt: expiredEnded }),
		makeNode("lingering", { status: "failed", endedAt: BASE_STARTED_AT }),
	];

	const roster = selectFleetNodeRoster(flat, Date.parse(BASE_STARTED_AT) + 1000);

	assert.deepEqual(roster.map((n) => n.agentId), ["active", "lingering"], "expired dropped, order kept");
});

test("isActiveFleetStatus: running and needs-attention are active, terminal states are not", () => {
	assert.equal(isActiveFleetStatus("running"), true);
	assert.equal(isActiveFleetStatus("needs-attention"), true);
	assert.equal(isActiveFleetStatus("completed"), false);
	assert.equal(isActiveFleetStatus("failed"), false);
	assert.equal(isActiveFleetStatus("interrupted"), false);
});

test("selectFleetRoster: keeps active runs and drops nothing while they run (P4)", () => {
	const snapshots = [
		makeSnapshot("a", { status: "running" }),
		makeSnapshot("b", { status: "needs-attention" }),
	];

	const roster = selectFleetRoster(snapshots, BASE_NOW);

	assert.deepEqual(roster.map((s) => s.id), ["a", "b"]);
});

test("selectFleetRoster: a finished run lingers within the linger window then drops (P4)", () => {
	const endedAt = BASE_STARTED_AT;
	const endedMs = Date.parse(endedAt);
	const snapshots = [makeSnapshot("done", { status: "completed", endedAt })];

	const withinWindow = selectFleetRoster(snapshots, endedMs + FLEET_LINGER_MS - 1);
	assert.equal(withinWindow.length, 1, "still lingering just before the window closes");

	const atBoundary = selectFleetRoster(snapshots, endedMs + FLEET_LINGER_MS);
	assert.equal(atBoundary.length, 1, "still lingering exactly at the boundary");

	const afterWindow = selectFleetRoster(snapshots, endedMs + FLEET_LINGER_MS + 1);
	assert.equal(afterWindow.length, 0, "dropped once the linger window has elapsed");
});

test("selectFleetRoster: a terminal run with no endedAt is not lingered (P4)", () => {
	const snapshots = [makeSnapshot("done", { status: "completed" })];

	assert.equal(selectFleetRoster(snapshots, BASE_NOW).length, 0);
});

test("selectFleetRoster: mixes active and lingering runs, sorted by start time (P4)", () => {
	const endedMs = Date.parse(BASE_STARTED_AT);
	const snapshots = [
		makeSnapshot("late-active", { status: "running", startedAt: new Date(endedMs + 2000).toISOString() }),
		makeSnapshot("early-done", {
			status: "failed",
			startedAt: new Date(endedMs).toISOString(),
			endedAt: new Date(endedMs + 500).toISOString(),
		}),
		makeSnapshot("expired", {
			status: "completed",
			startedAt: new Date(endedMs - 10000).toISOString(),
			endedAt: new Date(endedMs - 9000).toISOString(),
		}),
	];

	const roster = selectFleetRoster(snapshots, endedMs + 1000);

	assert.deepEqual(roster.map((s) => s.id), ["early-done", "late-active"], "expired run dropped, rest sorted by startedAt");
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
