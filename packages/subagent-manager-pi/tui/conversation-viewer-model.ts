import type { RunEvent, RunSnapshot } from "../../subagent-manager-core/events.ts";
import { TOOL_PROGRESS_PREFIX } from "../../subagent-manager-core/events.ts";
import { outputBlockLines } from "../tool-format/index.ts";

export interface ViewerModel {
	headerLines: string[];
	bodyLines: string[];
	footerLine: string;
	maxScroll: number;
	/** Resolved model id for the run (verbatim from the snapshot), for the invocation sub-line. */
	model?: string;
	/** Resolved thinking level for the run, for the invocation sub-line. */
	thinking?: string;
}

/**
 * Zero-width control sentinels that tag a body line's KIND for the styling layer
 * WITHOUT appearing in the rendered output. The glyph that used to mark a tool
 * line is gone; instead `eventsToBodyLines` prefixes each tool/diff line with one
 * of these markers, and the styling functions strip it before colouring. They are
 * C0 control characters that never occur in tool output, paths, commands, diffs,
 * or assistant text, so structural detection cannot misfire on real content. The
 * three summary markers also encode the summary's colour (neutral / success /
 * error) so the styler needs no second channel.
 */
const TOOL_MARK = "\u0001";
const SUM_DIM = "\u0002";
const SUM_OK = "\u0003";
const SUM_ERR = "\u0004";
const DIFF_MARK = "\u0005";
/**
 * Marks a wrapped tool-call continuation line. A long `<verb> <args>` no longer
 * truncates: `encodeToolItem` wraps it across lines, the first carrying `TOOL_MARK`
 * (bold-accent verb + the leading args) and each overflow line carrying this marker
 * so the styler renders it as indented, args-coloured text WITHOUT re-emitting the
 * verb. Like the other markers it is a C0 control that cannot occur in real content.
 */
const TOOL_CONT_MARK = "\u0006";

/**
 * Strips ANSI/CSI escape sequences and C0 control characters from a single line
 * of child-sourced text before it enters the encoding pipeline. Child processes
 * (e.g. `pi --mode json`) emit ANSI color codes in thinking and assistant text;
 * stripping them as complete units prevents leftover bracket residue like `[39m`
 * or `[38;2;138;190;183m` that appears when only the leading ESC byte is removed.
 * The viewer recolors lines itself via semantic markers, so child color codes
 * carry no value and must be removed cleanly. Order matters: ANSI sequences are
 * removed first (as a unit), then remaining C0 controls are stripped — this
 * ensures a lone ESC (not part of any sequence) is also caught by the second
 * pass. Tab (U+0009) is preserved because it carries meaning in code and diffs.
 * Prevents marker-collision (bytes identical to TOOL_MARK / DIFF_MARK / SUM_*
 * are used structurally by the encoder) and blocks raw control chars from leaking
 * to the TUI.
 */
function stripControlChars(text: string): string {
	return text
		.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
		.replace(/[\x00-\x08\x0a-\x1f\x7f]/g, "");
}

type SummaryStatus = "dim" | "success" | "error";

const STATUS_MARK: Record<SummaryStatus, string> = { dim: SUM_DIM, success: SUM_OK, error: SUM_ERR };
const SUMMARY_MARKS: ReadonlyArray<readonly [string, SummaryStatus]> = [
	[SUM_DIM, "dim"],
	[SUM_OK, "success"],
	[SUM_ERR, "error"],
];
const STATUS_COLOR: Record<SummaryStatus, TranscriptColor> = { dim: "dim", success: "success", error: "error" };

/** Maximum diff lines rendered inline before a `… +N more` continuation. */
const DIFF_BLOCK_CAP = 20;

/** Maximum bash output lines rendered inline before a `… +N more` continuation. */
const OUTPUT_BLOCK_CAP = 20;

/**
 * Marks a tool output block line — the text a command actually printed, shown
 * under a bash call so the reader sees the output, not just a line count. The
 * styler renders it muted with no verb. Like the other markers it is a C0 control
 * (BEL) that cannot occur in real content once `stripControlChars` has run.
 */
const OUTPUT_MARK = "\u0007";

/**
 * Style surface the model functions delegate to so they stay theme-agnostic and
 * headlessly testable: `fg` applies a semantic colour, `bold` weights text. The
 * render layer wires these to its theme; tests pass deterministic doubles.
 */
export interface TranscriptStyler {
	fg(color: TranscriptColor, text: string): string;
	bold(text: string): string;
}

function formatElapsedMs(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m${seconds % 60}s`;
}

function wrapText(text: string, width: number): string[] {
	if (width <= 0) return [text];

	const lines: string[] = [];
	for (const paragraph of text.split("\n")) {
		if (paragraph.length <= width) {
			lines.push(paragraph);
			continue;
		}
		let remaining = paragraph;
		while (remaining.length > width) {
			const breakAt = remaining.lastIndexOf(" ", width);
			if (breakAt <= 0) {
				lines.push(remaining.slice(0, width));
				remaining = remaining.slice(width);
			} else {
				lines.push(remaining.slice(0, breakAt));
				remaining = remaining.slice(breakAt + 1);
			}
		}
		if (remaining.length > 0) lines.push(remaining);
	}
	return lines;
}

function toolNameFromProgress(message: string): string | undefined {
	if (!message.startsWith(TOOL_PROGRESS_PREFIX)) return undefined;
	return message.slice(TOOL_PROGRESS_PREFIX.length).trim();
}

/** Truncates by character count (ANSI-free input) leaving room for an ellipsis. */
function truncateByLength(text: string, max: number): string {
	if (max <= 0 || text.length <= max) return text;
	if (max === 1) return "…";
	return `${text.slice(0, max - 1)}…`;
}

/**
 * Splits a rendered tool line into its styled parts and strips the internal kind
 * marker. A head line (`TOOL_MARK`) renders a bold-accent verb, muted args, and a
 * status-coloured ` · summary`; a wrapped continuation line (`TOOL_CONT_MARK`)
 * renders only the indented, muted args (no verb), keeping any trailing summary.
 * Detection is structural — the line carries one of those prefixes plus an optional
 * summary marker that also names the summary's colour — so no glyph is needed and
 * real tool output can never be mistaken for a tool line. The verb is bold + accent
 * and the args muted so a tool call reads as visibly distinct from plain assistant
 * text. Returns `undefined` for any non-tool line so callers fall through to their
 * default colouring.
 */
export function styleToolLine(line: string, styler: TranscriptStyler): string | undefined {
	const isHead = line.startsWith(TOOL_MARK);
	const isCont = line.startsWith(TOOL_CONT_MARK);
	if (!isHead && !isCont) return undefined;

	const body = line.slice(1);

	let callPart = body;
	let summary: string | undefined;
	let status: SummaryStatus = "dim";
	for (const [mark, markStatus] of SUMMARY_MARKS) {
		const at = body.indexOf(mark);
		if (at >= 0) {
			callPart = body.slice(0, at);
			summary = body.slice(at + mark.length);
			status = markStatus;
			break;
		}
	}

	let out: string;
	if (isHead) {
		const spaceAt = callPart.indexOf(" ");
		const verb = spaceAt < 0 ? callPart : callPart.slice(0, spaceAt);
		const args = spaceAt < 0 ? "" : callPart.slice(spaceAt + 1);

		out = styler.bold(styler.fg("accent", verb));
		if (args.length > 0) out += ` ${styler.fg("muted", args)}`;
	} else {
		out = callPart.length > 0 ? styler.fg("muted", callPart) : "";
	}

	if (summary !== undefined && summary.length > 0) out += ` · ${styler.fg(STATUS_COLOR[status], summary)}`;
	return out;
}

/**
 * Styles a diff body line and strips its internal marker: additions in success,
 * deletions in error, hunk/context/continuation lines dim. Returns `undefined`
 * for any non-diff line. Detection keys off the `DIFF_MARK` prefix, so assistant
 * text that happens to start with `+`/`-` is never mistaken for a diff.
 */
export function styleDiffLine(line: string, styler: TranscriptStyler): string | undefined {
	if (!line.startsWith(DIFF_MARK)) return undefined;

	const text = line.slice(DIFF_MARK.length);
	const color: TranscriptColor = text.startsWith("+") ? "success" : text.startsWith("-") ? "error" : "dim";
	return styler.fg(color, text);
}

/**
 * Styles a tool output block line and strips its internal marker: the printed
 * command output is rendered muted so it reads as subordinate to the call above it
 * without competing with assistant text. Returns `undefined` for any non-output
 * line, keyed off the `OUTPUT_MARK` prefix.
 */
export function styleOutputLine(line: string, styler: TranscriptStyler): string | undefined {
	if (!line.startsWith(OUTPUT_MARK)) return undefined;
	return styler.fg("muted", line.slice(OUTPUT_MARK.length));
}

/**
 * Single entry point for colouring one body line: tool lines, then diff lines,
 * then everything else via `transcriptLineColor`. Both render layers (the overlay
 * viewer and the expanded Ctrl-O row) share this so they stay visually identical.
 */
export function styleTranscriptLine(line: string, styler: TranscriptStyler): string {
	if (line.length === 0) return "";

	const tool = styleToolLine(line, styler);
	if (tool !== undefined) return tool;

	const diff = styleDiffLine(line, styler);
	if (diff !== undefined) return diff;

	const output = styleOutputLine(line, styler);
	if (output !== undefined) return output;

	return styler.fg(transcriptLineColor(line), line);
}

/**
 * Markers for a grouped thinking block. Pi's native thread renders reasoning as a
 * dim header followed by a wrapped paragraph, NOT a per-line tag; these reproduce
 * that. The body gutter uses the box-drawing vertical (kept under the de-emoji
 * scheme) so a continuation line reads like a quoted sidebar and is classifiable
 * as dim without a visible `[thinking]` tag. Markers and `transcriptLineColor`
 * must stay in sync.
 */
const THINKING_HEADER = "Thinking";
const THINKING_BODY_PREFIX = "│ ";

/**
 * Formats a token total compactly: a bare count under 1k, then `k`/`M` with one
 * decimal so the collapsed row and overlay header stay short.
 */
export function formatTokens(tokens: number): string {
	if (tokens < 1000) return String(tokens);
	if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
	return `${(tokens / 1_000_000).toFixed(1)}M`;
}

/**
 * Shortens a slash-qualified model id to its last path segment
 * (`anthropic/claude-haiku-4-5` → `claude-haiku-4-5`); leaves a bare id untouched.
 */
export function shortModelId(model: string): string {
	const segments = model.split("/");
	return segments[segments.length - 1] || model;
}

/**
 * Composes the bare `<model> · thinking: <level>` segment from whichever of the
 * two is known, shortening the model id. Returns `undefined` when neither is
 * known so callers can omit the segment entirely.
 */
export function formatModelEffort(model?: string, thinking?: string): string | undefined {
	const m = model && model.trim() ? shortModelId(model.trim()) : undefined;
	const t = thinking && thinking.trim() ? thinking.trim() : undefined;
	if (!m && !t) return undefined;

	const parts: string[] = [];
	if (m) parts.push(m);
	if (t) parts.push(`thinking: ${t}`);
	return parts.join(" · ");
}

/**
 * Builds the dim invocation sub-line shown under the viewer header
 * (`  ↳ <model> · thinking: <level>`), or `undefined` when neither model nor
 * thinking is known.
 */
export function formatInvocationSubline(model?: string, thinking?: string): string | undefined {
	const text = formatModelEffort(model, thinking);
	return text === undefined ? undefined : `  ↳ ${text}`;
}

/**
 * Splits a thinking text into an optional title and the remaining body. The model
 * sometimes leads its reasoning with its own title — either a markdown bold
 * (`**Weighing options**`) or a `Thinking:` prefix. When present that title is
 * lifted into the block header (so the rendered header never doubles up as
 * `Thinking: Thinking:`); otherwise the whole text is the body and a plain
 * `Thinking` header is used.
 */
function splitThinkingTitle(text: string): { title?: string; body: string } {
	const trimmed = text.trim();

	const bold = trimmed.match(/^\*\*(.+?)\*\*\s*/);
	if (bold) {
		return { title: bold[1].trim() || undefined, body: trimmed.slice(bold[0].length).trim() };
	}

	if (/^Thinking:/i.test(trimmed)) {
		const afterLabel = trimmed.replace(/^Thinking:\s*/i, "");
		const newlineAt = afterLabel.indexOf("\n");
		if (newlineAt >= 0) {
			return { title: afterLabel.slice(0, newlineAt).trim() || undefined, body: afterLabel.slice(newlineAt + 1).trim() };
		}
		return { title: afterLabel.trim() || undefined, body: "" };
	}

	return { body: trimmed };
}

/**
 * Renders one or more consecutive thinking texts as a single grouped block: a dim
 * `Thinking`/`Thinking: <title>` header followed by the reasoning body wrapped to
 * width under a dim gutter. Empty bodies (title-only thinking) yield just the
 * header.
 */
function renderThinkingBlock(texts: string[], width: number): string[] {
	const combined = texts.join("\n").trim();
	if (combined.length === 0) return [];

	const { title, body } = splitThinkingTitle(combined);
	const lines = [title ? `${THINKING_HEADER}: ${title}` : THINKING_HEADER];

	const bodyWidth = width > 0 ? width - THINKING_BODY_PREFIX.length : width;
	for (const line of wrapText(body, bodyWidth)) {
		if (line.length === 0) continue;
		lines.push(`${THINKING_BODY_PREFIX}${line}`);
	}

	return lines;
}

// ── per-tool result summaries ──────────────────────────────────────────────────

/** Counts displayable lines in tool output, ignoring a single trailing newline. */
function countLines(text: string | undefined): number {
	if (!text) return 0;
	const lines = text.split("\n");
	while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	return lines.length;
}

/** Counts non-empty lines (one per grep match / find entry). */
function countNonEmptyLines(text: string | undefined): number {
	if (!text) return 0;
	return text.split("\n").filter((line) => line.trim().length > 0).length;
}

/** Pi appends an `exit code: N` trailer to bash output; this lifts N back out. */
function bashExitCode(text: string | undefined): number | undefined {
	if (!text) return undefined;
	const match = text.match(/exit code:\s*(\d+)/i);
	return match ? Number(match[1]) : undefined;
}

interface ReadTruncation {
	truncated?: boolean;
	outputLines?: number;
	totalLines?: number;
}

/** Narrows the Read tool's `details.truncation` object without trusting its shape. */
function readTruncation(details: unknown): ReadTruncation | undefined {
	if (!details || typeof details !== "object") return undefined;
	const truncation = (details as { truncation?: unknown }).truncation;
	if (!truncation || typeof truncation !== "object") return undefined;

	const fields = truncation as Record<string, unknown>;
	const num = (key: string): number | undefined => (typeof fields[key] === "number" ? (fields[key] as number) : undefined);
	return {
		truncated: typeof fields.truncated === "boolean" ? fields.truncated : undefined,
		outputLines: num("outputLines"),
		totalLines: num("totalLines"),
	};
}

/** Narrows the Edit tool's `details.diff` unified-diff string. */
function diffOf(details: unknown): string | undefined {
	if (!details || typeof details !== "object") return undefined;
	const diff = (details as { diff?: unknown }).diff;
	return typeof diff === "string" ? diff : undefined;
}

/**
 * Counts added/removed lines in a unified diff: lines starting with `+`/`-`,
 * excluding the `+++`/`---` file headers and the `@@` hunk markers.
 */
function countDiff(diff: string): { adds: number; dels: number } {
	let adds = 0;
	let dels = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) adds += 1;
		else if (line.startsWith("-")) dels += 1;
	}
	return { adds, dels };
}

/**
 * Projects a unified diff to the inline block: drops the `+++`/`---` file headers,
 * keeps hunks and context, caps the body and appends a `… +N more` continuation
 * when the change is longer than the cap.
 */
function diffBlockLines(diff: string): string[] {
	const rendered: string[] = [];
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		rendered.push(line);
	}
	while (rendered.length > 0 && rendered[rendered.length - 1] === "") rendered.pop();

	if (rendered.length <= DIFF_BLOCK_CAP) return rendered;

	const shown = rendered.slice(0, DIFF_BLOCK_CAP);
	shown.push(`… +${rendered.length - DIFF_BLOCK_CAP} more`);
	return shown;
}

interface ToolResultInfo {
	resultText?: string;
	details?: unknown;
	isError?: boolean;
}

/**
 * Derives the per-tool result summary text (line counts, exit codes, match counts,
 * diff stats). Returns `undefined` to omit the summary for an unknown tool, except
 * an errored unknown tool which surfaces a bare `error` marker.
 */
function deriveToolSummary(toolName: string, result: ToolResultInfo): string | undefined {
	const base = baseToolSummary(toolName, result);
	if (base !== undefined) return base;
	return result.isError ? "error" : undefined;
}

function baseToolSummary(toolName: string, result: ToolResultInfo): string | undefined {
	switch (toolName.toLowerCase()) {
		case "read": {
			const truncation = readTruncation(result.details);
			if (truncation?.outputLines !== undefined) {
				if (truncation.truncated && truncation.totalLines !== undefined) {
					return `${truncation.outputLines}/${truncation.totalLines} lines`;
				}
				return `${truncation.outputLines} lines`;
			}
			return `${countLines(result.resultText)} lines`;
		}
		case "bash": {
			const lines = countLines(result.resultText);
			const code = bashExitCode(result.resultText);
			return code !== undefined ? `exit ${code} · ${lines} lines` : `${lines} lines`;
		}
		case "grep": {
			const matches = countNonEmptyLines(result.resultText);
			return `${matches} ${matches === 1 ? "match" : "matches"}`;
		}
		case "find":
		case "ls": {
			const results = countNonEmptyLines(result.resultText);
			return `${results} ${results === 1 ? "result" : "results"}`;
		}
		case "edit": {
			const diff = diffOf(result.details);
			if (diff === undefined) return undefined;
			const { adds, dels } = countDiff(diff);
			return `+${adds} -${dels}`;
		}
		case "write":
			return `${countLines(result.resultText)} lines`;
		default:
			return undefined;
	}
}

/** Resolves the summary colour: error on failure, success/error by bash exit code, else neutral. */
function deriveSummaryStatus(toolName: string, result: ToolResultInfo): SummaryStatus {
	if (result.isError) return "error";
	if (toolName.toLowerCase() === "bash") {
		const code = bashExitCode(result.resultText);
		if (code !== undefined) return code === 0 ? "success" : "error";
	}
	return "dim";
}

/**
 * Picks the index of the tool-call slot a result belongs to: an exact `toolCallId`
 * match when both sides carry one, otherwise the most recent slot that has not yet
 * received a result (subagent tool use is sequential, so a result follows its
 * call). Returns `undefined` when every slot is already matched.
 */
export function matchResultToCall(
	slots: ReadonlyArray<{ toolCallId?: string; matched: boolean }>,
	result: { toolCallId?: string },
): number | undefined {
	if (result.toolCallId !== undefined) {
		const exact = slots.findIndex((slot) => slot.toolCallId !== undefined && slot.toolCallId === result.toolCallId);
		if (exact >= 0) return exact;
	}

	for (let i = slots.length - 1; i >= 0; i--) {
		if (!slots[i].matched) return i;
	}
	return undefined;
}

// ── transcript line model ───────────────────────────────────────────────────────

interface ToolItem {
	kind: "tool";
	verb: string;
	args: string;
	summary?: string;
	status: SummaryStatus;
	toolCallId?: string;
	matched: boolean;
	count: number;
}
interface TextItem {
	kind: "text";
	text: string;
}
interface DiffItem {
	kind: "diff";
	text: string;
}
interface OutputItem {
	kind: "output";
	text: string;
}
type LineItem = ToolItem | TextItem | DiffItem | OutputItem;

/**
 * Splits a tool-call display into a bold verb and its args. The verb is the first
 * whitespace-delimited token; everything after is args. Bash keeps Pi's `$ <cmd>`
 * prompt style, applied here since the upstream `formatToolCall` emits a bare
 * command.
 */
function splitToolDisplay(display: string, toolName: string): { verb: string; args: string } {
	const spaceAt = display.indexOf(" ");
	const verb = spaceAt < 0 ? display : display.slice(0, spaceAt);
	let args = spaceAt < 0 ? "" : display.slice(spaceAt + 1);

	if (toolName.toLowerCase() === "bash" && args.length > 0 && !args.startsWith("$")) {
		args = `$ ${args}`;
	}
	return { verb, args };
}

/** Identity of a tool item for run-collapsing: identical verb, args, summary and status merge. */
function toolItemKey(item: ToolItem): string {
	return `${item.verb} ${item.args} ${item.summary ?? ""} ${item.status}`;
}

/**
 * Encodes one line item into one or more marked, width-fitted strings. A tool line
 * that fits stays a single head line; a too-wide tool line wraps across a head line
 * plus indented continuation lines (never truncated). Diff lines carry the diff
 * marker; plain text passes through truncated. Always returns at least one string.
 */
function encodeItem(item: LineItem, width: number): string[] {
	if (item.kind === "text") return [width > 0 ? truncateByLength(item.text, width) : item.text];
	if (item.kind === "diff") return [`${DIFF_MARK}${width > 0 ? truncateByLength(item.text, width) : item.text}`];
	if (item.kind === "output") return [`${OUTPUT_MARK}${width > 0 ? truncateByLength(item.text, width) : item.text}`];
	return encodeToolItem(item, width);
}

/** Minimum text room a continuation line keeps; below it the args indent collapses to a small gutter. */
const MIN_CONT_WIDTH = 8;

/**
 * Resolves the continuation indent so wrapped args align under the args column
 * (`verb.length + 1`). When the verb is long enough that aligning would starve the
 * continuation of usable width, the indent collapses to a small fixed gutter.
 */
function computeToolIndent(verb: string, width: number): number {
	const aligned = verb.length + 1;
	if (aligned + MIN_CONT_WIDTH <= width) return aligned;
	return Math.min(2, Math.max(0, width - 1));
}

function encodeToolItem(item: ToolItem, width: number): string[] {
	const countSuffix = item.count > 1 ? ` ×${item.count}` : "";
	const call = item.verb + (item.args ? ` ${item.args}` : "") + countSuffix;
	const hasSummary = item.summary !== undefined && item.summary.length > 0;
	const summary = item.summary ?? "";
	const visibleLength = call.length + (hasSummary ? 3 + summary.length : 0);

	if (width <= 0 || visibleLength <= width) {
		const summaryPart = hasSummary ? `${STATUS_MARK[item.status]}${summary}` : "";
		return [`${TOOL_MARK}${call}${summaryPart}`];
	}

	return wrapToolItem(item, width);
}

/**
 * Wraps a too-wide tool call across multiple marked lines instead of truncating it,
 * so the full call stays readable in the scrollable viewer. The head line carries
 * `TOOL_MARK` with the bold-accent verb and the first slice of args; each overflow
 * slice becomes a `TOOL_CONT_MARK` line indented under the args column and styled in
 * the args (muted) colour, with no repeated verb. The status-coloured ` · summary`
 * stays attached after the args — appended to the last line when it fits, otherwise
 * placed on its own trailing continuation line. Each wrapped line gets its own
 * leading marker (and the summary marker lands on exactly one line), so the styling
 * layer recolours every line consistently and no marker leaks into the output.
 */
function wrapToolItem(item: ToolItem, width: number): string[] {
	const countSuffix = item.count > 1 ? ` ×${item.count}` : "";
	const argsRegion = item.args ? `${item.args}${countSuffix}` : countSuffix.trimStart();

	const indent = computeToolIndent(item.verb, width);
	const contentWidth = Math.max(1, width - indent);
	const chunks = argsRegion.length > 0 ? wrapText(argsRegion, contentWidth) : [];

	const lines: string[] = [];
	const firstChunk = chunks[0] ?? "";
	lines.push(`${TOOL_MARK}${item.verb}${firstChunk ? ` ${firstChunk}` : ""}`);
	let lastVisible = item.verb.length + (firstChunk ? 1 + firstChunk.length : 0);

	for (let i = 1; i < chunks.length; i++) {
		const chunk = chunks[i];
		lines.push(`${TOOL_CONT_MARK}${" ".repeat(indent)}${chunk}`);
		lastVisible = indent + chunk.length;
	}

	const hasSummary = item.summary !== undefined && item.summary.length > 0;
	if (hasSummary) {
		const summary = item.summary ?? "";
		const summaryMark = STATUS_MARK[item.status];
		if (lastVisible + 3 + summary.length <= width) {
			lines[lines.length - 1] += `${summaryMark}${summary}`;
		} else {
			lines.push(`${TOOL_CONT_MARK}${" ".repeat(indent)}${summaryMark}${summary}`);
		}
	}

	return lines;
}

/**
 * Collapses consecutive identical tool items into one carrying a `×N` count, then
 * encodes every item to its final marked, width-fitted string. Distinct calls are
 * never merged, so no information is lost.
 */
function finalizeItems(items: LineItem[], width: number): string[] {
	const collapsed: LineItem[] = [];
	for (const item of items) {
		const prev = collapsed[collapsed.length - 1];
		if (item.kind === "tool" && prev && prev.kind === "tool" && toolItemKey(prev) === toolItemKey(item)) {
			prev.count += 1;
			continue;
		}
		collapsed.push(item.kind === "tool" ? { ...item } : item);
	}
	return collapsed.flatMap((item) => encodeItem(item, width));
}

export type TranscriptColor = "accent" | "success" | "error" | "warning" | "muted" | "dim" | "text";

/**
 * Maps a transcript line to a semantic colour so the viewer can give assistant
 * text, reasoning, and status transitions a distinct visual hierarchy. Pure and
 * theme-agnostic: callers translate the colour name through their theme. Tool and
 * diff lines are NOT classified here — they carry mixed, marker-tagged colouring
 * handled by `styleToolLine`/`styleDiffLine`, so callers (or `styleTranscriptLine`)
 * must check those first. Detection keys off the plain-text markers emitted by
 * `eventsToBodyLines`, so the markers and this classifier must stay in sync.
 */
export function transcriptLineColor(line: string): TranscriptColor {
	if (line.startsWith("[prompt]")) return "dim";
	if (line.startsWith("[Assistant")) return "accent";
	if (line.startsWith("[done]")) return "success";
	if (line.startsWith("[failed]")) return "error";
	if (line.startsWith("[attention]")) return "warning";
	if (line.startsWith("[degraded]")) return "warning";
	if (line.startsWith("[interrupted]")) return "warning";
	if (line.startsWith("[started]")) return "dim";
	if (line === THINKING_HEADER || line.startsWith(`${THINKING_HEADER}: `)) return "dim";
	if (line.startsWith(THINKING_BODY_PREFIX)) return "dim";
	if (line.startsWith("·")) return "dim";
	return "text";
}

/**
 * Resolves the viewport's top offset. When following the newest line the offset
 * tracks the growing tail; when paused it stays where the user left it, clamped
 * into range as the transcript grows. This is the heart of independent scroll:
 * new events never yank a paused viewport back to the bottom.
 */
export function resolveViewportOffset(scrollOffset: number, maxScroll: number, following: boolean): number {
	if (following) return maxScroll;
	return Math.max(0, Math.min(scrollOffset, maxScroll));
}

/**
 * Renders the run's chronological event stream into displayable body lines,
 * merging assistant text turns with live tool activity, tool result summaries,
 * edit diffs, and status transitions. When `prompt` is provided it is prepended as
 * a `[prompt]` block.
 *
 * Each tool call becomes one line, or several when it is too wide and wraps. The
 * call display prefers `toolCallFull` (the COMPLETE, uncapped args) over the
 * summarized `toolCall`, so the overlay shows every argument wrapped across lines
 * with no `…`; it falls back to `toolCall`, then `target`, then the bare name when
 * the fuller forms are absent. A following `run.tool_result` is correlated to its
 * call (by `toolCallId` when present, else by adjacency to the most recent
 * unmatched call) and its summary is folded into that line, with an edit's diff
 * rendered as a following block. Lines carry internal kind markers that the styling
 * layer strips, so the visible line starts with the verb — no glyph.
 */
export function eventsToBodyLines(events: RunEvent[], width: number, prompt?: string): string[] {
	const items: LineItem[] = [];
	const toolItems: ToolItem[] = [];
	let thinkingRun: string[] = [];

	const pushText = (text: string) => items.push({ kind: "text", text });

	if (prompt) {
		pushText("[prompt]");
		for (const line of wrapText(prompt, width)) pushText(line);
	}

	const flushThinking = () => {
		if (thinkingRun.length === 0) return;
		for (const line of renderThinkingBlock(thinkingRun, width)) pushText(stripControlChars(line));
		thinkingRun = [];
	};

	for (const event of events) {
		if (event.type === "run.output" && event.kind === "thinking" && event.text) {
			thinkingRun.push(event.text);
			continue;
		}

		flushThinking();

		switch (event.type) {
			case "run.started":
				pushText("[started]");
				break;
			case "run.progress": {
				const tool = toolNameFromProgress(event.message);
				if (tool) {
					const rawDisplay =
						event.toolCallFull ?? event.toolCall ?? (event.target ? `${tool} ${event.target}` : tool);
					const display = stripControlChars(rawDisplay);
					const { verb, args } = splitToolDisplay(display, tool);
					const item: ToolItem = { kind: "tool", verb, args, status: "dim", matched: false, count: 1 };
					items.push(item);
					toolItems.push(item);
				} else {
					pushText(`· ${event.message}`);
				}
				break;
			}
			case "run.output":
				if (event.role === "assistant" && event.text) {
					pushText("[Assistant]");
					for (const line of wrapText(event.text, width)) pushText(stripControlChars(line));
				}
				break;
			case "run.tool_result": {
				const idx = matchResultToCall(toolItems, event);
				if (idx !== undefined) {
					const item = toolItems[idx];
					item.matched = true;
					const resultInfo: ToolResultInfo = {
						resultText:
							event.resultText !== undefined
								? event.resultText.split("\n").map(stripControlChars).join("\n")
								: undefined,
						details: event.details,
						isError: event.isError,
					};
					item.summary = deriveToolSummary(event.toolName, resultInfo);
					item.status = deriveSummaryStatus(event.toolName, resultInfo);

					const diff = diffOf(event.details);
					if (diff !== undefined) {
						for (const line of diffBlockLines(diff)) items.push({ kind: "diff", text: stripControlChars(line) });
					}

					if (event.toolName.toLowerCase() === "bash" && resultInfo.resultText) {
						for (const line of outputBlockLines(resultInfo.resultText, OUTPUT_BLOCK_CAP)) {
							items.push({ kind: "output", text: stripControlChars(line) });
						}
					}
				}
				break;
			}
			case "run.needs_attention":
				pushText(`[attention] ${event.reason}`);
				break;
			case "run.completed":
				pushText("[done]");
				break;
			case "run.failed":
				pushText(`[failed] ${event.error}`);
				break;
			case "run.interrupted":
				pushText("[interrupted]");
				break;
			case "provider.degraded":
				pushText(`[degraded] ${event.provider}: ${event.reason}`);
				break;
		}
	}

	flushThinking();

	return finalizeItems(items, width);
}

export function buildViewerModel(input: {
	snapshot?: RunSnapshot;
	events: RunEvent[];
	scrollOffset: number;
	width: number;
	height: number;
	now: number;
	autoScroll?: boolean;
}): ViewerModel {
	const { snapshot, events, width, height, now, autoScroll } = input;

	const agent = snapshot?.agent ?? "";
	const status = snapshot?.status ?? "unknown";
	const elapsedMs = snapshot ? now - Date.parse(snapshot.startedAt) : undefined;
	const elapsed = elapsedMs !== undefined ? formatElapsedMs(elapsedMs) : "";

	let tools = 0;
	for (const event of events) {
		if (event.type === "run.progress" && toolNameFromProgress(event.message) !== undefined) tools += 1;
	}
	const tokens = snapshot?.tokens ?? 0;

	const headerParts = [agent, status, elapsed, `${formatTokens(tokens)} tok`, `${tools} tools`].filter(
		(p) => p.length > 0,
	);
	const headerLines = [headerParts.join(" · ")];

	const allBodyLines = eventsToBodyLines(events, width, snapshot?.prompt);
	const maxScroll = Math.max(0, allBodyLines.length - height);

	const effectiveOffset = resolveViewportOffset(input.scrollOffset, maxScroll, autoScroll ?? false);
	const bodyLines = allBodyLines.slice(effectiveOffset, effectiveOffset + height);

	const following = effectiveOffset >= maxScroll;
	const totalLines = allBodyLines.length;
	const pct = totalLines === 0 ? 100 : Math.min(100, Math.round(((effectiveOffset + height) / totalLines) * 100));
	const footerLine = `${totalLines} lines · ${pct}% · ${following ? "following" : "paused"}`;

	return { headerLines, bodyLines, footerLine, maxScroll, model: snapshot?.model, thinking: snapshot?.thinking };
}
