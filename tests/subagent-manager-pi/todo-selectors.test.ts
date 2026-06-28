import test from "node:test";
import assert from "node:assert/strict";
import {
	selectVisibleTasks,
	selectTodoCounts,
	selectTasksByStatus,
	selectOverlayLayout,
	selectHasActive,
	selectShowTaskIds,
	selectTaskSubjectById,
} from "../../packages/subagent-manager-pi/todo/selectors.ts";
import { EMPTY_STATE } from "../../packages/subagent-manager-pi/todo/state.ts";
import type { TaskState } from "../../packages/subagent-manager-pi/todo/state.ts";
import type { Task } from "../../packages/subagent-manager-pi/todo/types.ts";

function makeState(tasks: Task[], nextId = tasks.length + 1): TaskState {
	return { tasks, nextId };
}

function makeTask(id: number, overrides: Partial<Task> = {}): Task {
	return { id, subject: `Task ${id}`, status: "pending", ...overrides };
}

test("selectVisibleTasks: excludes deleted tasks", () => {
	const tasks = [
		makeTask(1, { status: "pending" }),
		makeTask(2, { status: "deleted" }),
		makeTask(3, { status: "completed" }),
	];
	const state = makeState(tasks);

	const visible = selectVisibleTasks(state);

	assert.deepEqual(visible.map((t) => t.id), [1, 3]);
});

test("selectVisibleTasks: returns all when no deleted", () => {
	const tasks = [
		makeTask(1, { status: "pending" }),
		makeTask(2, { status: "in_progress" }),
		makeTask(3, { status: "completed" }),
	];
	const state = makeState(tasks);

	assert.equal(selectVisibleTasks(state).length, 3);
});

test("selectVisibleTasks: empty state returns empty array", () => {
	assert.deepEqual(selectVisibleTasks(EMPTY_STATE), []);
});

test("selectTodoCounts: counts by status, excluding deleted", () => {
	const tasks = [
		makeTask(1, { status: "pending" }),
		makeTask(2, { status: "pending" }),
		makeTask(3, { status: "in_progress" }),
		makeTask(4, { status: "completed" }),
		makeTask(5, { status: "deleted" }),
	];
	const state = makeState(tasks);

	const counts = selectTodoCounts(state);

	assert.equal(counts.total, 4, "total excludes deleted");
	assert.equal(counts.pending, 2);
	assert.equal(counts.inProgress, 1);
	assert.equal(counts.completed, 1);
});

test("selectTodoCounts: all zeros when empty", () => {
	const counts = selectTodoCounts(EMPTY_STATE);

	assert.equal(counts.total, 0);
	assert.equal(counts.pending, 0);
	assert.equal(counts.inProgress, 0);
	assert.equal(counts.completed, 0);
});

test("selectTasksByStatus: groups into pending, inProgress, completed (excludes deleted)", () => {
	const tasks = [
		makeTask(1, { status: "pending" }),
		makeTask(2, { status: "in_progress" }),
		makeTask(3, { status: "completed" }),
		makeTask(4, { status: "deleted" }),
	];
	const state = makeState(tasks);

	const grouped = selectTasksByStatus(state);

	assert.deepEqual(grouped.pending.map((t) => t.id), [1]);
	assert.deepEqual(grouped.inProgress.map((t) => t.id), [2]);
	assert.deepEqual(grouped.completed.map((t) => t.id), [3]);
});

test("selectHasActive: true when any pending task exists", () => {
	const state = makeState([makeTask(1, { status: "pending" })]);

	assert.equal(selectHasActive(state), true);
});

test("selectHasActive: true when any in_progress task exists", () => {
	const state = makeState([makeTask(1, { status: "in_progress" })]);

	assert.equal(selectHasActive(state), true);
});

test("selectHasActive: false when only completed and deleted", () => {
	const tasks = [
		makeTask(1, { status: "completed" }),
		makeTask(2, { status: "deleted" }),
	];
	const state = makeState(tasks);

	assert.equal(selectHasActive(state), false);
});

test("selectHasActive: false when empty", () => {
	assert.equal(selectHasActive(EMPTY_STATE), false);
});

test("selectShowTaskIds: true when any visible task has non-empty blockedBy", () => {
	const tasks = [
		makeTask(1, { status: "pending" }),
		makeTask(2, { status: "pending", blockedBy: [1] }),
	];
	const state = makeState(tasks);

	assert.equal(selectShowTaskIds(state), true);
});

test("selectShowTaskIds: false when no visible task has blockedBy", () => {
	const tasks = [makeTask(1), makeTask(2)];
	const state = makeState(tasks);

	assert.equal(selectShowTaskIds(state), false);
});

test("selectShowTaskIds: deleted task with blockedBy does not trigger showIds", () => {
	const tasks = [
		makeTask(1),
		makeTask(2, { status: "deleted", blockedBy: [1] }),
	];
	const state = makeState(tasks);

	assert.equal(selectShowTaskIds(state), false, "deleted tasks are not visible and must not trigger showIds");
});

test("selectTaskSubjectById: returns subject for existing task", () => {
	const tasks = [makeTask(1, { subject: "Write unit tests" })];
	const state = makeState(tasks);

	assert.equal(selectTaskSubjectById(state, 1), "Write unit tests");
});

test("selectTaskSubjectById: returns undefined for missing id", () => {
	const state = makeState([makeTask(1)]);

	assert.equal(selectTaskSubjectById(state, 99), undefined);
});

test("selectOverlayLayout: all tasks returned when count <= budget", () => {
	const tasks = [makeTask(1), makeTask(2), makeTask(3)];
	const state = makeState(tasks);

	const layout = selectOverlayLayout(state, 5);

	assert.equal(layout.tasks.length, 3);
	assert.equal(layout.overflowCount, 0);
	assert.equal(layout.overflowCompleted, 0);
	assert.equal(layout.overflowPending, 0);
});

test("selectOverlayLayout: exactly budget tasks — no overflow", () => {
	const tasks = [makeTask(1), makeTask(2), makeTask(3)];
	const state = makeState(tasks);

	const layout = selectOverlayLayout(state, 3);

	assert.equal(layout.tasks.length, 3);
	assert.equal(layout.overflowCount, 0);
});

test("selectOverlayLayout: drops completed first when budget exceeded", () => {
	const tasks = [
		makeTask(1, { status: "pending" }),
		makeTask(2, { status: "completed" }),
		makeTask(3, { status: "in_progress" }),
	];
	const state = makeState(tasks);

	const layout = selectOverlayLayout(state, 2);

	assert.equal(layout.tasks.length, 1, "1 slot reserved for overflow summary");
	assert.ok(
		layout.tasks.every((t) => t.status !== "completed"),
		"no completed tasks in visible slots when overflow",
	);
	assert.ok(layout.overflowCompleted > 0, "completed counted in overflow");
});

test("selectOverlayLayout: non-completed tasks preserved even when budget is tight", () => {
	const tasks = [
		makeTask(1, { status: "pending" }),
		makeTask(2, { status: "in_progress" }),
		makeTask(3, { status: "completed" }),
		makeTask(4, { status: "completed" }),
	];
	const state = makeState(tasks);

	const layout = selectOverlayLayout(state, 3);

	assert.deepEqual(
		layout.tasks.map((t) => t.id),
		[1, 2],
		"non-completed tasks take priority in visible slots",
	);
	assert.equal(layout.overflowCount, 2);
	assert.equal(layout.overflowCompleted, 2);
	assert.equal(layout.overflowPending, 0);
});

test("selectOverlayLayout: overflow split between completed and non-completed when both truncated", () => {
	const tasks = [
		makeTask(1, { status: "pending" }),
		makeTask(2, { status: "pending" }),
		makeTask(3, { status: "pending" }),
		makeTask(4, { status: "completed" }),
	];
	const state = makeState(tasks);

	const layout = selectOverlayLayout(state, 2);

	assert.equal(layout.tasks.length, 1, "1 task visible, 1 slot for overflow");
	assert.equal(layout.overflowCount, 3);
	assert.equal(layout.overflowCompleted, 1);
	assert.equal(layout.overflowPending, 2);
});

test("selectOverlayLayout: excludes deleted tasks from layout", () => {
	const tasks = [
		makeTask(1, { status: "pending" }),
		makeTask(2, { status: "deleted" }),
	];
	const state = makeState(tasks);

	const layout = selectOverlayLayout(state, 5);

	assert.equal(layout.tasks.length, 1, "deleted task not included in layout");
	assert.equal(layout.tasks[0].id, 1);
});

test("selectOverlayLayout: empty state returns empty layout", () => {
	const layout = selectOverlayLayout(EMPTY_STATE, 10);

	assert.equal(layout.tasks.length, 0);
	assert.equal(layout.overflowCount, 0);
});
