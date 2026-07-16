/**
 * Subagent roster tracking for the status line and the `harness:agents` bus.
 *
 * The vendored tintinweb pi-subagents motor is unchanged; this extension only
 * observes it. The manager exposes no `listAgents`, so the roster is
 * reconstructed from the `subagents:*` lifecycle events the vendor emits and
 * folded by the pure reducer in `packages/subagent-ui/roster.ts`.
 *
 * Viewing the fleet and taking over an individual agent are the vendor's own
 * `/agents` command; this extension deliberately renders no overlay of its own.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { publish } from "../packages/events/index.ts";
import {
	applyLifecycle,
	emptyRoster,
	rosterList,
	rosterRows,
	rosterSummary,
	type AgentStatus,
	type LifecycleEvent,
	type RosterState,
} from "../packages/subagent-ui/roster.ts";

// --- lifecycle payload normalization (raw pi.events -> LifecycleEvent) -----------

function str(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
	return typeof value === "number" ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set<AgentStatus>([
	"completed",
	"steered",
	"aborted",
	"stopped",
	"error",
]);

function terminalStatus(raw: unknown, fallback: AgentStatus): AgentStatus {
	return typeof raw === "string" && TERMINAL_STATUSES.has(raw) ? (raw as AgentStatus) : fallback;
}

function tokensOf(value: unknown): { input: number; output: number; total: number } | undefined {
	const record = asRecord(value);
	if (typeof record.total !== "number") return undefined;
	return { input: num(record.input), output: num(record.output), total: record.total };
}

// --- extension entry ------------------------------------------------------------

export default function subagentUi(pi: ExtensionAPI): void {
	let state: RosterState = emptyRoster();
	let currentCtx: ExtensionContext | undefined;

	const apply = (event: LifecycleEvent): void => {
		state = applyLifecycle(state, event);

		const list = rosterList(state);
		publish(pi, "harness:agents", { rows: rosterRows(list) });

		const summary = rosterSummary(list);
		currentCtx?.ui.setStatus("subagents", summary.running > 0 ? `subagents: ${summary.running} running · /agents` : undefined);
	};

	pi.events.on("subagents:created", (payload: unknown) => {
		const p = asRecord(payload);
		apply({ kind: "created", id: str(p.id), agentType: str(p.type), description: str(p.description), isBackground: p.isBackground === true });
	});
	pi.events.on("subagents:started", (payload: unknown) => {
		const p = asRecord(payload);
		apply({ kind: "started", id: str(p.id), agentType: str(p.type), description: str(p.description) });
	});
	pi.events.on("subagents:completed", (payload: unknown) => {
		const p = asRecord(payload);
		apply({
			kind: "terminal",
			id: str(p.id),
			agentType: str(p.type),
			description: str(p.description),
			status: terminalStatus(p.status, "completed"),
			toolUses: num(p.toolUses),
			durationMs: num(p.durationMs),
			tokens: tokensOf(p.tokens),
		});
	});
	pi.events.on("subagents:failed", (payload: unknown) => {
		const p = asRecord(payload);
		apply({
			kind: "terminal",
			id: str(p.id),
			agentType: str(p.type),
			description: str(p.description),
			status: terminalStatus(p.status, "error"),
			toolUses: num(p.toolUses),
			durationMs: num(p.durationMs),
			tokens: tokensOf(p.tokens),
		});
	});
	pi.events.on("subagents:compacted", (payload: unknown) => {
		const p = asRecord(payload);
		apply({ kind: "compacted", id: str(p.id), agentType: str(p.type), description: str(p.description) });
	});
	pi.events.on("subagents:steered", (payload: unknown) => {
		const p = asRecord(payload);
		apply({ kind: "steered", id: str(p.id) });
	});

	pi.on("session_start", (_event, ctx) => {
		currentCtx = ctx;
	});
}
