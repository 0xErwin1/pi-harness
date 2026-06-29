import test from "node:test";
import assert from "node:assert/strict";
import { splitThinkingTitle, renderThinkingBlock } from "../../packages/render-core/formatters/thinking.ts";
import type { RenderCtx, WidthOps } from "../../packages/render-core/width.ts";
import type { RenderStyler } from "../../packages/render-core/styler.ts";
import { RENDER_DEFAULTS } from "../../packages/render-core/config.ts";

const TAGGED: RenderStyler = {
	fg: (color, text) => `[${color}:${text}]`,
	bold: (text) => `[bold:${text}]`,
};

const PLAIN: RenderStyler = {
	fg: (_color, text) => text,
	bold: (text) => text,
};

const ASCII: WidthOps = {
	visibleWidth: (s) => s.length,
	truncateToWidth: (s, w) => (s.length <= w ? s : s.slice(0, w)),
};

function makeCtx(maxWidth = 80, styler: RenderStyler = TAGGED): RenderCtx {
	return { styler, width: ASCII, maxWidth, config: RENDER_DEFAULTS };
}

// ── splitThinkingTitle ────────────────────────────────────────────────────────

test("splitThinkingTitle: plain text returns body only, no title", () => {
	const result = splitThinkingTitle("Some plain reasoning text.");
	assert.equal(result.title, undefined);
	assert.equal(result.body, "Some plain reasoning text.");
});

test("splitThinkingTitle: empty string returns empty body, no title", () => {
	const result = splitThinkingTitle("");
	assert.equal(result.title, undefined);
	assert.equal(result.body, "");
});

test("splitThinkingTitle: whitespace-only returns empty body, no title", () => {
	const result = splitThinkingTitle("   \n  ");
	assert.equal(result.title, undefined);
	assert.equal(result.body, "");
});

test("splitThinkingTitle: bold markdown prefix becomes title", () => {
	const result = splitThinkingTitle("**Weighing options**\n\nSome body text.");
	assert.equal(result.title, "Weighing options");
	assert.ok(result.body.includes("Some body text."), `body should include content: ${result.body}`);
});

test("splitThinkingTitle: bold prefix with no following body gives empty body", () => {
	const result = splitThinkingTitle("**A plan**");
	assert.equal(result.title, "A plan");
	assert.equal(result.body, "");
});

test("splitThinkingTitle: Thinking: prefix with a one-line suffix becomes title, empty body", () => {
	const result = splitThinkingTitle("Thinking: What to do");
	assert.equal(result.title, "What to do");
	assert.equal(result.body, "");
});

test("splitThinkingTitle: Thinking: prefix with multiline content splits on first newline", () => {
	const result = splitThinkingTitle("Thinking: What to do\n\nThen this happens.");
	assert.equal(result.title, "What to do");
	assert.ok(result.body.includes("Then this happens."), `expected body: ${result.body}`);
});

test("splitThinkingTitle: case-insensitive Thinking: prefix", () => {
	const result = splitThinkingTitle("thinking: a title\nsome body");
	assert.equal(result.title, "a title");
	assert.ok(result.body.includes("some body"), `expected body: ${result.body}`);
});

// ── renderThinkingBlock ───────────────────────────────────────────────────────

test("renderThinkingBlock: empty texts array returns empty array", () => {
	const result = renderThinkingBlock([], makeCtx());
	assert.deepEqual(result, []);
});

test("renderThinkingBlock: whitespace-only texts return empty array", () => {
	const result = renderThinkingBlock(["  ", "\n\n  \n"], makeCtx());
	assert.deepEqual(result, []);
});

test("renderThinkingBlock: plain body produces header + body lines (dim color)", () => {
	const result = renderThinkingBlock(["First line.\nSecond line."], makeCtx());
	assert.ok(result.length >= 2, `expected at least 2 lines, got ${result.length}: ${JSON.stringify(result)}`);
	assert.ok(result[0].includes("[dim:"), `first line should be dim-styled header: ${result[0]}`);
	assert.ok(result[0].includes("Thinking"), `header should contain 'Thinking': ${result[0]}`);
	assert.ok(result.some(l => l.includes("First line.")), `should include first body line`);
	assert.ok(result.some(l => l.includes("Second line.")), `should include second body line`);
});

test("renderThinkingBlock: bold-prefixed text lifts title into header", () => {
	const result = renderThinkingBlock(["**Planning**\n\nHere is the plan."], makeCtx());
	assert.ok(result[0].includes("Planning"), `header should include title: ${result[0]}`);
	assert.ok(result.some(l => l.includes("Here is the plan.")), `body should include plan`);
});

test("renderThinkingBlock: multiple texts are concatenated into one block", () => {
	const result = renderThinkingBlock(["First thought.", "Second thought."], makeCtx());
	assert.ok(result.some(l => l.includes("First thought.")), `should include first text`);
	assert.ok(result.some(l => l.includes("Second thought.")), `should include second text`);
});

test("renderThinkingBlock: body lines use the gutter prefix", () => {
	const result = renderThinkingBlock(["Some body text here."], makeCtx(80, PLAIN));
	const bodyLines = result.slice(1);
	assert.ok(bodyLines.length > 0, "expected at least one body line");
	assert.ok(bodyLines.every(l => l.startsWith("│ ")), `all body lines should start with '│ ': ${JSON.stringify(bodyLines)}`);
});

test("renderThinkingBlock: over-width lines are clamped by LineBuffer", () => {
	const width = 15;
	const long = "A".repeat(100);
	const result = renderThinkingBlock([long], makeCtx(width, PLAIN));
	assert.ok(result.every(l => l.length <= width), `all lines must be <= ${width}, got: ${JSON.stringify(result)}`);
});

test("renderThinkingBlock: dim styling is applied to all emitted lines", () => {
	const colors: string[] = [];
	const trackStyler: RenderStyler = {
		fg: (color, text) => { colors.push(color); return text; },
		bold: (text) => text,
	};
	renderThinkingBlock(["Some body."], makeCtx(80, trackStyler));
	assert.ok(colors.every(c => c === "dim"), `only dim should be used, got: ${JSON.stringify(colors)}`);
});

test("renderThinkingBlock: does not emit emoji codepoints", () => {
	const result = renderThinkingBlock(["Analyzing the situation."], makeCtx(80, PLAIN));
	for (const line of result) {
		for (const cp of line) {
			const code = cp.codePointAt(0) ?? 0;
			const isEmoji = (code >= 0x1f000 && code <= 0x1faff) || code === 0xfe0f;
			assert.ok(!isEmoji, `emoji codepoint U+${code.toString(16).toUpperCase()} found in: ${line}`);
		}
	}
});

test("renderThinkingBlock: blank body lines are skipped", () => {
	const result = renderThinkingBlock(["Header text.\n\n\nActual content."], makeCtx(80, PLAIN));
	const bodyLines = result.slice(1);
	assert.ok(!bodyLines.some(l => l === "│ "), `blank body lines (gutter + empty) should be omitted`);
});
