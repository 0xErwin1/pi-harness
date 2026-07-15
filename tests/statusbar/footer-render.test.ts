import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";

import {
	type FooterRenderInput,
	composeFooterLines,
	formatGitCounts,
} from "../../packages/statusbar/footer-render.ts";
import { ICON_CATALOG } from "../../packages/icons/catalog.ts";

const asciiIcons = () => ICON_CATALOG.ascii;

function baseInput(overrides: Partial<FooterRenderInput> = {}): FooterRenderInput {
	return {
		model: "Sonnet",
		effort: "high",
		effortRole: "thinkingHigh",
		context: { percent: 45, tokens: 1230, contextWindow: 200000 },
		dir: "~/dev/proj",
		branch: "main",
		git: { added: 391, removed: 37 },
		usageWindows: [],
		cumulative: { input: 1000, output: 2000, cacheRead: 3000, cacheWrite: 0, cost: 0.123, sub: true },
		statuses: new Map([["subagents", "2 running"]]),
		iconProvider: asciiIcons,
		...overrides,
	};
}

test("composeFooterLines returns nothing for non-positive width", () => {
	assert.deepEqual(composeFooterLines(baseInput(), 0), []);
	assert.deepEqual(composeFooterLines(baseInput(), -5), []);
});

test("line 1 carries the model, context segment, dir, branch and git counts", () => {
	const [line1] = composeFooterLines(baseInput(), 120);
	assert.ok(line1.includes("Sonnet · high · [#####-----] 1.2k/200k (45.0%)"));
	assert.ok(line1.includes("~/dev/proj"));
	assert.ok(line1.includes("br main")); // ascii branch glyph + name
	assert.ok(line1.includes("(+391,-37)"));
});

test("line 2 (usage) is omitted when there are no windows, present when there are", () => {
	const without = composeFooterLines(baseInput({ usageWindows: [] }), 120);
	assert.equal(without.length, 3); // line1 + stats + statuses

	const withWindows = composeFooterLines(
		baseInput({
			usageWindows: [
				{ id: "7d", label: "7d", percent: 48, resetsInSeconds: 4 * 86400 + 22 * 3600 + 35 * 60 },
				{ id: "5h", label: "5h", percent: 15, resetsInSeconds: 2 * 3600 + 25 * 60 },
			],
		}),
		120,
	);
	assert.equal(withWindows.length, 4);
	assert.equal(withWindows[1], "48.0% · 4d 22hr 35m · 15.0% · 2hr 25m");
});

test("the cumulative stats line preserves the built-in token/cost format", () => {
	const lines = composeFooterLines(baseInput(), 120);
	const statsLine = lines[1]!;
	assert.equal(statsLine, "^1.0k v2.0k R3.0k $0.123 (sub)");
});

test("the stats line is omitted when there is no usage and no cost", () => {
	const lines = composeFooterLines(
		baseInput({ cumulative: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, sub: false } }),
		120,
	);
	// only line1 + statuses remain
	assert.equal(lines.length, 2);
	assert.ok(lines[1]!.includes("2 running"));
});

test("extension statuses are preserved on the last line, sorted by key", () => {
	const lines = composeFooterLines(
		baseInput({ statuses: new Map([["zeta", "z-status"], ["alpha", "a-status"]]) }),
		120,
	);
	assert.equal(lines[lines.length - 1], "a-status z-status");
});

test("emoji and variation selectors are stripped from third-party status text", () => {
	const lines = composeFooterLines(
		baseInput({ statuses: new Map([["engram", "🧠 ignis · ✓ loaded"], ["mcp", "MCP: 0/4 servers"]]) }),
		120,
	);
	const last = lines[lines.length - 1];
	assert.ok(!/[\u{1F000}-\u{1FAFF}\u{FE0F}]/u.test(last!), "no emoji or VS16 survives");
	assert.equal(last, "ignis · ✓ loaded MCP: 0/4 servers");
});

test("narrow width truncates the right side and keeps the line within width", () => {
	const width = 40;
	const lines = composeFooterLines(baseInput(), width);
	assert.ok(visibleWidth(lines[0]!) <= width);
	assert.ok(lines[0]!.startsWith("Sonnet"));
	// the right-side dir/git no longer fits
	assert.ok(!lines[0]!.includes("+391"));
});

test("formatGitCounts is empty when there is no diff", () => {
	assert.equal(formatGitCounts({ added: 0, removed: 0 }), "");
	assert.equal(formatGitCounts({ added: 3, removed: 0 }), "(+3,-0)");
});

test("tokens/sec is appended to the stats line when present, alongside the untouched cost", () => {
	const statsLine = composeFooterLines(baseInput({ tokensPerSecond: 84.6 }), 120)[1]!;
	assert.ok(statsLine.includes("$0.123 (sub)"), "the existing cost segment is preserved");
	assert.ok(statsLine.includes("85 tok/s"), "rounded tokens/sec is shown");
});

test("tokens/sec is omitted when the turn has no observable cadence (null)", () => {
	const statsLine = composeFooterLines(baseInput({ tokensPerSecond: null }), 120)[1]!;
	assert.ok(!statsLine.includes("tok/s"));
});

test("the PR number renders as an OSC-8 hyperlink when the terminal supports hyperlinks", () => {
	const line1 = composeFooterLines(
		baseInput({ pr: { number: 7, url: "https://example.com/pr/7", isDraft: false }, hyperlinks: true }),
		120,
	)[0]!;
	assert.ok(line1.includes("PR #7"));
	assert.ok(line1.includes("\x1b]8;;https://example.com/pr/7"), "OSC-8 sequence wraps the PR number");
});

test("the PR number renders as plain text when hyperlinks are unsupported", () => {
	const line1 = composeFooterLines(
		baseInput({ pr: { number: 7, url: "https://example.com/pr/7", isDraft: false }, hyperlinks: false }),
		120,
	)[0]!;
	assert.ok(line1.includes("PR #7"));
	assert.ok(!line1.includes("\x1b]8;;"), "no OSC-8 escape without hyperlink support");
});

test("the PR segment is omitted entirely when there is no open PR", () => {
	const line1 = composeFooterLines(baseInput({ pr: null, hyperlinks: true }), 120)[0]!;
	assert.ok(!line1.includes("PR #"));
});
