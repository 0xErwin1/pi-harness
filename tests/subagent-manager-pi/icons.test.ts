import test from "node:test";
import assert from "node:assert/strict";

import { ICON_CATALOG } from "../../packages/subagent-manager-pi/icons/catalog.ts";
import { resolveIconSet } from "../../packages/subagent-manager-pi/icons/resolve.ts";
import { resolveIconMode } from "../../packages/subagent-manager-pi/icons/config.ts";
import {
	getIcons,
	setIconMode,
	resetIconsCache,
} from "../../packages/subagent-manager-pi/icons/config.ts";
import type { IconMode, IconSet } from "../../packages/subagent-manager-pi/icons/types.ts";

// ── catalog completeness ──────────────────────────────────────────────────────

const ICON_ROLES: ReadonlyArray<Exclude<keyof IconSet, "spinner">> = [
	"taskPending",
	"taskInProgress",
	"taskCompleted",
	"taskDeleted",
	"headerActive",
	"headerIdle",
	"chevron",
	"arrowUp",
	"arrowDown",
	"ellipsis",
	"agentDone",
	"agentFailed",
	"agentInterrupted",
	"agentStale",
	"selection",
	"treeBranch",
	"treeLast",
	"treeVertical",
	"treeSub",
] as const;

const MODES: readonly IconMode[] = ["nerdfont", "unicode", "ascii"] as const;

for (const mode of MODES) {
	test(`ICON_CATALOG[${mode}] has every role defined and non-empty`, () => {
		const set = ICON_CATALOG[mode];

		for (const role of ICON_ROLES) {
			const value = set[role];
			assert.ok(
				typeof value === "string" && value.length > 0,
				`${mode}.${role} must be a non-empty string, got: ${JSON.stringify(value)}`,
			);
		}
	});

	test(`ICON_CATALOG[${mode}] spinner is a non-empty array of non-empty strings`, () => {
		const { spinner } = ICON_CATALOG[mode];

		assert.ok(Array.isArray(spinner) && spinner.length > 0, `${mode}.spinner must be non-empty`);

		for (const frame of spinner) {
			assert.ok(
				typeof frame === "string" && frame.length > 0,
				`${mode}.spinner frames must be non-empty strings, got: ${JSON.stringify(frame)}`,
			);
		}
	});
}

// ── catalog spot-checks ───────────────────────────────────────────────────────

test("nerdfont catalog uses expected NF glyphs for key roles", () => {
	const nf = ICON_CATALOG.nerdfont;
	assert.equal(nf.taskCompleted, "");
	assert.equal(nf.taskPending, "");
	assert.equal(nf.treeBranch, "├─");
	assert.equal(nf.treeLast, "└─");
	assert.equal(nf.treeVertical, "│");
});

test("unicode catalog uses plain unicode for key roles", () => {
	const u = ICON_CATALOG.unicode;
	assert.equal(u.taskPending, "◻");
	assert.equal(u.taskCompleted, "✔");
	assert.equal(u.agentDone, "done");
});

test("ascii catalog uses printable ascii for key roles", () => {
	const a = ICON_CATALOG.ascii;
	assert.equal(a.taskPending, "[ ]");
	assert.equal(a.taskCompleted, "[x]");
	assert.equal(a.spinner.length, 4);
	assert.deepEqual(a.spinner, ["-", "\\", "|", "/"]);
});

test("the toolCall icon role is removed from every catalog mode", () => {
	for (const mode of MODES) {
		assert.ok(
			!("toolCall" in ICON_CATALOG[mode]),
			`${mode} must not define a toolCall role — tool lines no longer carry a glyph prefix`,
		);
	}
});

test("nerdfont spinner is the braille dot sequence (10 frames)", () => {
	const { spinner } = ICON_CATALOG.nerdfont;
	assert.equal(spinner.length, 10);
	assert.equal(spinner[0], "⠋");
	assert.equal(spinner[9], "⠏");
});

// ── resolveIconSet ────────────────────────────────────────────────────────────

test("resolveIconSet returns the correct catalog entry for each mode", () => {
	for (const mode of MODES) {
		const result = resolveIconSet(mode);
		assert.strictEqual(result, ICON_CATALOG[mode]);
	}
});

// ── resolveIconMode (pure) ────────────────────────────────────────────────────

test("resolveIconMode returns nerdfont when env and settings are absent", () => {
	const mode = resolveIconMode({});
	assert.equal(mode, "nerdfont");
});

test("resolveIconMode: env PI_HARNESS_ICONS=unicode wins over settings", () => {
	const mode = resolveIconMode({
		env: { PI_HARNESS_ICONS: "unicode" },
		settings: { icons: "ascii" },
	});
	assert.equal(mode, "unicode");
});

test("resolveIconMode: env PI_HARNESS_ICONS=ascii wins over settings and default", () => {
	const mode = resolveIconMode({
		env: { PI_HARNESS_ICONS: "ascii" },
		settings: { icons: "unicode" },
	});
	assert.equal(mode, "ascii");
});

test("resolveIconMode: invalid env falls through to settings", () => {
	const mode = resolveIconMode({
		env: { PI_HARNESS_ICONS: "emoji" },
		settings: { icons: "unicode" },
	});
	assert.equal(mode, "unicode");
});

test("resolveIconMode: invalid env falls through to default when settings is also invalid", () => {
	const mode = resolveIconMode({
		env: { PI_HARNESS_ICONS: "emoji" },
		settings: { icons: "also-bad" },
	});
	assert.equal(mode, "nerdfont");
});

test("resolveIconMode: settings.icons=ascii wins over default when env absent", () => {
	const mode = resolveIconMode({ settings: { icons: "ascii" } });
	assert.equal(mode, "ascii");
});

test("resolveIconMode: invalid settings falls through to default", () => {
	const mode = resolveIconMode({ settings: { icons: "invalid" } });
	assert.equal(mode, "nerdfont");
});

test("resolveIconMode: non-object settings is ignored", () => {
	assert.equal(resolveIconMode({ settings: "ascii" }), "nerdfont");
	assert.equal(resolveIconMode({ settings: null }), "nerdfont");
	assert.equal(resolveIconMode({ settings: 42 }), "nerdfont");
	assert.equal(resolveIconMode({ settings: [] }), "nerdfont");
});

test("resolveIconMode: settings.icons non-string is ignored", () => {
	assert.equal(resolveIconMode({ settings: { icons: 1 } }), "nerdfont");
	assert.equal(resolveIconMode({ settings: { icons: null } }), "nerdfont");
	assert.equal(resolveIconMode({ settings: { icons: true } }), "nerdfont");
});

test("resolveIconMode: empty env object, no settings → default nerdfont", () => {
	assert.equal(resolveIconMode({ env: {} }), "nerdfont");
});

test("resolveIconMode: env present but PI_HARNESS_ICONS undefined → falls through", () => {
	const mode = resolveIconMode({ env: { PI_HARNESS_ICONS: undefined }, settings: { icons: "ascii" } });
	assert.equal(mode, "ascii");
});

// ── getIcons / setIconMode / resetIconsCache ──────────────────────────────────

test("getIcons returns an icon set after setIconMode", () => {
	setIconMode("ascii");
	const icons = getIcons();
	assert.strictEqual(icons, ICON_CATALOG.ascii);
	resetIconsCache();
});

test("getIcons caches: repeated calls return the same object", () => {
	setIconMode("unicode");
	const a = getIcons();
	const b = getIcons();
	assert.strictEqual(a, b);
	resetIconsCache();
});

test("resetIconsCache clears the cache so next getIcons resolves fresh", () => {
	setIconMode("ascii");
	const a = getIcons();

	resetIconsCache();
	setIconMode("unicode");
	const b = getIcons();

	assert.notStrictEqual(a, b);
	assert.strictEqual(b, ICON_CATALOG.unicode);
	resetIconsCache();
});

test("setIconMode overrides the mode and invalidates the cache", () => {
	resetIconsCache();
	setIconMode("nerdfont");
	const a = getIcons();
	assert.strictEqual(a, ICON_CATALOG.nerdfont);

	setIconMode("ascii");
	const b = getIcons();
	assert.strictEqual(b, ICON_CATALOG.ascii);

	resetIconsCache();
});
