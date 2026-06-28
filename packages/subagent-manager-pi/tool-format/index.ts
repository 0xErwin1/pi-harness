/**
 * Pure, theme-agnostic formatting for Pi's built-in coding tools.
 *
 * This module turns a tool call's arguments and result into display strings:
 * the call args line (`read path:lines`, `bash $ cmd`, …), a one-line result
 * summary (`N lines`, `exit 0 · M lines`, `+A -R`, …), and a structured diff
 * block. It performs NO styling and touches NO theme or IO so it can be reused
 * by any renderer and exhaustively unit-tested. Callers map the returned text /
 * diff kinds to their own colours.
 *
 * Inputs from the agent runtime (`args`, `details`) are untrusted at the type
 * level, so every field is read through a small typed guard rather than a cast.
 */

/** Colour intent a renderer should apply to a result summary. */
export type ToolSummaryStatus = "ok" | "error" | "neutral";

/** One structured diff line: its change kind plus the raw text to render. */
export type DiffLineKind = "add" | "del" | "context" | "more";
export interface DiffBlockLine {
	kind: DiffLineKind;
	text: string;
}

/** Default number of diff lines rendered before a `… +N more` continuation. */
const DEFAULT_DIFF_CAP = 20;

/** Default number of output lines rendered before a `… +N more` continuation. */
const DEFAULT_OUTPUT_CAP = 20;

/** Pi appends an `exit code: N` trailer to bash output; this lifts N back out. */
const EXIT_CODE_RE = /exit code:\s*(\d+)/i;

/** A standalone `exit code: N` trailer line (the whole line), used to drop it from output. */
const EXIT_CODE_LINE_RE = /^\s*exit code:\s*\d+\s*$/i;

type ArgRecord = Record<string, unknown> | undefined;

function asRecord(value: unknown): ArgRecord {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// ── argument display ────────────────────────────────────────────────────────

/**
 * Renders the inclusive `offset-end` (or bare `offset`) line range for a read
 * call. Returns `undefined` when there is no offset so the caller shows just the
 * path. `limit` is the line count, so the last line is `offset + limit - 1`.
 */
function readLineRange(args: Record<string, unknown>): string | undefined {
	const offset = asNumber(args.offset);
	if (offset === undefined) return undefined;

	const limit = asNumber(args.limit);
	if (limit !== undefined) return `${offset}-${offset + limit - 1}`;
	return `${offset}`;
}

/**
 * Builds the per-tool display args (no verb, no styling):
 * read `path:lines` or `path`, bash `$ <cmd>`, grep/find `<pattern>`, ls
 * `<path>` (default `.`), edit/write `<path>`. Unknown tools yield an empty
 * string so the caller renders the verb alone.
 */
export function formatToolArgs(toolName: string, rawArgs: unknown): string {
	const args = asRecord(rawArgs) ?? {};

	switch (toolName.toLowerCase()) {
		case "read": {
			const path = asString(args.path) ?? "";
			if (path.length === 0) return "";
			const range = readLineRange(args);
			return range ? `${path}:${range}` : path;
		}
		case "bash":
			return `$ ${asString(args.command) ?? ""}`;
		case "grep":
		case "find":
			return asString(args.pattern) ?? "";
		case "ls":
			return asString(args.path) ?? ".";
		case "edit":
		case "write":
			return asString(args.path) ?? "";
		default:
			return "";
	}
}

// ── result summaries ────────────────────────────────────────────────────────

/** Counts displayable lines in tool output, ignoring a single trailing newline. */
function countLines(text: string | undefined): number {
	if (!text) return 0;
	const lines = text.split("\n");
	while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	return lines.length;
}

/** Counts non-empty lines (one per grep match / find or ls entry). */
function countNonEmptyLines(text: string | undefined): number {
	if (!text) return 0;
	return text.split("\n").filter((line) => line.trim().length > 0).length;
}

function bashExitCode(text: string | undefined): number | undefined {
	if (!text) return undefined;
	const match = text.match(EXIT_CODE_RE);
	return match ? Number(match[1]) : undefined;
}

interface ReadTruncation {
	truncated?: boolean;
	outputLines?: number;
	totalLines?: number;
}

/** Narrows the Read tool's `details.truncation` object without trusting its shape. */
function readTruncation(details: unknown): ReadTruncation | undefined {
	const root = asRecord(details);
	const truncation = asRecord(root?.truncation);
	if (!truncation) return undefined;

	return {
		truncated: typeof truncation.truncated === "boolean" ? truncation.truncated : undefined,
		outputLines: asNumber(truncation.outputLines),
		totalLines: asNumber(truncation.totalLines),
	};
}

/** Narrows the Edit tool's `details.diff` unified-diff string. */
function diffOf(details: unknown): string | undefined {
	return asString(asRecord(details)?.diff);
}

/**
 * Derives the one-line result summary and its colour intent for a tool. The
 * status is `ok`/`error` only for bash (by exit code); every other tool is
 * `neutral` and lets the renderer apply error colouring when the call itself
 * failed. Unknown tools return an empty summary so nothing is appended.
 */
export function summarizeToolResult(
	toolName: string,
	rawArgs: unknown,
	resultText: string | undefined,
	details: unknown,
): { text: string; status: ToolSummaryStatus } {
	switch (toolName.toLowerCase()) {
		case "read": {
			const truncation = readTruncation(details);
			if (truncation?.outputLines !== undefined) {
				if (truncation.truncated && truncation.totalLines !== undefined) {
					return { text: `${truncation.outputLines}/${truncation.totalLines} lines`, status: "neutral" };
				}
				return { text: `${truncation.outputLines} lines`, status: "neutral" };
			}
			return { text: `${countLines(resultText)} lines`, status: "neutral" };
		}
		case "bash": {
			const lines = countLines(resultText);
			const code = bashExitCode(resultText);
			if (code !== undefined) {
				return { text: `exit ${code} · ${lines} lines`, status: code === 0 ? "ok" : "error" };
			}
			return { text: `${lines} lines`, status: "neutral" };
		}
		case "grep": {
			const matches = countNonEmptyLines(resultText);
			return { text: `${matches} ${matches === 1 ? "match" : "matches"}`, status: "neutral" };
		}
		case "find":
		case "ls": {
			const results = countNonEmptyLines(resultText);
			return { text: `${results} ${results === 1 ? "result" : "results"}`, status: "neutral" };
		}
		case "edit": {
			const diff = diffOf(details);
			if (diff === undefined) return { text: "", status: "neutral" };
			const { additions, removals } = parseDiffStat(diff);
			return { text: `+${additions} -${removals}`, status: "neutral" };
		}
		case "write": {
			const content = asString(asRecord(rawArgs)?.content);
			return { text: `${countLines(content)} lines`, status: "neutral" };
		}
		default:
			return { text: "", status: "neutral" };
	}
}

// ── diff parsing ────────────────────────────────────────────────────────────

function isFileHeader(line: string): boolean {
	return line.startsWith("+++") || line.startsWith("---");
}

/**
 * Counts added/removed lines in a unified diff: lines starting with `+`/`-`,
 * excluding the `+++`/`---` file headers and the `@@` hunk markers.
 */
export function parseDiffStat(unifiedDiff: string): { additions: number; removals: number } {
	let additions = 0;
	let removals = 0;

	for (const line of unifiedDiff.split("\n")) {
		if (isFileHeader(line) || line.startsWith("@@")) continue;
		if (line.startsWith("+")) additions += 1;
		else if (line.startsWith("-")) removals += 1;
	}

	return { additions, removals };
}

/**
 * Projects a unified diff to a structured, capped block: the `+++`/`---` file
 * headers are dropped, each remaining line is tagged `add`/`del`/`context`, and
 * when the body exceeds `cap` a final `{ kind: "more" }` line reports the
 * remainder. The renderer maps each kind to a colour.
 */
export function diffBlockLines(unifiedDiff: string, cap: number = DEFAULT_DIFF_CAP): DiffBlockLine[] {
	const rendered: DiffBlockLine[] = [];

	for (const line of unifiedDiff.split("\n")) {
		if (isFileHeader(line)) continue;
		const kind: DiffLineKind = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "context";
		rendered.push({ kind, text: line });
	}

	while (rendered.length > 0 && rendered[rendered.length - 1].text === "") rendered.pop();

	if (rendered.length <= cap) return rendered;

	const shown = rendered.slice(0, cap);
	shown.push({ kind: "more", text: `… +${rendered.length - cap} more` });
	return shown;
}

// ── output block ──────────────────────────────────────────────────────────────

/**
 * Projects a tool's textual result into the inline output block shown under the
 * call (so the reader sees what the command actually printed, not just a line
 * count). The trailing `exit code: N` trailer that Pi appends to bash output is
 * dropped — the summary already carries the code — and trailing blank lines are
 * trimmed. When the body exceeds `cap` a final `… +N more` line reports the
 * remainder; pass `cap = Infinity` (the expanded view) to show everything.
 * Returns an empty array when there is no displayable output. Performs NO
 * styling; the caller maps the lines to its own colour.
 */
export function outputBlockLines(resultText: string | undefined, cap: number = DEFAULT_OUTPUT_CAP): string[] {
	if (!resultText) return [];

	const lines = resultText.split("\n");
	while (lines.length > 0) {
		const last = lines[lines.length - 1];
		if (last === "" || EXIT_CODE_LINE_RE.test(last)) lines.pop();
		else break;
	}

	if (lines.length === 0) return [];
	if (lines.length <= cap) return lines;

	const shown = lines.slice(0, cap);
	shown.push(`… +${lines.length - cap} more`);
	return shown;
}
