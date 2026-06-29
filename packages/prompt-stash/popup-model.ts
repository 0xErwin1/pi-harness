import { matchesKey } from "@earendil-works/pi-tui";

/** The two lists the popup switches between with Tab. */
export type StashTab = "stash" | "history";

/**
 * A key, classified into a popup intent. Navigation and editing keys apply only
 * in normal mode; while the incremental filter is open (`filterMode`) printable
 * keys build the query instead, and only a reduced set of keys keeps navigating.
 */
export type PopupAction =
	| { kind: "move"; rows: number }
	| { kind: "page"; dir: -1 | 1 }
	| { kind: "top" }
	| { kind: "bottom" }
	| { kind: "select" }
	| { kind: "toggleMark" }
	| { kind: "delete" }
	| { kind: "switchTab" }
	| { kind: "close" }
	| { kind: "filterStart" }
	| { kind: "filterChar"; ch: string }
	| { kind: "filterBackspace" }
	| { kind: "filterEnd" };

/**
 * Whether `data` is a single printable character (no control bytes, no escape
 * sequences) that should be appended to the filter query. Escape sequences start
 * with ESC and have length > 1, so the length-1 guard already excludes them.
 */
function printableChar(data: string): string | undefined {
	if (data.length !== 1) return undefined;
	if (data < " " || data === "\x7f") return undefined;
	return data;
}

/**
 * Maps a raw terminal key to a popup action, vim-style. In normal mode `j`/`k`
 * and the arrows move the selection, `g`/`G` jump to the ends, `Ctrl-d`/`Ctrl-u`
 * page, `Space` marks/unmarks a row for a combined load, `Enter` loads the marked
 * rows joined (or the selected row when nothing is marked), `d` deletes it, `Tab`
 * switches tab, `/` opens the filter, and `Esc`/`q` close. In filter mode printable
 * keys extend the query (so `Space` types a space and `j`/`q` filter), `Backspace`
 * shortens it, the arrows still move the selection, and `Enter`/`Esc` close the
 * filter (the query is kept).
 */
export function classifyPopupKey(data: string, filterMode: boolean): PopupAction | undefined {
	if (filterMode) {
		if (matchesKey(data, "escape") || matchesKey(data, "enter")) return { kind: "filterEnd" };
		if (matchesKey(data, "backspace")) return { kind: "filterBackspace" };
		if (matchesKey(data, "up")) return { kind: "move", rows: -1 };
		if (matchesKey(data, "down")) return { kind: "move", rows: 1 };

		const ch = printableChar(data);
		return ch ? { kind: "filterChar", ch } : undefined;
	}

	if (matchesKey(data, "escape") || matchesKey(data, "q")) return { kind: "close" };
	if (matchesKey(data, "enter")) return { kind: "select" };
	if (matchesKey(data, "space")) return { kind: "toggleMark" };
	if (matchesKey(data, "up") || matchesKey(data, "k")) return { kind: "move", rows: -1 };
	if (matchesKey(data, "down") || matchesKey(data, "j")) return { kind: "move", rows: 1 };
	if (matchesKey(data, "shift+g")) return { kind: "bottom" };
	if (matchesKey(data, "g")) return { kind: "top" };
	if (matchesKey(data, "ctrl+d")) return { kind: "page", dir: 1 };
	if (matchesKey(data, "ctrl+u")) return { kind: "page", dir: -1 };
	if (matchesKey(data, "d")) return { kind: "delete" };
	if (matchesKey(data, "tab")) return { kind: "switchTab" };
	if (matchesKey(data, "/")) return { kind: "filterStart" };

	return undefined;
}

/** Clamps a selection index into `[0, len)`, returning 0 for an empty list. */
export function clampIndex(index: number, len: number): number {
	if (len <= 0) return 0;
	return Math.max(0, Math.min(index, len - 1));
}

/** Moves a selection index by `delta` rows, clamped to the list bounds. */
export function moveIndex(index: number, delta: number, len: number): number {
	return clampIndex(index + delta, len);
}

/**
 * Scroll offset that keeps the selected row inside a `viewport`-row window,
 * minimally adjusting `prev` so navigation feels stable: scroll up when the
 * selection moves above the window, down when it moves below, and stay put
 * otherwise. The result is clamped so the window never runs past the list end.
 */
export function followScroll(selected: number, total: number, viewport: number, prev: number): number {
	if (total <= viewport) return 0;

	let scroll = prev;
	if (selected < scroll) scroll = selected;
	else if (selected >= scroll + viewport) scroll = selected - viewport + 1;

	return Math.max(0, Math.min(scroll, total - viewport));
}
