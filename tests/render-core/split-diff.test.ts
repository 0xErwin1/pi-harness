import test from "node:test";
import assert from "node:assert/strict";
import {
	buildDiffRows,
	resolveDiffMode,
	splitDiffBodyTexts,
	styleDiffBodyLine,
} from "../../packages/render-core/formatters/diff.ts";
import type { DiffConfig } from "../../packages/render-core/config.ts";
import type { RenderStyler } from "../../packages/render-core/styler.ts";

const TAGGED: RenderStyler = {
	fg: (color, text) => `<${color}>${text}</${color}>`,
	bold: (text) => `<b>${text}</b>`,
};

/** Strips the deterministic `<tag>` markup so a styled line's true visible width can be measured. */
function visibleText(s: string): string {
	return s.replace(/<\/?[a-z]+>/g, "");
}

function configWith(mode: DiffConfig["mode"], splitMinWidth = 120): DiffConfig {
	return { mode, splitMinWidth, collapsedLines: 20, wordWrap: true, lineNumbers: true, charSpans: true };
}

// ── resolveDiffMode ───────────────────────────────────────────────────────────

test("resolveDiffMode: unified always resolves to unified", () => {
	assert.equal(resolveDiffMode(configWith("unified"), 400), "unified");
	assert.equal(resolveDiffMode(configWith("unified"), 50), "unified");
});

test("resolveDiffMode: split is honoured above the legibility floor and degrades below it", () => {
	assert.equal(resolveDiffMode(configWith("split"), 120), "split");
	assert.equal(resolveDiffMode(configWith("split"), 100), "split");
	assert.equal(resolveDiffMode(configWith("split"), 80), "unified");
});

test("resolveDiffMode: auto switches at the configured splitMinWidth", () => {
	assert.equal(resolveDiffMode(configWith("auto", 120), 119), "unified");
	assert.equal(resolveDiffMode(configWith("auto", 120), 120), "split");
});

test("resolveDiffMode: a non-positive width (no-clamp path) can never size two panes", () => {
	assert.equal(resolveDiffMode(configWith("split"), 0), "unified");
	assert.equal(resolveDiffMode(configWith("auto", 1), 0), "unified");
});

// ── splitDiffBodyTexts ────────────────────────────────────────────────────────

function styledSplit(diff: string, maxWidth = 120): string[] {
	const rows = buildDiffRows(diff, { cap: 20 });
	return splitDiffBodyTexts(rows, maxWidth).map((body) => styleDiffBodyLine(body, TAGGED));
}

test("splitDiffBodyTexts: empty rows yield no lines", () => {
	assert.deepEqual(splitDiffBodyTexts([], 120), []);
});

test("splitDiffBodyTexts: a context row mirrors onto both panes with a divider", () => {
	const styled = styledSplit("--- a\n+++ b\n@@ -1,1 +1,1 @@\n keep\n-x\n+y");
	const ctxLine = styled.find((l) => (l.match(/keep/g) ?? []).length === 2);
	assert.ok(ctxLine !== undefined, `context mirrors both panes: ${JSON.stringify(styled)}`);
	assert.ok(ctxLine!.includes("│"), "panes are divided by a vertical separator");
});

test("splitDiffBodyTexts: a modified pair places old-left (error) and new-right (success) on one row", () => {
	const styled = styledSplit("--- a\n+++ b\n@@ -1,1 +1,1 @@\n-old\n+new");
	const pair = styled.find((l) => l.includes("old") && l.includes("new"));
	assert.ok(pair !== undefined, `pair shares a row: ${JSON.stringify(styled)}`);
	assert.ok(pair!.includes("<error>"), "left pane is error-coloured");
	assert.ok(pair!.includes("<success>"), "right pane is success-coloured");
});

test("splitDiffBodyTexts: a pure addition leaves the left pane blank", () => {
	const styled = styledSplit("--- a\n+++ b\n@@ -0,0 +1,1 @@\n+added only");
	const add = styled.find((l) => l.includes("added only"));
	assert.ok(add !== undefined, "addition row is present");
	assert.ok(add!.includes("<success>added only</success>"), "added content is success-coloured");
	// The added text must sit on the RIGHT of the divider — nothing before it but gutter + separator.
	const beforeDivider = add!.slice(0, add!.indexOf("│"));
	assert.ok(!beforeDivider.includes("added only"), "the added text is on the right pane, not the left");
});

test("splitDiffBodyTexts: a pure deletion leaves the right pane blank", () => {
	const styled = styledSplit("--- a\n+++ b\n@@ -1,1 +0,0 @@\n-removed only");
	const del = styled.find((l) => l.includes("removed only"));
	assert.ok(del !== undefined, "deletion row is present");
	assert.ok(del!.includes("<error>removed only"), "removed content is error-coloured (left pane is padded)");
	const afterDivider = del!.slice(del!.indexOf("│"));
	assert.ok(!afterDivider.includes("removed only"), "the removed text is on the left pane, not the right");
});

test("splitDiffBodyTexts: hunk and more rows pass through as plain dim full-width lines", () => {
	const body = Array.from({ length: 30 }, (_, i) => `+line ${i}`).join("\n");
	const styled = styledSplit(`--- a\n+++ b\n@@ -1 +1 @@\n${body}`);
	assert.ok(styled.some((l) => l.includes("@@ -1 +1 @@")), "the hunk header survives");
	assert.ok(styled.some((l) => l.includes("more")), "a `… +N more` continuation is emitted");
});

test("splitDiffBodyTexts: every styled split line fits within the draw width", () => {
	const width = 100;
	const styled = styledSplit("--- a\n+++ b\n@@ -1,2 +1,2 @@\n keep this context line\n-a removed line here\n+a replaced line here", width);
	for (const line of styled) {
		assert.ok(visibleText(line).length <= width, `over-width line (${visibleText(line).length} > ${width}): ${JSON.stringify(line)}`);
	}
});

test("splitDiffBodyTexts: styled split output leaks no split/emphasis control bytes and no emoji", () => {
	const styled = styledSplit("--- a\n+++ b\n@@ -1,2 +1,2 @@\n ctx\n-old value\n+new value");
	for (const line of styled) {
		assert.ok(!/[\x0e-\x14]/.test(line), `control byte leaked: ${JSON.stringify(line)}`);
		for (const cp of line) {
			const code = cp.codePointAt(0) ?? 0;
			const isEmoji = (code >= 0x1f000 && code <= 0x1faff) || code === 0xfe0f;
			assert.ok(!isEmoji, `emoji codepoint U+${code.toString(16).toUpperCase()} in: ${line}`);
		}
	}
});
