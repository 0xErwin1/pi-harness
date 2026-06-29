import {
	type RunEvent,
	type RunSnapshot,
	type RunStatus,
	TOOL_PROGRESS_PREFIX,
} from "../../subagent-manager-core/events.ts";
import type { AgentNode } from "../../subagent-manager-core/file-tree/reader.ts";

export interface FleetRow {
	/** Stable identity of the row across processes — the node's agentId. */
	id: string;
	/** Globally-unique agent identity (`<processToken>-<runId>`). */
	agentId: string;
	/** Spawning agent's id, or `null` for a root run. */
	parentAgentId: string | null;
	/** Tree depth (1 = a run launched by this process, 2 = its child, …). */
	depth: number;
	/** True when the run lives in this process and has a live in-memory snapshot. */
	local: boolean;
	/** The run id, present only for local nodes (used to open the live viewer). */
	runId?: string;
	agent: string;
	status: RunStatus;
	/** Short task label for the agent, derived from the run's request prompt. */
	task: string;
	/** What the agent is doing right now (current tool, `thinking…`, or status). */
	activity: string;
	elapsedMs: number;
	tools: number;
	tokens: number;
	/** Model id for the run, sourced from the live snapshot; absent for nested file-backed nodes. */
	model?: string;
	/** Thinking level for the run, sourced from the live snapshot; absent for nested file-backed nodes. */
	thinking?: string;
	/** True when a file-backed node is still marked running but its process is gone. */
	staleRunning: boolean;
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

/**
 * A merged tree node combining file-backed structure (depth, parent links) with
 * live in-memory liveness for local runs. Built by {@link mergeForest} and
 * flattened pre-order by {@link flattenForest} before windowing.
 */
export interface FleetNode {
	agentId: string;
	parentAgentId: string | null;
	depth: number;
	local: boolean;
	runId?: string;
	agent: string;
	status: RunStatus;
	task: string;
	activity: string;
	startedAt: string;
	endedAt?: string;
	updatedAt: string;
	tools: number;
	tokens: number;
	model?: string;
	thinking?: string;
	staleRunning: boolean;
	children: FleetNode[];
}

/**
 * Identity of the local process and the structural slot its own runs occupy in
 * the tree, used to recognise local nodes and to synthesise local runs that the
 * file sink has not flushed yet.
 */
export interface FleetLocalContext {
	processToken: string;
	depth: number;
	parentAgentId: string | null;
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

/**
 * True when a terminal status with a known terminal timestamp is still within
 * the linger window — the shared predicate behind both the snapshot roster and
 * the merged-node roster.
 */
function isLingering(status: RunStatus, endedAt: string | undefined, now: number, lingerMs: number): boolean {
	if (!TERMINAL_STATUSES.has(status)) return false;
	if (!endedAt) return false;
	return now - Date.parse(endedAt) <= lingerMs;
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
		.filter((snap) => isActiveFleetStatus(snap.status) || isLingering(snap.status, snap.endedAt, now, lingerMs))
		.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

/**
 * Roster predicate for a merged tree node. Active nodes stay; terminal nodes
 * linger briefly; a `staleRunning` node (running status, dead process) is shown
 * as terminal and lingered against its last write so a crashed agent appears
 * briefly without lingering forever.
 */
export function isFleetNodeVisible(node: FleetNode, now: number, lingerMs: number = FLEET_LINGER_MS): boolean {
	if (node.staleRunning) {
		return now - Date.parse(node.endedAt ?? node.updatedAt) <= lingerMs;
	}
	if (isActiveFleetStatus(node.status)) return true;
	return isLingering(node.status, node.endedAt, now, lingerMs);
}

/**
 * Filters a flattened forest to the visible roster, preserving the incoming
 * pre-order so the tree shape is kept across the window.
 */
export function selectFleetNodeRoster(
	nodes: FleetNode[],
	now: number,
	lingerMs: number = FLEET_LINGER_MS,
): FleetNode[] {
	return nodes.filter((node) => isFleetNodeVisible(node, now, lingerMs));
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

function isLocalAgentId(agentId: string, processToken: string): boolean {
	return agentId.startsWith(`${processToken}-`);
}

/**
 * Builds the activity sub-line for a file-backed (nested) node from its meta:
 * stale nodes flag the gone process, otherwise the status plus any tool/token
 * counts. Nested nodes have no live event stream, so this is the best signal.
 */
function nestedActivity(status: RunStatus, tools: number, tokens: number, stale: boolean): string {
	if (stale) return "stale (process gone)";

	const parts: string[] = [status];
	if (tools > 0) parts.push(`${tools} tools`);
	if (tokens > 0) parts.push(`${tokens} tok`);
	return parts.join(" · ");
}

function mergeNode(
	node: AgentNode,
	ctx: FleetLocalContext,
	liveByAgentId: Map<string, RunSnapshot>,
	activityById: Map<string, string>,
): FleetNode {
	const local = isLocalAgentId(node.agentId, ctx.processToken);
	const live = local ? liveByAgentId.get(node.agentId) : undefined;
	const runId = local ? node.agentId.slice(ctx.processToken.length + 1) : undefined;

	const status = live?.status ?? node.status;
	const tools = live?.toolCount ?? node.tools ?? 0;
	const tokens = live?.tokens ?? node.tokens ?? 0;
	const staleRunning = live ? false : (node.staleRunning ?? false);

	const activity = live
		? activityById.get(live.id) ?? status
		: nestedActivity(status, tools, tokens, staleRunning);

	return {
		agentId: node.agentId,
		parentAgentId: node.parentAgentId,
		depth: node.depth,
		local,
		runId,
		agent: live?.agent ?? node.agentType,
		status,
		task: live?.task ?? node.task ?? "",
		activity,
		startedAt: live?.startedAt ?? node.startedAt,
		endedAt: live?.endedAt ?? node.endedAt,
		updatedAt: live?.updatedAt ?? node.updatedAt,
		tools,
		tokens,
		...(live?.model ? { model: live.model } : {}),
		...(live?.thinking ? { thinking: live.thinking } : {}),
		staleRunning,
		children: [],
	};
}

function synthLocalNode(
	agentId: string,
	snap: RunSnapshot,
	ctx: FleetLocalContext,
	activityById: Map<string, string>,
): FleetNode {
	return {
		agentId,
		parentAgentId: ctx.parentAgentId,
		depth: ctx.depth,
		local: true,
		runId: snap.id,
		agent: snap.agent,
		status: snap.status,
		task: snap.task ?? "",
		activity: activityById.get(snap.id) ?? snap.status,
		startedAt: snap.startedAt,
		endedAt: snap.endedAt,
		updatedAt: snap.updatedAt,
		tools: snap.toolCount ?? 0,
		tokens: snap.tokens ?? 0,
		...(snap.model ? { model: snap.model } : {}),
		...(snap.thinking ? { thinking: snap.thinking } : {}),
		staleRunning: false,
		children: [],
	};
}

/**
 * Merges the file-backed forest with the live in-memory snapshots into one tree.
 *
 * Both sources contribute nodes: every file node (flattened) plus every live local
 * snapshot the file sink has not flushed yet. Each node is then linked under its
 * `parentAgentId` whenever that parent is known from EITHER source. This is what
 * keeps nesting correct in flight: a child must never be orphaned to the root just
 * because, at this instant, its parent is represented only by a live snapshot (which
 * carries no children) or only by a file node. For LOCAL nodes the live snapshot
 * overrides liveness fields (status, activity, tokens, tools, timestamps) because the
 * file lags slightly behind the in-memory store. Roots and children are returned
 * sorted by start time. A node whose parent is unknown (or which would point at
 * itself) is a root.
 */
export function mergeForest(
	roots: AgentNode[],
	ctx: FleetLocalContext,
	liveByAgentId: Map<string, RunSnapshot>,
	activityById: Map<string, string>,
): FleetNode[] {
	const byId = new Map<string, FleetNode>();

	const collectFileNodes = (node: AgentNode): void => {
		if (!byId.has(node.agentId)) {
			byId.set(node.agentId, mergeNode(node, ctx, liveByAgentId, activityById));
		}
		node.children.forEach(collectFileNodes);
	};
	roots.forEach(collectFileNodes);

	for (const [agentId, snap] of liveByAgentId) {
		if (!byId.has(agentId)) byId.set(agentId, synthLocalNode(agentId, snap, ctx, activityById));
	}

	for (const node of byId.values()) node.children = [];

	const treeRoots: FleetNode[] = [];
	for (const node of byId.values()) {
		const parent = node.parentAgentId ? byId.get(node.parentAgentId) : undefined;
		if (parent && parent !== node) parent.children.push(node);
		else treeRoots.push(node);
	}

	const byStartedAt = (a: FleetNode, b: FleetNode) => a.startedAt.localeCompare(b.startedAt);
	const sortChildren = (node: FleetNode): void => {
		node.children.sort(byStartedAt);
		node.children.forEach(sortChildren);
	};

	treeRoots.sort(byStartedAt);
	treeRoots.forEach(sortChildren);

	return treeRoots;
}

/**
 * Flattens a merged forest into a pre-order list: each parent immediately
 * followed by its children, recursively. Sibling order is preserved from the
 * input (start-time order), so the flat list reads top-to-bottom as the tree.
 */
export function flattenForest(roots: FleetNode[]): FleetNode[] {
	const out: FleetNode[] = [];
	const walk = (node: FleetNode): void => {
		out.push(node);
		for (const child of node.children) walk(child);
	};
	for (const root of roots) walk(root);
	return out;
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
 * Builds the tree model for the Agents group from the FLATTENED, roster-filtered
 * forest: one row per visible node, windowed around `selectedIndex` (at most
 * `maxRows` rows) so the selection stays on screen as it moves. Each row carries
 * its depth (for indentation), task label, current activity, elapsed time, and
 * counters. `hiddenAbove`/`hiddenBelow` report how many roster rows fall outside
 * the window so the caller can render "N more" markers on each side. A
 * `staleRunning` node is excluded from `runningCount` because its process is gone.
 */
export function buildFleetModel(
	nodes: FleetNode[],
	selectedIndex: number,
	now: number,
	maxRows: number,
): FleetModel {
	const total = nodes.length;
	const { start, end } = computeWindow(total, maxRows, selectedIndex);
	const visible = nodes.slice(start, end);
	const hiddenAbove = start;
	const hiddenBelow = total - end;
	const runningCount = nodes.filter((node) => node.status === "running" && !node.staleRunning).length;

	const rows: FleetRow[] = visible.map((node, index) => ({
		id: node.agentId,
		agentId: node.agentId,
		parentAgentId: node.parentAgentId,
		depth: node.depth,
		local: node.local,
		runId: node.runId,
		agent: node.agent,
		status: node.status,
		task: truncate(node.task, MAX_TASK),
		activity: truncate(node.activity, MAX_ACTIVITY),
		elapsedMs: now - Date.parse(node.startedAt),
		tools: node.tools,
		tokens: node.tokens,
		...(node.model ? { model: node.model } : {}),
		...(node.thinking ? { thinking: node.thinking } : {}),
		staleRunning: node.staleRunning,
		selected: start + index === selectedIndex,
	}));

	return { rows, hiddenAbove, hiddenBelow, runningCount };
}
