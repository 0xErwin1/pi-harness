import type { Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

/**
 * A one-line, right-aligned hint shown above the prompt while the current
 * session has stashed drafts — e.g. `› 2 stashed` — mirroring the Claude Code
 * "stashed" indicator. Rendering must stay purely in-memory: the TUI calls this
 * on every frame/keystroke, and synchronous SQLite reads in render can make input
 * echo lag when the database is momentarily locked by another pi process.
 */
export class StashIndicator implements Component {
	constructor(
		private readonly theme: Theme,
		private readonly getCount: () => number,
	) {}

	render(width: number): string[] {
		if (width <= 0) return [];

		const count = this.getCount();
		if (count <= 0) return [];

		const label = `› ${count} stashed`;
		const pad = " ".repeat(Math.max(0, width - label.length));
		return [this.theme.fg("dim", pad + label)];
	}

	invalidate(): void {}
}
