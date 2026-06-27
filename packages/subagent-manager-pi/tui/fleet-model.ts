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
	overflow: number;
	/** Number of active runs in the `running` state across the whole roster. */
	runningCount: number;
}

const MAX_TASK = 60;
const MAX_ACTIVITY = 50;

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
 * Builds the tree model for the Agents group: one row per snapshot (capped at
 * `maxRows`), each carrying its task label, current activity, elapsed time, and
 * counters. `activityById` provides the live per-run activity phrase tracked by
 * the widget from the event stream; rows fall back to their status when no
 * activity has been observed yet.
 */
export function buildFleetModel(
	snapshots: RunSnapshot[],
	selectedIndex: number,
	now: number,
	maxRows: number,
	activityById?: Map<string, string>,
): FleetModel {
	const overflow = Math.max(0, snapshots.length - maxRows);
	const visible = snapshots.slice(0, maxRows);
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
		selected: index === selectedIndex,
	}));

	return { rows, overflow, runningCount };
}
