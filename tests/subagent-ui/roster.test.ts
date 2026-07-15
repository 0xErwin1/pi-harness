import test from "node:test";
import assert from "node:assert/strict";

import {
	applyLifecycle,
	emptyRoster,
	rosterList,
	rosterSummary,
	rosterRows,
	type LifecycleEvent,
} from "../../packages/subagent-ui/roster.ts";

function created(id: string, agentType = "explorer", description = "explore the repo"): LifecycleEvent {
	return { kind: "created", id, agentType, description, isBackground: true };
}

test("a created agent enters the roster as queued", () => {
	const state = applyLifecycle(emptyRoster(), created("a1"));
	const list = rosterList(state);

	assert.equal(list.length, 1);
	assert.equal(list[0].id, "a1");
	assert.equal(list[0].agentType, "explorer");
	assert.equal(list[0].description, "explore the repo");
	assert.equal(list[0].status, "queued");
	assert.equal(list[0].isBackground, true);
});

test("started transitions a known agent to running without duplicating it", () => {
	let state = applyLifecycle(emptyRoster(), created("a1"));
	state = applyLifecycle(state, { kind: "started", id: "a1", agentType: "explorer", description: "explore the repo" });

	const list = rosterList(state);
	assert.equal(list.length, 1);
	assert.equal(list[0].status, "running");
});

test("a terminal event records the final status, tool uses, duration and tokens", () => {
	let state = applyLifecycle(emptyRoster(), created("a1"));
	state = applyLifecycle(state, { kind: "started", id: "a1", agentType: "explorer", description: "d" });
	state = applyLifecycle(state, {
		kind: "terminal",
		id: "a1",
		agentType: "explorer",
		description: "d",
		status: "completed",
		toolUses: 7,
		durationMs: 4200,
		tokens: { input: 100, output: 50, total: 150 },
	});

	const snap = rosterList(state)[0];
	assert.equal(snap.status, "completed");
	assert.equal(snap.toolUses, 7);
	assert.equal(snap.durationMs, 4200);
	assert.deepEqual(snap.tokens, { input: 100, output: 50, total: 150 });
});

test("a failed terminal event carries an error status", () => {
	let state = applyLifecycle(emptyRoster(), created("a1"));
	state = applyLifecycle(state, {
		kind: "terminal",
		id: "a1",
		agentType: "explorer",
		description: "d",
		status: "error",
		toolUses: 1,
		durationMs: 500,
	});

	assert.equal(rosterList(state)[0].status, "error");
});

test("events for an unknown agent upsert it (late subscription is tolerated)", () => {
	// The extension may subscribe after `created` already fired; a `started`
	// or `terminal` for an id we never saw must still create a row.
	const state = applyLifecycle(emptyRoster(), {
		kind: "started",
		id: "ghost",
		agentType: "planner",
		description: "plan",
	});

	const list = rosterList(state);
	assert.equal(list.length, 1);
	assert.equal(list[0].id, "ghost");
	assert.equal(list[0].status, "running");
});

test("insertion order is stable across updates", () => {
	let state = emptyRoster();
	state = applyLifecycle(state, created("a1"));
	state = applyLifecycle(state, created("a2"));
	state = applyLifecycle(state, created("a3"));
	// Update the first agent last — it must NOT jump to the end.
	state = applyLifecycle(state, { kind: "started", id: "a1", agentType: "explorer", description: "d" });

	assert.deepEqual(rosterList(state).map((s) => s.id), ["a1", "a2", "a3"]);
});

test("compaction increments the count without changing status", () => {
	let state = applyLifecycle(emptyRoster(), created("a1"));
	state = applyLifecycle(state, { kind: "started", id: "a1", agentType: "explorer", description: "d" });
	state = applyLifecycle(state, { kind: "compacted", id: "a1", agentType: "explorer", description: "d" });
	state = applyLifecycle(state, { kind: "compacted", id: "a1", agentType: "explorer", description: "d" });

	const snap = rosterList(state)[0];
	assert.equal(snap.compactionCount, 2);
	assert.equal(snap.status, "running");
});

test("applyLifecycle does not mutate the previous state", () => {
	const before = applyLifecycle(emptyRoster(), created("a1"));
	const beforeList = rosterList(before);
	applyLifecycle(before, { kind: "started", id: "a1", agentType: "explorer", description: "d" });

	// The original snapshot is untouched.
	assert.equal(beforeList[0].status, "queued");
	assert.equal(rosterList(before)[0].status, "queued");
});

test("rosterSummary counts settled agents against the total", () => {
	let state = emptyRoster();
	state = applyLifecycle(state, created("a1"));
	state = applyLifecycle(state, { kind: "started", id: "a1", agentType: "e", description: "d" });
	state = applyLifecycle(state, created("a2"));
	state = applyLifecycle(state, {
		kind: "terminal",
		id: "a2",
		agentType: "e",
		description: "d",
		status: "completed",
		toolUses: 0,
		durationMs: 10,
	});

	const summary = rosterSummary(rosterList(state));
	assert.equal(summary.total, 2);
	assert.equal(summary.settled, 1);
	assert.equal(summary.running, 1);
});

test("rosterRows projects the bus payload rows in roster order", () => {
	let state = applyLifecycle(emptyRoster(), created("a1", "explorer", "look around"));
	state = applyLifecycle(state, { kind: "started", id: "a1", agentType: "explorer", description: "look around" });

	const rows = rosterRows(rosterList(state));
	assert.deepEqual(rows, [{ id: "a1", agentType: "explorer", status: "running" }]);
});
