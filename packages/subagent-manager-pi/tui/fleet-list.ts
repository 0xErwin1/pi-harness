import {
	type Component,
	matchesKey,
	type TUI,
	truncateToWidth,
} from "@mariozechner/pi-tui";
import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import type { RunSnapshot, RunStatus } from "../../subagent-manager-core/events.ts";
import type { RunStoreListener } from "../../subagent-manager-core/store.ts";
import { buildFleetModel, fleetActivityFromEvent, type FleetRow } from "./fleet-model.ts";
import { isConversationViewerOpen, showConversationViewer, type ViewerRuntime } from "./conversation-viewer.ts";

/** Live accessor surface the fleet widget needs from the manager runtime. */
export interface FleetRuntime {
	subscribe(listener: RunStoreListener): () => void;
}

const WIDGET_KEY = "subagents";
const MAX_ROWS = 5;

export type FleetKey = "up" | "down" | "enter" | "escape";

export interface FleetNavResult {
	selectedIndex: number;
	consume: boolean;
	open: number | null;
}

/**
 * Pure navigation reducer for the fleet list. `selectedIndex === -1` means the
 * list is inactive (arrow keys flow to the editor); a `down` activates it. Only
 * keys that actually act on the list report `consume`, so normal editor input —
 * including history navigation with `up` at an inactive prompt — is never swallowed.
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
	if (matchesKey(data, "return")) return "enter";
	if (matchesKey(data, "escape")) return "escape";
	return undefined;
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

function isActiveStatus(status: RunStatus): boolean {
	return status === "running" || status === "needs-attention";
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

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		runtime: FleetRuntime,
		private readonly openViewer: (runId: string) => void,
	) {
		this.unsubscribe = runtime.subscribe((event, snapshot) => {
			this.snapshots.set(snapshot.id, snapshot);
			const activity = fleetActivityFromEvent(event);
			if (activity) this.activityById.set(event.runId, activity);
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

		const rowCount = this.visibleCount();
		const result = reduceFleetNav(key, this.selectedIndex, rowCount);
		this.selectedIndex = result.selectedIndex;

		if (result.open !== null) {
			const runId = this.roster()[result.open]?.id;
			if (runId) this.openViewer(runId);
		}

		if (result.consume) this.tui.requestRender();
		return result.consume ? { consume: true } : undefined;
	}

	render(width: number): string[] {
		const roster = this.roster();
		if (roster.length === 0) return [];

		const model = buildFleetModel(roster, this.selectedIndex, Date.now(), MAX_ROWS, this.activityById);
		const th = this.theme;

		const header = model.runningCount > 0 ? `Agents · ${model.runningCount} running` : "Agents";
		const lines: string[] = [];
		lines.push(truncateToWidth(th.fg("accent", header), width));

		const lastRowIndex = model.rows.length - 1;
		model.rows.forEach((row, index) => {
			const lastBranch = index === lastRowIndex && model.overflow === 0;
			lines.push(this.renderRowMain(row, lastBranch, width));
			lines.push(this.renderRowSub(row, lastBranch, width));
		});

		if (model.overflow > 0) {
			lines.push(truncateToWidth(`  ${th.fg("dim", `└─ +${model.overflow} more`)}`, width));
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
	}

	/**
	 * The branch line for an agent: `<marker> <connector> <spin> <agent>  <task> · <elapsed>`.
	 * The connector closes the tree (`└─`) on the last visible branch.
	 */
	private renderRowMain(row: FleetRow, lastBranch: boolean, width: number): string {
		const th = this.theme;
		const marker = row.selected ? th.fg("accent", ">") : " ";
		const connector = th.fg("dim", lastBranch ? "└─" : "├─");
		const spin = th.fg(statusColor(row.status), spinnerFrame(row.status, row.elapsedMs));
		const agent = th.fg("accent", row.agent);
		const task = row.task ? `  ${row.task}` : "";
		const elapsed = th.fg("dim", `· ${formatElapsed(row.elapsedMs)}`);

		return truncateToWidth(`${marker} ${connector} ${spin} ${agent}${task} ${elapsed}`, width);
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
		return [...this.snapshots.values()]
			.filter((snapshot) => isActiveStatus(snapshot.status))
			.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
	}

	private visibleCount(): number {
		return Math.min(this.roster().length, MAX_ROWS);
	}
}

/**
 * Registers the Agents group above the prompt and wires arrow-key navigation
 * through `onTerminalInput`, gated on an empty editor so typing is never consumed.
 * Should be registered once per cwd on `session_start` so it captures every run.
 */
export function registerFleetWidget(ctx: ExtensionContext, runtime: ViewerRuntime): void {
	let fleet: FleetList | undefined;

	ctx.ui.setWidget(
		WIDGET_KEY,
		(tui, theme) => {
			fleet = new FleetList(tui, theme, runtime, (runId) => {
				void showConversationViewer(ctx, runtime, runId);
			});
			return fleet;
		},
		{ placement: "aboveEditor" },
	);

	ctx.ui.onTerminalInput((data) => {
		if (!fleet) return undefined;
		return fleet.handleKey(data, ctx.ui.getEditorText() === "", isConversationViewerOpen());
	});
}
