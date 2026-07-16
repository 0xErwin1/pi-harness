import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";

import type { IconSet } from "../icons/types.ts";
import type { AgentSnapshot, AgentStatus } from "./roster.ts";
import type { UiTheme } from "./theme.ts";

/**
 * Pure layout composition for the subagent dashboard panel.
 *
 * Adopts my-pi-setup's LAYOUT — a panel whose title lives inside the top border,
 * rows with a left cluster (marker + status glyph + type + description) and a
 * right-aligned stat cluster, gap-filled between, with `... N more` truncation —
 * but sources every glyph from `packages/icons` and every color from the Ayu
 * theme roles. The monochrome `■` / `❯` sigils are deliberately NOT used.
 *
 * These functions are pure string builders (width math via pi-tui's
 * `visibleWidth`/`truncateToWidth`), so the interactive `ctx.ui.custom` glue in
 * the extension stays thin and untested surface is minimal.
 */

/** Format milliseconds as compact seconds: "4.2s". */
export function formatDuration(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

/** Abbreviate a token total: 150 -> "150", 33800 -> "33.8k". */
export function formatTokens(total: number): string {
	return total >= 1000 ? `${(total / 1000).toFixed(1)}k` : `${total}`;
}

/** Format elapsed milliseconds as a relative-time label: "45s ago", "3m ago", "1h4m ago". */
export function formatRelative(elapsedMs: number): string {
	const seconds = Math.floor(elapsedMs / 1000);
	if (seconds < 60) return `${seconds}s ago`;

	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;

	const hours = Math.floor(minutes / 60);
	return `${hours}h${minutes % 60}m ago`;
}

const STATUS_ROLE: Record<AgentStatus, ThemeColor> = {
	queued: "muted",
	running: "warning",
	completed: "success",
	steered: "warning",
	aborted: "warning",
	stopped: "dim",
	error: "error",
};

const STATUS_WORD: Record<AgentStatus, string> = {
	queued: "queued",
	running: "running",
	completed: "done",
	steered: "steered",
	aborted: "aborted",
	stopped: "stopped",
	error: "failed",
};

/**
 * The icon-set glyph for a status, colored by its Ayu role. Running/queued reuse
 * the header/clock glyphs; terminal states reuse the agent lifecycle glyphs.
 */
export function statusGlyph(status: AgentStatus, icons: IconSet, theme: UiTheme): string {
	const role = STATUS_ROLE[status];

	switch (status) {
		case "queued":
			return theme.fg(role, icons.agentStale);
		case "running":
			return theme.fg(role, icons.headerActive);
		case "completed":
			return theme.fg(role, icons.agentDone);
		case "steered":
			return theme.fg(role, icons.agentDone);
		case "stopped":
			return theme.fg(role, icons.agentInterrupted);
		case "aborted":
			return theme.fg(role, icons.agentInterrupted);
		case "error":
			return theme.fg(role, icons.agentFailed);
	}
}

/** The lifecycle status word, colored by its Ayu role. */
export function statusWord(status: AgentStatus, theme: UiTheme): string {
	return theme.fg(STATUS_ROLE[status], STATUS_WORD[status]);
}

/**
 * The panel's top border with the title embedded in the border run, e.g.
 * `╭─ agents · 1/3 ──────╮`. `innerWidth` is the interior width; the returned
 * line spans `innerWidth + 2` columns including the corners.
 */
export function panelTopBorder(innerWidth: number, title: string, theme: UiTheme): string {
	const label = title ? ` ${truncateToWidth(title, Math.max(0, innerWidth - 3))} ` : "";
	const labelWidth = visibleWidth(label);
	const trailing = Math.max(0, innerWidth - 1 - labelWidth);

	return (
		theme.fg("border", "╭") +
		theme.fg("border", "─") +
		(label ? theme.fg("text", label) : "") +
		theme.fg("border", "─".repeat(trailing)) +
		theme.fg("border", "╮")
	);
}

export interface RowOptions {
	selected: boolean;
	width: number;
	/** Current clock reading, injected so builders never read the clock themselves. */
	now?: number;
	/** This agent's start time, used to render a running agent's relative elapsed time. */
	startedAt?: number;
}

/**
 * The `·`-separated right stat cluster: tool uses, tokens, elapsed/duration,
 * status word. A settled `durationMs` always wins; while running (no
 * `durationMs` yet), `now`/`startedAt` — when both are available — render a
 * relative "Nm ago" marker instead. Neither being available leaves the
 * timestamp segment out entirely rather than throwing.
 */
function statCluster(snap: AgentSnapshot, theme: UiTheme, now?: number, startedAt?: number): string {
	const parts: string[] = [];

	if (snap.toolUses > 0) parts.push(theme.fg("muted", `${snap.toolUses} tool${snap.toolUses === 1 ? "" : "s"}`));
	if (snap.tokens) parts.push(theme.fg("muted", `${formatTokens(snap.tokens.total)} tok`));

	if (snap.durationMs != null) {
		parts.push(theme.fg("muted", formatDuration(snap.durationMs)));
	} else if (now != null && startedAt != null) {
		parts.push(theme.fg("muted", formatRelative(now - startedAt)));
	}

	parts.push(statusWord(snap.status, theme));

	return parts.join(theme.fg("dim", " · "));
}

/**
 * A single roster row: a left cluster (selection marker, status glyph, agent type,
 * description, dim id) and a right-aligned stat cluster, gap-filled to exactly
 * `width` columns.
 */
export function renderRow(snap: AgentSnapshot, opts: RowOptions, icons: IconSet, theme: UiTheme): string {
	const marker = opts.selected ? theme.fg("accent", icons.selection) : " ";
	const glyph = statusGlyph(snap.status, icons, theme);
	const type = opts.selected ? theme.fg("accent", theme.bold(snap.agentType)) : theme.fg("toolTitle", snap.agentType);
	const description = theme.fg("muted", snap.description);
	const id = theme.fg("dim", snap.id);

	const left = ` ${marker} ${glyph} ${type}  ${description} ${id}`;
	const right = `${statCluster(snap, theme, opts.now, opts.startedAt)} `;

	const rightWidth = visibleWidth(right);
	const leftMax = Math.max(0, opts.width - rightWidth - 2);
	const leftTruncated = truncateToWidth(left, leftMax);
	const gap = Math.max(2, opts.width - visibleWidth(leftTruncated) - rightWidth);

	return truncateToWidth(leftTruncated + " ".repeat(gap) + right, opts.width);
}

export interface RosterOptions {
	width: number;
	height: number;
	selectedIndex: number;
	/** Current clock reading, threaded through to each row's relative-time column. */
	now?: number;
	/** Per-agent start times, keyed by agent id, for the relative-time column. */
	startedAt?: ReadonlyMap<string, number>;
}

/**
 * Render the roster body as at most `height` lines, scrolling a window around the
 * selection and replacing the first/last visible line with a `... N more` marker
 * when agents are hidden above/below.
 */
export function renderRoster(
	list: readonly AgentSnapshot[],
	opts: RosterOptions,
	icons: IconSet,
	theme: UiTheme,
): string[] {
	const { width, height, selectedIndex, now, startedAt } = opts;

	let start = 0;
	if (list.length > height) {
		start = Math.min(Math.max(0, selectedIndex - Math.floor(height / 2)), list.length - height);
	}

	const visible = list.slice(start, start + height);
	const out = visible.map((snap, i) =>
		renderRow(snap, { selected: start + i === selectedIndex, width, now, startedAt: startedAt?.get(snap.id) }, icons, theme),
	);

	if (start > 0 && out.length > 0) {
		out[0] = truncateToWidth(theme.fg("dim", `   ... ${start} more`), width);
	}
	if (start + height < list.length && out.length > 0) {
		const hiddenBelow = list.length - start - height;
		out[out.length - 1] = truncateToWidth(theme.fg("dim", `   ... ${hiddenBelow} more`), width);
	}

	return out;
}
