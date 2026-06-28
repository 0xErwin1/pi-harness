import type { ThemeColor } from "@mariozechner/pi-coding-agent";
import type { IconSet } from "../icons/types.ts";
import { getIcons } from "../icons/config.ts";

/**
 * Minimal theme surface used by the statusbar layer. The real `Theme` from
 * pi-coding-agent satisfies it structurally; tests pass a stub that returns the
 * text unchanged so assertions can ignore ANSI coloring.
 */
export interface ThemeLike {
	fg(role: ThemeColor, text: string): string;
}

/**
 * Token-count formatter matching the built-in footer exactly:
 *   <1000      → plain integer
 *   <10_000    → x.xk
 *   <1_000_000 → xxxk
 *   <10_000_000 → x.xM
 *   otherwise  → xxxM
 */
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

/** Context usage primitives the bar renders from. */
export interface ContextUsageLike {
	percent: number | null;
	tokens?: number | null;
	contextWindow?: number;
}

export interface ContextBarOptions {
	/** Number of bar cells. Defaults to 10. */
	cells?: number;
	/** Icon provider, injectable for tests. Defaults to the active registry. */
	iconProvider?: () => IconSet;
	/** Theme for threshold coloring. When omitted, the bar is uncolored. */
	theme?: ThemeLike;
}

/**
 * Threshold color role mirroring the built-in footer: <70% healthy, 70-90%
 * warning, >90% critical. Unknown usage (null percent) is muted.
 */
export function barColorRole(percent: number | null): ThemeColor {
	if (percent === null) return "muted";
	if (percent > 90) return "error";
	if (percent > 70) return "warning";
	return "success";
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/**
 * The fixed-width glyph run: `barFull` for the filled portion, `barEmpty` for
 * the remainder. `filled = round(percent/100 * cells)`, clamped to the bar. A
 * null percent (unknown usage, e.g. right after compaction) renders as empty.
 */
export function contextBarRun(
	percent: number | null,
	cells: number,
	icons: IconSet,
): string {
	const filled = percent === null ? 0 : clamp(Math.round((percent / 100) * cells), 0, cells);
	const empty = cells - filled;

	return icons.barFull.repeat(filled) + icons.barEmpty.repeat(empty);
}

/**
 * Renders the full context segment for footer line 1:
 *   `[<bar>] <tokens>/<window> (<pct>%)`
 *
 * Tokens and percent fall back to `?` when unknown (null), matching the
 * built-in footer's post-compaction display. The bar run and percent are
 * threshold-colored; the rest is left plain so the caller controls framing.
 */
export function renderContextBar(
	usage: ContextUsageLike,
	options: ContextBarOptions = {},
): string {
	const cells = options.cells ?? 10;
	const icons = (options.iconProvider ?? getIcons)();
	const theme = options.theme;

	const paint = (role: ThemeColor, text: string): string =>
		theme ? theme.fg(role, text) : text;

	const role = barColorRole(usage.percent);
	const run = paint(role, contextBarRun(usage.percent, cells, icons));

	const tokensText = usage.tokens == null ? "?" : formatTokens(usage.tokens);
	const windowText = formatTokens(usage.contextWindow ?? 0);
	const pctText = usage.percent === null ? "?%" : `${usage.percent.toFixed(1)}%`;

	return `[${run}] ${tokensText}/${windowText} (${paint(role, pctText)})`;
}
