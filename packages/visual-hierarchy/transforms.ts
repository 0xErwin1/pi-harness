/**
 * Pure line-array transforms for visual hierarchy differentiation.
 *
 * Each transform is a `string[] → string[]` pure function that applies a
 * visual prefix to rendered component output. Callers are responsible for
 * stripping OSC 133 markers before calling and reapplying them after (see
 * osc133.ts), so these transforms receive and return clean body lines.
 *
 * The LineStyler interface is injected so the functions remain theme-agnostic
 * and unit-testable without a live TUI.
 */
import { truncateToWidth } from "@earendil-works/pi-tui";

/** Styling surface injected by callers; keeps transforms theme-agnostic. */
export interface LineStyler {
	fg(role: "dim" | "accent", text: string): string;
}

/**
 * Clamps every line to at most `width` visible columns (ANSI-aware).
 *
 * Prefixing a marker or indent onto a line the SDK already rendered at full
 * width pushes it past the terminal width, and pi-tui treats an over-width line
 * as a FATAL render error (it is not caught by safeRenderWrapper, since the
 * transform returns successfully — the host throws later in doRender). Every
 * patch must clamp its output with the render width to stay safe. A non-positive
 * width leaves the lines untouched.
 */
export function clampLineWidths(lines: string[], width: number): string[] {
	if (width <= 0) return lines;
	return lines.map((line) => truncateToWidth(line, width));
}

const MARKER_GLYPH  = "❯ ";
const MARKER_INDENT = "  ";

/**
 * Prefixes user message lines with a subtle accent left accent (R2).
 *
 * First line: accent-styled `❯ ` marker. Subsequent lines: two-space indent
 * that aligns content with the first line. Line count is unchanged.
 * OSC 133 markers must be stripped by the caller before this is invoked.
 */
export function applyUserMarker(lines: string[], styler: LineStyler): string[] {
	if (lines.length === 0) return [];
	const marker = styler.fg("accent", MARKER_GLYPH);
	return lines.map((line, idx) => (idx === 0 ? marker : MARKER_INDENT) + line);
}
