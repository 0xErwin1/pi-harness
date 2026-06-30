/**
 * Rich unified-diff renderer.
 *
 * `buildDiffRows` parses a unified diff string into a pure `DiffRow[]` model:
 * each row carries its change kind, old/new line numbers, the line content, and
 * inline char-level emphasis spans computed by a clean-room longest-common-
 * subsequence over each modified line pair. The model is theme-agnostic and
 * IO-free so BOTH consumers (the main-thread tool renderer and the subagent
 * conversation viewer) and the parity test drive it identically.
 *
 * `diffBodyTexts` composes the rows into the shared plain body strings — a
 * line-number gutter, the +/- sign, and the content, with emphasis spans bracketed
 * by control bytes that the styling layer consumes. `styleDiffBodyLine` is the
 * SINGLE styling function both consumers call: the gutter is dim, content is
 * coloured by change kind, and emphasis spans are bold. Because both surfaces
 * compose and style through these same functions, their output is byte-identical
 * (the parity invariant), and width-safety is preserved because the styled rows
 * are pushed through the consumer's `LineBuffer`.
 *
 * The LCS here is the inline char-diff between a removed line and its paired added
 * line — the unified diff input has already done the line-level diffing. It is an
 * independent reimplementation; no SDK `renderDiff` and no third-party diff code is
 * used, which keeps render-core pure and the two surfaces in parity.
 */

import type { RenderStyler, RenderColor } from "../styler.ts";
import type { WidthOps } from "../width.ts";
import type { DiffConfig } from "../config.ts";

/** The change role of a diff row. `hunk` is a `@@` header; `more` is the cap tail. */
export type DiffRowKind = "add" | "del" | "context" | "hunk" | "more";

/** A character range within a row's content; `emphasis` marks it as a changed span. */
export interface DiffSpan {
	start: number;
	end: number;
	emphasis: boolean;
}

/** One structured diff row. `text` is the content only (no gutter, no sign). */
export interface DiffRow {
	kind: DiffRowKind;
	lineNo?: { old?: number; new?: number };
	text: string;
	spans?: DiffSpan[];
}

/** Options for `buildDiffRows`; `cap` bounds the row count before a `more` tail. */
export interface DiffRowsOptions {
	cap?: number;
}

/** Default number of rows shown before a `… +N more` continuation. */
const DEFAULT_CAP = 20;

/** Column separator between the line-number gutter and the content. */
const SEP = "│ ";

/**
 * Control bytes bracketing an emphasized span inside a composed body string.
 * They are C0 controls that cannot survive `stripControlChars`, so they never
 * occur in real content; the styling layer consumes them and never emits them.
 */
const EMPH_ON = "";
const EMPH_OFF = "";

/** Upper bound on `a.length * b.length` for the inline LCS; larger pairs skip emphasis. */
const LCS_BUDGET = 250_000;

/**
 * Zero-width control sentinels used to lay out a SPLIT (side-by-side) diff body
 * string at build time and consume it at style time. Like `EMPH_ON`/`EMPH_OFF`
 * they are C0 controls that `stripControlChars` removes from real content, so they
 * can never collide with code, paths, or diff text. `SPLIT_MARK` tags a line as
 * split; `COL_SEP` divides the two panes; the `KIND_*` bytes carry each cell's
 * change role so the styler colours panes independently without re-parsing signs.
 */
const SPLIT_MARK = "";
const COL_SEP = "";
const KIND_DEL = "";
const KIND_ADD = "";
const KIND_CTX = "";

/** Visible separator the styler emits between the two split panes (replaces `COL_SEP`). */
const SPLIT_SEP = " │ ";

/** Below this draw width a side-by-side diff is too cramped, so even explicit `split` degrades to unified. */
const SPLIT_LEGIBILITY_FLOOR = 100;

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Removes ANSI escape sequences and C0 control characters (except tab) from one line. */
function stripControlChars(text: string): string {
	return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0a-\x1f\x7f]/g, "");
}

/** True for the unified-diff `+++`/`---` file headers, which carry no diff content. */
function isFileHeader(line: string): boolean {
	return line.startsWith("+++") || line.startsWith("---");
}

interface MutableRow {
	kind: DiffRowKind;
	old?: number;
	new?: number;
	text: string;
	spans?: DiffSpan[];
}

/**
 * Computes the changed character spans of `a` relative to `b` via a clean-room
 * LCS: positions in `a` that are not part of the longest common subsequence are
 * the changed characters, coalesced into contiguous emphasis spans. Returns no
 * spans when the pair is too large to diff cheaply or when the lines are equal.
 */
function changedSpans(a: string, b: string): DiffSpan[] {
	if (a.length === 0 || a === b) return [];
	if (a.length * b.length > LCS_BUDGET) return [];

	const n = a.length;
	const m = b.length;

	const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = 1; i <= n; i++) {
		for (let j = 1; j <= m; j++) {
			lcs[i][j] = a[i - 1] === b[j - 1] ? lcs[i - 1][j - 1] + 1 : Math.max(lcs[i - 1][j], lcs[i][j - 1]);
		}
	}

	const changed = new Array<boolean>(n).fill(false);
	let i = n;
	let j = m;
	while (i > 0) {
		if (j > 0 && a[i - 1] === b[j - 1]) {
			i--;
			j--;
		} else if (j > 0 && lcs[i][j - 1] >= lcs[i - 1][j]) {
			j--;
		} else {
			changed[i - 1] = true;
			i--;
		}
	}

	const spans: DiffSpan[] = [];
	let start = -1;
	for (let k = 0; k <= n; k++) {
		if (k < n && changed[k]) {
			if (start < 0) start = k;
		} else if (start >= 0) {
			spans.push({ start, end: k, emphasis: true });
			start = -1;
		}
	}
	return spans;
}

/**
 * Pairs each contiguous run of deleted rows with the immediately following run of
 * added rows and assigns inline emphasis spans to both halves of every pair, so a
 * modified line highlights only the characters that actually changed.
 */
function assignEmphasis(rows: MutableRow[]): void {
	let k = 0;
	while (k < rows.length) {
		if (rows[k].kind !== "del") {
			k++;
			continue;
		}

		let delEnd = k;
		while (delEnd < rows.length && rows[delEnd].kind === "del") delEnd++;

		let addEnd = delEnd;
		while (addEnd < rows.length && rows[addEnd].kind === "add") addEnd++;

		const pairCount = Math.min(delEnd - k, addEnd - delEnd);
		for (let p = 0; p < pairCount; p++) {
			const del = rows[k + p];
			const add = rows[delEnd + p];
			const delSpans = changedSpans(del.text, add.text);
			const addSpans = changedSpans(add.text, del.text);
			if (delSpans.length > 0) del.spans = delSpans;
			if (addSpans.length > 0) add.spans = addSpans;
		}

		k = addEnd > delEnd ? addEnd : delEnd;
	}
}

/**
 * Parses a unified diff into structured rows: `@@` headers become `hunk` rows,
 * each body line becomes an `add`/`del`/`context` row with its old/new line
 * numbers, inline emphasis spans are assigned per modified line pair, and the
 * body is capped with a trailing `more` row when it exceeds `cap`.
 */
export function buildDiffRows(unifiedDiff: string, options?: DiffRowsOptions): DiffRow[] {
	const cap = options?.cap ?? DEFAULT_CAP;
	const rows: MutableRow[] = [];

	let oldCur = 0;
	let newCur = 0;
	let inHunk = false;

	for (const line of unifiedDiff.split("\n")) {
		if (isFileHeader(line)) continue;

		const hunk = line.match(HUNK_RE);
		if (hunk) {
			oldCur = Number(hunk[1]);
			newCur = Number(hunk[2]);
			inHunk = true;
			rows.push({ kind: "hunk", text: line });
			continue;
		}

		if (line.startsWith("+")) {
			rows.push({ kind: "add", new: inHunk ? newCur++ : undefined, text: stripControlChars(line.slice(1)) });
		} else if (line.startsWith("-")) {
			rows.push({ kind: "del", old: inHunk ? oldCur++ : undefined, text: stripControlChars(line.slice(1)) });
		} else {
			const content = line.startsWith(" ") ? line.slice(1) : line;
			rows.push({
				kind: "context",
				old: inHunk ? oldCur++ : undefined,
				new: inHunk ? newCur++ : undefined,
				text: stripControlChars(content),
			});
		}
	}

	while (rows.length > 0 && rows[rows.length - 1].kind === "context" && rows[rows.length - 1].text === "") {
		rows.pop();
	}

	assignEmphasis(rows);

	const finished: DiffRow[] = rows.map((r) => ({
		kind: r.kind,
		lineNo: r.kind === "hunk" || r.kind === "more" ? undefined : { old: r.old, new: r.new },
		text: r.text,
		spans: r.spans,
	}));

	if (finished.length <= cap) return finished;

	const shown = finished.slice(0, cap);
	shown.push({ kind: "more", text: `… +${finished.length - cap} more` });
	return shown;
}

/** Right-aligns a line number to `width` columns, or returns blank padding when absent. */
function numberCell(value: number | undefined, width: number): string {
	return value === undefined ? " ".repeat(width) : String(value).padStart(width);
}

/** Resolves the digit width of the old and new number columns across all rows. */
function diffColumns(rows: DiffRow[]): { old: number; new: number } {
	let old = 1;
	let nw = 1;
	for (const row of rows) {
		if (row.lineNo?.old !== undefined) old = Math.max(old, String(row.lineNo.old).length);
		if (row.lineNo?.new !== undefined) nw = Math.max(nw, String(row.lineNo.new).length);
	}
	return { old, new: nw };
}

/** Wraps each emphasized span of `content` in the emphasis control bytes. */
function applyEmphasis(content: string, spans: DiffSpan[] | undefined): string {
	if (!spans || spans.length === 0) return content;

	let out = "";
	let pos = 0;
	for (const span of spans) {
		if (!span.emphasis || span.start < pos) continue;
		out += content.slice(pos, span.start) + EMPH_ON + content.slice(span.start, span.end) + EMPH_OFF;
		pos = span.end;
	}
	out += content.slice(pos);
	return out;
}

/** Sign character a composed body line starts with, per change kind. */
function signOf(kind: DiffRowKind): string {
	return kind === "add" ? "+" : kind === "del" ? "-" : " ";
}

/**
 * Composes one row into its plain body string. `hunk` and `more` rows render
 * verbatim (no gutter); `add`/`del`/`context` rows render as
 * `<sign> <old> <new> │ <content>` with emphasis spans bracketed by control bytes.
 */
function composeRow(row: DiffRow, cols: { old: number; new: number }): string {
	if (row.kind === "hunk" || row.kind === "more") return row.text;

	const gutter = `${signOf(row.kind)} ${numberCell(row.lineNo?.old, cols.old)} ${numberCell(row.lineNo?.new, cols.new)} ${SEP}`;
	return gutter + applyEmphasis(row.text, row.spans);
}

/**
 * Composes diff rows into the shared plain body strings used by both consumers.
 * The number columns are aligned across the whole row set so the gutter lines up.
 */
export function diffBodyTexts(rows: DiffRow[]): string[] {
	const cols = diffColumns(rows);
	return rows.map((row) => composeRow(row, cols));
}

/** Maps a leading sign character to the content colour for a body line. */
function colorForSign(sign: string): RenderColor {
	return sign === "+" ? "success" : sign === "-" ? "error" : "dim";
}

/** Styles a content fragment, splitting on emphasis control bytes to bold changed spans. */
function styleContent(content: string, color: RenderColor, styler: RenderStyler): string {
	let out = "";
	let emphasized = false;
	let buf = "";

	const flush = (): void => {
		if (buf.length === 0) return;
		out += emphasized ? styler.bold(styler.fg(color, buf)) : styler.fg(color, buf);
		buf = "";
	};

	for (const ch of content) {
		if (ch === EMPH_ON || ch === EMPH_OFF) {
			flush();
			emphasized = ch === EMPH_ON;
			continue;
		}
		buf += ch;
	}
	flush();
	return out;
}

// ── split (side-by-side) diff ─────────────────────────────────────────────────

/**
 * Resolves the effective diff layout for a given draw width. `unified` always wins;
 * `split` is honoured above a hard legibility floor and otherwise degrades to
 * unified; `auto` chooses split only at or above the configured `splitMinWidth`.
 * A non-positive `maxWidth` (the no-clamp/test path) cannot size two panes, so it
 * always resolves to unified.
 */
export function resolveDiffMode(config: DiffConfig, maxWidth: number): "unified" | "split" {
	if (config.mode === "unified" || maxWidth <= 0) return "unified";
	if (config.mode === "split") return maxWidth >= SPLIT_LEGIBILITY_FLOOR ? "split" : "unified";
	return maxWidth >= config.splitMinWidth ? "split" : "unified";
}

/** The change role of one pane cell. `empty` is the blank half of an unbalanced add/del. */
type SplitCellKind = "del" | "add" | "context" | "empty";

/** One pane of a split row: its line number, raw content, inline emphasis spans, and role. */
interface SplitCell {
	no?: number;
	text: string;
	spans?: DiffSpan[];
	kind: SplitCellKind;
}

/** One visual split row: either a left/right cell pair or a full-width `hunk`/`more` line. */
interface SplitLine {
	left?: SplitCell;
	right?: SplitCell;
	full?: string;
}

/** Maps a pane kind to its leading control byte; `empty` panes carry no byte. */
function kindByte(kind: SplitCellKind): string {
	return kind === "del" ? KIND_DEL : kind === "add" ? KIND_ADD : KIND_CTX;
}

/**
 * Re-pairs the flat unified `DiffRow[]` into side-by-side `SplitLine[]`. Context
 * rows mirror onto both panes; each run of deletions is zipped with the following
 * run of additions so a modified line shows old-left / new-right, with the shorter
 * run padded by `empty` cells; `hunk`/`more` rows pass through as full-width lines.
 */
function splitDiffRows(rows: DiffRow[]): SplitLine[] {
	const out: SplitLine[] = [];
	let k = 0;

	while (k < rows.length) {
		const row = rows[k];

		if (row.kind === "hunk" || row.kind === "more") {
			out.push({ full: row.text });
			k++;
			continue;
		}

		if (row.kind === "context") {
			out.push({
				left: { no: row.lineNo?.old, text: row.text, kind: "context" },
				right: { no: row.lineNo?.new, text: row.text, kind: "context" },
			});
			k++;
			continue;
		}

		if (row.kind === "del") {
			let delEnd = k;
			while (delEnd < rows.length && rows[delEnd].kind === "del") delEnd++;
			let addEnd = delEnd;
			while (addEnd < rows.length && rows[addEnd].kind === "add") addEnd++;

			const delCount = delEnd - k;
			const addCount = addEnd - delEnd;
			const pairs = Math.max(delCount, addCount);

			for (let i = 0; i < pairs; i++) {
				const d = i < delCount ? rows[k + i] : undefined;
				const a = i < addCount ? rows[delEnd + i] : undefined;
				out.push({
					left: d ? { no: d.lineNo?.old, text: d.text, spans: d.spans, kind: "del" } : { text: "", kind: "empty" },
					right: a ? { no: a.lineNo?.new, text: a.text, spans: a.spans, kind: "add" } : { text: "", kind: "empty" },
				});
			}

			k = addEnd;
			continue;
		}

		// A lone addition with no preceding deletion: blank left, content right.
		out.push({
			left: { text: "", kind: "empty" },
			right: { no: row.lineNo?.new, text: row.text, spans: row.spans, kind: "add" },
		});
		k++;
	}

	return out;
}

/** Char-count width ops used when a consumer renders split bodies without a real (ANSI-aware) measurer. */
const CHAR_WIDTH: WidthOps = {
	visibleWidth: (s) => s.length,
	truncateToWidth: (s, w) => (w <= 0 || s.length <= w ? s : s.slice(0, w)),
};

/** Clamps emphasis spans to a truncated cell length so a cut line never references removed characters. */
function clampSpans(spans: DiffSpan[] | undefined, len: number): DiffSpan[] | undefined {
	if (!spans || spans.length === 0) return undefined;
	const clamped = spans
		.filter((s) => s.start < len)
		.map((s) => ({ start: s.start, end: Math.min(s.end, len), emphasis: s.emphasis }));
	return clamped.length > 0 ? clamped : undefined;
}

/**
 * Composes one pane into its plain (pre-style) cell string:
 * `<numCell> <KIND_BYTE><content-with-emphasis><pad>`. The number cell is the
 * gutter (styled dim later); the kind byte tells the styler the content colour;
 * the content is truncated to `cellW`, emphasised, and — for the left pane — padded
 * so the column separator stays aligned. An `empty` pane is the gutter plus padding.
 */
function composeSplitCell(cell: SplitCell, cellW: number, numW: number, pad: boolean, width: WidthOps): string {
	const numCell = cell.no === undefined ? " ".repeat(numW) : String(cell.no).padStart(numW);
	const gutter = `${numCell} `;

	if (cell.kind === "empty") {
		return pad ? gutter + " ".repeat(cellW) : gutter;
	}

	const truncated = width.truncateToWidth(cell.text, cellW);
	const visible = width.visibleWidth(truncated);
	const content = applyEmphasis(truncated, clampSpans(cell.spans, truncated.length));
	const padding = pad ? " ".repeat(Math.max(0, cellW - visible)) : "";

	return gutter + kindByte(cell.kind) + content + padding;
}

/**
 * Composes diff rows into the shared plain SPLIT body strings: each non-header row
 * becomes `SPLIT_MARK <leftCell> COL_SEP <rightCell>`, sized so the two panes plus
 * their gutters and the separator fit within `maxWidth`; `hunk`/`more` rows pass
 * through as plain full-width lines. The styling layer (`styleDiffBodyLine`)
 * consumes the control bytes, so no consumer ever needs to know the split format.
 * `width` defaults to a char-count measurer for theme-agnostic consumers; the
 * main thread passes its ANSI-aware ops.
 */
export function splitDiffBodyTexts(rows: DiffRow[], maxWidth: number, width: WidthOps = CHAR_WIDTH): string[] {
	if (rows.length === 0) return [];

	const cols = diffColumns(rows);
	const gutters = cols.old + 1 + cols.new + 1;
	const sepWidth = SPLIT_SEP.length;
	const cellW = Math.max(1, Math.floor((maxWidth - gutters - sepWidth) / 2));

	const out: string[] = [];
	for (const line of splitDiffRows(rows)) {
		if (line.full !== undefined) {
			out.push(line.full);
			continue;
		}

		const left = composeSplitCell(line.left as SplitCell, cellW, cols.old, true, width);
		const right = composeSplitCell(line.right as SplitCell, cellW, cols.new, false, width);
		out.push(`${SPLIT_MARK}${left}${COL_SEP}${right}`);
	}

	return out;
}

/** Index of the first pane-kind control byte in a cell string, or -1 for an empty/gutter-only cell. */
function kindByteIndex(cell: string): number {
	for (let i = 0; i < cell.length; i++) {
		const ch = cell[i];
		if (ch === KIND_DEL || ch === KIND_ADD || ch === KIND_CTX) return i;
	}
	return -1;
}

/** Styles one split pane: dim gutter, content coloured by its kind byte, emphasis bold. */
function styleSplitCell(cell: string, styler: RenderStyler): string {
	const at = kindByteIndex(cell);
	if (at < 0) return styler.fg("dim", cell);

	const gutter = cell.slice(0, at);
	const marker = cell[at];
	const content = cell.slice(at + 1);
	const color: RenderColor = marker === KIND_DEL ? "error" : marker === KIND_ADD ? "success" : "dim";

	return styler.fg("dim", gutter) + styleContent(content, color, styler);
}

/**
 * Styles a SPLIT body line: the two panes are coloured independently (deletions
 * error, additions success, context dim) with a dim separator between them. All
 * split control bytes are consumed and never emitted. A malformed line (no
 * separator) degrades to a single styled pane rather than throwing.
 */
function styleSplitDiffBodyLine(body: string, styler: RenderStyler): string {
	const rest = body.slice(SPLIT_MARK.length);
	const sepAt = rest.indexOf(COL_SEP);
	if (sepAt < 0) return styleSplitCell(rest, styler);

	const left = rest.slice(0, sepAt);
	const right = rest.slice(sepAt + COL_SEP.length);
	return `${styleSplitCell(left, styler)}${styler.fg("dim", SPLIT_SEP)}${styleSplitCell(right, styler)}`;
}

// TODO(treesitter): syntax-highlight diff/code content. Both `styleContent` (unified)
// and `styleSplitCell` (split) currently colour a whole content fragment by change
// kind only. A tree-sitter pass would tokenise the line and tint identifiers,
// keywords, strings, etc. via the existing syntax* theme roles, layered under the
// add/del/emphasis colouring. Kept theme-agnostic here: the tokeniser would live
// behind the `RenderStyler`/consumer boundary so render-core stays IO-free.

/**
 * The single styling function both consumers apply to a composed diff body string
 * (the consumer strips its own kind marker first). The gutter is dim, the content
 * is coloured by change kind, and emphasized spans are bold. Emphasis control
 * bytes are consumed and never emitted. Because both surfaces call this with the
 * same body string, their styled output is byte-identical. A SPLIT body (tagged
 * with `SPLIT_MARK`) is dispatched to the side-by-side styler.
 */
export function styleDiffBodyLine(body: string, styler: RenderStyler): string {
	if (body.startsWith(SPLIT_MARK)) return styleSplitDiffBodyLine(body, styler);

	const sepAt = body.indexOf(SEP);
	const isGuttered = sepAt > 0 && !body.startsWith("@@") && !body.startsWith("…");

	if (!isGuttered) {
		const color: RenderColor = body.startsWith("+") ? "success" : body.startsWith("-") ? "error" : "dim";
		return styler.fg(color, body.replace(/[]/g, ""));
	}

	const gutter = body.slice(0, sepAt + SEP.length);
	const content = body.slice(sepAt + SEP.length);
	const color = colorForSign(body[0] ?? " ");

	return styler.fg("dim", gutter) + styleContent(content, color, styler);
}
