import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { IconMode, IconSet } from "./types.ts";
import { ICON_CATALOG } from "./catalog.ts";
import { resolveIconSet } from "./resolve.ts";

const VALID_MODES = new Set<string>(["nerdfont", "unicode", "ascii"]);

function isValidMode(value: string): value is IconMode {
	return VALID_MODES.has(value);
}

/**
 * Resolves the icon mode from the supplied inputs without performing any I/O.
 *
 * Precedence (highest to lowest):
 *   1. env.PI_HARNESS_ICONS — must be a valid IconMode string
 *   2. settings.icons field — settings must be a plain object with a string "icons" field
 *   3. Default: "nerdfont"
 *
 * Invalid values at any level are silently ignored and resolution falls through
 * to the next level. This function never throws.
 */
export function resolveIconMode(input: {
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	settings?: unknown;
}): IconMode {
	const envValue = input.env?.PI_HARNESS_ICONS;
	if (typeof envValue === "string" && isValidMode(envValue)) {
		return envValue;
	}

	const settings = input.settings;
	if (
		settings !== null &&
		typeof settings === "object" &&
		!Array.isArray(settings) &&
		"icons" in settings
	) {
		const iconsField = (settings as Record<string, unknown>).icons;
		if (typeof iconsField === "string" && isValidMode(iconsField)) {
			return iconsField;
		}
	}

	return "nerdfont";
}

/**
 * Resolves the settings.json path using the homedir convention.
 * getSettingsPath() from @mariozechner/pi-coding-agent is NOT re-exported
 * from the package root, so the homedir fallback is used here.
 */
function getSettingsPath(): string {
	return join(homedir(), ".pi", "agent", "settings.json");
}

/**
 * Reads PI's settings.json and returns its parsed content, or undefined if
 * the file is absent, unreadable, or not valid JSON. Never throws.
 */
function readPiSettings(): unknown {
	try {
		const raw = readFileSync(getSettingsPath(), "utf-8");
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

/**
 * Performs I/O to load the icon mode: reads process.env and PI's settings.json,
 * then delegates to resolveIconMode for the pure precedence logic.
 */
export function loadIconMode(): IconMode {
	const settings = readPiSettings();
	return resolveIconMode({ env: process.env, settings });
}

let cachedSet: IconSet | undefined;
let cachedMode: IconMode | undefined;

/**
 * Returns the active IconSet. Resolves and caches on first call; subsequent
 * calls return the same object. Use resetIconsCache() + setIconMode() to change
 * modes in tests or at runtime.
 */
export function getIcons(): IconSet {
	if (cachedSet === undefined) {
		const mode = cachedMode ?? loadIconMode();
		cachedSet = resolveIconSet(mode);
	}
	return cachedSet;
}

/**
 * Forces a specific mode and invalidates the cache, so the next getIcons()
 * call returns the set for the given mode. Intended for tests and explicit
 * runtime overrides.
 */
export function setIconMode(mode: IconMode): void {
	cachedMode = mode;
	cachedSet = ICON_CATALOG[mode];
}

/**
 * Clears the module-level icon cache. After this call, getIcons() will
 * re-resolve the mode from the environment and settings. Intended for tests.
 */
export function resetIconsCache(): void {
	cachedSet = undefined;
	cachedMode = undefined;
}
