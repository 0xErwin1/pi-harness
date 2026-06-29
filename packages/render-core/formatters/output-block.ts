/**
 * Pure output block formatter.
 *
 * Projects a tool's textual result into the inline output block shown under the
 * call. Theme-agnostic and IO-free; the caller maps the lines to its own colour.
 */

/** Default number of output lines rendered before a `… +N more` continuation. */
const DEFAULT_OUTPUT_CAP = 20;

/** A standalone `exit code: N` trailer line (the whole line), used to drop it from output. */
const EXIT_CODE_LINE_RE = /^\s*exit code:\s*\d+\s*$/i;

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
export function outputBlockLines(
	resultText: string | undefined,
	cap: number = DEFAULT_OUTPUT_CAP,
): string[] {
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
