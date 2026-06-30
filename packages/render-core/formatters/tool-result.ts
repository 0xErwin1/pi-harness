/**
 * Builds the completed tool result lines.
 *
 * Produces the `<Verb> <args> · <summary>` header line plus an optional body
 * block (diff for edit, output for bash). Verb is bold+accent, args are muted,
 * summary colour follows the tool status. All lines are emitted through
 * `LineBuffer` for structural width-clamping.
 */

import { LineBuffer, type RenderCtx } from "../width.ts";
import type { RenderColor } from "../styler.ts";
import { toolVerb, formatToolArgs } from "./tool-args.ts";
import { summarizeToolResult, type ToolSummaryStatus } from "./tool-summary.ts";
import { outputBlockLines } from "./output-block.ts";
import { buildDiffRows, diffBodyTexts, splitDiffBodyTexts, resolveDiffMode, styleDiffBodyLine } from "./diff.ts";

/** Minimal result shape consumed by the formatter; no pi-coding-agent import needed. */
export interface ToolResultData {
	resultText?: string;
	details?: unknown;
}

function statusColor(status: ToolSummaryStatus): RenderColor {
	switch (status) {
		case "ok":
			return "success";
		case "error":
			return "error";
		default:
			return "dim";
	}
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function editDiff(details: unknown): string | undefined {
	return asString(asRecord(details)?.diff);
}

/**
 * Synthesizes an all-additions unified diff from a `write` call's `content` arg, so
 * a completed write renders its body as a green addition block (a new file is a diff
 * against nothing). Returns `undefined` when there is no content. A trailing blank
 * from the final newline is dropped so the row count matches the visible lines.
 */
function writeContentDiff(args: unknown): string | undefined {
	const content = asString(asRecord(args)?.content);
	if (content === undefined) return undefined;

	const lines = content.split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	if (lines.length === 0) return undefined;

	const body = lines.map((line) => `+${line}`).join("\n");
	return `@@ -0,0 +1,${lines.length} @@\n${body}`;
}

/**
 * Pushes a rendered diff block onto the buffer, honouring the resolved split/unified
 * mode and the collapsed/expanded row cap. Shared by `edit` (real unified diff) and
 * `write` (synthesized additions), so both render through the one styling path.
 */
function pushDiffBlock(lb: LineBuffer, diff: string, expanded: boolean, ctx: RenderCtx): void {
	const cap = expanded ? Number.MAX_SAFE_INTEGER : ctx.config.diff.collapsedLines;
	const rows = buildDiffRows(diff, { cap });
	const bodies =
		resolveDiffMode(ctx.config.diff, ctx.maxWidth) === "split"
			? splitDiffBodyTexts(rows, ctx.maxWidth, ctx.width)
			: diffBodyTexts(rows);
	for (const body of bodies) {
		lb.push(styleDiffBodyLine(body, ctx.styler));
	}
}

/** Strips ANSI escape sequences and C0 control characters (except tab) from one line. */
function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0a-\x1f\x7f]/g, "");
}

/**
 * Builds the coloured result rows for a completed tool call: the `<Verb> <args>
 * · <summary>` header plus a diff block for edit or an output block for bash.
 * All rows are width-clamped via the `LineBuffer`. The caller passes `isError`
 * to force error styling and `expanded` to un-cap the body block.
 */
export function buildToolResultLines(
	toolName: string,
	args: unknown,
	result: ToolResultData,
	isError: boolean,
	expanded: boolean,
	ctx: RenderCtx,
): string[] {
	const lb = new LineBuffer(ctx);
	const verb = toolVerb(toolName);
	const display = formatToolArgs(toolName, args);
	const summary = summarizeToolResult(toolName, args, result.resultText, result.details);

	let summaryText = summary.text;
	let status = summary.status;
	if (isError) {
		status = "error";
		if (summaryText.length === 0) summaryText = "error";
	}

	// Bash carries no "Bash" verb (opencode-style): the `$` prompt plays the verb role
	// (bold + accent) and the command itself is muted, matching the subagent viewer.
	const isBash = toolName.toLowerCase() === "bash";
	const verbToken = isBash ? "$" : verb;
	const displayToken = isBash ? display.replace(/^\$\s?/, "") : display;

	let line = ctx.styler.bold(ctx.styler.fg("accent", verbToken));
	if (displayToken.length > 0) line += ` ${ctx.styler.fg("muted", displayToken)}`;
	if (summaryText.length > 0) line += ` · ${ctx.styler.fg(statusColor(status), summaryText)}`;

	lb.push(line);

	const tool = toolName.toLowerCase();
	if (tool === "edit") {
		const diff = editDiff(result.details);
		if (diff !== undefined) pushDiffBlock(lb, diff, expanded, ctx);
	} else if (tool === "write") {
		const diff = editDiff(result.details) ?? writeContentDiff(args);
		if (diff !== undefined) pushDiffBlock(lb, diff, expanded, ctx);
	} else if (tool === "bash") {
		const cap = expanded ? Number.MAX_SAFE_INTEGER : undefined;
		for (const outLine of outputBlockLines(result.resultText, cap)) {
			lb.push(ctx.styler.fg("muted", stripAnsi(outLine)));
		}
	}

	return lb.done();
}
