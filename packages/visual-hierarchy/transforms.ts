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
