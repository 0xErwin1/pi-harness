import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";

import {
	type HeaderTheme,
	renderGradientHeader,
	renderThemeHeader,
	supportsTrueColor,
} from "../../packages/header/render.ts";

const TRUECOLOR_SGR = "\x1b[38;2;";

/** A theme stub that returns text unchanged so assertions ignore coloring. */
const plainTheme: HeaderTheme = { fg: (_role, text) => text };

test("the gradient builder emits per-cell truecolor escapes", () => {
	const lines = renderGradientHeader(80);

	assert.ok(lines.length > 0);
	assert.ok(lines.join("\n").includes(TRUECOLOR_SGR), "truecolor path must emit 24-bit escapes");
	assert.ok(lines.join("\n").includes("█"), "the ASCII art glyphs are present");
});

test("the theme fallback builder never emits a gradient escape", () => {
	const lines = renderThemeHeader(80, plainTheme);

	const joined = lines.join("\n");
	assert.ok(joined.length > 0);
	assert.ok(!joined.includes(TRUECOLOR_SGR), "fallback must not construct a 24-bit escape");
	assert.ok(!joined.includes("\x1b["), "no raw escape leaks when the theme is uncolored");
	assert.ok(joined.includes("█"), "the same ASCII art renders on the fallback path");
});

test("both builders return an empty array for non-positive width", () => {
	assert.deepEqual(renderGradientHeader(0), []);
	assert.deepEqual(renderGradientHeader(-4), []);
	assert.deepEqual(renderThemeHeader(0, plainTheme), []);
});

test("both builders center within the given width and never overflow it", () => {
	const width = 60;
	for (const line of renderThemeHeader(width, plainTheme)) {
		assert.ok(visibleWidth(line) <= width, `line "${line}" exceeds width ${width}`);
	}
	for (const line of renderGradientHeader(width)) {
		assert.ok(visibleWidth(line) <= width, "gradient line exceeds width");
	}
});

test("both builders produce a non-empty header so the session starts normally", () => {
	assert.ok(renderGradientHeader(80).some((line) => line.includes("█")));
	assert.ok(renderThemeHeader(80, plainTheme).some((line) => line.includes("█")));
});

test("supportsTrueColor prefers the verified capability field over COLORTERM", () => {
	assert.equal(supportsTrueColor({ trueColor: true }, undefined), true);
	// A false capability wins even when COLORTERM claims truecolor.
	assert.equal(supportsTrueColor({ trueColor: false }, "truecolor"), false);
});

test("supportsTrueColor falls back to COLORTERM only when no capability field exists", () => {
	assert.equal(supportsTrueColor(undefined, "truecolor"), true);
	assert.equal(supportsTrueColor(undefined, "24bit"), true);
	assert.equal(supportsTrueColor(undefined, "256color"), false);
	assert.equal(supportsTrueColor(undefined, undefined), false);
	assert.equal(supportsTrueColor({}, "truecolor"), true);
});
