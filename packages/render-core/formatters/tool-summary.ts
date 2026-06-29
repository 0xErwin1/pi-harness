/**
 * Pure tool result summary formatters and diff helpers.
 *
 * `summarizeToolResult` produces the one-line `N lines` / `exit 0 · N lines` /
 * `+A -R` text and its colour intent. `parseDiffStat` counts additions and
 * removals. `diffBlockLines` projects a unified diff to a structured, capped
 * block for rendering. All functions are theme-agnostic and IO-free.
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
export function diffBlockLines(
	unifiedDiff: string,
	cap: number = DEFAULT_DIFF_CAP,
): DiffBlockLine[] {
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
