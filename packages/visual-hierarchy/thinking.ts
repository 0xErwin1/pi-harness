/**
 * Thinking-block collapse/expand for visual hierarchy.
 *
 * Provides pure, unit-testable functions for collapsing and expanding the
 * thinking section of an assistant message. The collapse transform replaces a
 * contiguous run of thinking lines with a single summary line; the expand
 * transform is a passthrough (the SDK already applies de-emphasized styling).
 *
 * All functions are pure and theme-agnostic — callers inject a LineStyler so
 * these remain unit-testable without a live TUI.
 */
import type { LineStyler } from "./transforms.ts";

export interface ThinkingViewState {
	collapsed: boolean;
}

/**
 * Counts the total number of lines across all thinking blocks in a message
 * content array.
 *
 * Defensively handles any malformed, missing, or non-thinking input by
 * returning 0. The content structure mirrors the Anthropic API's `content`
 * array on assistant messages.
 */
export function thinkingLineCount(content: unknown): number {
	if (!Array.isArray(content)) return 0;

	let count = 0;

	for (const block of content) {
		if (
			block !== null &&
			typeof block === "object" &&
			(block as Record<string, unknown>).type === "thinking" &&
			typeof (block as Record<string, unknown>).thinking === "string"
		) {
			const text = (block as Record<string, unknown>).thinking as string;
			count += text.split("\n").length;
		}
	}

	return count;
}

/**
 * Produces the collapsed thinking summary line.
 *
 * Returns a dim-styled "▸ thinking · N líneas" string. N is the thinking line
 * count obtained from `thinkingLineCount`. No emoji, no U+FE0F — only unicode
 * box/arrow glyphs and ASCII.
 */
export function summarizeThinking(n: number, styler: LineStyler): string {
	return styler.fg("dim", `▸ thinking · ${n} líneas`);
}

/**
 * Transforms a rendered body-line array by collapsing or expanding the
 * thinking section.
 *
 * Scans lines using the injected `isThinking` predicate to locate the
 * contiguous thinking run. The outcome depends on the run count:
 * - No thinking lines: passthrough (unchanged).
 * - Multiple non-contiguous runs: ambiguous → passthrough (fail-safe).
 * - Exactly one contiguous run + collapsed: replace the run with `summary`.
 * - Exactly one contiguous run + expanded: passthrough (SDK styling preserved).
 *
 * OSC 133 markers must be stripped by the caller before passing lines here
 * (see osc133.ts).
 */
export function collapseThinkingLines(
	lines: string[],
	isThinking: (line: string) => boolean,
	collapsed: boolean,
	summary: string,
): string[] {
	if (lines.length === 0) return lines;

	let runStart = -1;
	let runEnd = -1;
	let inRun = false;
	let runCount = 0;

	for (let i = 0; i < lines.length; i++) {
		if (isThinking(lines[i])) {
			if (!inRun) {
				inRun = true;
				runStart = i;
				runCount++;
			}
			runEnd = i;
		} else {
			if (inRun) inRun = false;
		}
	}

	if (runCount !== 1) return lines;

	if (!collapsed) return lines;

	const result = lines.slice(0, runStart);
	result.push(summary);
	result.push(...lines.slice(runEnd + 1));
	return result;
}

/**
 * Pure reducer for the thinking collapse/expand state.
 *
 * Returns a new state with `collapsed` toggled. Does not mutate the input.
 * The default session state is collapsed; this function produces deterministic
 * transitions: collapsed→expanded→collapsed.
 */
export function toggleThinking(state: ThinkingViewState): ThinkingViewState {
	return { collapsed: !state.collapsed };
}
