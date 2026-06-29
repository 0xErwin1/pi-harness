import test from "node:test";
import assert from "node:assert/strict";
import {
	thinkingLineCount,
	summarizeThinking,
	collapseThinkingLines,
	toggleThinking,
	type ThinkingViewState,
} from "../../packages/visual-hierarchy/thinking.ts";
import type { LineStyler } from "../../packages/visual-hierarchy/transforms.ts";

const testStyler: LineStyler = {
	fg: (role, text) => `[${role}:${text}]`,
};

// ────────────────────────────────────────────────────────────────────────────
// thinkingLineCount
// ────────────────────────────────────────────────────────────────────────────

test("thinkingLineCount: counts lines in a single thinking block", () => {
	const content = [{ type: "thinking", thinking: "line one\nline two\nline three" }];
	assert.equal(thinkingLineCount(content), 3);
});

test("thinkingLineCount: sums lines across multiple thinking blocks", () => {
	const content = [
		{ type: "thinking", thinking: "a" },
		{ type: "text", text: "assistant text" },
		{ type: "thinking", thinking: "b\nc" },
	];
	assert.equal(thinkingLineCount(content), 3);
});

test("thinkingLineCount: ignores non-thinking blocks", () => {
	const content = [
		{ type: "text", text: "hello" },
		{ type: "toolCall", id: "t1" },
	];
	assert.equal(thinkingLineCount(content), 0);
});

test("thinkingLineCount: returns 0 for null", () => {
	assert.equal(thinkingLineCount(null), 0);
});

test("thinkingLineCount: returns 0 for undefined", () => {
	assert.equal(thinkingLineCount(undefined), 0);
});

test("thinkingLineCount: returns 0 for non-array", () => {
	assert.equal(thinkingLineCount("not an array"), 0);
	assert.equal(thinkingLineCount(42), 0);
	assert.equal(thinkingLineCount({}), 0);
});

test("thinkingLineCount: returns 0 for block with missing thinking field", () => {
	const content = [{ type: "thinking" }];
	assert.equal(thinkingLineCount(content), 0);
});

test("thinkingLineCount: returns 0 for block with non-string thinking field", () => {
	const content = [{ type: "thinking", thinking: 42 }];
	assert.equal(thinkingLineCount(content), 0);
});

// ────────────────────────────────────────────────────────────────────────────
// summarizeThinking
// ────────────────────────────────────────────────────────────────────────────

test("summarizeThinking: contains the triangle glyph and line count", () => {
	const result = summarizeThinking(7, testStyler);
	assert.ok(result.includes("▸"), "contains ▸ glyph");
	assert.ok(result.includes("7"), "contains the count");
	assert.ok(result.includes("líneas"), "contains 'líneas'");
});

test("summarizeThinking: uses dim role via the injected styler", () => {
	const rolesUsed: string[] = [];
	const trackingStyler: LineStyler = {
		fg: (role, text) => {
			rolesUsed.push(role);
			return text;
		},
	};
	summarizeThinking(5, trackingStyler);
	assert.ok(rolesUsed.length > 0, "fg called at least once");
	assert.ok(rolesUsed.every((r) => r === "dim"), "only dim role used");
});

test("summarizeThinking: output contains no emoji or U+FE0F", () => {
	const result = summarizeThinking(3, testStyler);
	assert.ok(!result.includes("️"), "no variation selector U+FE0F");
	const emojiPattern = /\p{Emoji_Presentation}/u;
	assert.ok(!emojiPattern.test(result), "no emoji presentation characters");
});

// ────────────────────────────────────────────────────────────────────────────
// collapseThinkingLines
// ────────────────────────────────────────────────────────────────────────────

const isT = (line: string) => line.startsWith("T:");
const SUMMARY = "[dim:▸ thinking · 3 líneas]";

test("collapseThinkingLines: collapsed — thinking run replaced by summary line", () => {
	const lines = ["regular", "T:line one", "T:line two", "T:line three", "more regular"];
	const result = collapseThinkingLines(lines, isT, true, SUMMARY);

	assert.equal(result.length, 3, "summary replaces the three thinking lines");
	assert.equal(result[0], "regular");
	assert.equal(result[1], SUMMARY);
	assert.equal(result[2], "more regular");
});

test("collapseThinkingLines: expanded — thinking lines returned unchanged", () => {
	const lines = ["regular", "T:line one", "T:line two", "more regular"];
	const result = collapseThinkingLines(lines, isT, false, SUMMARY);

	assert.deepEqual(result, lines);
});

test("collapseThinkingLines: no-thinking lines — passthrough unchanged", () => {
	const lines = ["regular", "assistant text", "more text"];
	const result = collapseThinkingLines(lines, isT, true, SUMMARY);

	assert.deepEqual(result, lines);
});

test("collapseThinkingLines: ambiguous (multiple non-contiguous groups) — passthrough", () => {
	const lines = ["T:first group", "regular", "T:second group"];
	const result = collapseThinkingLines(lines, isT, true, SUMMARY);

	assert.deepEqual(result, lines);
});

test("collapseThinkingLines: empty lines array — passthrough", () => {
	const result = collapseThinkingLines([], isT, true, SUMMARY);
	assert.deepEqual(result, []);
});

test("collapseThinkingLines: thinking-only lines all collapsed to summary", () => {
	const lines = ["T:only thinking"];
	const result = collapseThinkingLines(lines, isT, true, SUMMARY);

	assert.equal(result.length, 1);
	assert.equal(result[0], SUMMARY);
});

// ────────────────────────────────────────────────────────────────────────────
// toggleThinking
// ────────────────────────────────────────────────────────────────────────────

test("toggleThinking: collapsed state flips to expanded", () => {
	const s: ThinkingViewState = { collapsed: true };
	const next = toggleThinking(s);
	assert.equal(next.collapsed, false);
});

test("toggleThinking: expanded state flips to collapsed", () => {
	const s: ThinkingViewState = { collapsed: false };
	const next = toggleThinking(s);
	assert.equal(next.collapsed, true);
});

test("toggleThinking: double toggle returns to original state", () => {
	const s: ThinkingViewState = { collapsed: true };
	const toggled = toggleThinking(s);
	const restored = toggleThinking(toggled);
	assert.equal(restored.collapsed, s.collapsed);
});

test("toggleThinking: does not mutate the input state", () => {
	const s: ThinkingViewState = { collapsed: true };
	toggleThinking(s);
	assert.equal(s.collapsed, true, "original state is unchanged");
});
