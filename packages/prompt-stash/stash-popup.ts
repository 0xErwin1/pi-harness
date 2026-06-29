import { type Component, truncateToWidth, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { PromptDb } from "./db.ts";
import {
	classifyPopupKey,
	clampIndex,
	followScroll,
	moveIndex,
	type StashTab,
} from "./popup-model.ts";

/** One displayable list row, resolved from a stash or history entry. */
interface Row {
	id: number;
	text: string;
	meta: string | undefined;
}

const VIEWPORT_HEIGHT_PCT = 80;
const MIN_VIEWPORT = 3;

/** Collapses a multi-line prompt into a single display row, marking breaks. */
function oneLine(text: string): string {
	return text.replace(/\s*\n\s*/g, " ⏎ ").trim();
}

/**
 * Focused overlay that browses the prompt stash and the prompt history and loads
 * a chosen entry back into the editor. Tab switches between the two lists; the
 * stash is the per-session draft scratch space (deletable with `d`), the history
 * is the permanent cross-session log (read-only). Navigation is vim-style (see
 * `classifyPopupKey`) with an incremental `/` filter. The component owns no async
 * state: it re-queries the injected `PromptDb` on every render and key, so a
 * delete or a filter change is reflected immediately. Selecting an entry resolves
 * the overlay via `done(text)`; closing resolves with `undefined`.
 */
export class StashPopup implements Component {
	private tab: StashTab;
	private selected = 0;
	private scrollOffset = 0;
	private filter = "";
	private filterMode = false;
	private lastViewportHeight = MIN_VIEWPORT;

	/** Rows marked with Space, in pick order, to be loaded joined as one prompt. */
	private readonly marked: Array<{ id: number; text: string }> = [];

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly done: (result: string | undefined) => void,
		private readonly db: () => PromptDb,
		private readonly sessionId: string,
		initialTab: StashTab = "stash",
	) {
		this.tab = initialTab;
	}

	/**
	 * Resolves the current rows from the DB for the active tab and filter. Both
	 * `render` and `handleInput` call this, and a throw in either is fatal to pi
	 * (no error boundary around component callbacks), so any DB error — e.g. a
	 * transient lock under concurrent access — degrades to an empty list.
	 */
	private rows(): Row[] {
		try {
			if (this.tab === "stash") {
				return this.db()
					.searchStash(this.sessionId, this.filter)
					.map((entry) => ({ id: entry.id, text: entry.text, meta: undefined }));
			}

			return this.db()
				.listHistory({ query: this.filter })
				.map((entry) => ({ id: entry.id, text: entry.text, meta: entry.project ?? undefined }));
		} catch {
			return [];
		}
	}

	handleInput(data: string): void {
		const action = classifyPopupKey(data, this.filterMode);
		if (!action) return;

		const rows = this.rows();
		const len = rows.length;

		switch (action.kind) {
			case "close":
				this.done(undefined);
				return;

			case "select": {
				if (this.marked.length > 0) {
					this.done(this.marked.map((m) => m.text).join("\n\n"));
					return;
				}
				const row = rows[this.selected];
				this.done(row ? row.text : undefined);
				return;
			}

			case "toggleMark": {
				const row = rows[this.selected];
				if (row) {
					const at = this.marked.findIndex((m) => m.id === row.id);
					if (at === -1) this.marked.push({ id: row.id, text: row.text });
					else this.marked.splice(at, 1);
				}
				break;
			}

			case "move":
				this.selected = moveIndex(this.selected, action.rows, len);
				break;

			case "page": {
				const half = Math.max(1, Math.floor(this.lastViewportHeight / 2));
				this.selected = moveIndex(this.selected, action.dir * half, len);
				break;
			}

			case "top":
				this.selected = 0;
				break;

			case "bottom":
				this.selected = clampIndex(len - 1, len);
				break;

			case "delete": {
				const row = rows[this.selected];
				if (row) {
					try {
						if (this.tab === "stash") this.db().removeStash(row.id);
						else this.db().removeHistory(row.id);
					} catch {
						// A failed delete (e.g. transient lock) must not crash the input
						// path; the row simply stays and the user can retry.
						break;
					}
					const markAt = this.marked.findIndex((m) => m.id === row.id);
					if (markAt !== -1) this.marked.splice(markAt, 1);
					this.selected = clampIndex(this.selected, len - 1);
				}
				break;
			}

			case "switchTab":
				this.tab = this.tab === "stash" ? "history" : "stash";
				this.selected = 0;
				this.scrollOffset = 0;
				this.filter = "";
				this.filterMode = false;
				this.marked.length = 0;
				break;

			case "filterStart":
				this.filterMode = true;
				break;

			case "filterChar":
				this.filter += action.ch;
				this.selected = 0;
				break;

			case "filterBackspace":
				this.filter = this.filter.slice(0, -1);
				this.selected = 0;
				break;

			case "filterEnd":
				this.filterMode = false;
				break;
		}

		this.tui.requestRender();
	}

	render(width: number): string[] {
		if (width < 8) return [];

		const th = this.theme;
		const innerW = width - 4;
		const rows = this.rows();
		this.selected = clampIndex(this.selected, rows.length);

		const viewport = this.viewportHeight();
		this.lastViewportHeight = viewport;
		this.scrollOffset = followScroll(this.selected, rows.length, viewport, this.scrollOffset);

		const pad = (text: string) => text + " ".repeat(Math.max(0, innerW - visibleWidth(text)));
		const row = (content: string) =>
			`${th.fg("border", "│")} ${truncateToWidth(pad(content), innerW)} ${th.fg("border", "│")}`;
		const top = th.fg("border", `╭${"─".repeat(width - 2)}╮`);
		const bottom = th.fg("border", `╰${"─".repeat(width - 2)}╯`);
		const separator = row(th.fg("dim", "─".repeat(innerW)));

		const lines: string[] = [];
		lines.push(top);
		lines.push(row(this.renderTabs()));
		if (this.filterMode || this.filter.length > 0) lines.push(row(this.renderFilter()));
		lines.push(separator);

		if (rows.length === 0) {
			lines.push(row(th.fg("dim", this.tab === "stash" ? "No stashed prompts" : "No history")));
			for (let i = 1; i < viewport; i++) lines.push(row(""));
		} else {
			for (let i = 0; i < viewport; i++) {
				const index = this.scrollOffset + i;
				const entry = rows[index];
				lines.push(row(entry ? this.renderRow(entry, index === this.selected, innerW) : ""));
			}
		}

		lines.push(separator);
		lines.push(row(this.renderFooter(rows.length, innerW)));
		lines.push(bottom);

		return lines;
	}

	invalidate(): void {}

	private renderTabs(): string {
		const th = this.theme;
		const label = (tab: StashTab, text: string) =>
			tab === this.tab ? th.bold(th.fg("accent", text)) : th.fg("dim", text);
		return `${label("stash", "Stash")}  ${th.fg("dim", "│")}  ${label("history", "History")}`;
	}

	private renderFilter(): string {
		const th = this.theme;
		const caret = this.filterMode ? th.fg("accent", "█") : "";
		return `${th.fg("dim", "/")}${this.filter}${caret}`;
	}

	private renderRow(entry: Row, selected: boolean, innerW: number): string {
		const th = this.theme;
		const markIdx = this.marked.findIndex((m) => m.id === entry.id);
		const marked = markIdx !== -1;

		const cursor = selected ? th.fg("accent", "›") : " ";
		const mark = marked ? th.fg("success", markIdx < 9 ? String(markIdx + 1) : "•") : " ";
		const meta = entry.meta ? ` ${th.fg("dim", `· ${entry.meta}`)}` : "";

		const body = oneLine(entry.text);
		const text = selected ? th.fg("accent", body) : marked ? th.fg("success", body) : body;

		return truncateToWidth(`${cursor}${mark} ${text}${meta}`, innerW);
	}

	private renderFooter(total: number, innerW: number): string {
		const th = this.theme;
		const load = this.marked.length > 0 ? `Enter load ${this.marked.length} joined` : "Enter load";
		const hint = this.filterMode
			? th.fg("dim", "type to filter · Enter/Esc done")
			: th.fg("dim", `jk move · Space mark · ${load} · d delete · Tab switch · / filter · Esc`);
		const pos = total > 0 ? th.fg("dim", `${this.selected + 1}/${total}`) : "";

		const gap = Math.max(1, innerW - visibleWidth(pos) - visibleWidth(hint));
		return pos + " ".repeat(gap) + hint;
	}

	private viewportHeight(): number {
		const rows = this.tui.terminal.rows;
		const maxRows = Math.floor((rows * VIEWPORT_HEIGHT_PCT) / 100);
		const chrome = 6 + (this.filterMode || this.filter.length > 0 ? 1 : 0);
		return Math.max(MIN_VIEWPORT, maxRows - chrome);
	}
}
