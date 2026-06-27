import type { RunSnapshot } from "../subagent-manager-core/events.ts";

/**
 * Selects the most relevant run ID from a snapshot list.
 *
 * Preference order:
 *   1. The most recently started run that is currently `running`.
 *   2. Failing that, the most recently started run overall.
 *
 * Returns `undefined` when the list is empty.
 */
export function selectMostRecentRunId(snapshots: RunSnapshot[]): string | undefined {
	if (snapshots.length === 0) return undefined;

	const byStartDesc = (a: RunSnapshot, b: RunSnapshot) =>
		Date.parse(b.startedAt) - Date.parse(a.startedAt);

	const running = snapshots.filter((s) => s.status === "running");
	const pool = running.length > 0 ? running : snapshots;

	return [...pool].sort(byStartDesc)[0]?.id;
}
