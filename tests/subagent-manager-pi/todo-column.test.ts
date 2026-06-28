import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { renderTodoColumn, DEFAULT_TODO_BODY_ROWS, type TaskMetric } from "../../packages/subagent-manager-pi/tui/todo-column.ts";
import { ICON_CATALOG } from "../../packages/subagent-manager-pi/icons/catalog.ts";
import type { IconSet } from "../../packages/subagent-manager-pi/icons/types.ts";
import type { TaskState } from "../../packages/subagent-manager-pi/todo/state.ts";
import type { Task } from "../../packages/subagent-manager-pi/todo/types.ts";

/**
 * A Theme double. `tag` mode wraps each styled fragment as `{color}text` so a
 * test can assert which color a fragment received, and strikethrough as
 * `{strike}text` so the completed-row mechanism is observable. Identity mode
 * returns the text untouched so visible-width assertions are exact.
 */
function fakeTheme(tag = true): Theme {
	const fg = (color: string, text: string): string => (tag ? `{${color}}${text}` : text);
	const identity = (text: string): string => text;
	const strikethrough = (text: string): string => (tag ? `{strike}${text}` : text);
	return {
		fg,
		bg: (_color: string, text: string) => text,
		bold: identity,
		italic: identity,
		underline: identity,
		inverse: identity,
		strikethrough,
	} as unknown as Theme;
}

/** The readable unicode glyph set is injected so assertions read against real glyphs. */
const ICONS: IconSet = ICON_CATALOG.unicode;

function makeTask(overrides: Partial<Task> & Pick<Task, "id" | "subject" | "status">): Task {
	return { ...overrides };
}

function makeState(tasks: Task[], nextId = tasks.length + 1): TaskState {
	return { tasks, nextId };
}

const WIDE = 200;
const NO_HIDDEN = new Set<number>();

function render(
	state: TaskState,
	opts: { width?: number; theme?: Theme; hiddenIds?: Set<number>; icons?: IconSet; metrics?: Map<number, TaskMetric>; now?: number } = {},
): string[] {
	return renderTodoColumn(state, opts.width ?? WIDE, opts.theme ?? fakeTheme(), {
		hiddenIds: opts.hiddenIds ?? NO_HIDDEN,
		icons: opts.icons ?? ICONS,
		metrics: opts.metrics ?? new Map(),
		now: opts.now ?? 0,
	});
}

test("renderTodoColumn: returns [] when there are no visible tasks", () => {
	assert.deepEqual(render(makeState([])), []);

	const onlyDeleted = makeState([makeTask({ id: 1, subject: "gone", status: "deleted" })]);
	assert.deepEqual(render(onlyDeleted), []);
});

test("renderTodoColumn: returns [] when all visible tasks are hidden", () => {
	const state = makeState([makeTask({ id: 1, subject: "x", status: "completed" })]);
	assert.deepEqual(render(state, { hiddenIds: new Set([1]) }), []);
});

test("renderTodoColumn: header uses the active icon and a non-zero breakdown", () => {
	const state = makeState([
		makeTask({ id: 1, subject: "p", status: "pending" }),
		makeTask({ id: 2, subject: "i", status: "in_progress" }),
		makeTask({ id: 3, subject: "c", status: "completed" }),
	]);
	const lines = render(state);
	assert.ok(lines[0].includes(`{accent}${ICONS.headerActive} 3 tasks (1 done, 1 in progress, 1 open)`), lines[0]);
});

test("renderTodoColumn: header uses the idle icon and dim color when nothing is active", () => {
	const state = makeState([makeTask({ id: 1, subject: "c", status: "completed" })]);
	const lines = render(state);
	assert.ok(lines[0].includes(`{dim}${ICONS.headerIdle} 1 tasks (1 done)`), lines[0]);
});

test("renderTodoColumn: header omits zero parts from the breakdown", () => {
	const onlyOpen = makeState([
		makeTask({ id: 1, subject: "a", status: "pending" }),
		makeTask({ id: 2, subject: "b", status: "pending" }),
	]);
	assert.ok(render(onlyOpen)[0].includes("(2 open)"), "only the open part should show");
	assert.ok(!render(onlyOpen)[0].includes("done"), "no done part");
	assert.ok(!render(onlyOpen)[0].includes("in progress"), "no in progress part");

	const noCompleted = makeState([
		makeTask({ id: 1, subject: "a", status: "in_progress" }),
		makeTask({ id: 2, subject: "b", status: "pending" }),
	]);
	assert.ok(render(noCompleted)[0].includes("(1 in progress, 1 open)"), render(noCompleted)[0]);
	assert.ok(!render(noCompleted)[0].includes("done"), "no done part");
});

test("renderTodoColumn: pending row shows the pending icon and subject with no tree connector", () => {
	const state = makeState([makeTask({ id: 1, subject: "set up schema", status: "pending" })]);
	const [, row] = render(state);
	assert.ok(row.includes(`  ${ICONS.taskPending} set up schema`), row);
	assert.ok(!row.includes("├─") && !row.includes("└─"), `no tree connectors: ${row}`);
});

test("renderTodoColumn: in_progress without metrics shows the in-progress icon and activeForm in accent", () => {
	const state = makeState([
		makeTask({ id: 1, subject: "build auth", status: "in_progress", activeForm: "Building auth" }),
	]);
	const [, row] = render(state);
	assert.ok(row.includes(`{accent}${ICONS.taskInProgress}`), `icon accent: ${row}`);
	assert.ok(row.includes("{accent}build auth"), `subject accent: ${row}`);
	assert.ok(row.includes("(Building auth)"), `activeForm shown: ${row}`);
});

test("renderTodoColumn: active in_progress row shows spinner frame, dim id, accent form and dim stats", () => {
	const metrics = new Map<number, TaskMetric>([
		[3, { startedAt: 0, inputTokens: 40, outputTokens: 1800 }],
	]);
	const state = makeState([
		makeTask({ id: 3, subject: "build auth service", status: "in_progress", activeForm: "Building auth service" }),
	]);
	const [, row] = render(state, { metrics, now: 8000 });

	// spinner frame at 8000ms with SPIN_MS=150 → floor(8000/150)=53; 53 % 11 = 9
	const frame = ICONS.spinner[Math.floor(8000 / 150) % ICONS.spinner.length];
	assert.ok(row.includes(`{accent}${frame}`), `spinner frame: ${row}`);
	assert.ok(row.includes("{dim}#3"), `dim id: ${row}`);
	assert.ok(row.includes("{accent}Building auth service…"), `accent form with ellipsis: ${row}`);
	assert.ok(row.includes(`{dim}(8s · ${ICONS.arrowUp} 40 ${ICONS.arrowDown} 1.8k)`), `dim stats: ${row}`);
});

test("renderTodoColumn: active row falls back to subject when no activeForm", () => {
	const metrics = new Map<number, TaskMetric>([[1, { startedAt: 0, inputTokens: 0, outputTokens: 0 }]]);
	const state = makeState([makeTask({ id: 1, subject: "do the thing", status: "in_progress" })]);
	const [, row] = render(state, { metrics, now: 1000 });
	assert.ok(row.includes("{accent}do the thing…"), row);
});

test("renderTodoColumn: active stats hide an arrow when that token count is zero", () => {
	const onlyInput = new Map<number, TaskMetric>([[1, { startedAt: 0, inputTokens: 40, outputTokens: 0 }]]);
	const state = makeState([makeTask({ id: 1, subject: "x", status: "in_progress" })]);
	const inRow = render(state, { metrics: onlyInput, now: 8000 }).find((l) => l.includes("#1"));
	assert.ok(inRow?.includes(`${ICONS.arrowUp} 40`), `up arrow present: ${inRow}`);
	assert.ok(!inRow?.includes(ICONS.arrowDown), `down arrow hidden: ${inRow}`);

	const noTokens = new Map<number, TaskMetric>([[1, { startedAt: 0, inputTokens: 0, outputTokens: 0 }]]);
	const bare = render(state, { metrics: noTokens, now: 8000 }).find((l) => l.includes("#1"));
	assert.ok(bare?.includes("(8s)"), `bare elapsed only: ${bare}`);
	assert.ok(!bare?.includes(ICONS.arrowUp) && !bare?.includes(ICONS.arrowDown), `no arrows: ${bare}`);
});

test("renderTodoColumn: spinner frame advances with elapsed time", () => {
	const state = makeState([makeTask({ id: 1, subject: "x", status: "in_progress" })]);
	const at = (elapsed: number) =>
		render(state, { metrics: new Map([[1, { startedAt: 0, inputTokens: 0, outputTokens: 0 }]]), now: elapsed }).find((l) => l.includes("#1"));

	const frame0 = ICONS.spinner[0];
	const frame2 = ICONS.spinner[2];
	assert.ok(at(0)?.includes(`{accent}${frame0}`), `frame 0 at 0ms: ${at(0)}`);
	assert.ok(at(300)?.includes(`{accent}${frame2}`), `frame 2 at 300ms: ${at(300)}`);
});

test("renderTodoColumn: completed row dims and strikes through the subject", () => {
	const state = makeState([makeTask({ id: 1, subject: "migrate db", status: "completed" })]);
	const completed = render(state).find((l) => l.includes("migrate db"));
	assert.ok(completed?.includes(`{success}${ICONS.taskCompleted}`), `success icon: ${completed}`);
	assert.ok(completed?.includes("{strike}{dim}migrate db"), `dim strikethrough: ${completed}`);
});

test("renderTodoColumn: blocked-by lists only non-completed blockers with the chevron", () => {
	const state = makeState([
		makeTask({ id: 1, subject: "done dep", status: "completed" }),
		makeTask({ id: 2, subject: "open dep", status: "pending" }),
		makeTask({ id: 3, subject: "cart service", status: "pending", blockedBy: [1, 2] }),
	]);
	const blocked = render(state).find((l) => l.includes("cart service"));
	assert.ok(blocked?.includes(`${ICONS.chevron} blocked by #2`), `chevron + open blocker: ${blocked}`);
	assert.ok(!blocked?.includes("#1"), `completed blocker filtered out: ${blocked}`);
});

test("renderTodoColumn: blocked-by suffix is suppressed when every blocker is completed", () => {
	const state = makeState([
		makeTask({ id: 1, subject: "done dep", status: "completed" }),
		makeTask({ id: 2, subject: "free task", status: "pending", blockedBy: [1] }),
	]);
	const row = render(state).find((l) => l.includes("free task"));
	assert.ok(!row?.includes("blocked by"), `no blocked-by when all blockers done: ${row}`);
});

test("renderTodoColumn: blocked-by only annotates pending tasks", () => {
	const state = makeState([
		makeTask({ id: 1, subject: "dep", status: "pending" }),
		makeTask({ id: 2, subject: "in flight", status: "in_progress", blockedBy: [1] }),
	]);
	const row = render(state).find((l) => l.includes("in flight"));
	assert.ok(!row?.includes("blocked by"), `in_progress is not annotated: ${row}`);
});

test("renderTodoColumn: overflow summary uses the ellipsis icon and the hidden count", () => {
	const tasks: Task[] = [];
	for (let i = 1; i <= 13; i++) {
		tasks.push(makeTask({ id: i, subject: `task-${i}`, status: "pending" }));
	}
	const lines = render(makeState(tasks));

	const last = lines[lines.length - 1];
	// Compact default: budget DEFAULT_TODO_BODY_ROWS (5) → 4 rows shown + overflow of 9.
	assert.ok(last.includes(`${ICONS.ellipsis} and 9 more`), last);
	assert.ok(!last.includes("├─") && !last.includes("└─"), `no tree connector in overflow: ${last}`);
});

test("renderTodoColumn: compact default caps the body and drops completed into the overflow", () => {
	const tasks: Task[] = [
		makeTask({ id: 1, subject: "ip-a", status: "in_progress", activeForm: "doing a" }),
		makeTask({ id: 2, subject: "ip-b", status: "in_progress", activeForm: "doing b" }),
		makeTask({ id: 3, subject: "pend-c", status: "pending" }),
		makeTask({ id: 4, subject: "pend-d", status: "pending" }),
		makeTask({ id: 5, subject: "done-e", status: "completed" }),
		makeTask({ id: 6, subject: "done-f", status: "completed" }),
		makeTask({ id: 7, subject: "done-g", status: "completed" }),
		makeTask({ id: 8, subject: "done-h", status: "completed" }),
	];
	const lines = render(makeState(tasks));
	const body = lines.slice(1);

	assert.ok(body.length <= DEFAULT_TODO_BODY_ROWS, `body capped at ${DEFAULT_TODO_BODY_ROWS}: got ${body.length}`);

	for (const subject of ["ip-a", "ip-b", "pend-c", "pend-d"]) {
		assert.ok(body.some((l) => l.includes(subject)), `active task ${subject} stays visible`);
	}
	for (const subject of ["done-e", "done-f", "done-g", "done-h"]) {
		assert.ok(!body.some((l) => l.includes(subject)), `completed task ${subject} dropped into overflow`);
	}

	const last = body[body.length - 1];
	assert.ok(last.includes(`${ICONS.ellipsis} and 4 more`), `overflow shows the dropped count: ${last}`);
});

test("renderTodoColumn: shows all rows with no overflow when at the compact budget", () => {
	const tasks: Task[] = [];
	for (let i = 1; i <= DEFAULT_TODO_BODY_ROWS; i++) {
		tasks.push(makeTask({ id: i, subject: `task-${i}`, status: "pending" }));
	}
	const lines = render(makeState(tasks));

	assert.equal(lines.length, DEFAULT_TODO_BODY_ROWS + 1, "header plus one row per task, no overflow line");
	assert.ok(!lines.some((l) => l.includes("more")), "no overflow summary at or below the budget");
});

test("renderTodoColumn: drops completed tasks first so active work stays visible", () => {
	const tasks: Task[] = [];
	for (let i = 1; i <= 11; i++) {
		tasks.push(makeTask({ id: i, subject: `done-${i}`, status: "completed" }));
	}
	tasks.push(makeTask({ id: 12, subject: "still-pending", status: "pending" }));
	const lines = render(makeState(tasks));
	assert.ok(lines.some((l) => l.includes("still-pending")), "pending work survives truncation");
});

test("renderTodoColumn: uses the injected icon set, not a hardcoded glyph", () => {
	const sentinel: IconSet = {
		...ICON_CATALOG.ascii,
		taskPending: "PEND",
		headerActive: "HEAD",
	};
	const state = makeState([makeTask({ id: 1, subject: "subject", status: "pending" })]);
	const lines = render(state, { icons: sentinel });
	assert.ok(lines[0].includes("HEAD"), `header uses injected icon: ${lines[0]}`);
	assert.ok(lines[1].includes("PEND"), `row uses injected icon: ${lines[1]}`);
});

test("renderTodoColumn: is pure — identical inputs yield identical output", () => {
	const state = makeState([
		makeTask({ id: 1, subject: "a", status: "in_progress", activeForm: "doing a" }),
		makeTask({ id: 2, subject: "b", status: "pending" }),
	]);
	const metrics = new Map<number, TaskMetric>([[1, { startedAt: 0, inputTokens: 10, outputTokens: 20 }]]);
	const first = render(state, { metrics, now: 5000 });
	const second = render(state, { metrics, now: 5000 });
	assert.deepEqual(first, second);
});

test("renderTodoColumn: every line is truncated to the given width", () => {
	const metrics = new Map<number, TaskMetric>([[1, { startedAt: 0, inputTokens: 1234, outputTokens: 5678 }]]);
	const state = makeState([
		makeTask({ id: 1, subject: "a-very-long-subject-that-exceeds-the-column", status: "in_progress", activeForm: "doing a very long activity" }),
		makeTask({ id: 2, subject: "another-fairly-long-subject-here", status: "pending" }),
	]);
	const width = 20;
	const lines = render(state, { width, theme: fakeTheme(false), metrics, now: 9000 });

	for (const line of lines) {
		assert.ok(visibleWidth(line) <= width, `"${line}" has width ${visibleWidth(line)} > ${width}`);
	}
});
