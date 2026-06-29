import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	routeTwoColumnInput,
	TwoColumnWidget,
	type TwoColumnFleet,
} from "../../packages/subagent-manager-pi/tui/two-column-widget.ts";
import { ICON_CATALOG } from "../../packages/subagent-manager-pi/icons/catalog.ts";
import type { TaskState } from "../../packages/subagent-manager-pi/todo/state.ts";
import type { Task } from "../../packages/subagent-manager-pi/todo/types.ts";

const UNICODE_ICONS = () => ICON_CATALOG.unicode;

function identityTheme(): Theme {
	const identity = (text: string): string => text;
	return {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: identity,
		italic: identity,
		underline: identity,
		inverse: identity,
		strikethrough: identity,
	} as unknown as Theme;
}

/** A TUI double that only needs to count requestRender invocations. */
function fakeTui(): { tui: TUI; renders: () => number } {
	let count = 0;
	const tui = { requestRender: () => { count += 1; } } as unknown as TUI;
	return { tui, renders: () => count };
}

/** A fleet double whose render output and key handling are fully controlled. */
function fakeFleet(lines: string[]): TwoColumnFleet & { keyCalls: Array<[string, boolean, boolean]>; disposed: boolean } {
	const fleet = {
		keyCalls: [] as Array<[string, boolean, boolean]>,
		disposed: false,
		render: (_width: number) => lines,
		handleKey(data: string, editorEmpty: boolean, overlayOpen = false) {
			fleet.keyCalls.push([data, editorEmpty, overlayOpen]);
			return { consume: true };
		},
		invalidate() {},
		dispose() { fleet.disposed = true; },
	};
	return fleet;
}

function makeTask(overrides: Partial<Task> & Pick<Task, "id" | "subject" | "status">): Task {
	return { ...overrides };
}

function makeState(tasks: Task[]): TaskState {
	return { tasks, nextId: tasks.length + 1 };
}

/** A swappable state source so a test can simulate task transitions between renders. */
function mutableState(initial: Task[]): { read: () => TaskState; set: (tasks: Task[]) => void } {
	let state = makeState(initial);
	return {
		read: () => state,
		set: (tasks: Task[]) => { state = makeState(tasks); },
	};
}

const UNICODE = ICON_CATALOG.unicode;

/** Whether any unicode spinner frame appears in a row (proves the active/spinner branch). */
function hasSpinnerFrame(row: string | undefined): boolean {
	return row !== undefined && UNICODE.spinner.some((frame) => row.includes(frame));
}

const EMPTY = makeState([]);

function widgetWith(fleet: TwoColumnFleet, state: TaskState, tui = fakeTui().tui) {
	return new TwoColumnWidget(fleet, tui, identityTheme(), () => state);
}

test("TwoColumnWidget: two-column layout keeps the separator at a fixed visible column", () => {
	const fleet = fakeFleet(["short", "a-much-longer-fleet-row-here"]);
	const state = makeState([makeTask({ id: 1, subject: "todo-a", status: "pending" })]);
	const widget = widgetWith(fleet, state);

	const width = 80;
	const expectedLeft = Math.floor(width * 0.55);
	const out = widget.render(width);

	assert.ok(out.length >= 2);
	for (const line of out) {
		const sep = line.indexOf("│");
		assert.ok(sep >= 0, `no separator in "${line}"`);
		assert.equal(visibleWidth(line.slice(0, sep)), expectedLeft, `left column misaligned in "${line}"`);
	}
});

test("TwoColumnWidget: separator stays aligned even when left lines carry ANSI", () => {
	const fleet = fakeFleet(["\x1b[31mred\x1b[0m", "plain-but-longer-row"]);
	const state = makeState([makeTask({ id: 1, subject: "todo", status: "pending" })]);
	const widget = widgetWith(fleet, state);

	const width = 80;
	const expectedLeft = Math.floor(width * 0.55);
	const out = widget.render(width);

	for (const line of out) {
		const sep = line.indexOf("│");
		assert.equal(visibleWidth(line.slice(0, sep)), expectedLeft, `left column misaligned in "${JSON.stringify(line)}"`);
	}
});

test("TwoColumnWidget: stacks vertically with a divider below 80 columns", () => {
	const fleet = fakeFleet(["fleet-row"]);
	const state = makeState([makeTask({ id: 1, subject: "todo-row", status: "pending" })]);
	const widget = widgetWith(fleet, state);

	const width = 70;
	const out = widget.render(width);

	assert.ok(out.some((l) => l.includes("─".repeat(width))), "expected a full-width divider");
	assert.ok(out.every((l) => !l.includes("│")), "vertical stack must not use the column separator");
});

test("TwoColumnWidget: single column at full width when the todo side is empty", () => {
	const fleet = fakeFleet(["fleet-row"]);
	const widget = widgetWith(fleet, EMPTY);

	const out = widget.render(100);
	assert.deepEqual(out, ["fleet-row"]);
	assert.ok(out.every((l) => !l.includes("│")));
});

test("TwoColumnWidget: reserves the Agents column when the fleet is empty but todos exist", () => {
	const fleet = fakeFleet([]);
	const state = makeState([makeTask({ id: 1, subject: "only-todo", status: "pending" })]);
	const widget = widgetWith(fleet, state);

	const width = 100;
	const leftWidth = Math.floor(width * 0.55);
	const out = widget.render(width);

	assert.ok(out.length > 0);
	assert.ok(out.every((l) => l.includes("│")), "two-column layout is kept so the todos do not shift sideways");
	assert.ok(out[0].includes("Agents"), "left column shows the idle Agents placeholder");
	assert.ok(out.some((l) => l.includes("only-todo")), "todo content present on the right");
	for (const line of out) {
		assert.equal(visibleWidth(line.slice(0, line.indexOf("│"))), leftWidth, `left column misaligned in "${line}"`);
	}
});

test("TwoColumnWidget: todos occupy the same columns whether or not an agent is running", () => {
	const state = makeState([
		makeTask({ id: 1, subject: "alpha", status: "pending" }),
		makeTask({ id: 2, subject: "beta", status: "pending" }),
	]);
	const width = 100;
	const leftWidth = Math.floor(width * 0.55);

	const outEmpty = widgetWith(fakeFleet([]), state).render(width);
	const outFull = widgetWith(fakeFleet(["agent-row"]), state).render(width);

	for (const out of [outEmpty, outFull]) {
		assert.ok(out.length > 0);
		for (const line of out) {
			const sep = line.indexOf("│");
			assert.ok(sep >= 0, `expected a separator in "${line}"`);
			assert.equal(visibleWidth(line.slice(0, sep)), leftWidth, `left column misaligned in "${line}"`);
		}
	}

	const rightOf = (out: string[]) => out.map((l) => l.slice(l.indexOf("│") + 1));
	assert.deepEqual(rightOf(outEmpty), rightOf(outFull), "the todos column is identical regardless of the fleet");
});

test("TwoColumnWidget: narrow layout reserves the agents section above the todos when the fleet is empty", () => {
	const fleet = fakeFleet([]);
	const state = makeState([makeTask({ id: 1, subject: "todo-x", status: "pending" })]);
	const widget = widgetWith(fleet, state);

	const width = 70;
	const out = widget.render(width);

	const agentsIdx = out.findIndex((l) => l.includes("Agents"));
	const dividerIdx = out.findIndex((l) => l.includes("─".repeat(width)));

	assert.ok(agentsIdx >= 0, "idle Agents placeholder reserved");
	assert.ok(dividerIdx >= 0, "divider between agents and todos");
	assert.ok(agentsIdx < dividerIdx, "agents section sits above the divider");
	assert.ok(out.some((l) => l.includes("todo-x")), "todos present below the divider");
});

test("TwoColumnWidget: self-hides when both columns are empty", () => {
	const fleet = fakeFleet([]);
	const widget = widgetWith(fleet, EMPTY);
	assert.deepEqual(widget.render(120), []);
});

test("TwoColumnWidget: hide-between-turns moves completed tasks out on agent_start", () => {
	const fleet = fakeFleet([]);
	const state = makeState([
		makeTask({ id: 1, subject: "done-task", status: "completed" }),
		makeTask({ id: 2, subject: "todo-task", status: "pending" }),
	]);
	const { tui, renders } = fakeTui();
	const widget = new TwoColumnWidget(fleet, tui, identityTheme(), () => state);

	const before = widget.render(100);
	assert.ok(before.some((l) => l.includes("done-task")), "completed task visible before the turn boundary");

	widget.onTodoToolEnd();
	const afterToolEnd = widget.render(100);
	assert.ok(afterToolEnd.some((l) => l.includes("done-task")), "still visible after tool end, before agent_start");

	const rendersBefore = renders();
	widget.onAgentStart();
	assert.ok(renders() > rendersBefore, "agent_start should request a render");

	const afterAgentStart = widget.render(100);
	assert.ok(!afterAgentStart.some((l) => l.includes("done-task")), "completed task hidden after agent_start");
	assert.ok(afterAgentStart.some((l) => l.includes("todo-task")), "pending task stays visible");
});

test("TwoColumnWidget: agent_start does not request a render when nothing is pending hide", () => {
	const fleet = fakeFleet([]);
	const { tui, renders } = fakeTui();
	const widget = new TwoColumnWidget(fleet, tui, identityTheme(), () => makeState([makeTask({ id: 1, subject: "p", status: "pending" })]));

	widget.onAgentStart();
	assert.equal(renders(), 0);
});

test("TwoColumnWidget: session reset restores hidden completed tasks", () => {
	const fleet = fakeFleet([]);
	const state = makeState([makeTask({ id: 1, subject: "done-task", status: "completed" })]);
	const { tui, renders } = fakeTui();
	const widget = new TwoColumnWidget(fleet, tui, identityTheme(), () => state);

	widget.onTodoToolEnd();
	widget.onAgentStart();
	assert.ok(!widget.render(100).some((l) => l.includes("done-task")), "hidden after a turn");

	const rendersBefore = renders();
	widget.onSessionReset();
	assert.ok(renders() > rendersBefore, "session reset should request a render");
	assert.ok(widget.render(100).some((l) => l.includes("done-task")), "visible again after reset");
});

test("TwoColumnWidget: delegates key handling to the fleet unchanged", () => {
	const fleet = fakeFleet(["row"]);
	const widget = widgetWith(fleet, EMPTY);

	const result = widget.handleKey("\x1b[A", true, false);
	assert.deepEqual(result, { consume: true });
	assert.deepEqual(fleet.keyCalls, [["\x1b[A", true, false]]);
});

test("TwoColumnWidget: dispose tears down the fleet", () => {
	const fleet = fakeFleet([]);
	const widget = widgetWith(fleet, EMPTY);
	widget.dispose();
	assert.equal(fleet.disposed, true);
});

test("TwoColumnWidget: addTokenUsage distributes tokens to tasks activated this session only", () => {
	const fleet = fakeFleet([]);
	const store = mutableState([
		makeTask({ id: 1, subject: "running", status: "pending", activeForm: "running it" }),
		makeTask({ id: 2, subject: "waiting", status: "pending" }),
	]);
	const widget = new TwoColumnWidget(fleet, fakeTui().tui, identityTheme(), store.read, UNICODE_ICONS, () => 8000);

	// Baseline render with nothing in progress.
	widget.render(100);

	// Task 1 transitions into in_progress this session, driven by the todo tool.
	store.set([
		makeTask({ id: 1, subject: "running", status: "in_progress", activeForm: "running it" }),
		makeTask({ id: 2, subject: "waiting", status: "pending" }),
	]);
	widget.onTodoToolEnd();

	widget.addTokenUsage(40, 1800);
	const out = widget.render(100);

	const active = out.find((l) => l.includes("running it"));
	assert.ok(active?.includes("↑ 40"), `active row shows input tokens: ${active}`);
	assert.ok(active?.includes("↓ 1.8k"), `active row shows output tokens: ${active}`);

	const pending = out.find((l) => l.includes("waiting"));
	assert.ok(!pending?.includes("↑") && !pending?.includes("↓"), `pending row carries no tokens: ${pending}`);

	widget.dispose();
});

test("TwoColumnWidget: a replayed in_progress task at first render renders static with no metrics", (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });

	const fleet = fakeFleet([]);
	const { tui, renders } = fakeTui();
	const store = mutableState([
		makeTask({ id: 1, subject: "leftover", status: "in_progress" }),
	]);
	const widget = new TwoColumnWidget(fleet, tui, identityTheme(), store.read, UNICODE_ICONS, () => 9000);

	const out = widget.render(100);
	const row = out.find((l) => l.includes("leftover"));

	assert.ok(row?.includes(UNICODE.taskInProgress), `expected the static in-progress icon: ${row}`);
	assert.ok(!hasSpinnerFrame(row), `replayed task must not spin: ${row}`);
	assert.ok(!row?.includes("("), `replayed task shows no elapsed/stats: ${row}`);

	// No heartbeat is scheduled, so advancing time requests no further renders.
	const rendersBefore = renders();
	t.mock.timers.tick(1000);
	assert.equal(renders(), rendersBefore, "a replayed in_progress task must not start the render heartbeat");

	// Token usage must not accrue to a baseline (non-activated) task.
	widget.addTokenUsage(100, 200);
	const after = widget.render(100);
	const row2 = after.find((l) => l.includes("leftover"));
	assert.ok(!row2?.includes("↑") && !row2?.includes("↓"), `baseline task accrues no tokens: ${row2}`);

	widget.dispose();
});

test("TwoColumnWidget: a task transitioned in_progress this session activates and starts the heartbeat", (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });

	const fleet = fakeFleet([]);
	const { tui, renders } = fakeTui();
	const store = mutableState([
		makeTask({ id: 1, subject: "fresh", status: "pending", activeForm: "doing fresh" }),
	]);
	const widget = new TwoColumnWidget(fleet, tui, identityTheme(), store.read, UNICODE_ICONS, () => 7000);

	widget.render(100);

	store.set([makeTask({ id: 1, subject: "fresh", status: "in_progress", activeForm: "doing fresh" })]);
	widget.onTodoToolEnd();
	const out = widget.render(100);

	const row = out.find((l) => l.includes("doing fresh"));
	assert.ok(hasSpinnerFrame(row), `activated task shows a spinner frame: ${row}`);

	const rendersBefore = renders();
	t.mock.timers.tick(1000);
	assert.ok(renders() > rendersBefore, "an activated task starts the render heartbeat");

	widget.dispose();
});

test("TwoColumnWidget: a task leaving in_progress drops its metrics and stops the heartbeat", (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });

	const fleet = fakeFleet([]);
	const { tui, renders } = fakeTui();
	const store = mutableState([
		makeTask({ id: 1, subject: "task", status: "pending", activeForm: "doing task" }),
	]);
	const widget = new TwoColumnWidget(fleet, tui, identityTheme(), store.read, UNICODE_ICONS, () => 3000);

	widget.render(100);
	store.set([makeTask({ id: 1, subject: "task", status: "in_progress", activeForm: "doing task" })]);
	widget.onTodoToolEnd();
	widget.render(100);

	// Task completes: metrics drop, no active row remains.
	store.set([makeTask({ id: 1, subject: "task", status: "completed", activeForm: "doing task" })]);
	widget.onTodoToolEnd();
	const out = widget.render(100);
	assert.ok(!out.some((l) => hasSpinnerFrame(l)), "no spinner once the task left in_progress");

	const rendersBefore = renders();
	t.mock.timers.tick(1000);
	assert.equal(renders(), rendersBefore, "heartbeat stops once no task is active");

	widget.dispose();
});

test("TwoColumnWidget: session reset re-baselines in_progress without re-activating it", () => {
	const fleet = fakeFleet([]);
	const store = mutableState([
		makeTask({ id: 1, subject: "first", status: "pending", activeForm: "doing first" }),
	]);
	const widget = new TwoColumnWidget(fleet, fakeTui().tui, identityTheme(), store.read, UNICODE_ICONS, () => 5000);

	// Baseline render with task 1 still pending, then activate it this session.
	widget.render(100);
	store.set([makeTask({ id: 1, subject: "first", status: "in_progress", activeForm: "doing first" })]);
	widget.onTodoToolEnd();
	const active = widget.render(100);
	assert.ok(active.some((l) => l.includes("doing first") && hasSpinnerFrame(l)), "task is active (spinning) before reset");

	// New/compacted session restores a different in_progress task via replay.
	widget.onSessionReset();
	store.set([makeTask({ id: 2, subject: "restored", status: "in_progress", activeForm: "restored work" })]);
	const out = widget.render(100);

	const row = out.find((l) => l.includes("restored"));
	assert.ok(row?.includes(UNICODE.taskInProgress), `restored task renders static after reset: ${row}`);
	assert.ok(!hasSpinnerFrame(row), `restored task does not spin after reset: ${row}`);

	widget.addTokenUsage(10, 20);
	const after = widget.render(100);
	const row2 = after.find((l) => l.includes("restored"));
	assert.ok(!row2?.includes("↑") && !row2?.includes("↓"), `re-baselined task accrues no tokens: ${row2}`);

	widget.dispose();
});

test("TwoColumnWidget: active-row rendering is deterministic under an injected clock and icon set", () => {
	const fleet = fakeFleet([]);
	const store = mutableState([
		makeTask({ id: 1, subject: "x", status: "pending", activeForm: "doing x" }),
	]);
	const widget = new TwoColumnWidget(fleet, fakeTui().tui, identityTheme(), store.read, UNICODE_ICONS, () => 12345);

	store.set([makeTask({ id: 1, subject: "x", status: "in_progress", activeForm: "doing x" })]);
	widget.onTodoToolEnd();

	const first = widget.render(100);
	const second = widget.render(100);
	assert.deepEqual(first, second, "same injected clock + icon set yields identical output");

	widget.dispose();
});

test("TwoColumnWidget: addTokenUsage is a no-op when no task is in_progress", () => {
	const fleet = fakeFleet([]);
	const state = makeState([makeTask({ id: 1, subject: "idle", status: "pending" })]);
	const widget = new TwoColumnWidget(fleet, fakeTui().tui, identityTheme(), () => state, UNICODE_ICONS, () => 8000);

	widget.render(100);
	widget.addTokenUsage(100, 200);
	const out = widget.render(100);

	assert.ok(!out.some((l) => l.includes("↑") || l.includes("↓")), "no token stats appear without an active task");
	widget.dispose();
});

const RIGHT_ARROW = "\x1b[C";
const LEFT_ARROW = "\x1b[D";

test("routeTwoColumnInput: right arrow at an empty prompt with no overlay and todos present opens the overlay", () => {
	let opened = 0;
	let fellThrough = 0;
	const result = routeTwoColumnInput(
		RIGHT_ARROW,
		true,
		false,
		true,
		() => { opened += 1; },
		() => { fellThrough += 1; return undefined; },
	);

	assert.equal(opened, 1, "the overlay open path runs");
	assert.equal(fellThrough, 0, "the key never reaches the fleet");
	assert.deepEqual(result, { consume: true }, "the right arrow is consumed");
});

test("routeTwoColumnInput: right arrow with no todos does not open an empty overlay", () => {
	let opened = 0;
	let fellThrough = 0;
	const result = routeTwoColumnInput(
		RIGHT_ARROW,
		true,
		false,
		false,
		() => { opened += 1; },
		() => { fellThrough += 1; return undefined; },
	);

	assert.equal(opened, 0, "an empty todos modal must not open");
	assert.equal(fellThrough, 1, "the key falls through to the fleet");
});

test("routeTwoColumnInput: right arrow with a non-empty editor falls through to the fleet", () => {
	let opened = 0;
	let fellThrough = 0;
	const result = routeTwoColumnInput(
		RIGHT_ARROW,
		false,
		false,
		true,
		() => { opened += 1; },
		() => { fellThrough += 1; return { consume: true }; },
	);

	assert.equal(opened, 0, "typing must not open the overlay");
	assert.equal(fellThrough, 1, "the key flows to the fleet handler");
	assert.deepEqual(result, { consume: true });
});

test("routeTwoColumnInput: right arrow while an overlay is open does not open the todos overlay", () => {
	let opened = 0;
	routeTwoColumnInput(
		RIGHT_ARROW,
		true,
		true,
		true,
		() => { opened += 1; },
		() => undefined,
	);

	assert.equal(opened, 0, "an already-open overlay must not be displaced");
});

test("routeTwoColumnInput: a non-right key always falls through to the fleet", () => {
	let opened = 0;
	let fellThrough = 0;
	routeTwoColumnInput(
		LEFT_ARROW,
		true,
		false,
		true,
		() => { opened += 1; },
		() => { fellThrough += 1; return { consume: true }; },
	);

	assert.equal(opened, 0, "the left arrow is the fleet's key, not the todos key");
	assert.equal(fellThrough, 1, "the fleet still handles the left arrow");
});
