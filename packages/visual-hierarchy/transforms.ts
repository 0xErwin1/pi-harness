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

/** Styling surface injected by callers; keeps transforms theme-agnostic. */
export interface LineStyler {
	fg(role: "dim" | "accent", text: string): string;
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
