/**
 * User message accent formatter.
 *
 * Applies a subtle left accent (`❯ ` on the first line, aligned two-space
 * indent on subsequent lines) to a set of pre-rendered content lines. The
 * caller is responsible for rendering the markdown content at `ctx.maxWidth - 2`
 * so that after the 2-char marker is prepended each resulting line fits exactly
 * within the available width. Every line passes through `LineBuffer` for
 * structural width-safety.
 *
 * The formatter is pure: it has no pi-tui dependency. Colour comes from the
 * injected `ctx.styler`; the `❯` glyph is unicode, never emoji.
 */

import { LineBuffer, type RenderCtx } from "../width.ts";

const MARKER_GLYPH  = "❯ ";
const MARKER_INDENT = "  ";

/**
 * Prefixes user message content lines with a subtle left accent.
 *
 * - First line: `ctx.styler.fg("accent", "❯ ")` + line content.
 * - Subsequent lines: `"  "` (two plain spaces) + line content.
 *
 * Every line is pushed through `LineBuffer`, which clamps to `ctx.maxWidth`.
 * An empty `lines` array returns an empty array immediately.
 *
 * Callers must strip OSC 133 markers before passing `lines` and reapply them
 * to the returned array (see `osc133.ts`). Content should be rendered at
 * `ctx.maxWidth - 2` so that the added marker keeps each line within bounds.
 */
export function applyUserMarker(lines: string[], ctx: RenderCtx): string[] {
	if (lines.length === 0) return [];

	const marker = ctx.styler.fg("accent", MARKER_GLYPH);
	const lb = new LineBuffer(ctx);

	for (let i = 0; i < lines.length; i++) {
		lb.push((i === 0 ? marker : MARKER_INDENT) + lines[i]);
	}

	return lb.done();
}
