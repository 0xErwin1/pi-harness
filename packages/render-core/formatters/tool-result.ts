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

/** Leading glyph for a non-bash tool call, opencode-style (`→ Read file.ts`). */
export const TOOL_ARROW = "→";

/**
 * Composes the single tool head line, opencode-style:
 * - bash: `$ <cmd>` — the `$` prompt in bold accent, the command muted.
 * - everything else: `→ <verb> <args>` — a dim arrow, the verb and args muted (no
 *   bold-accent verb), reading as a quiet, scannable action line rather than a label.
 * A non-empty summary is appended as ` · <summary>` in the status colour.
 */
export function buildToolHeadLine(
	isBash: boolean,
	verb: string,
	display: string,
	summaryText: string,
	status: ToolSummaryStatus,
	ctx: RenderCtx,
): string {
	let line: string;
	if (isBash) {
		const cmd = display.replace(/^\$\s?/, "");
		line = ctx.styler.bold(ctx.styler.fg("accent", "$"));
		if (cmd.length > 0) line += ` ${ctx.styler.fg("muted", cmd)}`;
	} else {
		line = `${ctx.styler.fg("dim", TOOL_ARROW)} ${ctx.styler.fg("muted", verb)}`;
		if (display.length > 0) line += ` ${ctx.styler.fg("muted", display)}`;
	}
	if (summaryText.length > 0) line += ` · ${ctx.styler.fg(statusColor(status), summaryText)}`;
	return line;
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

	const isBash = toolName.toLowerCase() === "bash";
	lb.push(buildToolHeadLine(isBash, verb, display, summaryText, status, ctx));

	const tool = toolName.toLowerCase();
	if (tool === "edit") {
		const diff = editDiff(result.details);
		if (diff !== undefined) pushDiffBlock(lb, diff, expanded, ctx);
	} else if (tool === "write") {
		const diff = editDiff(result.details) ?? writeContentDiff(args);
		if (diff !== undefined) pushDiffBlock(lb, diff, expanded, ctx);
	} else if (tool === "bash") {
		const cap = expanded ? Number.MAX_SAFE_INTEGER : undefined;
		const output = outputBlockLines(result.resultText, cap);
		if (output.length > 0) {
			// One blank between the `$ cmd · summary` head and the printed output, so the
			// command intent and its result read as two parts of a breathing block (#85)
			// rather than a glued wall of text.
			lb.push("");
			for (const outLine of output) {
				lb.push(ctx.styler.fg("muted", stripAnsi(outLine)));
			}
		}
	}

	return lb.done();
}
