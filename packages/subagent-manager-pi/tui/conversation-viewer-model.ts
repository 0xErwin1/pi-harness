import type { RunEvent, RunSnapshot } from "../../subagent-manager-core/events.ts";
import { TOOL_PROGRESS_PREFIX } from "../../subagent-manager-core/events.ts";
import { outputBlockLines, parseDiffStat } from "../tool-format/index.ts";
import {
	buildDiffRows,
	diffBodyTexts,
	resolveDiffMode,
	RENDER_DEFAULTS,
	splitDiffBodyTexts,
	splitThinkingTitle,
	styleDiffBodyLine,
	THINKING_HEADER,
	TOOL_ARROW,
} from "../../render-core/index.ts";
import type { RenderStyler } from "../../render-core/index.ts";

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

/** Maximum bash output lines rendered inline before a `… +N more` continuation. */
const OUTPUT_BLOCK_CAP = 20;

/** Maximum diff rows rendered inline before a `… +N more` continuation. Mirrors render-core's default. */
const DIFF_BLOCK_CAP = 20;

/**
 * Marks a tool output block line — the text a command actually printed, shown
 * under a bash call so the reader sees the output, not just a line count. The
 * styler renders it muted with no verb. Like the other markers it is a C0 control
 * (BEL) that cannot occur in real content once `stripControlChars` has run.
 */
const OUTPUT_MARK = "\u0007";

/**
 * Marks a thinking HEADER line. The styler renders it as the reasoning label
 * (`Thinking` / `Thinking:`) in the thinking tint, italicised, followed by the
 * bold title when one is present (the title is separated from the label by
 * `TITLE_SEP`). A C0 control stripped from real content, so it cannot misfire.
 */
const THINK_HEAD_MARK = String.fromCharCode(0x0b);

/** Marks a thinking BODY line: reasoning prose rendered muted and flush (no gutter), matching the main thread. */
const THINK_BODY_MARK = String.fromCharCode(0x0c);

/** Separates the `Thinking:` label from its title inside a `THINK_HEAD_MARK` line. */
const TITLE_SEP = String.fromCharCode(0x1f);

/**
 * Marks a user-prompt line. The styler accents the leading `❯ ` marker glyph (or
 * keeps the aligned indent on continuation lines), mirroring the main thread's
 * user-message accent so the run's prompt reads as input rather than a section header.
 */
const USER_MARK = String.fromCharCode(0x0e);

/** Leading glyph for the first line of the user prompt block; continuation lines align under it. */
const USER_GLYPH = "❯ ";
const USER_INDENT = "  ";

/**
 * Style surface the model functions delegate to so they stay theme-agnostic and
 * headlessly testable: `fg` applies a semantic colour, `bold` weights text, and
 * `italic` slants it (used by the thinking header to match the main thread). The
 * render layer wires these to its theme; tests pass deterministic doubles.
 */
export interface TranscriptStyler {
	fg(color: TranscriptColor, text: string): string;
	bold(text: string): string;
	italic(text: string): string;
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
		const lead = spaceAt < 0 ? callPart : callPart.slice(0, spaceAt);
		const rest = spaceAt < 0 ? "" : callPart.slice(spaceAt + 1);

		// The raw head already carries its lead glyph (`→ ` for tools, `$` for bash) so
		// width is accounted for upstream; here we only COLOUR it. opencode-style: the
		// `→` arrow is dim with a muted verb + muted args; bash leads with a bold-accent
		// `$` prompt and a muted command (matching render-core's `buildToolHeadLine`).
		if (lead === TOOL_ARROW) {
			const verbAt = rest.indexOf(" ");
			const verb = verbAt < 0 ? rest : rest.slice(0, verbAt);
			const args = verbAt < 0 ? "" : rest.slice(verbAt + 1);
			out = styler.fg("dim", TOOL_ARROW);
			if (verb.length > 0) out += ` ${styler.fg("muted", verb)}`;
			if (args.length > 0) out += ` ${styler.fg("muted", args)}`;
		} else if (lead === "$") {
			out = styler.bold(styler.fg("accent", "$"));
			if (rest.length > 0) out += ` ${styler.fg("muted", rest)}`;
		} else {
			out = styler.fg("muted", lead);
			if (rest.length > 0) out += ` ${styler.fg("muted", rest)}`;
		}
	} else {
		out = callPart.length > 0 ? styler.fg("muted", callPart) : "";
	}

	if (summary !== undefined && summary.length > 0) out += ` · ${styler.fg(STATUS_COLOR[status], summary)}`;
	return out;
}

/**
 * Styles a rich diff body line and strips its internal marker: the line-number
 * gutter is dim, the content is coloured by change kind (additions success,
 * deletions error, hunk/context dim), and inline char-level emphasis spans are
 * bold. Returns `undefined` for any non-diff line. Detection keys off the
 * `DIFF_MARK` prefix, so assistant text is never mistaken for a diff. The styling
 * itself is delegated to render-core's `styleDiffBodyLine`, the single function
 * the main-thread renderer also calls, so both surfaces are byte-identical.
 */
export function styleDiffLine(line: string, styler: TranscriptStyler): string | undefined {
	if (!line.startsWith(DIFF_MARK)) return undefined;
	return styleDiffBodyLine(line.slice(DIFF_MARK.length), styler as unknown as RenderStyler);
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
 * Styles a thinking HEADER line and strips its marker: the `Thinking`/`Thinking:`
 * label is italic and thinking-tinted; a title (present after `TITLE_SEP`) follows
 * in bold. Mirrors the main thread's opencode reasoning header. Returns `undefined`
 * for any non-header line.
 */
export function styleThinkingHeadLine(line: string, styler: TranscriptStyler): string | undefined {
	if (!line.startsWith(THINK_HEAD_MARK)) return undefined;

	const rest = line.slice(THINK_HEAD_MARK.length);
	const sepAt = rest.indexOf(TITLE_SEP);
	if (sepAt < 0) return styler.italic(styler.fg("thinking", rest));

	const label = rest.slice(0, sepAt);
	const title = rest.slice(sepAt + TITLE_SEP.length);
	return `${styler.italic(styler.fg("thinking", label))} ${styler.bold(title)}`;
}

/**
 * Styles a thinking BODY line and strips its marker: the reasoning prose is muted
 * and flush (no gutter), matching the main thread. Returns `undefined` otherwise.
 */
export function styleThinkingBodyLine(line: string, styler: TranscriptStyler): string | undefined {
	if (!line.startsWith(THINK_BODY_MARK)) return undefined;
	return styler.fg("muted", line.slice(THINK_BODY_MARK.length));
}

/**
 * Styles a user-prompt line and strips its marker: the leading `❯ ` glyph is
 * accent-coloured (mirroring the main thread's user-message marker) and the prompt
 * text is dim, so the run's input reads as subordinate context. A continuation line
 * (aligned indent, no glyph) is dim throughout. Returns `undefined` otherwise.
 */
export function styleUserLine(line: string, styler: TranscriptStyler): string | undefined {
	if (!line.startsWith(USER_MARK)) return undefined;

	const rest = line.slice(USER_MARK.length);
	if (rest.startsWith(USER_GLYPH)) {
		return styler.fg("accent", USER_GLYPH) + styler.fg("dim", rest.slice(USER_GLYPH.length));
	}
	return styler.fg("dim", rest);
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

	const thinkHead = styleThinkingHeadLine(line, styler);
	if (thinkHead !== undefined) return thinkHead;

	const thinkBody = styleThinkingBodyLine(line, styler);
	if (thinkBody !== undefined) return thinkBody;

	const user = styleUserLine(line, styler);
	if (user !== undefined) return user;

	return styler.fg(transcriptLineColor(line), line);
}

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
 * Renders one or more consecutive thinking texts as a single grouped block, marked
 * for the styling layer to match the main thread's opencode style: an italic,
 * thinking-tinted `Thinking`/`Thinking:` header with a bold title, followed by the
 * reasoning body rendered muted and flush (no gutter), word-wrapped to width.
 * Title-only thinking yields just the header. The source text is stripped of
 * control bytes HERE (before the markers are added) so the returned lines carry the
 * markers intact for `styleTranscriptLine`. The title/body split is shared with the
 * main thread via render-core's `splitThinkingTitle`.
 */
function renderThinkingBlock(texts: string[], width: number): string[] {
	// Strip ANSI and C0 controls but PRESERVE tab (0x09) and newline (0x0a): the
	// newline is the structural separator `splitThinkingTitle`/`wrapText` rely on, so
	// stripping it here (as the generic `stripControlChars` would) folds the body into
	// the title. The remaining markers are added AFTER this, so they survive.
	const combined = texts
		.join("\n")
		.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
		.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
		.trim();
	if (combined.length === 0) return [];

	const { title, body } = splitThinkingTitle(combined);

	const header = title ? `${THINKING_HEADER}:${TITLE_SEP}${title}` : THINKING_HEADER;
	const lines = [`${THINK_HEAD_MARK}${header}`];

	for (const line of wrapText(body, width)) {
		if (line.length === 0) continue;
		lines.push(`${THINK_BODY_MARK}${line}`);
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
			const { additions, removals } = parseDiffStat(diff);
			return `+${additions} -${removals}`;
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
	/** True when `text` is a side-by-side split body already sized to width; it must not be re-truncated. */
	split?: boolean;
}
interface OutputItem {
	kind: "output";
	text: string;
}
type LineItem = ToolItem | TextItem | DiffItem | OutputItem;

/**
 * Splits a tool-call display into a bold verb and its args. The verb is the first
 * whitespace-delimited token; everything after is args.
 *
 * Bash is special-cased to carry NO verb: a leading `bash` verb token (if present)
 * is dropped and the command is shown under a `$ ` prompt, matching the main
 * thread's opencode-style bash line (`$ <cmd>`, no bold "Bash" prefix).
 */
function splitToolDisplay(display: string, toolName: string): { verb: string; args: string } {
	if (toolName.toLowerCase() === "bash") {
		const spaceAt = display.indexOf(" ");
		const firstToken = spaceAt < 0 ? display : display.slice(0, spaceAt);
		let command = firstToken.toLowerCase() === "bash" && spaceAt >= 0 ? display.slice(spaceAt + 1) : display;
		if (command.startsWith("$ ")) command = command.slice(2);
		else if (command === "$") command = "";
		// `$` stands in for the verb so the line reads `$ <cmd>` with no bold "Bash" prefix.
		return { verb: "$", args: command };
	}

	const spaceAt = display.indexOf(" ");
	const verb = spaceAt < 0 ? display : display.slice(0, spaceAt);
	const args = spaceAt < 0 ? "" : display.slice(spaceAt + 1);
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
/** Leading 1-char kind markers that the styler consumes; truncation must preserve them, clamping only the payload. */
const LEADING_MARKERS = new Set([THINK_HEAD_MARK, THINK_BODY_MARK, USER_MARK]);

function encodeItem(item: LineItem, width: number): string[] {
	if (item.kind === "text") {
		const marker = item.text[0];
		if (marker !== undefined && LEADING_MARKERS.has(marker)) {
			const payload = item.text.slice(1);
			return [`${marker}${width > 0 ? truncateByLength(payload, width) : payload}`];
		}
		return [width > 0 ? truncateByLength(item.text, width) : item.text];
	}
	if (item.kind === "diff") {
		const fitted = item.split || width <= 0 ? item.text : truncateByLength(item.text, width);
		return [`${DIFF_MARK}${fitted}`];
	}
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
function computeToolIndent(headPrefix: string, width: number): number {
	const aligned = headPrefix.length + 1;
	if (aligned + MIN_CONT_WIDTH <= width) return aligned;
	return Math.min(2, Math.max(0, width - 1));
}

/** Leading glyph carried in the RAW tool line so width accounting matches the styled output. */
function toolHeadLead(verb: string): string {
	return verb === "$" ? "" : `${TOOL_ARROW} `;
}

function encodeToolItem(item: ToolItem, width: number): string[] {
	const countSuffix = item.count > 1 ? ` ×${item.count}` : "";
	const call = `${toolHeadLead(item.verb)}${item.verb}${item.args ? ` ${item.args}` : ""}${countSuffix}`;
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

	const headPrefix = `${toolHeadLead(item.verb)}${item.verb}`;
	const indent = computeToolIndent(headPrefix, width);
	const contentWidth = Math.max(1, width - indent);
	const chunks = argsRegion.length > 0 ? wrapText(argsRegion, contentWidth) : [];

	const lines: string[] = [];
	const firstChunk = chunks[0] ?? "";
	lines.push(`${TOOL_MARK}${headPrefix}${firstChunk ? ` ${firstChunk}` : ""}`);
	let lastVisible = headPrefix.length + (firstChunk ? 1 + firstChunk.length : 0);

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

export type TranscriptColor = "accent" | "success" | "error" | "warning" | "muted" | "dim" | "text" | "thinking";

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
	if (line.startsWith("[failed]")) return "error";
	if (line.startsWith("[attention]")) return "warning";
	if (line.startsWith("[degraded]")) return "warning";
	if (line.startsWith("[interrupted]")) return "warning";
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
		const promptWidth = width > 0 ? Math.max(1, width - USER_GLYPH.length) : width;
		const wrapped = wrapText(stripControlChars(prompt), promptWidth);
		wrapped.forEach((line, index) => {
			const prefix = index === 0 ? USER_GLYPH : USER_INDENT;
			pushText(`${USER_MARK}${prefix}${line}`);
		});
	}

	const flushThinking = () => {
		if (thinkingRun.length === 0) return;
		for (const line of renderThinkingBlock(thinkingRun, width)) pushText(line);
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
						const rows = buildDiffRows(diff, { cap: DIFF_BLOCK_CAP });
						const split = resolveDiffMode(RENDER_DEFAULTS.diff, width) === "split";
						const bodies = split ? splitDiffBodyTexts(rows, width) : diffBodyTexts(rows);
						for (const body of bodies) {
							items.push({ kind: "diff", text: body, split });
						}
					}

					if (event.toolName.toLowerCase() === "bash" && resultInfo.resultText) {
						const output = outputBlockLines(resultInfo.resultText, OUTPUT_BLOCK_CAP);
						if (output.length > 0) {
							// One blank between the head and the output, mirroring the main thread
							// (#85). A plain text blank — not an `output` line — keeps it out of the
							// muted output block proper.
							pushText("");
							for (const line of output) {
								items.push({ kind: "output", text: stripControlChars(line) });
							}
						}
					}
				}
				break;
			}
			case "run.needs_attention":
				pushText(`[attention] ${event.reason}`);
				break;
			case "run.completed":
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
