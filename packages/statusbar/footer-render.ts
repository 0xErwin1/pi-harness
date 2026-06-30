import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import type { IconSet } from "../icons/types.ts";
import { getIcons } from "../icons/config.ts";
import {
	type ContextUsageLike,
	type ThemeLike,
	formatTokens,
	renderContextBar,
} from "./context-bar.ts";
import type { DiffCounts } from "./git-diff.ts";
import { type UsageWindow, formatUsageWindow } from "./usage.ts";

/** Cumulative token/cost stats preserved from the built-in footer (line 3). */
export interface CumulativeStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	/** Whether the active model bills via an OAuth subscription (adds `(sub)`). */
	sub: boolean;
}

export interface FooterRenderInput {
	model: string;
	effort?: string;
	effortRole?: ThemeColor;
	context: ContextUsageLike;
	dir: string;
	branch: string | null;
	git: DiffCounts;
	usageWindows: UsageWindow[];
	cumulative: CumulativeStats;
	statuses: ReadonlyMap<string, string>;
	theme?: ThemeLike;
	iconProvider?: () => IconSet;
	cells?: number;
}

const MIN_PADDING = 2;

/**
 * Emoji and pictographic characters (plus the U+FE0F variation selector) that other
 * extensions may embed in their status text (e.g. a brain glyph). The harness never
 * renders emoji, so they are stripped from third-party status text before display.
 * Text-presentation dingbats such as `·` and `✓` are intentionally left untouched.
 */
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;

function paint(theme: ThemeLike | undefined, role: ThemeColor, text: string): string {
	return theme ? theme.fg(role, text) : text;
}

/**
 * Normalizes third-party status text for the single-line footer: control characters
 * become spaces, emoji/pictographs are removed (the harness never shows emoji), and
 * runs of whitespace collapse so a stray glyph never breaks the layout.
 */
function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(EMOJI_RE, "")
		.replace(/ +/g, " ")
		.trim();
}

/**
 * Right-aligns `right` against `left` within `width`, mirroring the built-in
 * footer: at least `MIN_PADDING` spaces between them, the left side truncated if
 * it alone overflows, the right side truncated (then dropped) when space runs out.
 */
function composeLeftRight(left: string, right: string, width: number): string {
	let leftStr = left;
	let leftWidth = visibleWidth(leftStr);

	if (leftWidth > width) {
		leftStr = truncateToWidth(leftStr, width, "...");
		leftWidth = visibleWidth(leftStr);
	}

	const rightWidth = visibleWidth(right);
	if (leftWidth + MIN_PADDING + rightWidth <= width) {
		return leftStr + " ".repeat(width - leftWidth - rightWidth) + right;
	}

	const availableForRight = width - leftWidth - MIN_PADDING;
	if (availableForRight <= 0) return leftStr;

	const truncatedRight = truncateToWidth(right, availableForRight, "");
	const padding = " ".repeat(Math.max(0, width - leftWidth - visibleWidth(truncatedRight)));
	return leftStr + padding + truncatedRight;
}

/** `(+A,-R)`, with the added/removed counts theme-colored. Empty when no diff. */
export function formatGitCounts(git: DiffCounts, theme?: ThemeLike): string {
	if (git.added === 0 && git.removed === 0) return "";

	const added = paint(theme, "toolDiffAdded", `+${git.added}`);
	const removed = paint(theme, "toolDiffRemoved", `-${git.removed}`);

	return `(${added},${removed})`;
}

function buildLine1(input: FooterRenderInput, width: number, icons: IconSet): string {
	const segments = [input.model];
	if (input.effort) {
		segments.push(paint(input.theme, input.effortRole ?? "dim", input.effort));
	}
	segments.push(
		renderContextBar(input.context, {
			cells: input.cells,
			iconProvider: input.iconProvider,
			theme: input.theme,
		}),
	);
	const left = segments.join(" · ");

	const rightSegments = [paint(input.theme, "dim", input.dir)];
	if (input.branch) {
		rightSegments.push(paint(input.theme, "dim", `${icons.branch} ${input.branch}`));
	}
	const gitCounts = formatGitCounts(input.git, input.theme);
	if (gitCounts) rightSegments.push(gitCounts);

	return composeLeftRight(left, rightSegments.join(" "), width);
}

function buildUsageLine(windows: UsageWindow[], width: number, theme?: ThemeLike): string | undefined {
	if (windows.length === 0) return undefined;

	const text = windows.map(formatUsageWindow).join(" · ");
	return truncateToWidth(paint(theme, "muted", text), width, paint(theme, "dim", "..."));
}

function buildStatsLine(stats: CumulativeStats, width: number, icons: IconSet, theme?: ThemeLike): string | undefined {
	const parts: string[] = [];

	if (stats.input) parts.push(`${icons.arrowUp}${formatTokens(stats.input)}`);
	if (stats.output) parts.push(`${icons.arrowDown}${formatTokens(stats.output)}`);
	if (stats.cacheRead) parts.push(`R${formatTokens(stats.cacheRead)}`);
	if (stats.cacheWrite) parts.push(`W${formatTokens(stats.cacheWrite)}`);
	if (stats.cost || stats.sub) parts.push(`$${stats.cost.toFixed(3)}${stats.sub ? " (sub)" : ""}`);

	if (parts.length === 0) return undefined;

	return truncateToWidth(paint(theme, "dim", parts.join(" ")), width, paint(theme, "dim", "..."));
}

function buildStatusLine(statuses: ReadonlyMap<string, string>, width: number, theme?: ThemeLike): string | undefined {
	if (statuses.size === 0) return undefined;

	const text = Array.from(statuses.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, value]) => sanitizeStatusText(value))
		.join(" ");

	return truncateToWidth(text, width, paint(theme, "dim", "..."));
}

/**
 * Builds the custom footer lines from already-resolved primitives. Width-aware
 * and self-contained; the impure wiring resolves the primitives each frame.
 *
 *   line 1  model · effort · [ctx-bar] tokens/window (pct%)   dir branch (+A,-R)
 *   line 2  provider-agnostic usage windows (omitted when none)
 *   line 3  cumulative ↑in ↓out Rread Wwrite $cost(sub) (omitted when empty)
 *   line 4  extension statuses (omitted when none) — preserved verbatim
 */
export function composeFooterLines(input: FooterRenderInput, width: number): string[] {
	if (width <= 0) return [];

	const icons = (input.iconProvider ?? getIcons)();
	const lines: string[] = [buildLine1(input, width, icons)];

	const usageLine = buildUsageLine(input.usageWindows, width, input.theme);
	if (usageLine !== undefined) lines.push(usageLine);

	const statsLine = buildStatsLine(input.cumulative, width, icons, input.theme);
	if (statsLine !== undefined) lines.push(statsLine);

	const statusLine = buildStatusLine(input.statuses, width, input.theme);
	if (statusLine !== undefined) lines.push(statusLine);

	return lines;
}
