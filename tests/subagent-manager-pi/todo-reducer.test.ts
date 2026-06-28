import test from "node:test";
import assert from "node:assert/strict";
import {
	applyTaskMutation,
} from "../../packages/subagent-manager-pi/todo/reducer.ts";
import { EMPTY_STATE } from "../../packages/subagent-manager-pi/todo/state.ts";
import type { TaskState } from "../../packages/subagent-manager-pi/todo/state.ts";
import type { Task } from "../../packages/subagent-manager-pi/todo/types.ts";

function makeState(overrides: Partial<TaskState> = {}): TaskState {
	return { ...EMPTY_STATE, tasks: [], nextId: 1, ...overrides };
}

function makeTask(overrides: Partial<Task>): Task {
	return {
		id: 1,
		subject: "default subject",
		status: "pending",
		...overrides,
	};
}

test("create: appends a task with nextId and increments nextId", () => {
	const state = makeState();
	const { state: next, op } = applyTaskMutation(state, "create", { action: "create", subject: "Buy milk" });

	assert.equal(op.type, "created");
	assert.equal(next.tasks.length, 1);
	assert.equal(next.tasks[0].id, 1);
	assert.equal(next.tasks[0].subject, "Buy milk");
	assert.equal(next.tasks[0].status, "pending");
	assert.equal(next.nextId, 2);
});

test("create: sets description, activeForm, owner, metadata when provided", () => {
	const state = makeState();
	const { state: next } = applyTaskMutation(state, "create", {
		action: "create",
		subject: "Write tests",
		description: "For the todo module",
		activeForm: "writing",
		owner: "agent-1",
		metadata: { priority: "high" },
	});

	const task = next.tasks[0];
	assert.equal(task.description, "For the todo module");
	assert.equal(task.activeForm, "writing");
	assert.equal(task.owner, "agent-1");
	assert.deepEqual(task.metadata, { priority: "high" });
});

test("create: creates with blockedBy when provided", () => {
	const state = makeState({
		tasks: [makeTask({ id: 1, subject: "First task" })],
		nextId: 2,
	});
	const { state: next, op } = applyTaskMutation(state, "create", {
		action: "create",
		subject: "Second task",
		blockedBy: [1],
	});

	assert.equal(op.type, "created");
	assert.deepEqual(next.tasks[1].blockedBy, [1]);
});

test("create: multiple creates get sequential ids", () => {
	let state = makeState();
	({ state } = applyTaskMutation(state, "create", { action: "create", subject: "A" }));
	({ state } = applyTaskMutation(state, "create", { action: "create", subject: "B" }));
	({ state } = applyTaskMutation(state, "create", { action: "create", subject: "C" }));

	assert.deepEqual(state.tasks.map((t) => t.id), [1, 2, 3]);
	assert.equal(state.nextId, 4);
});

test("create: returns error op when subject is missing", () => {
	const state = makeState();
	const { state: next, op } = applyTaskMutation(state, "create", { action: "create" });

	assert.equal(op.type, "error");
	assert.equal(next.tasks.length, 0, "state must not be mutated on error");
});

test("update: changes subject when provided", () => {
	const state = makeState({ tasks: [makeTask({ id: 1, subject: "Old" })], nextId: 2 });
	const { state: next, op } = applyTaskMutation(state, "update", {
		action: "update",
		id: 1,
		subject: "New subject",
	});

	assert.equal(op.type, "updated");
	assert.equal(next.tasks[0].subject, "New subject");
});

test("update: changes status when provided", () => {
	const state = makeState({ tasks: [makeTask({ id: 1 })], nextId: 2 });
	const { state: next } = applyTaskMutation(state, "update", {
		action: "update",
		id: 1,
		status: "in_progress",
	});

	assert.equal(next.tasks[0].status, "in_progress");
});

test("update: addBlockedBy merges additively", () => {
	const state = makeState({
		tasks: [
			makeTask({ id: 1, subject: "A" }),
			makeTask({ id: 2, subject: "B", blockedBy: [1] }),
		],
		nextId: 3,
	});
	const stateWithThird = {
		...state,
		tasks: [...state.tasks, makeTask({ id: 3, subject: "C" })],
		nextId: 4,
	};

	const { state: next, op } = applyTaskMutation(stateWithThird, "update", {
		action: "update",
		id: 2,
		addBlockedBy: [3],
	});

	assert.equal(op.type, "updated");
	assert.deepEqual(next.tasks[1].blockedBy?.sort(), [1, 3]);
});

test("update: removeBlockedBy removes specified ids", () => {
	const state = makeState({
		tasks: [
			makeTask({ id: 1, subject: "A" }),
			makeTask({ id: 2, subject: "B" }),
			makeTask({ id: 3, subject: "C", blockedBy: [1, 2] }),
		],
		nextId: 4,
	});

	const { state: next } = applyTaskMutation(state, "update", {
		action: "update",
		id: 3,
		removeBlockedBy: [1],
	});

	assert.deepEqual(next.tasks[2].blockedBy, [2]);
});

test("update: removeBlockedBy removes all specified ids, leaving rest intact", () => {
	const state = makeState({
		tasks: [
			makeTask({ id: 1 }),
			makeTask({ id: 2 }),
			makeTask({ id: 3 }),
			makeTask({ id: 4, blockedBy: [1, 2, 3] }),
		],
		nextId: 5,
	});

	const { state: next } = applyTaskMutation(state, "update", {
		action: "update",
		id: 4,
		removeBlockedBy: [1, 3],
	});

	assert.deepEqual(next.tasks[3].blockedBy, [2]);
});

test("update: does not mutate other tasks", () => {
	const state = makeState({
		tasks: [makeTask({ id: 1, subject: "A" }), makeTask({ id: 2, subject: "B" })],
		nextId: 3,
	});

	const { state: next } = applyTaskMutation(state, "update", {
		action: "update",
		id: 1,
		subject: "A updated",
	});

	assert.equal(next.tasks[1].subject, "B");
});

test("update: returns error op when id is missing", () => {
	const state = makeState({ tasks: [makeTask({ id: 1 })], nextId: 2 });
	const { op } = applyTaskMutation(state, "update", { action: "update" });

	assert.equal(op.type, "error");
});

test("update: returns error op when task not found", () => {
	const state = makeState({ tasks: [makeTask({ id: 1 })], nextId: 2 });
	const { op } = applyTaskMutation(state, "update", { action: "update", id: 99 });

	assert.equal(op.type, "error");
});

test("delete: sets status to deleted (tombstone)", () => {
	const state = makeState({ tasks: [makeTask({ id: 1 })], nextId: 2 });
	const { state: next, op } = applyTaskMutation(state, "delete", { action: "delete", id: 1 });

	assert.equal(op.type, "deleted");
	assert.equal(next.tasks[0].status, "deleted");
	assert.equal(next.tasks.length, 1, "task remains in array as tombstone");
});

test("delete: returns error op when id is missing", () => {
	const state = makeState({ tasks: [makeTask({ id: 1 })], nextId: 2 });
	const { op } = applyTaskMutation(state, "delete", { action: "delete" });

	assert.equal(op.type, "error");
});

test("delete: returns error op when task not found", () => {
	const state = makeState({ tasks: [makeTask({ id: 1 })], nextId: 2 });
	const { op } = applyTaskMutation(state, "delete", { action: "delete", id: 42 });

	assert.equal(op.type, "error");
});

test("clear: resets state to EMPTY_STATE", () => {
	const state = makeState({
		tasks: [makeTask({ id: 1 }), makeTask({ id: 2 })],
		nextId: 3,
	});
	const { state: next, op } = applyTaskMutation(state, "clear", { action: "clear" });

	assert.equal(op.type, "cleared");
	assert.deepEqual(next, EMPTY_STATE);
});

test("list: returns tasks without mutating state", () => {
	const tasks = [
		makeTask({ id: 1, status: "pending" }),
		makeTask({ id: 2, status: "completed" }),
		makeTask({ id: 3, status: "deleted" }),
	];
	const state = makeState({ tasks, nextId: 4 });

	const { state: next, op } = applyTaskMutation(state, "list", { action: "list" });

	assert.equal(op.type, "listed");
	assert.deepEqual(next, state, "state must not change on list");
});

test("list: includeDeleted=false excludes deleted by default", () => {
	const tasks = [
		makeTask({ id: 1, status: "pending" }),
		makeTask({ id: 2, status: "deleted" }),
	];
	const state = makeState({ tasks, nextId: 3 });

	const { op } = applyTaskMutation(state, "list", { action: "list" });

	assert.equal(op.type, "listed");
	if (op.type === "listed") {
		assert.ok(op.tasks.every((t) => t.status !== "deleted"), "deleted must be excluded");
	}
});

test("list: includeDeleted=true includes deleted tombstones", () => {
	const tasks = [
		makeTask({ id: 1, status: "pending" }),
		makeTask({ id: 2, status: "deleted" }),
	];
	const state = makeState({ tasks, nextId: 3 });

	const { op } = applyTaskMutation(state, "list", { action: "list", includeDeleted: true });

	assert.equal(op.type, "listed");
	if (op.type === "listed") {
		assert.equal(op.tasks.length, 2, "deleted must be included when includeDeleted=true");
	}
});

test("get: returns the task without mutating state", () => {
	const tasks = [makeTask({ id: 1, subject: "Find me" })];
	const state = makeState({ tasks, nextId: 2 });

	const { state: next, op } = applyTaskMutation(state, "get", { action: "get", id: 1 });

	assert.equal(op.type, "got");
	if (op.type === "got") {
		assert.equal(op.task?.subject, "Find me");
	}
	assert.deepEqual(next, state, "state must not change on get");
});

test("get: returns error op when id is missing", () => {
	const state = makeState({ tasks: [makeTask({ id: 1 })], nextId: 2 });
	const { op } = applyTaskMutation(state, "get", { action: "get" });

	assert.equal(op.type, "error");
});

test("get: returns error op when task not found", () => {
	const state = makeState({ tasks: [makeTask({ id: 1 })], nextId: 2 });
	const { op } = applyTaskMutation(state, "get", { action: "get", id: 99 });

	assert.equal(op.type, "error");
});

test("cycle detection: addBlockedBy that would create a direct cycle is rejected", () => {
	const state = makeState({
		tasks: [
			makeTask({ id: 1, subject: "A", blockedBy: [2] }),
			makeTask({ id: 2, subject: "B" }),
		],
		nextId: 3,
	});

	const { state: next, op } = applyTaskMutation(state, "update", {
		action: "update",
		id: 2,
		addBlockedBy: [1],
	});

	assert.equal(op.type, "error", "direct cycle must be rejected");
	assert.deepEqual(next.tasks[1].blockedBy, undefined, "state must not be mutated on cycle detection");
});

test("cycle detection: addBlockedBy that would create a transitive cycle is rejected", () => {
	const state = makeState({
		tasks: [
			makeTask({ id: 1, subject: "A", blockedBy: [2] }),
			makeTask({ id: 2, subject: "B", blockedBy: [3] }),
			makeTask({ id: 3, subject: "C" }),
		],
		nextId: 4,
	});

	const { state: next, op } = applyTaskMutation(state, "update", {
		action: "update",
		id: 3,
		addBlockedBy: [1],
	});

	assert.equal(op.type, "error", "transitive cycle must be rejected");
	assert.deepEqual(next.tasks[2].blockedBy, undefined, "state must not be mutated on cycle detection");
});

test("cycle detection: valid addBlockedBy (no cycle) is accepted", () => {
	const state = makeState({
		tasks: [
			makeTask({ id: 1, subject: "A" }),
			makeTask({ id: 2, subject: "B" }),
		],
		nextId: 3,
	});

	const { op } = applyTaskMutation(state, "update", {
		action: "update",
		id: 1,
		addBlockedBy: [2],
	});

	assert.equal(op.type, "updated", "non-cyclic addBlockedBy must succeed");
});

test("cycle detection: self-referencing blockedBy is rejected", () => {
	const state = makeState({
		tasks: [makeTask({ id: 1, subject: "A" })],
		nextId: 2,
	});

	const { op } = applyTaskMutation(state, "update", {
		action: "update",
		id: 1,
		addBlockedBy: [1],
	});

	assert.equal(op.type, "error", "self-reference must be rejected as a cycle");
});

test("reducer does not throw — errors are returned in op.type", () => {
	const state = makeState();
	const badParams = [
		{ action: "create" as const },
		{ action: "update" as const },
		{ action: "delete" as const },
		{ action: "get" as const },
	];

	for (const params of badParams) {
		assert.doesNotThrow(() => applyTaskMutation(state, params.action, params));
	}
});

test("applyTaskMutation: state is immutable — original state is not mutated by create", () => {
	const state = makeState();
	const originalTasks = state.tasks;
	applyTaskMutation(state, "create", { action: "create", subject: "X" });

	assert.equal(state.tasks, originalTasks, "original tasks array must not be mutated");
	assert.equal(state.tasks.length, 0, "original tasks must remain empty");
});
