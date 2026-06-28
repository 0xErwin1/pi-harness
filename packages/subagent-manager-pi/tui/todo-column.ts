import { truncateToWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TaskState } from "../todo/state.ts";
import type { Task } from "../todo/types.ts";
import type { IconSet } from "../icons/types.ts";
import { selectHasActive, selectOverlayLayout, selectTodoCounts, selectVisibleTasks } from "../todo/selectors.ts";

/**
 * Body-row budget for the inline todo column: at most this many lines below the
 * header, with the last slot reserved for the `… and N more` overflow summary
 * when tasks do not fit (so an overflowing list shows this count minus one task
 * rows plus the summary). Kept small on purpose so the inline list stays compact;
 * the full list is available in the scrollable todos overlay.
 */
export const DEFAULT_TODO_BODY_ROWS = 5;

/** Spinner frame cadence in milliseconds; the active frame advances once per this slice of elapsed time. */
const SPIN_MS = 150;

type ThemeColor = Parameters<Theme["fg"]>[0];

/**
 * Per-task runtime metrics: when the task became active and the tokens
 * attributed to it while active. Supplied by the stateful widget so the pure
 * renderer never reads a clock or token source itself.
 */
export interface TaskMetric {
	startedAt: number;
	inputTokens: number;
	outputTokens: number;
}

/**
 * Injected dependencies for the pure renderer. Icons, live metrics and the
 * current time are all passed in so the function stays deterministic and
 * testable — it calls neither `getIcons()` nor `Date.now()` internally.
 */
export interface RenderTodoColumnOptions {
	hiddenIds: Set<number>;
	icons: IconSet;
	metrics: Map<number, TaskMetric>;
	now: number;
}

/** Human-readable duration (e.g. `8s`, `2m 49s`, `1h 3m`). */
function formatDuration(ms: number): string {
	const totalSec = Math.floor(Math.max(0, ms) / 1000);
	if (totalSec < 60) return `${totalSec}s`;

	const min = Math.floor(totalSec / 60);
	const sec = totalSec % 60;
	if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`;

	const hr = Math.floor(min / 60);
	const remMin = min % 60;
	return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
}

/** Token count with a `k` suffix once it reaches a thousand (e.g. `40`, `1.8k`). */
function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

/**
 * Header line: `<icon> N tasks (X done, Y in progress, Z open)`. The icon and
 * color reflect whether any work is active; the parenthetical lists only the
 * non-zero status groups, so an idle list collapses to e.g. `(3 done)`.
 */
function renderHeader(state: TaskState, icons: IconSet, theme: Theme, width: number): string {
	const counts = selectTodoCounts(state);
	const active = selectHasActive(state);

	const parts: string[] = [];
	if (counts.completed > 0) parts.push(`${counts.completed} done`);
	if (counts.inProgress > 0) parts.push(`${counts.inProgress} in progress`);
	if (counts.pending > 0) parts.push(`${counts.pending} open`);

	const breakdown = parts.length > 0 ? ` (${parts.join(", ")})` : "";
	const icon = active ? icons.headerActive : icons.headerIdle;
	const color: ThemeColor = active ? "accent" : "dim";

	return truncateToWidth(theme.fg(color, `${icon} ${counts.total} tasks${breakdown}`), width);
}

/**
 * Trailing `blocked by` annotation for a pending task. Only blockers that still
 * exist and are not themselves completed are listed, so a dependency that is
 * already done stops cluttering the row.
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
 * The dim stats tail for an active task: ` (<elapsed>[ · <up> <in>][ · <down> <out>])`.
 * An arrow is shown only when that token count is positive, so a freshly started
 * task reads as just ` (8s)`.
 */
function activeStats(metric: TaskMetric, icons: IconSet, theme: Theme, now: number): string {
	const elapsed = formatDuration(now - metric.startedAt);

	const tokenParts: string[] = [];
	if (metric.inputTokens > 0) tokenParts.push(`${icons.arrowUp} ${formatTokens(metric.inputTokens)}`);
	if (metric.outputTokens > 0) tokenParts.push(`${icons.arrowDown} ${formatTokens(metric.outputTokens)}`);

	const inner = tokenParts.length > 0 ? `${elapsed} · ${tokenParts.join(" ")}` : elapsed;
	return ` ${theme.fg("dim", `(${inner})`)}`;
}

/**
 * Renders one task row at a 2-space indent. Completed rows are dimmed and struck
 * through; an in-progress task with a metrics entry animates a spinner with its
 * id, active form and live stats; an in-progress task without metrics yet falls
 * back to the static in-progress icon; pending rows carry the optional
 * `blocked by` annotation. No tree connectors are drawn.
 */
function renderTaskRow(
	task: Task,
	opts: RenderTodoColumnOptions,
	byId: Map<number, Task>,
	theme: Theme,
	width: number,
): string {
	const { icons, metrics, now } = opts;
	const indent = "  ";

	if (task.status === "completed") {
		const icon = theme.fg("success", icons.taskCompleted);
		const subject = theme.strikethrough(theme.fg("dim", task.subject));
		return truncateToWidth(`${indent}${icon} ${subject}`, width);
	}

	if (task.status === "in_progress") {
		const metric = metrics.get(task.id);
		if (metric) {
			const elapsed = Math.max(0, now - metric.startedAt);
			const frame = icons.spinner[Math.floor(elapsed / SPIN_MS) % icons.spinner.length];
			const spinner = theme.fg("accent", frame);
			const id = theme.fg("dim", `#${task.id}`);
			const form = theme.fg("accent", `${task.activeForm ?? task.subject}…`);
			const stats = activeStats(metric, icons, theme, now);
			return truncateToWidth(`${indent}${spinner} ${id} ${form}${stats}`, width);
		}

		const icon = theme.fg("accent", icons.taskInProgress);
		const subject = theme.fg("accent", task.subject);
		const form = task.activeForm ? ` ${theme.fg("accent", `(${task.activeForm})`)}` : "";
		return truncateToWidth(`${indent}${icon} ${subject}${form}`, width);
	}

	const suffix = blockedSuffix(task, byId, icons, theme);
	return truncateToWidth(`${indent}${icons.taskPending} ${task.subject}${suffix}`, width);
}

/**
 * Pure renderer for the Todos column in the tintinweb/pi-tasks style. Returns a
 * header line plus one row per visible task (deleted tasks and `opts.hiddenIds`
 * are excluded), capped at `DEFAULT_TODO_BODY_ROWS` body lines with a trailing
 * overflow summary when tasks do not fit. Completed tasks are dropped first so active work stays
 * visible. All glyphs come from `opts.icons`; timing comes from `opts.now` and
 * `opts.metrics`. The function never mutates state, reads no clock and resolves
 * no icons itself, and self-hides (returns `[]`) when nothing is visible.
 */
export function renderTodoColumn(
	state: TaskState,
	width: number,
	theme: Theme,
	opts: RenderTodoColumnOptions,
): string[] {
	const filtered: TaskState = {
		tasks: state.tasks.filter((task) => !opts.hiddenIds.has(task.id)),
		nextId: state.nextId,
	};

	if (selectVisibleTasks(filtered).length === 0) return [];

	const byId = new Map<number, Task>(state.tasks.map((task) => [task.id, task]));

	const lines: string[] = [renderHeader(filtered, opts.icons, theme, width)];

	const layout = selectOverlayLayout(filtered, DEFAULT_TODO_BODY_ROWS);
	for (const task of layout.tasks) {
		lines.push(renderTaskRow(task, opts, byId, theme, width));
	}

	if (layout.overflowCount > 0) {
		const summary = `    ${opts.icons.ellipsis} and ${layout.overflowCount} more`;
		lines.push(truncateToWidth(theme.fg("dim", summary), width));
	}

	return lines;
}
