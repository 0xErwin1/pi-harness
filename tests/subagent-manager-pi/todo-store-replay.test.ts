import test from "node:test";
import assert from "node:assert/strict";
import {
	getState,
	replaceState,
	commitState,
	getTodos,
	__resetState,
} from "../../packages/subagent-manager-pi/todo/store.ts";
import { replayFromBranch } from "../../packages/subagent-manager-pi/todo/replay.ts";
import { EMPTY_STATE } from "../../packages/subagent-manager-pi/todo/state.ts";
import type { TaskState } from "../../packages/subagent-manager-pi/todo/state.ts";
import type { Task } from "../../packages/subagent-manager-pi/todo/types.ts";

function makeTask(id: number): Task {
	return { id, subject: `Task ${id}`, status: "pending" };
}

function makeBranch(entries: unknown[]): { sessionManager: { getBranch: () => unknown[] } } {
	return {
		sessionManager: {
			getBranch: () => entries,
		},
	};
}

function makeTodoToolResult(tasks: Task[], nextId: number, toolCallId = "call-1"): unknown {
	return {
		type: "message",
		id: `msg-${toolCallId}`,
		parentId: null,
		timestamp: new Date().toISOString(),
		message: {
			role: "toolResult",
			toolCallId,
			toolName: "todo",
			content: [{ type: "text", text: "ok" }],
			details: { action: "list", params: {}, tasks, nextId },
			isError: false,
			timestamp: Date.now(),
		},
	};
}

test("getState: returns EMPTY_STATE initially (after reset)", () => {
	__resetState();
	assert.deepEqual(getState(), EMPTY_STATE);
});

test("replaceState: replaces the current state", () => {
	__resetState();
	const newState: TaskState = { tasks: [makeTask(1)], nextId: 2 };
	replaceState(newState);

	assert.deepEqual(getState(), newState);
});

test("commitState: replaces the current state (same semantics as replaceState)", () => {
	__resetState();
	const newState: TaskState = { tasks: [makeTask(42)], nextId: 43 };
	commitState(newState);

	assert.deepEqual(getState(), newState);
});

test("getTodos: returns the tasks array from current state", () => {
	__resetState();
	const tasks = [makeTask(1), makeTask(2)];
	replaceState({ tasks, nextId: 3 });

	assert.deepEqual(getTodos(), tasks);
});

test("getTodos: returns empty array when state is empty", () => {
	__resetState();
	assert.deepEqual(getTodos(), []);
});

test("__resetState: restores EMPTY_STATE", () => {
	replaceState({ tasks: [makeTask(1)], nextId: 2 });
	__resetState();

	assert.deepEqual(getState(), EMPTY_STATE);
});

test("replayFromBranch: loads last todo toolResult into store (last-write-wins)", () => {
	__resetState();
	const tasks1 = [makeTask(1)];
	const tasks2 = [makeTask(1), makeTask(2)];
	const ctx = makeBranch([
		makeTodoToolResult(tasks1, 2, "call-1"),
		{ type: "message", id: "x", parentId: null, timestamp: "", message: { role: "user", content: [] } },
		makeTodoToolResult(tasks2, 3, "call-2"),
	]);

	replayFromBranch(ctx as any);

	const state = getState();
	assert.equal(state.tasks.length, 2, "last todo toolResult wins");
	assert.equal(state.nextId, 3);
});

test("replayFromBranch: cleans up and starts fresh when no prior todo calls", () => {
	const prevState: TaskState = { tasks: [makeTask(1)], nextId: 2 };
	replaceState(prevState);

	const ctx = makeBranch([
		{ type: "message", id: "m1", parentId: null, timestamp: "", message: { role: "user", content: [{ type: "text", text: "hello" }] } },
		{ type: "message", id: "m2", parentId: null, timestamp: "", message: { role: "assistant", content: [] } },
	]);

	replayFromBranch(ctx as any);

	assert.deepEqual(getState(), EMPTY_STATE, "no prior todo calls: start clean");
});

test("replayFromBranch: ignores non-todo toolResult entries", () => {
	__resetState();
	const ctx = makeBranch([
		{
			type: "message",
			id: "x",
			parentId: null,
			timestamp: "",
			message: {
				role: "toolResult",
				toolCallId: "c1",
				toolName: "subagent",
				content: [{ type: "text", text: "result" }],
				details: { tasks: [makeTask(99)], nextId: 100 },
				isError: false,
				timestamp: Date.now(),
			},
		},
	]);

	replayFromBranch(ctx as any);

	assert.deepEqual(getState(), EMPTY_STATE, "non-todo toolResult must not affect todo state");
});

test("replayFromBranch: ignores todo toolResult without details.tasks", () => {
	__resetState();
	const ctx = makeBranch([
		{
			type: "message",
			id: "x",
			parentId: null,
			timestamp: "",
			message: {
				role: "toolResult",
				toolCallId: "c1",
				toolName: "todo",
				content: [{ type: "text", text: "ok" }],
				details: { action: "clear" },
				isError: false,
				timestamp: Date.now(),
			},
		},
	]);

	replayFromBranch(ctx as any);

	assert.deepEqual(getState(), EMPTY_STATE, "details without tasks should not be replayed");
});

test("replayFromBranch: ignores todo toolResult without details.nextId", () => {
	__resetState();
	const ctx = makeBranch([
		{
			type: "message",
			id: "x",
			parentId: null,
			timestamp: "",
			message: {
				role: "toolResult",
				toolCallId: "c1",
				toolName: "todo",
				content: [{ type: "text", text: "ok" }],
				details: { tasks: [makeTask(1)] },
				isError: false,
				timestamp: Date.now(),
			},
		},
	]);

	replayFromBranch(ctx as any);

	assert.deepEqual(getState(), EMPTY_STATE, "details without nextId should not be replayed");
});

test("replayFromBranch: the last qualifying entry in branch wins over earlier ones", () => {
	__resetState();
	const early = makeTodoToolResult([makeTask(1)], 2, "call-1");
	const late = makeTodoToolResult([makeTask(1), makeTask(2), makeTask(3)], 4, "call-2");
	const ctx = makeBranch([early, late]);

	replayFromBranch(ctx as any);

	assert.equal(getState().tasks.length, 3, "last entry wins");
	assert.equal(getState().nextId, 4);
});

test("replayFromBranch: handles empty branch gracefully", () => {
	replaceState({ tasks: [makeTask(1)], nextId: 2 });
	const ctx = makeBranch([]);

	replayFromBranch(ctx as any);

	assert.deepEqual(getState(), EMPTY_STATE, "empty branch resets to EMPTY_STATE");
});
