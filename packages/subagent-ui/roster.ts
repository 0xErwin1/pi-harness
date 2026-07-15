import type { AgentRow } from "../events/channels.ts";

/**
 * Roster model for the subagent dashboard.
 *
 * The vendored pi-subagents manager does NOT expose a `listAgents` surface, so
 * the roster is reconstructed purely from the lifecycle events the vendor emits
 * on `pi.events` (`subagents:created|started|completed|failed|compacted|steered`).
 * `applyLifecycle` folds one normalized event into an immutable snapshot map; the
 * extension owns the thin translation from the raw `pi.events` payloads into the
 * `LifecycleEvent` union below, and calls this reducer.
 *
 * The reducer is pure: it never reads `getRecord`, the clock, or any global. Row
 * enrichment that needs the live manager (model label, live transcript) happens
 * in the extension, keyed off the ids this roster tracks.
 */

/** The lifecycle statuses the vendor attaches to an agent record. */
export type AgentStatus =
	| "queued"
	| "running"
	| "completed"
	| "steered"
	| "aborted"
	| "stopped"
	| "error";

export interface AgentTokens {
	input: number;
	output: number;
	total: number;
}

export interface AgentSnapshot {
	id: string;
	agentType: string;
	description: string;
	status: AgentStatus;
	isBackground: boolean;
	toolUses: number;
	durationMs?: number;
	tokens?: AgentTokens;
	compactionCount: number;
}

export interface RosterState {
	readonly order: readonly string[];
	readonly byId: ReadonlyMap<string, AgentSnapshot>;
}

/**
 * A normalized lifecycle event. Each variant maps 1:1 to a `subagents:*` channel;
 * the extension constructs these from the raw vendor payloads so this reducer
 * stays independent of the exact channel wire shapes.
 */
export type LifecycleEvent =
	| { kind: "created"; id: string; agentType: string; description: string; isBackground?: boolean }
	| { kind: "started"; id: string; agentType: string; description: string }
	| {
			kind: "terminal";
			id: string;
			agentType: string;
			description: string;
			status: AgentStatus;
			toolUses: number;
			durationMs: number;
			tokens?: AgentTokens;
	  }
	| { kind: "compacted"; id: string; agentType: string; description: string }
	| { kind: "steered"; id: string };

export function emptyRoster(): RosterState {
	return { order: [], byId: new Map() };
}

/** The blank snapshot an unseen id starts from, before its first status-bearing event. */
function seedSnapshot(id: string, agentType: string, description: string): AgentSnapshot {
	return {
		id,
		agentType,
		description,
		status: "queued",
		isBackground: false,
		toolUses: 0,
		compactionCount: 0,
	};
}

/** Return the existing snapshot for `id`, or a fresh seed when the id is new. */
function baseFor(state: RosterState, id: string, agentType: string, description: string): AgentSnapshot {
	return state.byId.get(id) ?? seedSnapshot(id, agentType, description);
}

/**
 * Fold one lifecycle event into the roster, returning a NEW state. The previous
 * state is never mutated, so callers can hold a prior reference safely.
 *
 * Events for an unknown id upsert a fresh row: the extension may subscribe after
 * `created` already fired, and a late `started`/`terminal` must still surface the
 * agent rather than be dropped.
 */
export function applyLifecycle(state: RosterState, event: LifecycleEvent): RosterState {
	const existing = state.byId.get(event.id);
	const base = existing ?? seedSnapshot(event.id, "agentType" in event ? event.agentType : "", "description" in event ? event.description : "");

	let next: AgentSnapshot;

	switch (event.kind) {
		case "created":
			next = {
				...base,
				agentType: event.agentType,
				description: event.description,
				isBackground: event.isBackground ?? base.isBackground,
			};
			break;

		case "started":
			next = {
				...base,
				agentType: event.agentType,
				description: event.description,
				status: "running",
			};
			break;

		case "terminal":
			next = {
				...base,
				agentType: event.agentType,
				description: event.description,
				status: event.status,
				toolUses: event.toolUses,
				durationMs: event.durationMs,
				tokens: event.tokens ?? base.tokens,
			};
			break;

		case "compacted":
			next = {
				...base,
				agentType: event.agentType,
				description: event.description,
				compactionCount: base.compactionCount + 1,
			};
			break;

		case "steered":
			// A mid-run steer message does not change the agent's lifecycle status;
			// it only guarantees the agent is tracked.
			next = base;
			break;
	}

	const byId = new Map(state.byId);
	byId.set(event.id, next);

	const order = existing ? state.order : [...state.order, event.id];

	return { order, byId };
}

/** The roster as an ordered list, following stable insertion order. */
export function rosterList(state: RosterState): AgentSnapshot[] {
	const out: AgentSnapshot[] = [];
	for (const id of state.order) {
		const snap = state.byId.get(id);
		if (snap) out.push(snap);
	}
	return out;
}

const SETTLED_STATUSES: ReadonlySet<AgentStatus> = new Set<AgentStatus>([
	"completed",
	"steered",
	"aborted",
	"stopped",
	"error",
]);

export interface RosterSummary {
	total: number;
	settled: number;
	running: number;
}

/** Count settled (terminal) and running agents for the panel title and status line. */
export function rosterSummary(list: readonly AgentSnapshot[]): RosterSummary {
	let settled = 0;
	let running = 0;

	for (const snap of list) {
		if (SETTLED_STATUSES.has(snap.status)) settled += 1;
		else if (snap.status === "running") running += 1;
	}

	return { total: list.length, settled, running };
}

/** Project the roster onto the `harness:agents` bus payload rows. */
export function rosterRows(list: readonly AgentSnapshot[]): AgentRow[] {
	return list.map((snap) => ({ id: snap.id, agentType: snap.agentType, status: snap.status }));
}
