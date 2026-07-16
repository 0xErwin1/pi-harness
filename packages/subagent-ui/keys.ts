import { decodeKittyPrintable, matchesKey } from "@earendil-works/pi-tui";

/**
 * Pure key classification for the subagent dashboard and takeover overlays.
 *
 * `matchesKey` is protocol-aware (legacy bytes and Kitty CSI-u sequences), so
 * classification is correct regardless of which encoding the terminal sends.
 *
 * Both classifiers return `undefined` for a key that is genuinely unowned —
 * neither the overlay nor (in the takeover) its `Input` claims it. Callers
 * MUST treat `undefined` as inert and stop there: falling through to
 * `Input.handleInput` for an unowned control byte silently drops it, which is
 * the exact bug this module fixes.
 */

export type DashboardAction = { kind: "close" } | { kind: "select" } | { kind: "move"; rows: -1 | 1 };

export type TakeoverAction = { kind: "close" } | { kind: "scroll"; dir: -1 | 1 } | { kind: "toInput" };

/**
 * Every key pi-tui's `Input` binds itself (`TUI_KEYBINDINGS` in
 * `@earendil-works/pi-tui/keybindings.ts`). These must be forwarded verbatim
 * so readline-style editing (e.g. `ctrl+d` deleting a character) keeps working.
 */
const INPUT_EDITING_KEYS = [
	"enter",
	"shift+enter",
	"ctrl+j",
	"backspace",
	"delete",
	"left",
	"right",
	"home",
	"end",
	"pageUp",
	"pageDown",
	"alt+left",
	"alt+right",
	"ctrl+left",
	"ctrl+right",
	"ctrl+a",
	"ctrl+b",
	"ctrl+d",
	"ctrl+e",
	"ctrl+f",
	"ctrl+k",
	"ctrl+u",
	"ctrl+w",
	"ctrl+y",
	"ctrl+-",
	"alt+b",
	"alt+f",
	"alt+d",
	"alt+y",
	"tab",
] as const;

function isPrintable(data: string): boolean {
	if (data.length === 1 && data >= " " && data !== "\x7f") return true;
	return decodeKittyPrintable(data) !== undefined;
}

/** Classify a raw keypress delivered to the takeover overlay. */
export function classifyTakeoverKey(data: string): TakeoverAction | undefined {
	if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) return { kind: "close" };
	if (matchesKey(data, "up")) return { kind: "scroll", dir: 1 };
	if (matchesKey(data, "down")) return { kind: "scroll", dir: -1 };

	for (const key of INPUT_EDITING_KEYS) {
		if (matchesKey(data, key)) return { kind: "toInput" };
	}

	if (isPrintable(data)) return { kind: "toInput" };

	return undefined;
}

/** Classify a raw keypress delivered to the dashboard overlay (no `Input` present). */
export function classifyDashboardKey(data: string): DashboardAction | undefined {
	if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || matchesKey(data, "q")) return { kind: "close" };
	if (matchesKey(data, "enter")) return { kind: "select" };
	if (matchesKey(data, "up") || matchesKey(data, "k")) return { kind: "move", rows: -1 };
	if (matchesKey(data, "down") || matchesKey(data, "j")) return { kind: "move", rows: 1 };

	return undefined;
}
