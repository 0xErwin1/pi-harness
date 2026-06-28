import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Reads Pi's user settings.json and maps the few fields that change BUILT-IN
 * tool execution semantics (shell command prefix, image auto-resize) so a global
 * tool-rendering override can reconstruct the SAME options Pi would build its
 * built-ins with. Keys and defaults mirror pi-coding-agent's SettingsManager:
 *   - getShellCommandPrefix() -> settings.shellCommandPrefix
 *   - getImageAutoResize()    -> settings.images?.autoResize ?? true
 */

/** Absolute path to Pi's user settings file (`~/.pi/agent/settings.json`). */
function settingsPath(): string {
	return join(homedir(), ".pi", "agent", "settings.json");
}

/** A settings provider; injectable so callers can supply a deterministic object in tests. */
export type PiSettingsReader = () => Record<string, unknown>;

/**
 * Reads and parses Pi's settings.json, returning the parsed object or an empty
 * object when the file is absent, unreadable, not valid JSON, or not a JSON
 * object. Never throws — a missing or malformed file degrades to defaults.
 */
export function readPiSettings(): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(readFileSync(settingsPath(), "utf-8"));
		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return {};
	} catch {
		return {};
	}
}

/**
 * Pi's `shellCommandPrefix` setting: a string prepended to every bash command
 * (for example a sandbox or environment wrapper). Returns `undefined` when unset
 * or non-string, matching `SettingsManager.getShellCommandPrefix()`.
 */
export function shellCommandPrefix(settings: Record<string, unknown>): string | undefined {
	const value = settings.shellCommandPrefix;
	return typeof value === "string" ? value : undefined;
}

/**
 * Pi's image auto-resize setting (`settings.images.autoResize`). Defaults to
 * `true` when unset or malformed, matching `SettingsManager.getImageAutoResize()`.
 */
export function imageAutoResize(settings: Record<string, unknown>): boolean {
	const images = settings.images;
	if (images !== null && typeof images === "object" && !Array.isArray(images)) {
		const value = (images as Record<string, unknown>).autoResize;
		if (typeof value === "boolean") return value;
	}
	return true;
}
