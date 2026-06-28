import test from "node:test";
import assert from "node:assert/strict";
import type { Theme } from "@mariozechner/pi-coding-agent";
import {
	renderAllTodos,
	shouldOpenTodosOverlay,
} from "../../packages/subagent-manager-pi/tui/todos-overlay.ts";
import { ICON_CATALOG } from "../../packages/subagent-manager-pi/icons/catalog.ts";
import type { IconSet } from "../../packages/subagent-manager-pi/icons/types.ts";
import type { TaskState } from "../../packages/subagent-manager-pi/todo/state.ts";
import type { Task } from "../../packages/subagent-manager-pi/todo/types.ts";

/**
 * Theme double. `fg` tags each fragment as `{color}text` and `strikethrough`
 * tags as `{strike}text`, so a test can prove which styling a fragment received
 * without depending on real ANSI codes.
 */
function fakeTheme(): Theme {
	const identity = (text: string): string => text;
	return {
		fg: (color: string, text: string) => `{${color}}${text}`,
		bg: (_color: string, text: string) => text,
		bold: identity,
		italic: identity,
		underline: identity,
		inverse: identity,
		strikethrough: (text: string) => `{strike}${text}`,
	} as unknown as Theme;
}

const ICONS: IconSet = ICON_CATALOG.unicode;
const WIDE = 200;

function makeTask(overrides: Partial<Task> & Pick<Task, "id" | "subject" | "status">): Task {
	return { ...overrides };
}

function makeState(tasks: Task[]): TaskState {
	return { tasks, nextId: tasks.length + 1 };
}

function render(state: TaskState, width = WIDE): string[] {
	return renderAllTodos(state, width, ICONS, fakeTheme());
}

test("renderAllTodos: groups every task under its status section header", () => {
	const state = makeState([
		makeTask({ id: 1, subject: "ip", status: "in_progress", activeForm: "doing ip" }),
		makeTask({ id: 2, subject: "pend", status: "pending" }),
		makeTask({ id: 3, subject: "done", status: "completed" }),
	]);
	const lines = render(state);
	const joined = lines.join("\n");

	assert.ok(joined.includes("In progress"), "in-progress section header present");
	assert.ok(joined.includes("Pending"), "pending section header present");
	assert.ok(joined.includes("Completed"), "completed section header present");

	assert.ok(lines.some((l) => l.includes("ip") && l.includes(ICONS.taskInProgress)), "in-progress row uses its glyph");
	assert.ok(lines.some((l) => l.includes("doing ip")), "in-progress row shows the activeForm");
	assert.ok(lines.some((l) => l.includes("pend") && l.includes(ICONS.taskPending)), "pending row uses its glyph");

	const completedRow = lines.find((l) => l.includes("done"));
	assert.ok(completedRow?.includes(`{success}${ICONS.taskCompleted}`), `completed glyph: ${completedRow}`);
	assert.ok(completedRow?.includes("{strike}{dim}done"), `completed dim + strikethrough: ${completedRow}`);
});

test("renderAllTodos: lists every task with no overflow truncation", () => {
	const tasks: Task[] = [];
	for (let i = 1; i <= 20; i++) {
		tasks.push(makeTask({ id: i, subject: `t${i}`, status: "pending" }));
	}
	const lines = render(makeState(tasks));

	for (let i = 1; i <= 20; i++) {
		assert.ok(lines.some((l) => l.includes(`t${i} `) || l.endsWith(`t${i}`)), `task t${i} present in the full list`);
	}
	assert.ok(!lines.some((l) => l.includes("more")), "the full list never shows an overflow summary");
});

test("renderAllTodos: a blocked pending task shows the chevron and its open blocker", () => {
	const state = makeState([
		makeTask({ id: 1, subject: "dep", status: "pending" }),
		makeTask({ id: 2, subject: "blocked-task", status: "pending", blockedBy: [1] }),
	]);
	const row = render(state).find((l) => l.includes("blocked-task"));
	assert.ok(row?.includes(`${ICONS.chevron} blocked by #1`), `chevron + open blocker: ${row}`);
});

test("renderAllTodos: drops a completed blocker from the blocked-by annotation", () => {
	const state = makeState([
		makeTask({ id: 1, subject: "done dep", status: "completed" }),
		makeTask({ id: 2, subject: "free", status: "pending", blockedBy: [1] }),
	]);
	const row = render(state).find((l) => l.includes("free"));
	assert.ok(!row?.includes("blocked by"), `no annotation when every blocker is done: ${row}`);
});

test("renderAllTodos: is pure — identical inputs yield identical output", () => {
	const state = makeState([
		makeTask({ id: 1, subject: "a", status: "in_progress", activeForm: "doing a" }),
		makeTask({ id: 2, subject: "b", status: "pending" }),
		makeTask({ id: 3, subject: "c", status: "completed" }),
	]);
	assert.deepEqual(render(state), render(state));
});

test("renderAllTodos: returns nothing for an empty list", () => {
	assert.deepEqual(render(makeState([])), []);
});

test("shouldOpenTodosOverlay: only the right arrow at an empty prompt with no overlay opens", () => {
	assert.equal(shouldOpenTodosOverlay("\x1b[C", true, false), true);
	assert.equal(shouldOpenTodosOverlay("\x1b[C", false, false), false, "non-empty editor must not open");
	assert.equal(shouldOpenTodosOverlay("\x1b[C", true, true), false, "an open overlay must not re-open");
	assert.equal(shouldOpenTodosOverlay("\x1b[D", true, false), false, "the left arrow is the fleet's key");
	assert.equal(shouldOpenTodosOverlay("a", true, false), false, "normal typing is never the trigger");
});
