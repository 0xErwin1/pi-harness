import {
	type Component,
	matchesKey,
	truncateToWidth,
	type TUI,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getState } from "../todo/store.ts";
import type { TaskState } from "../todo/state.ts";
import type { Task } from "../todo/types.ts";
import { selectTasksByStatus } from "../todo/selectors.ts";
import { getIcons } from "../icons/config.ts";
import type { IconSet } from "../icons/types.ts";
import { applyScroll, type ScrollAction } from "./conversation-viewer.ts";

/**
 * Tracks how many full-todos overlays are open. Mirrors the conversation
 * viewer's counter: the combined widget's global `onTerminalInput` listener runs
 * BEFORE the focused overlay receives a key, so it must stay inert while the
 * overlay is up — otherwise it would consume keys (Esc to close, arrows to
 * scroll, the right arrow that would re-open it) before the overlay can act.
 */
let openOverlayCount = 0;

export function isTodosOverlayOpen(): boolean {
	return openOverlayCount > 0;
}

/**
 * Whether a raw key should open the full-todos overlay. Gated identically to the
 * fleet's `←` navigation: it acts ONLY on the right arrow, only at an empty
 * editor, and only when no overlay is already open — so it never swallows normal
 * typing and never fires while a conversation viewer or this overlay is up.
 */
export function shouldOpenTodosOverlay(data: string, editorEmpty: boolean, overlayOpen: boolean): boolean {
	return editorEmpty && !overlayOpen && matchesKey(data, "right");
}

/** Lines consumed by the bordered chrome: top, header, header separator, footer separator, footer, bottom. */
const CHROME_LINES = 6;
const MIN_VIEWPORT = 3;
const VIEWPORT_HEIGHT_PCT = 80;

const INDENT = "  ";

function classifyScrollKey(data: string): ScrollAction | undefined {
	if (matchesKey(data, "up") || matchesKey(data, "k")) return "up";
	if (matchesKey(data, "down") || matchesKey(data, "j")) return "down";
	if (matchesKey(data, "pageUp") || matchesKey(data, "shift+up")) return "pageUp";
	if (matchesKey(data, "pageDown") || matchesKey(data, "shift+down")) return "pageDown";
	if (matchesKey(data, "home")) return "home";
	if (matchesKey(data, "end") || matchesKey(data, "shift+g") || matchesKey(data, "g")) return "end";
	return undefined;
}

/**
 * Trailing `blocked by` annotation for a pending task. Only blockers that still
 * exist and are not themselves completed are listed, so a dependency that is
 * already done stops cluttering the row. Mirrors the inline todo column.
 */
function blockedSuffix(task: Task, byId: Map<number, Task>, icons: IconSet, theme: Theme): string {
	if (task.status !== "pending" || !task.blockedBy || task.blockedBy.length === 0) return "";

	const open = task.blockedBy.filter((id) => {
		const blocker = byId.get(id);
		return blocker !== undefined && blocker.status !== "completed";
	});
	if (open.length === 0) return "";

	const refs = open.map((id) => `#${id}`).join(", ");
	return ` ${theme.fg("dim", `${icons.chevron} blocked by ${refs}`)}`;
}

/**
 * Renders one task row for the full list. Completed rows are dimmed and struck
 * through; an in-progress row carries its id, subject and activeForm; a pending
 * row carries its id, subject and the optional `blocked by` annotation. All
 * glyphs come from the injected icon set.
 */
function renderRow(task: Task, byId: Map<number, Task>, icons: IconSet, theme: Theme, width: number): string {
	if (task.status === "completed") {
		const icon = theme.fg("success", icons.taskCompleted);
		const subject = theme.strikethrough(theme.fg("dim", task.subject));
		return truncateToWidth(`${INDENT}${icon} ${subject}`, width);
	}

	if (task.status === "in_progress") {
		const icon = theme.fg("accent", icons.taskInProgress);
		const id = theme.fg("dim", `#${task.id}`);
		const subject = theme.fg("accent", task.subject);
		const form = task.activeForm ? ` ${theme.fg("accent", `(${task.activeForm})`)}` : "";
		return truncateToWidth(`${INDENT}${icon} ${id} ${subject}${form}`, width);
	}

	const id = theme.fg("dim", `#${task.id}`);
	const suffix = blockedSuffix(task, byId, icons, theme);
	return truncateToWidth(`${INDENT}${icons.taskPending} ${id} ${task.subject}${suffix}`, width);
}

/**
 * Pure renderer for the full todo list shown in the scrollable overlay. Lists
 * every visible task grouped under `In progress`, `Pending` and `Completed`
 * section headers (empty sections are omitted), with NO overflow truncation —
 * the overlay scrolls instead. Deterministic: it reads no clock and resolves no
 * icons itself, and returns `[]` when there is nothing to show.
 */
export function renderAllTodos(state: TaskState, width: number, icons: IconSet, theme: Theme): string[] {
	const grouped = selectTasksByStatus(state);
	const byId = new Map<number, Task>(state.tasks.map((task) => [task.id, task]));

	const lines: string[] = [];

	const section = (label: string, tasks: Task[]): void => {
		if (tasks.length === 0) return;

		lines.push(truncateToWidth(theme.fg("dim", `${label} (${tasks.length})`), width));
		for (const task of tasks) {
			lines.push(renderRow(task, byId, icons, theme, width));
		}
	};

	section("In progress", grouped.inProgress);
	section("Pending", grouped.pending);
	section("Completed", grouped.completed);

	return lines;
}

/**
 * Scrollable overlay listing ALL todos grouped by status. Built on the same
 * `ctx.ui.custom({ overlay })` lifecycle the conversation viewer uses and the
 * same `applyScroll` reducer, so PgUp/PgDn/arrow scrolling and Esc-to-close
 * behave identically. The list is static (the overlay reads task state once per
 * render), so there is no runtime subscription to tear down.
 */
export class TodosOverlay implements Component {
	private scrollOffset = 0;
	private lastMaxScroll = 0;
	private lastViewportHeight = MIN_VIEWPORT;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly done: (result: void) => void,
		private readonly readState: () => TaskState = getState,
		private readonly resolveIcons: () => IconSet = getIcons,
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q")) {
			this.done(undefined);
			return;
		}

		const action = classifyScrollKey(data);
		if (!action) return;

		const next = applyScroll(
			action,
			{ scrollOffset: this.scrollOffset, autoScroll: false },
			this.lastMaxScroll,
			this.lastViewportHeight,
		);
		this.scrollOffset = next.scrollOffset;
		this.tui.requestRender();
	}

	render(width: number): string[] {
		if (width < 6) return [];

		const th = this.theme;
		const innerW = width - 4;
		const viewportHeight = this.viewportHeight();
		this.lastViewportHeight = viewportHeight;

		const body = renderAllTodos(this.readState(), innerW, this.resolveIcons(), th);
		const maxScroll = Math.max(0, body.length - viewportHeight);
		this.lastMaxScroll = maxScroll;
		if (this.scrollOffset > maxScroll) this.scrollOffset = maxScroll;

		const pad = (text: string) => text + " ".repeat(Math.max(0, innerW - visibleWidth(text)));
		const row = (content: string) =>
			`${th.fg("border", "│")} ${truncateToWidth(pad(content), innerW)} ${th.fg("border", "│")}`;
		const top = th.fg("border", `╭${"─".repeat(width - 2)}╮`);
		const bottom = th.fg("border", `╰${"─".repeat(width - 2)}╯`);
		const separator = row(th.fg("dim", "─".repeat(innerW)));

		const lines: string[] = [];
		lines.push(top);
		lines.push(row(th.bold("All todos")));
		lines.push(separator);

		for (let i = 0; i < viewportHeight; i++) {
			lines.push(row(body[this.scrollOffset + i] ?? ""));
		}

		lines.push(separator);
		lines.push(row(this.renderFooter(maxScroll, innerW)));
		lines.push(bottom);

		return lines;
	}

	invalidate(): void {}

	private renderFooter(maxScroll: number, innerW: number): string {
		const th = this.theme;
		const hint = th.fg("dim", "up/down/jk · PgUp/PgDn · Esc close");
		const pos = maxScroll > 0 ? th.fg("dim", `${this.scrollOffset}/${maxScroll}`) : "";

		const gap = Math.max(1, innerW - visibleWidth(pos) - visibleWidth(hint));
		return pos + " ".repeat(gap) + hint;
	}

	private viewportHeight(): number {
		const rows = this.tui.terminal.rows;
		const maxRows = Math.floor((rows * VIEWPORT_HEIGHT_PCT) / 100);
		return Math.max(MIN_VIEWPORT, maxRows - CHROME_LINES);
	}
}

/**
 * Opens the full-todos overlay as a focused overlay and resolves when it closes.
 * Mirrors `showConversationViewer`: the open count is tracked so the combined
 * widget's input listener stays inert while the overlay is up.
 */
export function showTodosOverlay(ctx: ExtensionContext): Promise<void> {
	openOverlayCount += 1;
	const closed = ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => new TodosOverlay(tui, theme, done),
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "80%",
				maxHeight: "80%",
			},
		},
	);
	return closed.finally(() => {
		openOverlayCount = Math.max(0, openOverlayCount - 1);
	});
}
