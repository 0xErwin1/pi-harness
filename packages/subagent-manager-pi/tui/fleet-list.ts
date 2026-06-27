import {
	type Component,
	matchesKey,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@mariozechner/pi-tui";
import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import type { RunSnapshot, RunStatus } from "../../subagent-manager-core/events.ts";
import type { RunStoreListener } from "../../subagent-manager-core/store.ts";
import { buildFleetModel, type FleetRow } from "./fleet-model.ts";
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

function rightAlign(left: string, right: string, width: number): string {
	const rightW = visibleWidth(right);
	const maxLeft = Math.max(0, width - rightW - 1);
	const leftClamped = truncateToWidth(left, maxLeft);
	const gap = Math.max(1, width - visibleWidth(leftClamped) - rightW);
	return truncateToWidth(leftClamped + " ".repeat(gap) + right, width);
}

/**
 * Below-editor widget listing active and recent subagent runs. Renders from the
 * shared runtime (live, via subscribe) and exposes `handleKey` for the
 * `onTerminalInput` navigation path. Selection moves with the arrow keys, Enter
 * opens the selected run's conversation viewer, Esc clears the selection.
 */
export class FleetList implements Component {
	private selectedIndex = -1;
	private readonly snapshots = new Map<string, RunSnapshot>();
	private unsubscribe: (() => void) | undefined;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		runtime: FleetRuntime,
		private readonly openViewer: (runId: string) => void,
	) {
		this.unsubscribe = runtime.subscribe((_event, snapshot) => {
			this.snapshots.set(snapshot.id, snapshot);
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

		const model = buildFleetModel(roster, this.selectedIndex, Date.now(), MAX_ROWS);
		const th = this.theme;

		const hint = this.selectedIndex >= 0
			? "↑↓ select · enter view · esc back"
			: "↓ to manage subagents";

		const lines: string[] = [];
		lines.push(truncateToWidth("  " + th.fg("dim", hint), width));
		lines.push("");

		for (const row of model.rows) {
			lines.push(this.renderRow(row, width));
		}

		if (model.overflow > 0) {
			lines.push(rightAlign("", th.fg("dim", `↓ ${model.overflow} more`), width));
		}

		return lines;
	}

	invalidate(): void {}

	dispose(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
	}

	private renderRow(row: FleetRow, width: number): string {
		const th = this.theme;
		const bullet = row.selected ? th.fg("accent", "⏺") : th.fg("dim", "◯");
		const left = `  ${bullet} ${th.fg(statusColor(row.status), row.agent)}  ${th.fg("muted", row.status)}`;
		const right = th.fg("dim", formatElapsed(row.elapsedMs));
		return rightAlign(left, right, width);
	}

	private roster(): RunSnapshot[] {
		return [...this.snapshots.values()].sort(
			(a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
		);
	}

	private visibleCount(): number {
		return Math.min(this.roster().length, MAX_ROWS);
	}
}

/**
 * Registers the fleet widget below the editor and wires arrow-key navigation
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
		{ placement: "belowEditor" },
	);

	ctx.ui.onTerminalInput((data) => {
		if (!fleet) return undefined;
		return fleet.handleKey(data, ctx.ui.getEditorText() === "", isConversationViewerOpen());
	});
}
