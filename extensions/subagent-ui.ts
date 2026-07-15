/**
 * Subagent dashboard + takeover UI (`/fleet`).
 *
 * The vendored tintinweb pi-subagents motor is unchanged. This extension adds a
 * harness-styled surface on top of the VERIFIED no-fork surface (spike #10029):
 *
 *  - The roster is reconstructed from the `subagents:*` lifecycle events the
 *    vendor emits (the manager exposes no `listAgents`), folded by the pure
 *    reducer in `packages/subagent-ui/roster.ts`.
 *  - The dashboard is opened with `ctx.ui.custom(...)` as a centered overlay and
 *    renders through the pure layout builders (title-in-border, left/right
 *    clusters, `... N more`) — icons from `packages/icons`, colors from Ayu.
 *  - The takeover streams a live transcript from
 *    `globalThis[Symbol.for("pi-subagents:manager")].getRecord(id).session
 *    .subscribe(...)` and steers via the PUBLIC `AgentSession.steer(text)` — no
 *    vendor patch is needed for either read or write.
 *
 * The vendor's own always-on widget and fleet view are turned off via a managed
 * `~/.pi/agent/subagents.json` (written by `scripts/link.sh` and the Nix module),
 * so its chrome does not double up with ours. The vendor's `/agents` command and
 * its menus stay vendor-styled — an accepted residual seam (design D5 / Q1).
 */

import type { Component, Focusable, TUI } from "@earendil-works/pi-tui";
import { Input, truncateToWidth, visibleWidth as visibleWidthOf } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";

import { publish } from "../packages/events/index.ts";
import { getIcons } from "../packages/icons/config.ts";
import type { IconSet } from "../packages/icons/types.ts";
import {
	applyLifecycle,
	emptyRoster,
	rosterList,
	rosterRows,
	rosterSummary,
	type AgentSnapshot,
	type AgentStatus,
	type LifecycleEvent,
	type RosterState,
} from "../packages/subagent-ui/roster.ts";
import { panelTopBorder, renderRoster, statusGlyph, statusWord } from "../packages/subagent-ui/layout.ts";
import {
	applyTranscriptEvent,
	buildTranscriptLines,
	emptyTranscript,
	type TranscriptEvent,
	type TranscriptState,
} from "../packages/subagent-ui/transcript.ts";
import { enterOverlay, exitOverlay } from "../packages/shared/overlay-gate.ts";

// --- structural view of the no-fork manager surface (never imported from vendor) ---

interface AgentSessionLike {
	subscribe(listener: (event: unknown) => void): () => void;
	steer(text: string): Promise<void>;
}

interface AgentRecordLike {
	session?: AgentSessionLike;
}

interface SubagentManager {
	getRecord(id: string): AgentRecordLike | undefined;
}

function getManager(): SubagentManager | undefined {
	const manager = (globalThis as Record<symbol, unknown>)[Symbol.for("pi-subagents:manager")];
	return manager as SubagentManager | undefined;
}

// --- roster store: folds lifecycle events, notifies open overlays ---------------

class RosterStore {
	private state: RosterState = emptyRoster();
	private readonly listeners = new Set<() => void>();

	apply(event: LifecycleEvent): void {
		this.state = applyLifecycle(this.state, event);
		for (const listener of this.listeners) listener();
	}

	list(): AgentSnapshot[] {
		return rosterList(this.state);
	}

	get(id: string): AgentSnapshot | undefined {
		return this.list().find((snap) => snap.id === id);
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}

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

// --- session event normalization (raw AgentSessionEvent -> TranscriptEvent) ------

function normalizeSessionEvent(event: unknown): TranscriptEvent | null {
	const record = asRecord(event);
	const type = record.type;

	switch (type) {
		case "message_start":
		case "message_update":
		case "message_end": {
			const message = asRecord(record.message);
			return { type, message: { role: str(message.role), content: message.content } };
		}
		case "tool_execution_start":
			return { type, toolCallId: str(record.toolCallId), toolName: str(record.toolName) };
		case "tool_execution_end":
			return {
				type,
				toolCallId: str(record.toolCallId),
				toolName: str(record.toolName),
				isError: record.isError === true,
				result: record.result,
			};
		default:
			return null;
	}
}

// --- dashboard overlay ----------------------------------------------------------

function keyHint(theme: Theme, text: string, width: number): string {
	return truncateToWidth(theme.fg("dim", text), width);
}

class SubagentDashboard implements Component {
	private selectedIndex = 0;
	private readonly unsubscribe: () => void;
	private readonly ticker: ReturnType<typeof setInterval>;
	private closed = false;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly store: RosterStore,
		private readonly icons: IconSet,
		private readonly done: (id: string | null) => void,
	) {
		this.unsubscribe = store.subscribe(() => this.tui.requestRender());
		this.ticker = setInterval(() => this.tui.requestRender(), 1000);
	}

	private clampSelection(count: number): void {
		if (count === 0) this.selectedIndex = 0;
		else this.selectedIndex = Math.min(Math.max(0, this.selectedIndex), count - 1);
	}

	private cleanup(): boolean {
		if (this.closed) return false;
		this.closed = true;
		this.unsubscribe();
		clearInterval(this.ticker);
		return true;
	}

	private close(result: string | null): void {
		if (this.cleanup()) this.done(result);
	}

	dispose(): void {
		this.cleanup();
	}

	handleInput(data: string): void {
		const list = this.store.list();
		this.clampSelection(list.length);

		if (data === "\x1b" || data === "q") {
			this.close(null);
			return;
		}
		if (data === "\r" || data === "\n") {
			const snap = list[this.selectedIndex];
			this.close(snap ? snap.id : null);
			return;
		}
		if ((data === "k" || data === "\x1b[A") && list.length > 0) {
			this.selectedIndex = (this.selectedIndex - 1 + list.length) % list.length;
			this.tui.requestRender();
			return;
		}
		if ((data === "j" || data === "\x1b[B") && list.length > 0) {
			this.selectedIndex = (this.selectedIndex + 1) % list.length;
			this.tui.requestRender();
		}
	}

	render(width: number): string[] {
		const theme = this.theme;
		const list = this.store.list();
		this.clampSelection(list.length);

		const rows = this.tui.terminal.rows || 30;
		const bodyHeight = Math.max(4, rows - 6);
		const innerWidth = Math.max(4, width - 2);
		const summary = rosterSummary(list);

		const lines: string[] = [];

		// Header: title left, count right.
		const headerLeft = theme.fg("accent", theme.bold("Subagents"));
		const headerRight = theme.fg("muted", `${summary.running} running · ${list.length} total`);
		const headerPad = Math.max(1, width - visibleWidthOf(headerLeft) - visibleWidthOf(headerRight) - 4);
		lines.push(truncateToWidth(`  ${headerLeft}${" ".repeat(headerPad)}${headerRight}  `, width));

		// Top border with the panel title embedded.
		lines.push(panelTopBorder(innerWidth, `agents · ${summary.settled}/${list.length}`, theme));

		const divider = theme.fg("border", "│");
		if (list.length === 0) {
			const empty = padTo(theme.fg("dim", "  (no subagents yet)"), innerWidth);
			lines.push(divider + empty + divider);
			for (let i = 1; i < bodyHeight; i++) lines.push(divider + " ".repeat(innerWidth) + divider);
		} else {
			const body = renderRoster(list, { width: innerWidth, height: bodyHeight, selectedIndex: this.selectedIndex }, this.icons, theme);
			for (let i = 0; i < bodyHeight; i++) lines.push(divider + padTo(body[i] ?? "", innerWidth) + divider);
		}

		lines.push(theme.fg("border", "╰") + theme.fg("border", "─".repeat(innerWidth)) + theme.fg("border", "╯"));
		lines.push(keyHint(theme, "  ↑/↓/jk select · ⏎ take over · q/esc close", width));

		return lines;
	}

	invalidate(): void {}
}

// --- takeover overlay -----------------------------------------------------------

const TRANSCRIPT_SCROLL_STEP = 6;

class TakeoverView implements Component, Focusable {
	private readonly input = new Input();
	private transcript: TranscriptState = emptyTranscript();
	private scrollOffset = 0;
	private renderTimer?: ReturnType<typeof setTimeout>;
	private readonly ticker: ReturnType<typeof setInterval>;
	private readonly unsubscribeSession: () => void;
	private readonly unsubscribeStore: () => void;
	private closed = false;

	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value;
	}

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly id: string,
		private readonly store: RosterStore,
		private readonly icons: IconSet,
		private readonly done: () => void,
	) {
		const session = getManager()?.getRecord(id)?.session;
		this.unsubscribeSession = session
			? session.subscribe((event) => {
					const normalized = normalizeSessionEvent(event);
					if (normalized) {
						this.transcript = applyTranscriptEvent(this.transcript, normalized);
						this.scheduleRender();
					}
				})
			: () => {};

		this.unsubscribeStore = store.subscribe(() => this.scheduleRender());
		this.ticker = setInterval(() => this.tui.requestRender(), 1000);

		this.input.onSubmit = (value: string) => {
			const text = value.trim();
			if (!text) return;
			this.input.setValue("");
			void this.steer(text);
			this.scrollOffset = 0;
			this.tui.requestRender();
		};
	}

	private async steer(text: string): Promise<void> {
		const session = getManager()?.getRecord(this.id)?.session;
		if (!session) return;
		try {
			await session.steer(text);
		} catch {
			// A steer can fail if the agent settled between keypress and delivery;
			// the transcript stream reflects the real state, so swallow it here.
		}
	}

	private scheduleRender(): void {
		if (this.renderTimer) return;
		// Streaming can emit an event per token; cap repaints so input never starves.
		this.renderTimer = setTimeout(() => {
			this.renderTimer = undefined;
			if (!this.closed) this.tui.requestRender();
		}, 50);
	}

	private cleanup(): boolean {
		if (this.closed) return false;
		this.closed = true;
		this.unsubscribeSession();
		this.unsubscribeStore();
		clearInterval(this.ticker);
		if (this.renderTimer) clearTimeout(this.renderTimer);
		this.renderTimer = undefined;
		return true;
	}

	private close(): void {
		if (this.cleanup()) this.done();
	}

	dispose(): void {
		this.cleanup();
	}

	private viewportHeight(): number {
		const rows = this.tui.terminal.rows || 30;
		return Math.max(6, rows - 8);
	}

	handleInput(data: string): void {
		if (data === "\x1b") {
			this.close();
			return;
		}
		if (data === "\x1b[A") {
			this.scrollOffset += TRANSCRIPT_SCROLL_STEP;
			this.tui.requestRender();
			return;
		}
		if (data === "\x1b[B") {
			this.scrollOffset = Math.max(0, this.scrollOffset - TRANSCRIPT_SCROLL_STEP);
			this.tui.requestRender();
			return;
		}
		this.input.handleInput(data);
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const theme = this.theme;
		const rule = theme.fg("borderAccent", "─".repeat(Math.max(1, width)));
		const lines: string[] = [];
		const snap = this.store.get(this.id);

		lines.push(rule);
		if (!snap) {
			lines.push(theme.fg("dim", `${this.id} is no longer tracked`));
			lines.push(rule);
			return lines;
		}

		const header =
			`${statusGlyph(snap.status, this.icons, theme)} ` +
			theme.fg("accent", theme.bold(`${snap.agentType} · ${snap.id}`)) +
			theme.fg("muted", `  ${snap.description}`) +
			theme.fg("dim", ` · `) +
			statusWord(snap.status, theme);
		lines.push(truncateToWidth(header, width));
		lines.push(rule);

		// Fixed-height transcript viewport so streaming deltas never resize the overlay.
		const viewport = this.viewportHeight();
		const all = buildTranscriptLines(this.transcript, width, theme, this.icons);
		const scrollRows = this.scrollOffset > 0 ? 1 : 0;
		const capacity = Math.max(1, viewport - scrollRows);
		const maxOffset = Math.max(0, all.length - capacity);
		if (this.scrollOffset > maxOffset) this.scrollOffset = maxOffset;

		const end = all.length - this.scrollOffset;
		const visible = all.slice(Math.max(0, end - capacity), end);

		const body: string[] = [];
		if (visible.length === 0) body.push(theme.fg("dim", "(no output yet)"));
		else body.push(...visible);
		if (this.scrollOffset > 0) body.push(keyHint(theme, `... ${this.scrollOffset} lines below · ↓`, width));
		while (body.length < viewport) body.push("");
		lines.push(...body.slice(0, viewport));

		lines.push(rule);
		lines.push(...this.input.render(width));
		lines.push(keyHint(theme, "⏎ steer · ↑/↓ scroll · esc back", width));
		lines.push(rule);
		return lines;
	}

	invalidate(): void {
		this.input.invalidate();
	}
}

// --- small width helpers --------------------------------------------------------

function padTo(text: string, width: number): string {
	const truncated = truncateToWidth(text, width);
	return truncated + " ".repeat(Math.max(0, width - visibleWidthOf(truncated)));
}

// --- overlay driver -------------------------------------------------------------

async function openDashboard(ctx: ExtensionContext, store: RosterStore, icons: IconSet): Promise<void> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("The subagent dashboard needs the interactive TUI.", "info");
		return;
	}

	enterOverlay();
	try {
		while (true) {
			if (store.list().length === 0) {
				ctx.ui.notify("No subagents are running.", "info");
				return;
			}

			const picked = await ctx.ui.custom<string | null>(
				(tui, theme, _keybindings: KeybindingsManager, done) => new SubagentDashboard(tui, theme, store, icons, done),
				{ overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" } },
			);

			if (!picked || !store.get(picked)) return;

			await ctx.ui.custom<void>(
				(tui, theme, _keybindings: KeybindingsManager, done) => new TakeoverView(tui, theme, picked, store, icons, done),
				{ overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" } },
			);
			// Returning from takeover falls back to the dashboard.
		}
	} finally {
		exitOverlay();
	}
}

// --- extension entry ------------------------------------------------------------

export default function subagentUi(pi: ExtensionAPI): void {
	const store = new RosterStore();
	const icons = getIcons();
	let currentCtx: ExtensionContext | undefined;

	const onChange = (): void => {
		const list = store.list();
		publish(pi, "harness:agents", { rows: rosterRows(list) });

		const summary = rosterSummary(list);
		currentCtx?.ui.setStatus("subagents", summary.running > 0 ? `subagents: ${summary.running} running · /fleet` : undefined);
	};

	const apply = (event: LifecycleEvent): void => {
		store.apply(event);
		onChange();
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

	pi.registerCommand("fleet", {
		description: "Open the subagent fleet dashboard (roster + live takeover).",
		handler: (_args, ctx) => openDashboard(ctx, store, icons),
	});
}
