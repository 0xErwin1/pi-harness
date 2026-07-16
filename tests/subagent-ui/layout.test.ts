import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";

import { ICON_CATALOG } from "../../packages/icons/catalog.ts";
import type { AgentSnapshot } from "../../packages/subagent-ui/roster.ts";
import {
	formatDuration,
	formatRelative,
	formatTokens,
	panelTopBorder,
	renderRoster,
	renderRow,
	statusGlyph,
	statusWord,
} from "../../packages/subagent-ui/layout.ts";
import type { UiTheme } from "../../packages/subagent-ui/theme.ts";

const nerd = ICON_CATALOG.nerdfont;
const ascii = ICON_CATALOG.ascii;

/** A no-op theme so assertions see the raw structural text, not ANSI. */
const theme: UiTheme = {
	fg: (_color, text) => text,
	bg: (_color, text) => text,
	bold: (text) => text,
	italic: (text) => text,
};

const FORBIDDEN_SIGILS = ["■", "❯"];

function snap(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
	return {
		id: "a1",
		agentType: "explorer",
		description: "map the repo",
		status: "running",
		isBackground: true,
		toolUses: 3,
		durationMs: 4200,
		compactionCount: 0,
		...overrides,
	};
}

test("panelTopBorder embeds the title inside the top border run", () => {
	const line = panelTopBorder(40, "agents · 1/3", theme);
	assert.ok(line.startsWith("╭"), `expected a rounded top-left corner: ${line}`);
	assert.ok(line.endsWith("╮"), `expected a rounded top-right corner: ${line}`);
	assert.ok(line.includes("agents · 1/3"), `title not embedded in border: ${line}`);
	assert.equal(visibleWidth(line), 42, "border must span innerWidth + two corners");
});

test("statusGlyph is drawn from the icon set and differs per status", () => {
	const running = statusGlyph("running", nerd, theme);
	const done = statusGlyph("completed", nerd, theme);
	const failed = statusGlyph("error", nerd, theme);

	assert.notEqual(running, done);
	assert.notEqual(done, failed);
	assert.equal(done, nerd.agentDone);
	assert.equal(failed, nerd.agentFailed);
	for (const glyph of [running, done, failed]) {
		for (const sigil of FORBIDDEN_SIGILS) assert.ok(!glyph.includes(sigil), `status glyph leaked ${sigil}: ${glyph}`);
	}
});

test("statusWord reflects the lifecycle status", () => {
	assert.equal(statusWord("running", theme), "running");
	assert.equal(statusWord("completed", theme), "done");
	assert.equal(statusWord("error", theme), "failed");
});

test("a row fills exactly the given width with left content and right-aligned stats", () => {
	const row = renderRow(snap(), { selected: false, width: 70 }, ascii, theme);
	assert.equal(visibleWidth(row), 70, `row must be exactly width: got ${visibleWidth(row)}`);
	assert.ok(row.includes("map the repo"), "left cluster must show the description");
	assert.ok(row.includes("explorer"), "left cluster must show the agent type");
	assert.ok(row.includes("running"), "right cluster must show the status word");
	assert.ok(row.trimEnd().endsWith("running"), `stats must be right-aligned to the row edge: ${row}`);
});

test("a selected row uses the icon-set selection marker, not a monochrome sigil", () => {
	const selected = renderRow(snap(), { selected: true, width: 70 }, nerd, theme);
	const unselected = renderRow(snap(), { selected: false, width: 70 }, nerd, theme);

	assert.ok(selected.includes(nerd.selection), "selected row must carry the selection glyph");
	assert.ok(!unselected.includes(nerd.selection), "unselected row must not carry the selection glyph");
	for (const sigil of FORBIDDEN_SIGILS) assert.ok(!selected.includes(sigil), `selected row leaked ${sigil}`);
});

test("renderRoster returns one line per agent when they fit", () => {
	const list = [snap({ id: "a1" }), snap({ id: "a2" }), snap({ id: "a3" })];
	const out = renderRoster(list, { width: 70, height: 6, selectedIndex: 0 }, ascii, theme);
	assert.equal(out.length, 3);
	assert.ok(out[0].includes("a1"));
	assert.ok(out[2].includes("a3"));
});

test("renderRoster truncates with a '... N more' line when the roster overflows the height", () => {
	const list = Array.from({ length: 10 }, (_v, i) => snap({ id: `a${i}` }));
	const out = renderRoster(list, { width: 70, height: 4, selectedIndex: 9 }, ascii, theme);

	assert.equal(out.length, 4, "body must not exceed the available height");
	assert.ok(out.some((l) => l.includes("more")), `expected a '... N more' truncation line: ${JSON.stringify(out)}`);
	// The selected agent (last) must remain visible in the scroll window.
	assert.ok(out.some((l) => l.includes("a9")), "the selected agent must stay in view");
});

test("formatDuration renders compact seconds", () => {
	assert.equal(formatDuration(4200), "4.2s");
	assert.equal(formatDuration(500), "0.5s");
});

test("formatTokens abbreviates thousands", () => {
	assert.equal(formatTokens(150), "150");
	assert.equal(formatTokens(33800), "33.8k");
});

test("formatRelative renders seconds, minutes, and hours+minutes", () => {
	assert.equal(formatRelative(45_000), "45s ago");
	assert.equal(formatRelative(3 * 60_000), "3m ago");
	assert.equal(formatRelative(64 * 60_000), "1h4m ago");
});

test("a running row with no durationMs shows relative time since start", () => {
	const now = 10 * 60_000;
	const startedAt = 7 * 60_000;
	const row = renderRow(
		snap({ status: "running", durationMs: undefined }),
		{ selected: false, width: 70, now, startedAt },
		ascii,
		theme,
	);
	assert.ok(row.includes("3m ago"), `expected relative time for a running row: ${row}`);
});

test("a settled row with durationMs shows total duration, unaffected by now/startedAt", () => {
	const row = renderRow(
		snap({ status: "completed", durationMs: 4200 }),
		{ selected: false, width: 70, now: 10 * 60_000, startedAt: 7 * 60_000 },
		ascii,
		theme,
	);
	assert.ok(row.includes("4.2s"), `expected settled duration: ${row}`);
	assert.ok(!row.includes("ago"), `settled row must not show a relative marker: ${row}`);
});

test("a row missing both durationMs and startedAt renders no timestamp segment and does not throw", () => {
	assert.doesNotThrow(() => {
		const row = renderRow(snap({ status: "running", durationMs: undefined }), { selected: false, width: 70 }, ascii, theme);
		assert.ok(!row.includes("ago"));
	});
});

test("renderRoster threads now/startedAt per-agent into each row", () => {
	const list = [snap({ id: "a1", status: "running", durationMs: undefined }), snap({ id: "a2", status: "running", durationMs: undefined })];
	const startedAt = new Map([
		["a1", 8 * 60_000],
		["a2", 9 * 60_000],
	]);
	const out = renderRoster(list, { width: 70, height: 6, selectedIndex: 0, now: 10 * 60_000, startedAt }, ascii, theme);

	assert.ok(out[0].includes("2m ago"), `expected a1's relative time: ${out[0]}`);
	assert.ok(out[1].includes("1m ago"), `expected a2's relative time: ${out[1]}`);
});

test("every rendered surface stays free of the my-pi-setup monochrome sigils in nerdfont mode", () => {
	const list = [snap({ status: "running" }), snap({ id: "a2", status: "completed" }), snap({ id: "a3", status: "error" })];
	const surfaces = [
		panelTopBorder(60, "agents · 1/3", theme),
		...renderRoster(list, { width: 60, height: 6, selectedIndex: 1 }, nerd, theme),
	];
	for (const line of surfaces) {
		for (const sigil of FORBIDDEN_SIGILS) assert.ok(!line.includes(sigil), `sigil ${sigil} leaked into: ${line}`);
	}
});
