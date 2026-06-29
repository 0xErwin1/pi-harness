/**
 * Thinking-block grouped formatter for the render-core.
 *
 * Provides `splitThinkingTitle` and `renderThinkingBlock`, the shared thinking
 * presentation primitives used by both the main-thread prototype patch (S7) and
 * the subagent viewer. Moving them here establishes parity: both surfaces call
 * the same functions, so strip-ANSI of their output is identical.
 *
 * Visual contract (matches the viewer's THINKING_HEADER / THINKING_BODY_PREFIX):
 *   - Header line: dim `Thinking` or `Thinking: <title>`
 *   - Body lines: dim `│ <wrapped content line>`
 *   - No emoji; unicode box-drawing glyph `│` (U+2502) only.
 *
 * All emitted lines pass through `LineBuffer` so over-width output is impossible.
 */

import { LineBuffer, type RenderCtx } from "../width.ts";

/** Header label for a thinking block. Shared so both consumers stay byte-identical. */
export const THINKING_HEADER = "Thinking";
/** Dim gutter prefix for each wrapped thinking body line. Shared across consumers. */
export const THINKING_BODY_PREFIX = "│ ";

/**
 * Splits a thinking text into an optional display title and the remaining body.
 *
 * Recognises two patterns in which the model leads its own reasoning:
 * - A markdown bold span at the start (`**Title**`) — the bold text becomes the
 *   title and everything after it is the body.
 * - A `Thinking:` prefix (case-insensitive) — the text on that same line becomes
 *   the title and everything after the first newline is the body.
 *
 * When neither pattern matches the whole text is the body with no title, so the
 * rendered header is the bare `Thinking` label (never doubled-up as
 * `Thinking: Thinking:`).
 */
export function splitThinkingTitle(text: string): { title?: string; body: string } {
	const trimmed = text.trim();

	const bold = trimmed.match(/^\*\*(.+?)\*\*\s*/);
	if (bold) {
		const title = bold[1].trim() || undefined;
		const body = trimmed.slice(bold[0].length).trim();
		return { title, body };
	}

	if (/^Thinking:/i.test(trimmed)) {
		const afterLabel = trimmed.replace(/^Thinking:\s*/i, "");
		const newlineAt = afterLabel.indexOf("\n");
		if (newlineAt >= 0) {
			return {
				title: afterLabel.slice(0, newlineAt).trim() || undefined,
				body: afterLabel.slice(newlineAt + 1).trim(),
			};
		}
		return { title: afterLabel.trim() || undefined, body: "" };
	}

	return { body: trimmed };
}

/**
 * Word-wraps a raw (ANSI-free) line to at most `width` columns, breaking on the
 * last space within the window and hard-breaking a word longer than the window.
 * Used to wrap thinking body text BEFORE styling, so a long single-line thought
 * flows across multiple gutter lines instead of being truncated to one.
 */
function wrapRaw(text: string, width: number): string[] {
	if (width <= 0) return [text];

	const out: string[] = [];
	let remaining = text;

	while (remaining.length > width) {
		const space = remaining.lastIndexOf(" ", width);
		if (space > 0) {
			out.push(remaining.slice(0, space));
			remaining = remaining.slice(space + 1);
		} else {
			out.push(remaining.slice(0, width));
			remaining = remaining.slice(width);
		}
	}

	if (remaining.length > 0) out.push(remaining);
	return out;
}

/**
 * Renders one or more consecutive thinking texts as a single grouped block.
 *
 * Header: the `Thinking:` label in the reasoning tint, italicised, followed by the
 * bold title (`Thinking: <title>`), or a bare italicised `Thinking` when the text
 * carries no title. Body: the reasoning prose in the muted colour, flush (no
 * gutter), word-wrapped to width so a long unbroken thought spans several lines
 * instead of being truncated. Multiple texts are joined with a newline before
 * splitting, so adjacent thinking segments collapse into one coherent block.
 *
 * Blank body lines are omitted. Every line still passes through `LineBuffer`, so
 * no emitted line can exceed `ctx.maxWidth`. An empty or whitespace-only combined
 * text returns an empty array.
 */
export function renderThinkingBlock(texts: string[], ctx: RenderCtx): string[] {
	const combined = texts.join("\n").trim();
	if (combined.length === 0) return [];

	const { title, body } = splitThinkingTitle(combined);

	const lb = new LineBuffer(ctx);

	const italicize = (text: string): string => (ctx.styler.italic ? ctx.styler.italic(text) : text);
	const label = italicize(ctx.styler.fg("thinking", title ? `${THINKING_HEADER}:` : THINKING_HEADER));
	lb.push(title ? `${label} ${ctx.styler.bold(title)}` : label);

	const bodyWidth = Math.max(1, ctx.maxWidth);
	for (const line of body.split("\n")) {
		if (line.trim().length === 0) continue;
		for (const wrapped of wrapRaw(line, bodyWidth)) {
			lb.push(ctx.styler.fg("muted", wrapped));
		}
	}

	return lb.done();
}
