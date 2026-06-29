/**
 * Parity test: Consumer A (render-core formatters) vs Consumer B (conversation viewer).
 *
 * For strict fixtures, `stripAnsi(A) === stripAnsi(B)` must hold. For diverging
 * fixtures, the test asserts NOT equal AND records the documented reason so
 * divergence is visible and opt-in rather than silent.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { driveConsumerA, driveConsumerB } from "../../packages/render-core/testing/drivers.ts";
import type { ParityFixture } from "../../packages/render-core/testing/parity-fixtures.ts";
import type { RenderStyler } from "../../packages/render-core/styler.ts";
import type { WidthOps } from "../../packages/render-core/width.ts";

/** Removes ANSI CSI escape sequences so two outputs can be compared by visible text alone. */
function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

/** Deterministic tag-based styler: produces `<color>text</color>` tokens. */
const STYLER: RenderStyler = {
	fg: (color, text) => `<${color}>${text}</${color}>`,
	bold: (text) => `<b>${text}</b>`,
};

/** ASCII width ops: one char = one column. */
const ASCII_WIDTH: WidthOps = {
	visibleWidth: (s) => s.length,
	truncateToWidth: (s, w) => (s.length <= w ? s : s.slice(0, w)),
};

// ── fixtures seeded after ADR-2 (args = muted on both consumers) ─────────────

const FIXTURES: ParityFixture[] = [
	{
		id: "PAR-01",
		description: "read result: verb+muted-args+dim-summary",
		events: [
			{
				toolName: "read",
				args: { path: "src/main.ts" },
				result: { resultText: "line1\nline2\n", details: undefined },
			},
		],
		width: 200,
		parity: "strict",
	},
	{
		id: "PAR-02",
		description: "edit result with diff block",
		events: [
			{
				toolName: "edit",
				args: { path: "src/foo.ts" },
				result: {
					resultText: "",
					details: { diff: "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,3 +1,3 @@\n ctx\n-old line\n+new line" },
				},
			},
		],
		width: 200,
		parity: "strict",
	},
	{
		id: "PAR-03",
		description: "bash result: muted output block on both consumers",
		events: [
			{
				toolName: "bash",
				args: { command: "echo hello" },
				result: { resultText: "hello\nexit code: 0", details: undefined },
			},
		],
		width: 200,
		parity: "strict",
	},
	{
		id: "PAR-04",
		description: "grep result: match count",
		events: [
			{
				toolName: "grep",
				args: { pattern: "TODO" },
				result: { resultText: "src/a.ts:10:// TODO: fix this\nsrc/b.ts:5:// TODO: clean up", details: undefined },
			},
		],
		width: 200,
		parity: "strict",
	},
	{
		id: "PAR-05",
		description: "write result: Consumer A uses args.content, Consumer B uses resultText — explicit divergence",
		events: [
			{
				toolName: "write",
				args: { path: "out.txt", content: "line1\nline2\nline3" },
				result: { resultText: "Wrote file", details: undefined },
			},
		],
		width: 200,
		parity: { diverges: "write: Consumer A counts args.content lines (3), Consumer B counts resultText lines (1)" },
	},
];

// ── test runner ───────────────────────────────────────────────────────────────

for (const fixture of FIXTURES) {
	if (fixture.parity === "strict") {
		test(`parity strict ${fixture.id}: ${fixture.description}`, () => {
			const a = driveConsumerA(fixture, STYLER, ASCII_WIDTH);
			const b = driveConsumerB(fixture, STYLER, ASCII_WIDTH);

			assert.deepEqual(
				a.map(stripAnsi),
				b.map(stripAnsi),
				`Consumers diverged for fixture ${fixture.id}:\n  A: ${JSON.stringify(a)}\n  B: ${JSON.stringify(b)}`,
			);
		});
	} else {
		const { diverges } = fixture.parity;

		test(`parity diverges ${fixture.id}: ${fixture.description} (reason: ${diverges})`, () => {
			const a = driveConsumerA(fixture, STYLER, ASCII_WIDTH);
			const b = driveConsumerB(fixture, STYLER, ASCII_WIDTH);

			const aStripped = a.map(stripAnsi);
			const bStripped = b.map(stripAnsi);

			assert.notDeepEqual(
				aStripped,
				bStripped,
				`Expected documented divergence but consumers produced identical output for ${fixture.id}`,
			);
		});
	}
}
