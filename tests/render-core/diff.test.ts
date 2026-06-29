import test from "node:test";
import assert from "node:assert/strict";
import {
	buildDiffRows,
	diffBodyTexts,
	styleDiffBodyLine,
	type DiffRow,
} from "../../packages/render-core/formatters/diff.ts";
import { LineBuffer, type RenderCtx, type WidthOps } from "../../packages/render-core/width.ts";
import type { RenderStyler } from "../../packages/render-core/styler.ts";
import { RENDER_DEFAULTS } from "../../packages/render-core/config.ts";

/** Deterministic tag styler: `<color>text</color>` and `<b>text</b>` for assertability. */
const STYLER: RenderStyler = {
	fg: (color, text) => `<${color}>${text}</${color}>`,
	bold: (text) => `<b>${text}</b>`,
};

const ASCII_WIDTH: WidthOps = {
	visibleWidth: (s) => s.length,
	truncateToWidth: (s, w) => (s.length <= w ? s : s.slice(0, w)),
};

function makeCtx(maxWidth = 200): RenderCtx {
	return { styler: STYLER, width: ASCII_WIDTH, maxWidth, config: RENDER_DEFAULTS };
}

const EMPH_RE = /[]/;

// ── parsing & line numbers ─────────────────────────────────────────────────────

test("buildDiffRows: drops +++/--- file headers", () => {
	const rows = buildDiffRows("--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n ctx");
	assert.ok(!rows.some((r) => r.text.startsWith("+++") || r.text.startsWith("---")), JSON.stringify(rows));
});

test("buildDiffRows: emits a hunk row carrying the @@ header verbatim", () => {
	const rows = buildDiffRows("--- a\n+++ b\n@@ -1,2 +1,3 @@\n ctx");
	const hunk = rows.find((r) => r.kind === "hunk");
	assert.ok(hunk, "hunk row present");
	assert.equal(hunk?.text, "@@ -1,2 +1,3 @@");
});

test("buildDiffRows: context rows carry both old and new line numbers", () => {
	const rows = buildDiffRows("--- a\n+++ b\n@@ -5,1 +7,1 @@\n ctx");
	const ctx = rows.find((r) => r.kind === "context");
	assert.deepEqual(ctx?.lineNo, { old: 5, new: 7 });
	assert.equal(ctx?.text, "ctx");
});

test("buildDiffRows: del rows carry only the old line number", () => {
	const rows = buildDiffRows("--- a\n+++ b\n@@ -3,1 +3,0 @@\n-gone");
	const del = rows.find((r) => r.kind === "del");
	assert.equal(del?.lineNo?.old, 3);
	assert.equal(del?.lineNo?.new, undefined);
	assert.equal(del?.text, "gone");
});

test("buildDiffRows: add rows carry only the new line number", () => {
	const rows = buildDiffRows("--- a\n+++ b\n@@ -0,0 +4,1 @@\n+fresh");
	const add = rows.find((r) => r.kind === "add");
	assert.equal(add?.lineNo?.new, 4);
	assert.equal(add?.lineNo?.old, undefined);
	assert.equal(add?.text, "fresh");
});

test("buildDiffRows: numbers advance across a multi-line hunk", () => {
	const diff = "--- a\n+++ b\n@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three";
	const rows = buildDiffRows(diff).filter((r) => r.kind !== "hunk");
	assert.deepEqual(
		rows.map((r) => ({ kind: r.kind, old: r.lineNo?.old, new: r.lineNo?.new })),
		[
			{ kind: "context", old: 1, new: 1 },
			{ kind: "del", old: 2, new: undefined },
			{ kind: "add", old: undefined, new: 2 },
			{ kind: "context", old: 3, new: 3 },
		],
	);
});

// ── inline char-level emphasis (clean-room LCS on the line pair) ─────────────────

test("buildDiffRows: a modified line pair emphasizes only the changed prefix", () => {
	const diff = "--- a\n+++ b\n@@ -1,1 +1,1 @@\n-old line\n+new line";
	const rows = buildDiffRows(diff);
	const del = rows.find((r) => r.kind === "del");
	const add = rows.find((r) => r.kind === "add");
	assert.deepEqual(del?.spans, [{ start: 0, end: 3, emphasis: true }], "del emphasizes 'old'");
	assert.deepEqual(add?.spans, [{ start: 0, end: 3, emphasis: true }], "add emphasizes 'new'");
});

test("buildDiffRows: emphasis isolates a changed middle segment", () => {
	const diff = "--- a\n+++ b\n@@ -1,1 +1,1 @@\n-abXcd\n+abYcd";
	const rows = buildDiffRows(diff);
	const del = rows.find((r) => r.kind === "del");
	const add = rows.find((r) => r.kind === "add");
	assert.deepEqual(del?.spans, [{ start: 2, end: 3, emphasis: true }]);
	assert.deepEqual(add?.spans, [{ start: 2, end: 3, emphasis: true }]);
});

test("buildDiffRows: an unpaired add (pure insertion) has no emphasis spans", () => {
	const diff = "--- a\n+++ b\n@@ -0,0 +1,2 @@\n+line a\n+line b";
	const rows = buildDiffRows(diff).filter((r) => r.kind === "add");
	assert.ok(rows.every((r) => r.spans === undefined || r.spans.length === 0), JSON.stringify(rows));
});

// ── cap / more row ──────────────────────────────────────────────────────────────

test("buildDiffRows: caps the row count and appends a more row", () => {
	const body = Array.from({ length: 30 }, (_, i) => `+line ${i}`).join("\n");
	const rows = buildDiffRows(`--- a\n+++ b\n@@ -1 +1 @@\n${body}`, { cap: 20 });
	assert.equal(rows.length, 21);
	const last = rows[20];
	assert.equal(last.kind, "more");
	assert.equal(last.text, "… +11 more");
});

test("buildDiffRows: expanded cap shows every row, no more row", () => {
	const body = Array.from({ length: 30 }, (_, i) => `+line ${i}`).join("\n");
	const rows = buildDiffRows(`--- a\n+++ b\n@@ -1 +1 @@\n${body}`, { cap: Number.MAX_SAFE_INTEGER });
	assert.ok(!rows.some((r) => r.kind === "more"), "no more row when expanded");
});

// ── diffBodyTexts: composed plain body (line-number gutter + sign + content) ─────

test("diffBodyTexts: composes a line-number gutter with sign for a pure insertion", () => {
	const rows = buildDiffRows("--- a\n+++ b\n@@ -0,0 +1,2 @@\n+line a\n+line b");
	assert.deepEqual(diffBodyTexts(rows), ["@@ -0,0 +1,2 @@", "+   1 │ line a", "+   2 │ line b"]);
});

test("diffBodyTexts: aligns both old and new number columns across a hunk", () => {
	const diff = "--- a\n+++ b\n@@ -1,2 +1,2 @@\n ctx\n-old\n+new";
	assert.deepEqual(diffBodyTexts(buildDiffRows(diff)), [
		"@@ -1,2 +1,2 @@",
		"  1 1 │ ctx",
		"- 2   │ old",
		"+   2 │ new",
	]);
});

// ── styleDiffBodyLine: shared styling (gutter dim, content by kind, emphasis bold) ─

test("styleDiffBodyLine: hunk header is dim", () => {
	assert.equal(styleDiffBodyLine("@@ -1,2 +1,2 @@", STYLER), "<dim>@@ -1,2 +1,2 @@</dim>");
});

test("styleDiffBodyLine: a more row is dim", () => {
	assert.equal(styleDiffBodyLine("… +11 more", STYLER), "<dim>… +11 more</dim>");
});

test("styleDiffBodyLine: context gutter and content are dim", () => {
	assert.equal(styleDiffBodyLine("  1 1 │ ctx", STYLER), "<dim>  1 1 │ </dim><dim>ctx</dim>");
});

test("styleDiffBodyLine: del gutter is dim, content is error with bold emphasis", () => {
	assert.equal(
		styleDiffBodyLine("- 2   │ old line", STYLER),
		"<dim>- 2   │ </dim><b><error>old</error></b><error> line</error>",
	);
});

test("styleDiffBodyLine: add gutter is dim, content is success with bold emphasis", () => {
	assert.equal(
		styleDiffBodyLine("+   2 │ new line", STYLER),
		"<dim>+   2 │ </dim><b><success>new</success></b><success> line</success>",
	);
});

test("styleDiffBodyLine: strips emphasis control bytes from the output", () => {
	const out = styleDiffBodyLine("+   2 │ new line", STYLER);
	assert.ok(!EMPH_RE.test(out), `emphasis control bytes must not leak: ${JSON.stringify(out)}`);
});

// ── width-safety (rows pushed through LineBuffer) & emoji audit ──────────────────

test("buildDiffRows → LineBuffer: every styled row is clamped to the render width", () => {
	const diff = "--- a\n+++ b\n@@ -1,1 +1,1 @@\n-this is a fairly long original line of code\n+this is a fairly long replacement line of code";
	const ctx = makeCtx(20);
	const lb = new LineBuffer(ctx);
	for (const body of diffBodyTexts(buildDiffRows(diff))) {
		lb.push(styleDiffBodyLine(body, ctx.styler));
	}
	for (const line of lb.done()) {
		assert.ok(line.length <= 20, `over-width line: ${JSON.stringify(line)}`);
	}
});

test("styleDiffBodyLine: output contains no emoji codepoints", () => {
	const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
	const diff = "--- a\n+++ b\n@@ -1,2 +1,2 @@\n ctx\n-old line\n+new line";
	for (const body of diffBodyTexts(buildDiffRows(diff))) {
		const styled = styleDiffBodyLine(body, STYLER);
		assert.ok(!EMOJI_RE.test(styled), `unexpected emoji: ${styled}`);
	}
});

// ── robustness ──────────────────────────────────────────────────────────────────

test("buildDiffRows: empty diff yields no rows", () => {
	assert.deepEqual(buildDiffRows(""), [] as DiffRow[]);
});

test("buildDiffRows: a body line with no leading marker is treated as context content", () => {
	const rows = buildDiffRows("--- a\n+++ b\n@@ -1 +1 @@\nbare line");
	const ctx = rows.find((r) => r.kind === "context");
	assert.equal(ctx?.text, "bare line");
});
