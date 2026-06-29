import test from "node:test";
import assert from "node:assert/strict";
import { applyUserMarker } from "../../packages/render-core/formatters/user-message.ts";
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

test("applyUserMarker: empty input returns empty array", () => {
	const result = applyUserMarker([], makeCtx());
	assert.deepEqual(result, []);
});

test("applyUserMarker: single line receives accent marker prefix", () => {
	const result = applyUserMarker(["hello world"], makeCtx());
	assert.equal(result.length, 1);
	assert.ok(result[0].startsWith("[accent:❯ ]"), `expected accent marker, got: ${result[0]}`);
	assert.ok(result[0].includes("hello world"), `expected content, got: ${result[0]}`);
});

test("applyUserMarker: first line gets marker, subsequent lines get two-space indent", () => {
	const result = applyUserMarker(["first", "second", "third"], makeCtx());
	assert.equal(result.length, 3);
	assert.ok(result[0].startsWith("[accent:❯ ]"), `first line should have marker: ${result[0]}`);
	assert.equal(result[1], "  second");
	assert.equal(result[2], "  third");
});

test("applyUserMarker: all N content lines pass through (no truncation of multi-line content)", () => {
	const lines = ["line-1", "line-2", "line-3", "line-4", "line-5"];
	const result = applyUserMarker(lines, makeCtx());
	assert.equal(result.length, 5, "all 5 lines must appear in output");
});

test("applyUserMarker: over-width line is clamped to maxWidth by LineBuffer", () => {
	const width = 10;
	const line = "x".repeat(20);
	const result = applyUserMarker([line], makeCtx(width, PLAIN));
	assert.ok(result.length >= 1);
	assert.ok(
		result.every((l) => l.length <= width),
		`expected each line <= ${width}, got: ${JSON.stringify(result)}`,
	);
});

test("applyUserMarker: accent is applied only to the marker glyph, not the content", () => {
	const roles: string[] = [];
	const trackingStyler: RenderStyler = {
		fg: (color, text) => { roles.push(color); return text; },
		bold: (text) => text,
	};
	applyUserMarker(["first", "second"], makeCtx(80, trackingStyler));
	assert.ok(roles.every((r) => r === "accent"), `only accent should be used, got: ${roles}`);
	assert.equal(roles.length, 1, "fg called exactly once (for the first-line marker only)");
});

test("applyUserMarker: indent on continuation lines has no ANSI styling", () => {
	const result = applyUserMarker(["first", "second"], makeCtx());
	assert.equal(result[1], "  second", "continuation line: two plain spaces + content");
});

test("applyUserMarker: marker glyph is ❯ followed by a space (two visible chars)", () => {
	const result = applyUserMarker(["content"], makeCtx(80, PLAIN));
	assert.ok(result[0].startsWith("❯ "), `expected '❯ ' prefix, got: ${result[0]}`);
});

test("applyUserMarker: does not emit emoji codepoints", () => {
	const result = applyUserMarker(["text"], makeCtx(80, PLAIN));
	for (const line of result) {
		for (const cp of line) {
			const code = cp.codePointAt(0) ?? 0;
			const isEmoji = (code >= 0x1f000 && code <= 0x1faff) || code === 0xfe0f;
			assert.ok(!isEmoji, `emoji codepoint U+${code.toString(16).toUpperCase()} found in: ${line}`);
		}
	}
});
