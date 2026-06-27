import {
	type Component,
	matchesKey,
	type TUI,
	truncateToWidth,
} from "@mariozechner/pi-tui";
import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import type { RunSnapshot, RunStatus } from "../../subagent-manager-core/events.ts";
import type { RunStoreListener } from "../../subagent-manager-core/store.ts";
import {
	buildFleetModel,
	fleetActivityFromEvent,
	isActiveFleetStatus,
	selectFleetRoster,
	type FleetRow,
} from "./fleet-model.ts";
import { isConversationViewerOpen, showConversationViewer, type ViewerRuntime } from "./conversation-viewer.ts";

/** Live accessor surface the fleet widget needs from the manager runtime. */
export interface FleetRuntime {
	subscribe(listener: RunStoreListener): () => void;
}

const WIDGET_KEY = "subagents";
const MAX_ROWS = 5;

export type FleetKey = "up" | "down" | "left" | "enter" | "escape";

export interface FleetNavResult {
	selectedIndex: number;
	consume: boolean;
	open: number | null;
}

/**
 * Pure navigation reducer for the fleet list. `selectedIndex === -1` means the
 * list is inactive (arrow keys flow to the editor); a `down` — or a `left` at the
 * inactive prompt — activates it. Only keys that actually act on the list report
 * `consume`, so normal editor input — including history navigation with `up` at an
 * inactive prompt, and `left` once the list is already active — is never swallowed.
 */
export function reduceFleetNav(
	key: FleetKey,
	selectedIndex: number,
	rowCount: number,
): FleetNavResult {
	if (rowCount <= 0) return { selectedIndex: -1, consume: false, open: null };

	switch (key) {
		case "down": {
			const next = selectedIndex < 0 ? 0 : Math.min(rowCount - 1, selectedIndex + 1);
			return { selectedIndex: next, consume: true, open: null };
		}
		case "left": {
			if (selectedIndex < 0) return { selectedIndex: 0, consume: true, open: null };
			return { selectedIndex, consume: false, open: null };
		}
		case "up": {
			if (selectedIndex < 0) return { selectedIndex: -1, consume: false, open: null };
			if (selectedIndex === 0) return { selectedIndex: -1, consume: true, open: null };
			return { selectedIndex: selectedIndex - 1, consume: true, open: null };
		}
		case "enter": {
			if (selectedIndex < 0) return { selectedIndex, consume: false, open: null };
			return { selectedIndex, consume: true, open: selectedIndex };
		}
		case "escape": {
			if (selectedIndex < 0) return { selectedIndex: -1, consume: false, open: null };
			return { selectedIndex: -1, consume: true, open: null };
		}
	}
}

/**
 * Decides whether the fleet's global terminal-input listener should act on a key.
 * It must stay inert while a conversation overlay is open — the overlay is the
 * focused component and should receive keys (Esc to close, arrows to scroll)
 * without the listener consuming them first — and only ever act at an empty
 * prompt so normal typing is never swallowed.
 */
export function shouldFleetHandleKey(editorEmpty: boolean, overlayOpen: boolean): boolean {
	return editorEmpty && !overlayOpen;
}

function classifyFleetKey(data: string): FleetKey | undefined {
	if (matchesKey(data, "down")) return "down";
	if (matchesKey(data, "up")) return "up";
	if (matchesKey(data, "left")) return "left";
	if (matchesKey(data, "return")) return "enter";
	if (matchesKey(data, "escape")) return "escape";
	return undefined;
}

/**
 * Resolves the roster index to restore after a conversation viewer closes:
 * the still-present row for the run that was being viewed, or `-1` (inactive)
 * when that run has dropped off the roster.
 */
export function resolveRestoreIndex(rosterIds: string[], runId: string): number {
	return rosterIds.indexOf(runId);
}

function formatElapsed(ms: number): string {
	return `${Math.max(0, Math.round(ms / 1000))}s`;
}

function statusColor(status: RunStatus): Parameters<Theme["fg"]>[0] {
	switch (status) {
		case "running":
			return "accent";
		case "completed":
			return "success";
		case "failed":
			return "error";
		case "interrupted":
		case "needs-attention":
			return "warning";
		default:
			return "dim";
	}
}

const SPINNER_FRAMES = ["-", "\\", "|", "/"];
const SPINNER_INTERVAL_MS = 120;

/**
 * ASCII running indicator. Cycles through `-\|/` by a frame derived from elapsed
 * time for running agents and shows a static `!` for runs awaiting attention. No
 * braille or pictographs (hard project constraint).
 */
function spinnerFrame(status: RunStatus, elapsedMs: number): string {
	if (status === "needs-attention") return "!";
	const frame = Math.floor(Math.max(0, elapsedMs) / SPINNER_INTERVAL_MS) % SPINNER_FRAMES.length;
	return SPINNER_FRAMES[frame];
}

/**
 * Plain-text marker shown in place of the spinner while a finished run lingers
 * in the roster, so the user sees the outcome (no spinner, no pictograph).
 */
function terminalMarker(status: RunStatus): string {
	switch (status) {
		case "completed":
			return "done";
		case "failed":
			return "failed";
		case "interrupted":
			return "interrupted";
		default:
			return "";
	}
}

/**
 * Above-prompt "Agents" group rendering the live set of active subagent runs as
 * a tree: a header with the running count, then one branch per agent showing the
 * spinner, agent type, task, and elapsed time, with a sub-line for the agent's
 * current activity. Renders from the shared runtime (live, via subscribe) and
 * exposes `handleKey` for the `onTerminalInput` navigation path. Selection moves
 * with the arrow keys, Enter opens the selected run's conversation viewer, Esc
 * clears the selection. Self-hides when no run is active.
 */
export class FleetList implements Component {
	private selectedIndex = -1;
	private readonly snapshots = new Map<string, RunSnapshot>();
	private readonly activityById = new Map<string, string>();
	private unsubscribe: (() => void) | undefined;
	private renderTimer: ReturnType<typeof setInterval> | undefined;
	private viewingRunId: string | undefined;
	private lastRunningCount = -1;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		runtime: FleetRuntime,
		private readonly openViewer: (runId: string) => Promise<void>,
		private readonly reportRunning: (running: number) => void,
	) {
		this.unsubscribe = runtime.subscribe((event, snapshot) => {
			this.snapshots.set(snapshot.id, snapshot);
			const activity = fleetActivityFromEvent(event);
			if (activity) this.activityById.set(event.runId, activity);
			this.syncTimer();
			this.reportRunningCount();
			this.tui.requestRender();
		});
	}

	/**
	 * Handles a raw terminal key for fleet navigation. Returns `{ consume: true }`
	 * only when it actually acted on a navigation key at an empty prompt; otherwise
	 * `undefined` so the key flows to the editor (or, while a viewer overlay is
	 * open, to the focused overlay).
	 */
	handleKey(data: string, editorEmpty: boolean, overlayOpen = false): { consume?: boolean } | undefined {
		if (!shouldFleetHandleKey(editorEmpty, overlayOpen)) return undefined;

		const key = classifyFleetKey(data);
		if (!key) return undefined;

		const rowCount = this.roster().length;
		const result = reduceFleetNav(key, this.selectedIndex, rowCount);
		this.selectedIndex = result.selectedIndex;

		if (result.open !== null) {
			const runId = this.roster()[result.open]?.id;
			if (runId) this.openSelectedViewer(runId);
		}

		if (result.consume) this.tui.requestRender();
		return result.consume ? { consume: true } : undefined;
	}

	/**
	 * Opens the conversation viewer for a run and, once it closes, restores the
	 * selection to that run's row — so closing a viewer returns the cursor to the
	 * agent that was being viewed, not to the inactive prompt. The selection drops
	 * to inactive if the run has since left the roster.
	 */
	private openSelectedViewer(runId: string): void {
		this.viewingRunId = runId;
		void this.openViewer(runId).finally(() => this.restoreSelection(runId));
	}

	private restoreSelection(runId: string): void {
		if (this.viewingRunId !== runId) return;
		this.viewingRunId = undefined;
		this.selectedIndex = resolveRestoreIndex(this.roster().map((snapshot) => snapshot.id), runId);
		this.tui.requestRender();
	}

	/**
	 * Pushes the running-agent count to the status bar whenever it changes,
	 * clearing the status when no run is running. We have no queued count, so only
	 * the running total is surfaced.
	 */
	private reportRunningCount(): void {
		const running = [...this.snapshots.values()].filter((snapshot) => snapshot.status === "running").length;
		if (running === this.lastRunningCount) return;
		this.lastRunningCount = running;
		this.reportRunning(running);
	}

	render(width: number): string[] {
		const roster = this.roster();
		if (roster.length === 0) return [];

		const model = buildFleetModel(roster, this.selectedIndex, Date.now(), MAX_ROWS, this.activityById);
		const th = this.theme;

		const header = model.runningCount > 0 ? `Agents · ${model.runningCount} running` : "Agents";
		const lines: string[] = [];
		lines.push(truncateToWidth(th.fg("accent", header), width));

		if (model.hiddenAbove > 0) {
			lines.push(truncateToWidth(`  ${th.fg("dim", `^ ${model.hiddenAbove} more`)}`, width));
		}

		const lastRowIndex = model.rows.length - 1;
		model.rows.forEach((row, index) => {
			const lastBranch = index === lastRowIndex && model.hiddenBelow === 0;
			lines.push(this.renderRowMain(row, lastBranch, width));
			lines.push(this.renderRowSub(row, lastBranch, width));
		});

		if (model.hiddenBelow > 0) {
			lines.push(truncateToWidth(`  ${th.fg("dim", `v ${model.hiddenBelow} more`)}`, width));
		}

		const hint = this.selectedIndex >= 0
			? "up/down select · enter view · esc back"
			: "down to manage subagents";
		lines.push(truncateToWidth("  " + th.fg("dim", hint), width));

		return lines;
	}

	invalidate(): void {}

	dispose(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		if (this.renderTimer !== undefined) {
			clearInterval(this.renderTimer);
			this.renderTimer = undefined;
		}
		this.reportRunning(0);
	}

	/**
	 * Starts a 200ms render heartbeat while the roster is non-empty — including
	 * while finished runs are still lingering — so the spinner and elapsed counter
	 * advance between store events and lingering rows re-render and expire on time.
	 * The heartbeat re-checks the roster on every tick and stops itself once no run
	 * remains visible, so the timer never runs when the widget is idle.
	 */
	private syncTimer(): void {
		const hasRows = this.roster().length > 0;
		if (hasRows && this.renderTimer === undefined) {
			this.renderTimer = setInterval(() => {
				this.tui.requestRender();
				this.syncTimer();
			}, 200);
		} else if (!hasRows && this.renderTimer !== undefined) {
			clearInterval(this.renderTimer);
			this.renderTimer = undefined;
		}
	}

	/**
	 * The branch line for an agent: `<marker> <connector> <indicator> <agent>  <task> · <elapsed>`.
	 * The indicator is the live spinner while the run is active and a plain-text
	 * terminal marker (`done` / `failed` / `interrupted`) while it lingers. The
	 * connector closes the tree (`└─`) on the last visible branch.
	 */
	private renderRowMain(row: FleetRow, lastBranch: boolean, width: number): string {
		const th = this.theme;
		const marker = row.selected ? th.fg("accent", ">") : " ";
		const connector = th.fg("dim", lastBranch ? "└─" : "├─");
		const indicatorText = isActiveFleetStatus(row.status)
			? spinnerFrame(row.status, row.elapsedMs)
			: terminalMarker(row.status);
		const indicator = th.fg(statusColor(row.status), indicatorText);
		const agent = th.fg("accent", row.agent);
		const task = row.task ? `  ${row.task}` : "";
		const elapsed = th.fg("dim", `· ${formatElapsed(row.elapsedMs)}`);

		return truncateToWidth(`${marker} ${connector} ${indicator} ${agent}${task} ${elapsed}`, width);
	}

	/**
	 * The activity sub-line beneath an agent's branch. Keeps the tree's vertical
	 * gutter (`│`) for inner branches so the hierarchy reads cleanly.
	 */
	private renderRowSub(row: FleetRow, lastBranch: boolean, width: number): string {
		const th = this.theme;
		const gutter = lastBranch ? " " : th.fg("dim", "│");
		const branch = th.fg("dim", "└");

		return truncateToWidth(`  ${gutter}     ${branch} ${th.fg("dim", row.activity)}`, width);
	}

	private roster(): RunSnapshot[] {
		return selectFleetRoster([...this.snapshots.values()], Date.now());
	}
}

/**
 * Registers the Agents group above the prompt and wires arrow-key navigation
 * through `onTerminalInput`, gated on an empty editor so typing is never consumed.
 * Should be registered once per cwd on `session_start` so it captures every run.
 */
export function registerFleetWidget(ctx: ExtensionContext, runtime: ViewerRuntime): void {
	let fleet: FleetList | undefined;

	const reportRunning = (running: number) => {
		ctx.ui.setStatus(WIDGET_KEY, running > 0 ? `${running} running` : undefined);
	};

	ctx.ui.setWidget(
		WIDGET_KEY,
		(tui, theme) => {
			fleet = new FleetList(
				tui,
				theme,
				runtime,
				(runId) => showConversationViewer(ctx, runtime, runId),
				reportRunning,
			);
			return fleet;
		},
		{ placement: "aboveEditor" },
	);

	ctx.ui.onTerminalInput((data) => {
		if (!fleet) return undefined;
		return fleet.handleKey(data, ctx.ui.getEditorText() === "", isConversationViewerOpen());
	});
}
