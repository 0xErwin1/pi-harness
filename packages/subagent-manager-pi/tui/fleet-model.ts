import type { RunSnapshot, RunStatus } from "../../subagent-manager-core/events.ts";

export interface FleetRow {
	id: string;
	agent: string;
	status: RunStatus;
	elapsedMs: number;
	selected: boolean;
}

export interface FleetModel {
	rows: FleetRow[];
	overflow: number;
}

export function buildFleetModel(
	snapshots: RunSnapshot[],
	selectedIndex: number,
	now: number,
	maxRows: number,
): FleetModel {
	const overflow = Math.max(0, snapshots.length - maxRows);
	const visible = snapshots.slice(0, maxRows);

	const rows: FleetRow[] = visible.map((snap, index) => ({
		id: snap.id,
		agent: snap.agent,
		status: snap.status,
		elapsedMs: now - Date.parse(snap.startedAt),
		selected: index === selectedIndex,
	}));

	return { rows, overflow };
}
