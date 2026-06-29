import type { Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { PromptDb } from "./db.ts";

/**
 * A one-line, right-aligned hint shown above the prompt while the current
 * session has stashed drafts — e.g. `› 2 stashed` — mirroring the Claude Code
 * "stashed" indicator. It renders nothing when the stash is empty, so the line
 * only appears when there is something to restore. The session id is read live
 * on each render (not captured) so the count follows session switches, and the
 * count is re-read every frame, which is cheap for the small stash table.
 */
export class StashIndicator implements Component {
	constructor(
		private readonly theme: Theme,
		private readonly db: () => PromptDb,
		private readonly getSessionId: () => string,
	) {}

	render(width: number): string[] {
		if (width <= 0) return [];

		const count = this.db().countStash(this.getSessionId());
		if (count <= 0) return [];

		const label = `› ${count} stashed`;
		const pad = " ".repeat(Math.max(0, width - label.length));
		return [this.theme.fg("dim", pad + label)];
	}

	invalidate(): void {}
}
