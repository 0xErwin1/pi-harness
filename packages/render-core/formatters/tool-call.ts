/**
 * Builds the pending/streaming tool call line.
 *
 * Verb is bold + accent (matching the conversation viewer's style). Args are
 * muted. Output is emitted through `LineBuffer` so every line is width-clamped
 * by the structural choke point.
 */

import { LineBuffer, type RenderCtx } from "../width.ts";
import { toolVerb, formatToolArgs } from "./tool-args.ts";

/**
 * Builds the pending tool-call line: `<Verb> <args>` with the verb bold+accent
 * and the args muted. Returns an array of clamped lines (always length 1 for the
 * call line, since no body block exists while the call is streaming).
 */
export function buildToolCallLine(
	toolName: string,
	args: unknown,
	ctx: RenderCtx,
): string[] {
	const lb = new LineBuffer(ctx);
	const verb = toolVerb(toolName);
	const display = formatToolArgs(toolName, args);

	if (display.length === 0) {
		lb.push(ctx.styler.bold(ctx.styler.fg("accent", verb)));
	} else {
		lb.push(`${ctx.styler.bold(ctx.styler.fg("accent", verb))} ${ctx.styler.fg("muted", display)}`);
	}

	return lb.done();
}
