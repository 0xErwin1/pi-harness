import { type Component, matchesKey, truncateToWidth, type TUI } from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	FleetList,
	openFleetTarget,
} from "./fleet-list.ts";
import type { ViewerRuntime } from "./conversation-viewer.ts";
import {
	shouldOpenTodosOverlay,
	showTodosOverlay,
} from "./todos-overlay.ts";
import { anyOverlayOpen } from "../../shared/overlay-gate.ts";
import { getState } from "../todo/store.ts";
import { selectVisibleTasks } from "../todo/selectors.ts";
import type { TaskState } from "../todo/state.ts";
import { getIcons } from "../icons/config.ts";
import type { IconSet } from "../icons/types.ts";
import { renderTodoColumn, type TaskMetric } from "./todo-column.ts";

const WIDGET_KEY = "subagents";

/** Below this terminal width the two columns stack vertically instead. */
const MIN_TWO_COLUMN_WIDTH = 80;

/** Fraction of the width given to the left (Agents) column in two-column mode. */
const LEFT_RATIO = 0.55;

const SEPARATOR = "│";

/** Render heartbeat while any task is active, so the spinner and elapsed time advance. */
const RENDER_TICK_MS = 150;

/**
 * The slice of the fleet widget the two-column container depends on: it renders
 * the left column, owns navigation key handling, and tears down its own timers.
 * `FleetList` satisfies this; tests substitute a lightweight double.
 */
export interface TwoColumnFleet extends Component {
	handleKey(data: string, editorEmpty: boolean, overlayOpen?: boolean): { consume?: boolean } | undefined;
	dispose(): void;
}

/**
 * Combines the Agents fleet (left) and the Todos list (right) into a single
 * above-editor widget. The fleet is reused unchanged and keeps full ownership of
 * navigation; this container only lays the two columns out, reads todo state at
 * render time, and tracks which completed tasks are hidden between turns.
 *
 * Layout: side by side with a fixed separator column when the terminal is at
 * least `MIN_TWO_COLUMN_WIDTH`, otherwise stacked with a divider. Whenever the
 * Todos column is present the Agents column is ALWAYS reserved — rendered with a
 * dim idle placeholder when no subagent is running — so the Todos column keeps
 * the exact same position whether or not an agent is active and never shifts
 * sideways when one starts. The fleet alone (no todos) still renders at full
 * width, and an empty pair self-hides.
 */
export class TwoColumnWidget implements Component {
	private readonly completedPendingHide = new Set<number>();
	private readonly hiddenCompleted = new Set<number>();
	private readonly metrics = new Map<number, TaskMetric>();
	private readonly knownInProgress = new Set<number>();
	private baselined = false;
	private renderTimer: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly fleet: TwoColumnFleet,
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly readState: () => TaskState = getState,
		private readonly resolveIcons: () => IconSet = getIcons,
		private readonly clock: () => number = Date.now,
	) {}

	render(width: number): string[] {
		const state = this.readState();
		this.ensureBaseline(state);
		this.syncTimer();

		if (width >= MIN_TWO_COLUMN_WIDTH) {
			return this.renderSideBySide(state, width);
		}

		return this.renderStacked(state, width);
	}

	/** Renders the Todos column with live icons, metrics and clock injected. */
	private renderTodos(state: TaskState, width: number): string[] {
		return renderTodoColumn(state, width, this.theme, {
			hiddenIds: this.hiddenCompleted,
			icons: this.resolveIcons(),
			metrics: this.metrics,
			now: this.clock(),
		});
	}

	/**
	 * Captures the in-progress task set present at the first render as the session
	 * baseline, creating NO metrics. Tasks already in_progress at this point were
	 * restored by branch replay (`replayFromBranch` on session_start), not started
	 * this session, so they must render as static work — no spinner, elapsed or
	 * tokens. Only a later `todo`-tool transition into in_progress (see
	 * `onTodoToolEnd`) promotes a task to active. Without this baseline, a leftover
	 * in_progress task would look like it is running right now.
	 */
	private ensureBaseline(state: TaskState): void {
		if (this.baselined) return;

		for (const task of selectVisibleTasks(state)) {
			if (task.status === "in_progress") this.knownInProgress.add(task.id);
		}

		this.baselined = true;
	}

	/**
	 * Starts a render heartbeat while at least one task is active — i.e. has a
	 * metrics entry — so its spinner animates and the elapsed counter advances
	 * between store events, and stops it as soon as no active work remains. Gating
	 * on `metrics.size` rather than on raw in_progress status is what keeps a
	 * replayed/idle in_progress task (which has no metrics) from spinning the
	 * heartbeat. Mirrors `FleetList.syncTimer`.
	 */
	private syncTimer(): void {
		const active = this.metrics.size > 0;

		if (active && this.renderTimer === undefined) {
			this.renderTimer = setInterval(() => {
				this.tui.requestRender();
				this.syncTimer();
			}, RENDER_TICK_MS);
			this.renderTimer.unref?.();
		} else if (!active && this.renderTimer !== undefined) {
			clearInterval(this.renderTimer);
			this.renderTimer = undefined;
		}
	}

	/**
	 * Attributes a turn's token usage to the currently active tasks. The metrics
	 * map only ever holds entries for tasks activated this session (see
	 * `onTodoToolEnd`), so the usage is distributed across exactly the tasks the
	 * user sees spinning — never a replayed/idle in_progress task.
	 */
	addTokenUsage(inputTokens: number, outputTokens: number): void {
		for (const metric of this.metrics.values()) {
			metric.inputTokens += inputTokens;
			metric.outputTokens += outputTokens;
		}
	}

	/**
	 * Single dim placeholder used as the Agents column when no subagent is
	 * running. Reserving this one line keeps the Todos column anchored in the same
	 * place whether or not an agent is active, so a starting agent never displaces
	 * the todos sideways.
	 */
	private idleAgentsLine(): string {
		return this.theme.fg("dim", "Agents");
	}

	/**
	 * Side-by-side layout. Each composited line pads the left column to exactly
	 * `leftWidth` (ANSI-aware, via `truncateToWidth(..., pad)`) so the separator
	 * sits at the same visible column on every row regardless of content length
	 * or color codes. When the Todos column is present the Agents column is always
	 * reserved (the idle placeholder substitutes for an empty fleet) so the todos
	 * never shift; the fleet alone renders at full width with no separator, and an
	 * empty pair self-hides.
	 */
	private renderSideBySide(state: TaskState, width: number): string[] {
		const leftWidth = Math.floor(width * LEFT_RATIO);
		const rightWidth = width - leftWidth - 1;

		const fleetLines = this.fleet.render(leftWidth);
		const rightLines = this.renderTodos(state, rightWidth);

		if (rightLines.length === 0) {
			return fleetLines.length === 0 ? [] : this.fleet.render(width);
		}

		const leftLines = fleetLines.length > 0 ? fleetLines : [this.idleAgentsLine()];
		const maxLines = Math.max(leftLines.length, rightLines.length);
		const out: string[] = [];

		for (let i = 0; i < maxLines; i++) {
			const left = truncateToWidth(leftLines[i] ?? "", leftWidth, "", true);
			const right = rightLines[i] ?? "";
			out.push(`${left}${SEPARATOR}${right}`);
		}

		return out;
	}

	/**
	 * Vertical fallback for narrow terminals. When the Todos column is present the
	 * Agents section is always reserved above the divider (the idle placeholder
	 * substitutes for an empty fleet) so the todos keep their position; the fleet
	 * alone renders without a divider, and an empty pair self-hides.
	 */
	private renderStacked(state: TaskState, width: number): string[] {
		const fleetLines = this.fleet.render(width);
		const todoLines = this.renderTodos(state, width);

		if (todoLines.length === 0) return fleetLines;

		const agentsSection = fleetLines.length > 0 ? fleetLines : [this.idleAgentsLine()];
		const divider = this.theme.fg("dim", "─".repeat(width));
		return [...agentsSection, divider, ...todoLines];
	}

	handleKey(data: string, editorEmpty: boolean, overlayOpen = false): { consume?: boolean } | undefined {
		return this.fleet.handleKey(data, editorEmpty, overlayOpen);
	}

	/**
	 * Turn boundary driven by the `todo` tool. Two responsibilities:
	 *
	 * 1. Reconcile the active-metrics set with the live task state. A task that is
	 *    in_progress now but was NOT in the session baseline just transitioned this
	 *    session, so it becomes active (its timer starts now). A task that left
	 *    in_progress drops its metrics. This is the ONLY path that creates metrics,
	 *    which is why a task in_progress purely because branch replay restored it
	 *    (captured by `ensureBaseline`, never re-activated) never gains a spinner.
	 * 2. Mark tasks that completed this turn as pending-hide, so the user sees what
	 *    finished before it is tucked away on the next `agent_start`.
	 */
	onTodoToolEnd(): void {
		const state = this.readState();
		this.ensureBaseline(state);

		const current = new Set<number>();
		for (const task of selectVisibleTasks(state)) {
			if (task.status === "in_progress") current.add(task.id);
		}

		for (const id of current) {
			if (!this.knownInProgress.has(id)) {
				this.metrics.set(id, { startedAt: this.clock(), inputTokens: 0, outputTokens: 0 });
			}
		}

		for (const id of [...this.metrics.keys()]) {
			if (!current.has(id)) this.metrics.delete(id);
		}

		this.knownInProgress.clear();
		for (const id of current) this.knownInProgress.add(id);

		for (const task of selectVisibleTasks(state)) {
			if (task.status === "completed" && !this.hiddenCompleted.has(task.id)) {
				this.completedPendingHide.add(task.id);
			}
		}
	}

	/** Turn boundary: hides everything that completed during the previous turn. */
	onAgentStart(): void {
		if (this.completedPendingHide.size === 0) return;

		for (const id of this.completedPendingHide) this.hiddenCompleted.add(id);
		this.completedPendingHide.clear();
		this.tui.requestRender();
	}

	/**
	 * Session boundary (start / compact / tree): every task becomes visible again
	 * and the active-metrics tracking resets. Clearing the baseline means the next
	 * render re-captures whatever is in_progress in the new/compacted session as
	 * static baseline work — nothing is treated as active until a `todo`-tool
	 * transition occurs in this session.
	 */
	onSessionReset(): void {
		this.completedPendingHide.clear();
		this.hiddenCompleted.clear();
		this.metrics.clear();
		this.knownInProgress.clear();
		this.baselined = false;
		this.tui.requestRender();
	}

	invalidate(): void {
		this.fleet.invalidate();
	}

	dispose(): void {
		if (this.renderTimer !== undefined) {
			clearInterval(this.renderTimer);
			this.renderTimer = undefined;
		}
		this.fleet.dispose();
	}
}

/**
 * Handle the harness uses to forward turn/session lifecycle events into the
 * widget's hide-between-turns state. The widget is created lazily by the TUI, so
 * each method is a no-op until the widget exists.
 */
export interface TwoColumnWidgetHandle {
	onTodoToolEnd(): void;
	onAgentStart(): void;
	onSessionReset(): void;
	addTokenUsage(inputTokens: number, outputTokens: number): void;
}

/**
 * Routes a raw terminal key for the combined widget. The right arrow at an empty
 * prompt, with no overlay open and at least one todo to show, opens the full-todos
 * overlay and consumes the key (symmetric to the fleet's `←` for managing Agents);
 * every other key falls through to the fleet's own navigation handling unchanged,
 * so normal typing and `←`/`↑`/`↓` navigation are never affected. Kept pure (the
 * open and fallback actions are injected) so the gating is unit-testable without a
 * TUI.
 */
export function routeTwoColumnInput(
	data: string,
	editorEmpty: boolean,
	overlayOpen: boolean,
	hasTodos: boolean,
	openTodos: () => void,
	fallback: () => { consume?: boolean } | undefined,
): { consume?: boolean } | undefined {
	if (shouldOpenTodosOverlay(data, editorEmpty, overlayOpen, hasTodos)) {
		openTodos();
		return { consume: true };
	}

	return fallback();
}

/**
 * Registers the combined Agents + Todos widget above the prompt under the same
 * key the fleet widget used, replacing `registerFleetWidget`. The right arrow at
 * an empty prompt opens the full-todos overlay; all other arrow-key navigation
 * is delegated to the embedded fleet (gated on an empty editor and no open
 * overlay), and the running count is mirrored to the status bar. Should be
 * registered once per cwd on `session_start`.
 *
 * Returns a handle the harness wires to `tool_execution_end`, `agent_start`, and
 * the session-reset events for the hide-completed-between-turns behavior.
 */
export function registerTwoColumnWidget(ctx: ExtensionContext, runtime: ViewerRuntime): TwoColumnWidgetHandle {
	let widget: TwoColumnWidget | undefined;

	const reportRunning = (running: number) => {
		ctx.ui.setStatus(WIDGET_KEY, running > 0 ? `${running} running` : undefined);
	};

	ctx.ui.setWidget(
		WIDGET_KEY,
		(tui, theme) => {
			const fleet = new FleetList(
				tui,
				theme,
				runtime,
				(target) => openFleetTarget(ctx, runtime, target),
				reportRunning,
			);
			widget = new TwoColumnWidget(fleet, tui, theme);
			return widget;
		},
		{ placement: "aboveEditor" },
	);

	ctx.ui.onTerminalInput((data) => {
		const activeWidget = widget;
		if (!activeWidget) return undefined;

		const editorEmpty = ctx.ui.getEditorText() === "";
		const overlayOpen = anyOverlayOpen();
		const hasTodos = getState().tasks.length > 0;

		return routeTwoColumnInput(
			data,
			editorEmpty,
			overlayOpen,
			hasTodos,
			() => {
				void showTodosOverlay(ctx);
			},
			() => activeWidget.handleKey(data, editorEmpty, overlayOpen),
		);
	});

	return {
		onTodoToolEnd: () => widget?.onTodoToolEnd(),
		onAgentStart: () => widget?.onAgentStart(),
		onSessionReset: () => widget?.onSessionReset(),
		addTokenUsage: (inputTokens, outputTokens) => widget?.addTokenUsage(inputTokens, outputTokens),
	};
}
