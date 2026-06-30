import test from "node:test";
import assert from "node:assert/strict";

import {
	type ThemeLike,
	barColorRole,
	contextBarRun,
	formatTokens,
	renderContextBar,
} from "../../packages/statusbar/context-bar.ts";
import { ICON_CATALOG } from "../../packages/icons/catalog.ts";

const asciiIcons = () => ICON_CATALOG.ascii;

// A theme stub that records calls but returns text unchanged so width/content
// assertions are unaffected by ANSI coloring.
const identityTheme: ThemeLike = { fg: (_role, text) => text };

test("formatTokens matches the built-in boundaries", () => {
	assert.equal(formatTokens(0), "0");
	assert.equal(formatTokens(999), "999");
	assert.equal(formatTokens(1000), "1.0k");
	assert.equal(formatTokens(1500), "1.5k");
	assert.equal(formatTokens(9999), "10.0k");
	assert.equal(formatTokens(10000), "10k");
	assert.equal(formatTokens(123456), "123k");
	assert.equal(formatTokens(999999), "1000k");
	assert.equal(formatTokens(1000000), "1.0M");
	assert.equal(formatTokens(9900000), "9.9M");
	assert.equal(formatTokens(10000000), "10M");
});

test("contextBarRun fills round(percent/100 * cells)", () => {
	const icons = ICON_CATALOG.ascii;
	assert.equal(contextBarRun(0, 10, icons), "----------");
	assert.equal(contextBarRun(100, 10, icons), "##########");
	assert.equal(contextBarRun(40, 10, icons), "####------");
	assert.equal(contextBarRun(150, 10, icons), "##########"); // clamps above full
});

test("contextBarRun rounds half up (Math.round)", () => {
	const icons = ICON_CATALOG.ascii;
	// 45% of 10 cells = 4.5 → Math.round → 5
	assert.equal(contextBarRun(45, 10, icons), "#####-----");
	// 12% of 10 cells = 1.2 → 1
	assert.equal(contextBarRun(12, 10, icons), "#---------");
	// 96% of 10 cells = 9.6 → 10
	assert.equal(contextBarRun(96, 10, icons), "##########");
});

test("contextBarRun renders an empty bar for unknown (null) percent", () => {
	assert.equal(contextBarRun(null, 8, ICON_CATALOG.ascii), "--------");
});

test("renderContextBar shows ? for null tokens and null percent", () => {
	const out = renderContextBar(
		{ percent: null, tokens: null, contextWindow: 200000 },
		{ cells: 10, iconProvider: asciiIcons },
	);
	assert.equal(out, "[----------] ?/200k (?%)");
});

test("renderContextBar formats a known usage segment", () => {
	const out = renderContextBar(
		{ percent: 45, tokens: 1230, contextWindow: 200000 },
		{ cells: 10, iconProvider: asciiIcons },
	);
	assert.equal(out, "[#####-----] 1.2k/200k (45.0%)");
});

test("renderContextBar invokes the theme for the bar and percent only", () => {
	const roles: string[] = [];
	const theme: ThemeLike = {
		fg: (role, text) => {
			roles.push(role);
			return text;
		},
	};
	renderContextBar({ percent: 95, tokens: 190000, contextWindow: 200000 }, { iconProvider: asciiIcons, theme });
	assert.deepEqual(roles, ["error", "error"]);
});

test("barColorRole mirrors the built-in thresholds", () => {
	assert.equal(barColorRole(null), "muted");
	assert.equal(barColorRole(0), "success");
	assert.equal(barColorRole(70), "success");
	assert.equal(barColorRole(70.1), "warning");
	assert.equal(barColorRole(90), "warning");
	assert.equal(barColorRole(90.1), "error");
});

test("identityTheme passthrough keeps the segment text intact", () => {
	const plain = renderContextBar(
		{ percent: 50, tokens: 1000, contextWindow: 2000 },
		{ iconProvider: asciiIcons },
	);
	const out = renderContextBar(
		{ percent: 50, tokens: 1000, contextWindow: 2000 },
		{ iconProvider: asciiIcons, theme: identityTheme },
	);
	assert.equal(out, plain);
	const ESC = String.fromCharCode(27);
	assert.ok(!plain.includes(ESC));
});
