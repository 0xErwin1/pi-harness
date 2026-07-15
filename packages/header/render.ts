import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { SUBTITLE, TITLE_LINES } from "./art.ts";
import { gradientText } from "./gradient.ts";

const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const ROW_PHASE_STEP = 0.05;
const SUBTITLE_PHASE = 0.2;

/**
 * The minimal theme surface the fallback path needs. The real `Theme` satisfies
 * it structurally; tests pass a stub that returns the text unchanged so
 * assertions can ignore ANSI coloring.
 */
export interface HeaderTheme {
	fg(role: ThemeColor, text: string): string;
}

function center(text: string, width: number): string {
	const padding = Math.max(0, Math.floor((width - visibleWidth(text)) / 2));
	return truncateToWidth(`${" ".repeat(padding)}${text}`, width);
}

/**
 * Builds the truecolor header: each art row and the subtitle are colored per
 * cell along the Ayu gradient, then centered. Chosen ONLY when the terminal
 * reports truecolor — this builder always constructs 24-bit escapes.
 */
export function renderGradientHeader(width: number): string[] {
	if (width <= 0) return [];

	const art = TITLE_LINES.map((line, row) => center(gradientText(line, row * ROW_PHASE_STEP), width));
	const subtitle = center(`${BOLD}${gradientText(SUBTITLE, SUBTITLE_PHASE)}${RESET}`, width);

	return ["", ...art, subtitle, ""];
}

/**
 * Builds the non-truecolor fallback: the SAME art rendered through the theme's
 * accent role, never touching a gradient escape. Keeping this a separate builder
 * from `renderGradientHeader` guarantees a raw 24-bit escape can never leak as
 * visible text on a terminal that cannot interpret it — nothing is built then
 * stripped.
 */
export function renderThemeHeader(width: number, theme: HeaderTheme): string[] {
	if (width <= 0) return [];

	const art = TITLE_LINES.map((line) => center(theme.fg("accent", line), width));
	const subtitle = center(theme.fg("accent", SUBTITLE), width);

	return ["", ...art, subtitle, ""];
}

/**
 * Decides whether to take the truecolor path. Prefers the verified `trueColor`
 * capability field; falls back to `COLORTERM` only when no capability object
 * exposes it.
 */
export function supportsTrueColor(
	capabilities: { trueColor?: boolean } | undefined,
	colorterm: string | undefined,
): boolean {
	if (capabilities && typeof capabilities.trueColor === "boolean") return capabilities.trueColor;

	return colorterm === "truecolor" || colorterm === "24bit";
}
