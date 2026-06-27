import {
	type RunEvent,
	type RunSnapshot,
	type RunStatus,
	TOOL_PROGRESS_PREFIX,
} from "../../subagent-manager-core/events.ts";

export interface FleetRow {
	id: string;
	agent: string;
	status: RunStatus;
	/** Short task label for the agent, derived from the run's request prompt. */
	task: string;
	/** What the agent is doing right now (current tool, `thinking…`, or status). */
	activity: string;
	elapsedMs: number;
	tools: number;
	tokens: number;
	selected: boolean;
}

export interface FleetModel {
	rows: FleetRow[];
	/** Roster rows hidden above the visible window (selection scrolled down). */
	hiddenAbove: number;
	/** Roster rows hidden below the visible window. */
	hiddenBelow: number;
	/** Number of active runs in the `running` state across the whole roster. */
	runningCount: number;
}

const MAX_TASK = 60;
const MAX_ACTIVITY = 50;

/** How long a finished run lingers in the fleet roster after its terminal transition. */
export const FLEET_LINGER_MS = 5000;

const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set(["completed", "failed", "interrupted"]);

/** A run is active while it is running or waiting on the user. */
export function isActiveFleetStatus(status: RunStatus): boolean {
	return status === "running" || status === "needs-attention";
}

function isLingeringFleetSnapshot(snap: RunSnapshot, now: number, lingerMs: number): boolean {
	if (!TERMINAL_STATUSES.has(snap.status)) return false;
	if (!snap.endedAt) return false;
	return now - Date.parse(snap.endedAt) <= lingerMs;
}

/**
 * Selects the fleet roster from all known snapshots: every active run plus any
 * run that reached a terminal status within the last `lingerMs`, so finished
 * agents stay visible briefly before dropping off. Pure (computed against the
 * injected `now`), sorted by start time so row order is stable.
 */
export function selectFleetRoster(
	snapshots: RunSnapshot[],
	now: number,
	lingerMs: number = FLEET_LINGER_MS,
): RunSnapshot[] {
	return snapshots
		.filter((snap) => isActiveFleetStatus(snap.status) || isLingeringFleetSnapshot(snap, now, lingerMs))
		.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

function truncate(text: string, max: number): string {
	const trimmed = text.trim();
	if (trimmed.length <= max) return trimmed;
	return `${trimmed.slice(0, max - 1)}…`;
}

/**
 * Derives the live activity phrase for a run from a single incoming event,
 * mirroring the collapsed row's `currentActivity` rules: the latest tool as
 * `<tool> <target>`, `thinking…` while the agent reasons, or the first line of
 * an assistant turn. Returns `null` for events that should leave the previous
 * activity unchanged (so the caller keeps the last meaningful phrase). Never
 * surfaces reasoning prose.
 */
export function fleetActivityFromEvent(event: RunEvent): string | null {
	if (event.type === "run.progress") {
		if (!event.message.startsWith(TOOL_PROGRESS_PREFIX)) return null;
		const name = event.message.slice(TOOL_PROGRESS_PREFIX.length).trim();
		return event.target ? `${name} ${event.target}` : name;
	}

	if (event.type === "run.output") {
		if (event.kind === "thinking" && event.text) return "thinking…";
		if (event.role === "assistant" && event.text) {
			const firstLine = event.text.split("\n")[0]?.trim();
			return firstLine ? firstLine : null;
		}
	}

	return null;
}

function activityFor(snap: RunSnapshot, activityById: Map<string, string> | undefined): string {
	const live = activityById?.get(snap.id);
	if (live && live.trim().length > 0) return live;
	return snap.status;
}

/**
 * Computes the visible window of roster indices. When the roster fits within
 * `maxRows` the whole list shows; otherwise the window is centred on the
 * selection (clamped to the list bounds) so the selected row is always visible.
 * An inactive selection (`selectedIndex < 0`) anchors the window at the top.
 */
function computeWindow(total: number, maxRows: number, selectedIndex: number): { start: number; end: number } {
	if (total <= maxRows) return { start: 0, end: total };
	if (selectedIndex < 0) return { start: 0, end: maxRows };

	const half = Math.floor(maxRows / 2);
	const maxStart = total - maxRows;
	const start = Math.max(0, Math.min(selectedIndex - half, maxStart));
	return { start, end: start + maxRows };
}

/**
 * Builds the tree model for the Agents group: one row per visible snapshot,
 * windowed around `selectedIndex` (at most `maxRows` rows) so the selection
 * stays on screen as it moves. Each row carries its task label, current
 * activity, elapsed time, and counters. `hiddenAbove`/`hiddenBelow` report how
 * many roster rows fall outside the window so the caller can render "N more"
 * markers on each side. `activityById` provides the live per-run activity phrase
 * tracked by the widget from the event stream; rows fall back to their status
 * when no activity has been observed yet.
 */
export function buildFleetModel(
	snapshots: RunSnapshot[],
	selectedIndex: number,
	now: number,
	maxRows: number,
	activityById?: Map<string, string>,
): FleetModel {
	const total = snapshots.length;
	const { start, end } = computeWindow(total, maxRows, selectedIndex);
	const visible = snapshots.slice(start, end);
	const hiddenAbove = start;
	const hiddenBelow = total - end;
	const runningCount = snapshots.filter((snap) => snap.status === "running").length;

	const rows: FleetRow[] = visible.map((snap, index) => ({
		id: snap.id,
		agent: snap.agent,
		status: snap.status,
		task: truncate(snap.task ?? "", MAX_TASK),
		activity: truncate(activityFor(snap, activityById), MAX_ACTIVITY),
		elapsedMs: now - Date.parse(snap.startedAt),
		tools: snap.toolCount ?? 0,
		tokens: snap.tokens ?? 0,
		selected: start + index === selectedIndex,
	}));

	return { rows, hiddenAbove, hiddenBelow, runningCount };
}
