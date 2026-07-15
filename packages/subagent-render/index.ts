import { Container, type Component, Text } from "@earendil-works/pi-tui";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";

import type { IconSet } from "../icons/types.ts";
import { getIcons } from "../icons/config.ts";

/**
 * Render logic for the vendored tintinweb `Agent` tool-call card.
 *
 * This module is the type-checked home of the ~90 render lines that used to live
 * inline in `vendor/pi-subagents/src/index.ts`. The vendor entry now delegates to
 * `renderAgentCall`/`renderAgentResult` here. The logic lives in `packages/`
 * because `tsconfig` excludes `vendor/**` from `tsc --noEmit`, so an in-place fork
 * would be entirely un-type-checked.
 *
 * HARD RULE: this module MUST NOT import anything from `vendor/`. `tsconfig`'s
 * `exclude` only filters the initial file set; tsc still follows imports, so a
 * `packages/ -> vendor/` import would drag the whole vendored tree into the
 * type-check program. The `AgentCardDetails` shape below is therefore declared
 * structurally rather than imported from the vendor's `AgentDetails`. Drift
 * against the real vendor shape is covered by the status-matrix fixture test and
 * the runtime load test.
 *
 * Aesthetic (decision #10024): glyphs come from `packages/icons` (nerdfont by
 * default, honoring `PI_HARNESS_ICONS`) and colors from the Ayu theme roles. The
 * vendor's hardcoded `⏺`/`✓`/`✗`/`■` literals are replaced with catalog glyphs.
 * The truecolor gradient is header-only and never appears here.
 */

/** The minimal theme surface the card consumes; the real pi `Theme` satisfies it structurally. */
export interface CardTheme {
	fg(color: ThemeColor, text: string): string;
	bold(text: string): string;
}

/** Arguments the Agent tool-call card reads at call time. `displayName` is resolved vendor-side. */
export interface AgentCall {
	displayName: string;
	description?: string;
}

/** The lifecycle statuses the vendor attaches to an Agent result's details. */
export type AgentCardStatus =
	| "queued"
	| "running"
	| "completed"
	| "steered"
	| "aborted"
	| "stopped"
	| "error"
	| "background";

/**
 * The subset of the vendor's `AgentDetails` this card reads. Declared structurally
 * (see the HARD RULE above) — NOT imported from `vendor/`.
 */
export interface AgentCardDetails {
	status: AgentCardStatus;
	toolUses: number;
	tokens: string;
	durationMs: number;
	activity?: string;
	spinnerFrame?: number;
	modelName?: string;
	tags?: string[];
	turnCount?: number;
	maxTurns?: number;
	agentId?: string;
	error?: string;
}

/** One entry of a tool result's content array. */
export interface AgentResultContent {
	type: string;
	text?: string;
}

/** The Agent tool result the card renders. */
export interface AgentResult {
	content: AgentResultContent[];
	details?: AgentCardDetails;
}

/** Render-state flags pi passes alongside the result. */
export interface AgentResultState {
	expanded: boolean;
	isPartial: boolean;
}

const MAX_EXPANDED_LINES = 50;

/** Format turn count with an optional cap: "↻5≤30" or "↻5". */
function formatTurns(turnCount: number, maxTurns?: number | null): string {
	return maxTurns != null ? `↻${turnCount}≤${maxTurns}` : `↻${turnCount}`;
}

/** Format milliseconds as a compact human duration: "4.2s". */
function formatMs(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

/** Pick the spinner frame for the current tick, tolerating an out-of-range index. */
function spinnerFrame(icons: IconSet, index: number | undefined): string {
	const frames = icons.spinner;
	if (frames.length === 0) return "";
	return frames[(index ?? 0) % frames.length] ?? frames[0] ?? "";
}

/** Build the dim, `·`-separated stats cluster ("haiku · thinking: high · ↻5≤30 · 3 tool uses · 33.8k token"). */
function statsCluster(d: AgentCardDetails, theme: CardTheme): string {
	const parts: string[] = [];

	if (d.modelName) parts.push(d.modelName);
	if (d.tags) parts.push(...d.tags);
	if (d.turnCount != null && d.turnCount > 0) parts.push(formatTurns(d.turnCount, d.maxTurns));
	if (d.toolUses > 0) parts.push(`${d.toolUses} tool use${d.toolUses === 1 ? "" : "s"}`);
	if (d.tokens) parts.push(d.tokens);

	const separator = " " + theme.fg("dim", "·") + " ";
	return parts.map((p) => theme.fg("dim", p)).join(separator);
}

/** A tree-connected detail line ("  └  Done"), using the icon-set connector glyph. */
function detailLine(icons: IconSet, theme: CardTheme, role: ThemeColor, text: string): string {
	return theme.fg(role, `  ${icons.treeSub}  ${text}`);
}

/** The two-line streaming card: a spinner + stats line above a tree-connected activity line. */
function streamingCard(details: AgentCardDetails, icons: IconSet, theme: CardTheme): Container {
	const frame = spinnerFrame(icons, details.spinnerFrame);
	const stats = statsCluster(details, theme);
	const activity = details.activity ?? "thinking…";

	const container = new Container();
	container.addChild(new Text(theme.fg("accent", frame) + (stats ? " " + stats : ""), 0, 0));
	container.addChild(new Text(detailLine(icons, theme, "dim", activity), 0, 0));

	return container;
}

/** Extract the first text block from a result's content, or "" when there is none. */
function bodyText(result: AgentResult): string {
	const first = result.content[0];
	return first?.type === "text" ? (first.text ?? "") : "";
}

/**
 * Render the Agent tool-call header line: an icon-set chevron, the bold display
 * name, and an optional muted description.
 */
export function renderAgentCall(call: AgentCall, theme: CardTheme, icons: IconSet = getIcons()): Component {
	const chevron = theme.fg("toolTitle", icons.chevron);
	const title = theme.fg("toolTitle", theme.bold(call.displayName));
	const description = call.description ? "  " + theme.fg("muted", call.description) : "";

	return new Text(`${chevron} ${title}${description}`, 0, 0);
}

/**
 * Render the Agent tool result card across every lifecycle status. Handles the
 * in-progress (streaming) state, background hand-off, completion (collapsed or
 * expanded transcript), user stop, and error/aborted outcomes. A result without
 * details renders its plain text body verbatim.
 */
export function renderAgentResult(
	result: AgentResult,
	state: AgentResultState,
	theme: CardTheme,
	icons: IconSet = getIcons(),
): Component {
	const details = result.details;
	const body = bodyText(result);

	if (!details) {
		return new Text(body, 0, 0);
	}

	const stats = statsCluster(details, theme);

	if (state.isPartial || details.status === "running") {
		return streamingCard(details, icons, theme);
	}

	if (details.status === "background") {
		const label = `Running in background (ID: ${details.agentId ?? "?"})`;
		return new Text(detailLine(icons, theme, "dim", label), 0, 0);
	}

	if (details.status === "completed" || details.status === "steered") {
		const isSteered = details.status === "steered";
		const glyph = theme.fg(isSteered ? "warning" : "success", icons.agentDone);
		const duration = formatMs(details.durationMs);

		let line = glyph + (stats ? " " + stats : "");
		line += " " + theme.fg("dim", "·") + " " + theme.fg("dim", duration);

		if (state.expanded && body) {
			const lines = body.split("\n").slice(0, MAX_EXPANDED_LINES);
			for (const l of lines) {
				line += "\n" + theme.fg("dim", `  ${l}`);
			}
			if (body.split("\n").length > MAX_EXPANDED_LINES) {
				line += "\n" + theme.fg("muted", "  ... (use get_subagent_result with verbose for full output)");
			}
		} else {
			const doneText = isSteered ? "Wrapped up (turn limit)" : "Done";
			line += "\n" + detailLine(icons, theme, "dim", doneText);
		}

		return new Text(line, 0, 0);
	}

	if (details.status === "stopped") {
		const glyph = theme.fg("dim", icons.agentInterrupted);
		let line = glyph + (stats ? " " + stats : "");
		line += "\n" + detailLine(icons, theme, "dim", "Stopped");
		return new Text(line, 0, 0);
	}

	// Error / aborted (and any residual status), mirroring the vendor's fall-through.
	const glyph = theme.fg("error", icons.agentFailed);
	let line = glyph + (stats ? " " + stats : "");

	if (details.status === "error") {
		line += "\n" + detailLine(icons, theme, "error", `Error: ${details.error ?? "unknown"}`);
	} else {
		line += "\n" + detailLine(icons, theme, "warning", "Aborted (max turns exceeded)");
	}

	return new Text(line, 0, 0);
}
