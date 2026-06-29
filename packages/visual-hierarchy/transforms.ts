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

const GUTTER_GLYPH = "│ ";

/**
 * Prefixes every line with a dim left-bar gutter `│ ` (R1).
 *
 * The line count is unchanged: no lines are added, removed, split, or merged.
 * OSC 133 markers must be stripped by the caller before this is invoked.
 */
export function applyAssistantGutter(lines: string[], styler: LineStyler): string[] {
	const prefix = styler.fg("dim", GUTTER_GLYPH);
	return lines.map((line) => prefix + line);
}
