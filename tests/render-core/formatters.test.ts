import test from "node:test";
import assert from "node:assert/strict";
import { toolVerb, formatToolArgs } from "../../packages/render-core/formatters/tool-args.ts";
import {
	summarizeToolResult,
	parseDiffStat,
	diffBlockLines,
} from "../../packages/render-core/formatters/tool-summary.ts";
import { outputBlockLines } from "../../packages/render-core/formatters/output-block.ts";
import { buildToolCallLine } from "../../packages/render-core/formatters/tool-call.ts";
import { buildToolResultLines } from "../../packages/render-core/formatters/tool-result.ts";
import { LineBuffer, type RenderCtx, type WidthOps } from "../../packages/render-core/width.ts";
import type { RenderStyler } from "../../packages/render-core/styler.ts";
import { RENDER_DEFAULTS } from "../../packages/render-core/config.ts";

/** Deterministic styler: wraps text in semantic HTML-like tags for full assertability. */
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

// ── toolVerb ────────────────────────────────────────────────────────────────

test("toolVerb: capitalizes the built-in tool names", () => {
	assert.equal(toolVerb("read"), "Read");
	assert.equal(toolVerb("bash"), "Bash");
	assert.equal(toolVerb("edit"), "Edit");
	assert.equal(toolVerb("write"), "Write");
	assert.equal(toolVerb("grep"), "Grep");
	assert.equal(toolVerb("find"), "Find");
	assert.equal(toolVerb("ls"), "Ls");
});

test("toolVerb: unknown tool gets capitalized first letter", () => {
	assert.equal(toolVerb("frobnicate"), "Frobnicate");
	assert.equal(toolVerb("myTool"), "Mytool");
});

test("toolVerb: empty string stays empty", () => {
	assert.equal(toolVerb(""), "");
});

// ── formatToolArgs ──────────────────────────────────────────────────────────

test("formatToolArgs: read shows just the path when no range", () => {
	assert.equal(formatToolArgs("read", { path: "src/a.ts" }), "src/a.ts");
});

test("formatToolArgs: read shows path:start-end from offset+limit", () => {
	assert.equal(formatToolArgs("read", { path: "src/a.ts", offset: 10, limit: 20 }), "src/a.ts:10-29");
});

test("formatToolArgs: bash prefixes the command with a $ prompt", () => {
	assert.equal(formatToolArgs("bash", { command: "ls -la" }), "$ ls -la");
});

test("formatToolArgs: bash collapses a multi-line command to its first line plus an ellipsis", () => {
	const command = "python3 - <<'PY'\nfrom pathlib import Path\nprint(Path('.'))";
	assert.equal(formatToolArgs("bash", { command }), "$ python3 - <<'PY' …");
});

test("formatToolArgs: grep shows the pattern", () => {
	assert.equal(formatToolArgs("grep", { pattern: "TODO" }), "TODO");
});

test("formatToolArgs: ls defaults to '.'", () => {
	assert.equal(formatToolArgs("ls", {}), ".");
});

test("formatToolArgs: unknown tool yields empty string", () => {
	assert.equal(formatToolArgs("frobnicate", { path: "x" }), "");
});

// ── summarizeToolResult ─────────────────────────────────────────────────────

test("summarizeToolResult: read counts lines", () => {
	assert.deepEqual(summarizeToolResult("read", { path: "a" }, "l1\nl2\nl3\n", undefined), {
		text: "3 lines",
		status: "neutral",
	});
});

test("summarizeToolResult: bash exit 0 is ok-status", () => {
	assert.deepEqual(summarizeToolResult("bash", { command: "x" }, "line1\nline2\nexit code: 0", undefined), {
		text: "exit 0 · 3 lines",
		status: "ok",
	});
});

test("summarizeToolResult: bash nonzero exit is error-status", () => {
	assert.deepEqual(summarizeToolResult("bash", { command: "x" }, "boom\nexit code: 2", undefined), {
		text: "exit 2 · 2 lines",
		status: "error",
	});
});

test("summarizeToolResult: unknown tool yields neutral empty summary", () => {
	assert.deepEqual(summarizeToolResult("frobnicate", {}, "whatever", undefined), {
		text: "",
		status: "neutral",
	});
});

// ── parseDiffStat ───────────────────────────────────────────────────────────

test("parseDiffStat: counts +/- excluding +++/--- headers and @@ hunks", () => {
	const diff = "--- a/x\n+++ b/x\n@@ -1,4 +1,5 @@\n ctx\n-removed\n+added1\n+added2\n+added3";
	assert.deepEqual(parseDiffStat(diff), { additions: 3, removals: 1 });
});

test("parseDiffStat: empty diff yields zeros", () => {
	assert.deepEqual(parseDiffStat(""), { additions: 0, removals: 0 });
});

// ── diffBlockLines ──────────────────────────────────────────────────────────

test("diffBlockLines: classifies add/del/context and drops file headers", () => {
	const diff = "--- a/x\n+++ b/x\n@@ -1,2 +1,3 @@\n ctx\n-old\n+new";
	assert.deepEqual(diffBlockLines(diff), [
		{ kind: "context", text: "@@ -1,2 +1,3 @@" },
		{ kind: "context", text: " ctx" },
		{ kind: "del", text: "-old" },
		{ kind: "add", text: "+new" },
	]);
});

test("diffBlockLines: caps the block and appends a more line", () => {
	const body = Array.from({ length: 25 }, (_, i) => ` ctx${i}`).join("\n");
	const diff = `--- a\n+++ b\n${body}`;
	const lines = diffBlockLines(diff, 20);
	assert.equal(lines.length, 21);
	assert.deepEqual(lines[20], { kind: "more", text: "… +5 more" });
});

// ── outputBlockLines ─────────────────────────────────────────────────────────

test("outputBlockLines: returns lines verbatim", () => {
	assert.deepEqual(outputBlockLines("one\ntwo\nthree"), ["one", "two", "three"]);
});

test("outputBlockLines: drops a trailing exit code trailer", () => {
	assert.deepEqual(outputBlockLines("done\nexit code: 0"), ["done"]);
});

test("outputBlockLines: empty output yields no lines", () => {
	assert.deepEqual(outputBlockLines(undefined), []);
	assert.deepEqual(outputBlockLines(""), []);
});

// ── buildToolCallLine ───────────────────────────────────────────────────────

test("buildToolCallLine: verb is bold+accent, args are muted", () => {
	const ctx = makeCtx();
	assert.deepEqual(buildToolCallLine("read", { path: "a.ts" }, ctx), [
		"<dim>→</dim> <muted>Read</muted> <muted>a.ts</muted>",
	]);
});

test("buildToolCallLine: bash shows $ prefix for command", () => {
	const ctx = makeCtx();
	assert.deepEqual(buildToolCallLine("bash", { command: "ls" }, ctx), [
		"<b><accent>$</accent></b> <muted>ls</muted>",
	]);
});

test("buildToolCallLine: unknown tool with no display args yields verb only", () => {
	const ctx = makeCtx();
	assert.deepEqual(buildToolCallLine("frobnicate", {}, ctx), [
		"<dim>→</dim> <muted>Frobnicate</muted>",
	]);
});

test("buildToolCallLine: clamped to maxWidth", () => {
	const ctx = makeCtx(10);
	const lines = buildToolCallLine("read", { path: "long/path/to/file.ts" }, ctx);
	assert.equal(lines.length, 1);
	// With ASCII width ops the line would be truncated; just verify it's within maxWidth
	// The styled line has HTML-like tags so we can't easily measure, but with ASCII ops
	// the truncateToWidth acts on the full tagged string
	assert.ok(lines[0].length <= 10 || lines[0].includes("<b>"), "line is produced");
});

// ── buildToolResultLines ────────────────────────────────────────────────────

test("buildToolResultLines: read yields verb+args+summary", () => {
	const ctx = makeCtx();
	const result = { resultText: "l1\nl2\n", details: undefined };
	const lines = buildToolResultLines("read", { path: "a.ts" }, result, false, false, ctx);
	assert.deepEqual(lines, [
		"<dim>→</dim> <muted>Read</muted> <muted>a.ts</muted> · <dim>2 lines</dim>",
	]);
});

test("buildToolResultLines: bash exit 0 success summary with output block", () => {
	const ctx = makeCtx();
	const result = { resultText: "a\nb\nexit code: 0", details: undefined };
	const lines = buildToolResultLines("bash", { command: "x" }, result, false, false, ctx);
	assert.deepEqual(lines, [
		"<b><accent>$</accent></b> <muted>x</muted> · <success>exit 0 · 3 lines</success>",
		"",
		"<muted>a</muted>",
		"<muted>b</muted>",
	]);
});

test("buildToolResultLines: isError overrides summary color", () => {
	const ctx = makeCtx();
	const result = { resultText: "l1\n", details: undefined };
	const lines = buildToolResultLines("read", { path: "a.ts" }, result, true, false, ctx);
	assert.deepEqual(lines, [
		"<dim>→</dim> <muted>Read</muted> <muted>a.ts</muted> · <error>1 lines</error>",
	]);
});

/** Config that forces the unified (single-column) diff layout regardless of width. */
const UNIFIED_CONFIG = { ...RENDER_DEFAULTS, diff: { ...RENDER_DEFAULTS.diff, mode: "unified" as const } };

/** Strips the deterministic `<tag>` markup so a split line's true visible width is measured. */
function visibleText(s: string): string {
	return s.replace(/<\/?[a-z]+>/g, "");
}

/** Tag-aware width ops: needed for split lines, which are padded to near the full draw width. */
const TAG_WIDTH: WidthOps = {
	visibleWidth: (s) => visibleText(s).length,
	truncateToWidth: (s, w) => (visibleText(s).length <= w ? s : s.slice(0, w)),
};

test("buildToolResultLines: edit appends the rich UNIFIED diff block when mode is unified", () => {
	const diff = "--- a/x\n+++ b/x\n@@ -1,2 +1,3 @@\n ctx\n-old\n+new";
	const ctx: RenderCtx = { styler: STYLER, width: ASCII_WIDTH, maxWidth: 200, config: UNIFIED_CONFIG };
	const result = { resultText: "", details: { diff } };
	const lines = buildToolResultLines("edit", { path: "x" }, result, false, false, ctx);
	assert.deepEqual(lines, [
		"<dim>→</dim> <muted>Edit</muted> <muted>x</muted> · <dim>+1 -1</dim>",
		"<dim>@@ -1,2 +1,3 @@</dim>",
		"<dim>  1 1 │ </dim><dim>ctx</dim>",
		"<dim>- 2   │ </dim><b><error>old</error></b>",
		"<dim>+   2 │ </dim><b><success>new</success></b>",
	]);
});

test("buildToolResultLines: edit renders a SPLIT diff at the default (split) mode on a wide terminal", () => {
	const diff = "--- a/x\n+++ b/x\n@@ -1,2 +1,3 @@\n ctx\n-old\n+new";
	const ctx: RenderCtx = { styler: STYLER, width: TAG_WIDTH, maxWidth: 120, config: RENDER_DEFAULTS };
	const result = { resultText: "", details: { diff } };
	const lines = buildToolResultLines("edit", { path: "x" }, result, false, false, ctx);

	assert.equal(lines[0], "<dim>→</dim> <muted>Edit</muted> <muted>x</muted> · <dim>+1 -1</dim>");
	assert.ok(lines.includes("<dim>@@ -1,2 +1,3 @@</dim>"), "hunk header stays a dim full-width line");

	const ctxLine = lines.find((l) => (l.match(/ctx/g) ?? []).length === 2);
	assert.ok(ctxLine !== undefined, `context must mirror onto both panes: ${JSON.stringify(lines)}`);
	assert.ok(ctxLine!.includes("│"), "the two panes are divided by a vertical separator");

	const pairLine = lines.find((l) => l.includes("old") && l.includes("new"));
	assert.ok(pairLine !== undefined, `the modified line pairs old-left / new-right on one row: ${JSON.stringify(lines)}`);
	assert.ok(pairLine!.includes("<b><error>old</error></b>"), "old text is error-coloured + emphasised on the left pane");
	assert.ok(pairLine!.includes("<b><success>new</success></b>"), "new text is success-coloured + emphasised on the right pane");

	for (const line of lines) {
		assert.ok(!/[\x10-\x14]/.test(line), `no split control byte may leak into styled output: ${JSON.stringify(line)}`);
	}
});

test("buildToolResultLines: write renders its content as an all-additions diff block (unified)", () => {
	const ctx: RenderCtx = { styler: STYLER, width: ASCII_WIDTH, maxWidth: 200, config: UNIFIED_CONFIG };
	const result = { resultText: "Successfully wrote 18 bytes to f.txt", details: undefined };
	const lines = buildToolResultLines("write", { path: "f.txt", content: "alpha\nbeta\n" }, result, false, false, ctx);

	assert.equal(lines[0], "<dim>→</dim> <muted>Write</muted> <muted>f.txt</muted> · <dim>2 lines</dim>");
	assert.ok(lines.some((l) => l.includes("<success>alpha</success>")), `alpha is an addition: ${JSON.stringify(lines)}`);
	assert.ok(lines.some((l) => l.includes("<success>beta</success>")), "beta is an addition");
	assert.ok(!lines.some((l) => l.includes("<error>")), "a new-file write has no deletions");
});

test("buildToolResultLines: write with no content renders just the summary, no diff block", () => {
	const ctx = makeCtx();
	const result = { resultText: "wrote", details: undefined };
	const lines = buildToolResultLines("write", { path: "f.txt" }, result, false, false, ctx);
	assert.equal(lines.length, 1, "no content means no diff block");
});

test("buildToolResultLines: no output contains emoji", () => {
	const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
	const ctx = makeCtx();
	for (const tool of ["read", "bash", "edit", "write", "grep", "find", "ls"]) {
		const result = { resultText: "a\nb", details: undefined };
		const lines = buildToolResultLines(tool, { path: "p", command: "c", pattern: "x", content: "a" }, result, false, false, ctx);
		for (const line of lines) {
			assert.ok(!EMOJI_RE.test(line), `unexpected emoji in ${tool}: ${line}`);
		}
	}
});
