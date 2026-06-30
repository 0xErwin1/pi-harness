/**
 * Builds the pending/streaming tool call line.
 *
 * Verb is bold + accent (matching the conversation viewer's style). Args are
 * muted. Output is emitted through `LineBuffer` so every line is width-clamped
 * by the structural choke point.
 */

import { LineBuffer, type RenderCtx } from "../width.ts";
import { toolVerb, formatToolArgs } from "./tool-args.ts";
import { buildToolHeadLine } from "./tool-result.ts";

/**
 * Builds the pending tool-call line, opencode-style: bash as `$ <cmd>` and every
 * other tool as `→ <verb> <args>` (dim arrow, muted verb/args). No summary exists
 * while the call is streaming. Returns a single clamped line.
 */
export function buildToolCallLine(
	toolName: string,
	args: unknown,
	ctx: RenderCtx,
): string[] {
	const lb = new LineBuffer(ctx);
	const isBash = toolName.toLowerCase() === "bash";
	const verb = toolVerb(toolName);
	const display = formatToolArgs(toolName, args);

	lb.push(buildToolHeadLine(isBash, verb, display, "", "neutral", ctx));
	return lb.done();
}
