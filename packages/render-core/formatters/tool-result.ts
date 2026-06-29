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
import { summarizeToolResult, parseDiffStat, diffBlockLines, type ToolSummaryStatus, type DiffLineKind } from "./tool-summary.ts";
import { outputBlockLines } from "./output-block.ts";

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

function diffColor(kind: DiffLineKind): RenderColor {
	switch (kind) {
		case "add":
			return "success";
		case "del":
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

	let line = ctx.styler.bold(ctx.styler.fg("accent", verb));
	if (display.length > 0) line += ` ${ctx.styler.fg("muted", display)}`;
	if (summaryText.length > 0) line += ` · ${ctx.styler.fg(statusColor(status), summaryText)}`;

	lb.push(line);

	const tool = toolName.toLowerCase();
	if (tool === "edit") {
		const diff = editDiff(result.details);
		if (diff !== undefined) {
			const cap = expanded ? Number.MAX_SAFE_INTEGER : undefined;
			for (const dl of diffBlockLines(diff, cap)) {
				lb.push(ctx.styler.fg(diffColor(dl.kind), dl.text));
			}
		}
	} else if (tool === "bash") {
		const cap = expanded ? Number.MAX_SAFE_INTEGER : undefined;
		for (const outLine of outputBlockLines(result.resultText, cap)) {
			lb.push(ctx.styler.fg("muted", stripAnsi(outLine)));
		}
	}

	return lb.done();
}
