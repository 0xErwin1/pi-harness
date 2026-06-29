/**
 * Pending-edit diff projector.
 *
 * `projectPendingEdit` is a PURE function: given args from a streaming edit or
 * write tool call and the current file content, it computes the structured diff
 * rows that represent what the edit WOULD do — without reading any files itself.
 * The impure file read stays in the consumer (tool-renderer.ts).
 *
 * Return type reuses `DiffBlockLine` from S1 (kind + text). S5 will replace
 * this with the rich `DiffRow` type once `buildDiffRows` (LCS-based, full
 * line numbers + char spans) exists. For S4 the diff is a straightforward
 * context-before / del / add / context-after block.
 *
 * No pi-tui or SDK imports — this module is render-core-pure.
 */

import type { DiffBlockLine } from "./tool-summary.ts";

/** Number of context lines to show before and after the changed region. */
const CONTEXT_LINES = 3;

/** Default cap matching `RENDER_DEFAULTS.diff.collapsedLines`. */
const DEFAULT_CAP = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Slices `rows` to `cap` entries and appends a `{ kind: "more" }` row when
 * there are additional rows beyond the cap. Mirrors `diffBlockLines` semantics.
 */
function applyRowCap(rows: DiffBlockLine[], cap: number): DiffBlockLine[] {
	if (rows.length <= cap) return rows;
	const overflow = rows.length - cap;
	return [...rows.slice(0, cap), { kind: "more", text: `… +${overflow} more` }];
}

/**
 * Projects an `edit` tool call onto `fileContent`.
 *
 * Finds the first occurrence of `old_string` in the file and builds a diff
 * block: up to `CONTEXT_LINES` context before, deleted lines (old_string),
 * added lines (new_string), up to `CONTEXT_LINES` context after.
 *
 * Returns `[]` when either string arg is absent, or when `old_string` is not
 * found in `fileContent` (no preview is possible without a clear target).
 */
function projectEdit(
	args: Record<string, unknown>,
	fileContent: string | undefined,
	cap: number,
): DiffBlockLine[] {
	const oldStr = typeof args.old_string === "string" ? args.old_string : undefined;
	const newStr = typeof args.new_string === "string" ? args.new_string : undefined;

	if (oldStr === undefined || newStr === undefined) return [];
	if (!fileContent || !fileContent.includes(oldStr)) return [];

	const fileLines = fileContent.split("\n");
	const oldLines = oldStr.split("\n");
	const newLines = newStr.split("\n");

	const idx = fileContent.indexOf(oldStr);
	const startLine = fileContent.slice(0, idx).split("\n").length - 1;
	const endLine = startLine + oldLines.length;

	const rows: DiffBlockLine[] = [];

	const ctxStart = Math.max(0, startLine - CONTEXT_LINES);
	for (let i = ctxStart; i < startLine; i++) {
		rows.push({ kind: "context", text: `  ${fileLines[i] ?? ""}` });
	}

	for (const line of oldLines) {
		rows.push({ kind: "del", text: `- ${line}` });
	}

	for (const line of newLines) {
		rows.push({ kind: "add", text: `+ ${line}` });
	}

	const ctxEnd = Math.min(endLine + CONTEXT_LINES, fileLines.length);
	for (let i = endLine; i < ctxEnd; i++) {
		rows.push({ kind: "context", text: `  ${fileLines[i] ?? ""}` });
	}

	return applyRowCap(rows, cap);
}

/**
 * Projects a `write` tool call onto `fileContent`.
 *
 * For a new file (no existing content): returns all content lines as add rows.
 * For an existing file: returns all old lines as del, all new lines as add.
 * This is an S4 simplification; S5 will replace this with LCS-based diff.
 *
 * Returns `[]` when the `content` arg is absent.
 */
function projectWrite(
	args: Record<string, unknown>,
	fileContent: string | undefined,
	cap: number,
): DiffBlockLine[] {
	const content = typeof args.content === "string" ? args.content : undefined;
	if (content === undefined) return [];

	const newLines = content.split("\n");
	while (newLines.length > 0 && newLines[newLines.length - 1] === "") newLines.pop();

	if (!fileContent) {
		const rows: DiffBlockLine[] = newLines.map((line) => ({ kind: "add" as const, text: `+ ${line}` }));
		return applyRowCap(rows, cap);
	}

	const oldLines = fileContent.split("\n");
	while (oldLines.length > 0 && oldLines[oldLines.length - 1] === "") oldLines.pop();

	const rows: DiffBlockLine[] = [
		...oldLines.map((line): DiffBlockLine => ({ kind: "del", text: `- ${line}` })),
		...newLines.map((line): DiffBlockLine => ({ kind: "add", text: `+ ${line}` })),
	];
	return applyRowCap(rows, cap);
}

/**
 * Projects a pending `edit` or `write` tool call onto `currentFileContent` and
 * returns the diff as `DiffBlockLine[]`.
 *
 * - Detects the tool type by the presence of `old_string`/`new_string` (edit)
 *   or `content` (write) in `args`.
 * - Returns `[]` for unknown arg shapes, non-object args, or any condition
 *   where a preview cannot be computed.
 * - `cap` limits the number of rows before a `{ kind: "more" }` tail is
 *   appended; defaults to `RENDER_DEFAULTS.diff.collapsedLines` (20).
 *
 * The consumer (tool-renderer.ts) renders the rows through `LineBuffer` for
 * structural width-clamping. This function is IO-free.
 */
export function projectPendingEdit(
	args: unknown,
	currentFileContent: string | undefined,
	cap: number = DEFAULT_CAP,
): DiffBlockLine[] {
	if (!isRecord(args)) return [];

	if ("old_string" in args || "new_string" in args) {
		return projectEdit(args, currentFileContent, cap);
	}

	if ("content" in args) {
		return projectWrite(args, currentFileContent, cap);
	}

	return [];
}
