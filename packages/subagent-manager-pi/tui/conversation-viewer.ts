import {
	type Component,
	matchesKey,
	truncateToWidth,
	type TUI,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { enterOverlay, exitOverlay } from "../../shared/overlay-gate.ts";
import type { RunEvent, RunSnapshot } from "../../subagent-manager-core/events.ts";
import type { RunStoreListener } from "../../subagent-manager-core/store.ts";
import {
	buildViewerModel,
	formatModelEffort,
	styleTranscriptLine,
	type TranscriptStyler,
} from "./conversation-viewer-model.ts";

/** Live accessor surface the viewer needs from the manager runtime. */
export interface ViewerRuntime {
	subscribe(listener: RunStoreListener): () => void;
	events(id: string): RunEvent[];
	snapshot(id: string): RunSnapshot | undefined;
}

/**
 * Tracks how many conversation overlays are currently open. The fleet widget's
 * global `onTerminalInput` listener runs BEFORE the focused overlay receives a
 * key, so it must stay inert while a viewer is open; otherwise it would consume
 * keys (e.g. Esc deselecting a row) before the overlay can act on them. Opening
 * the viewer from either the fleet or the `subagent:view` command flows through
 * `showConversationViewer`, so this counter covers both entry points.
 */
let openViewerCount = 0;

export function isConversationViewerOpen(): boolean {
	return openViewerCount > 0;
}

/** Rows reserved at the bottom for the agent identity line and the hint line. */
const FOOTER_ROWS = 2;
const MIN_VIEWPORT = 3;

export type ScrollAction = "up" | "down" | "halfPageUp" | "halfPageDown" | "pageUp" | "pageDown" | "home" | "end";

export interface ScrollState {
	scrollOffset: number;
	autoScroll: boolean;
}

/**
 * Pure scroll reducer. `autoScroll` re-engages whenever the offset reaches the
 * bottom so live updates keep following the tail, and disengages on any upward
 * or absolute-top movement.
 */
export function applyScroll(
	action: ScrollAction,
	state: ScrollState,
	maxScroll: number,
	viewportHeight: number,
): ScrollState {
	const clamp = (value: number) => Math.max(0, Math.min(value, maxScroll));

	switch (action) {
		case "up": {
			const offset = clamp(state.scrollOffset - 1);
			return { scrollOffset: offset, autoScroll: offset >= maxScroll };
		}
		case "down": {
			const offset = clamp(state.scrollOffset + 1);
			return { scrollOffset: offset, autoScroll: offset >= maxScroll };
		}
		case "halfPageUp": {
			const offset = clamp(state.scrollOffset - Math.max(1, Math.floor(viewportHeight / 2)));
			return { scrollOffset: offset, autoScroll: false };
		}
		case "halfPageDown": {
			const offset = clamp(state.scrollOffset + Math.max(1, Math.floor(viewportHeight / 2)));
			return { scrollOffset: offset, autoScroll: offset >= maxScroll };
		}
		case "pageUp": {
			const offset = clamp(state.scrollOffset - viewportHeight);
			return { scrollOffset: offset, autoScroll: false };
		}
		case "pageDown": {
			const offset = clamp(state.scrollOffset + viewportHeight);
			return { scrollOffset: offset, autoScroll: offset >= maxScroll };
		}
		case "home":
			return { scrollOffset: 0, autoScroll: false };
		case "end":
			return { scrollOffset: maxScroll, autoScroll: true };
	}
}

/**
 * Maps a key to a scroll action using a vim-style scheme: `j`/`k` line, `Ctrl-d`/
 * `Ctrl-u` half page, `Ctrl-f`/`Ctrl-b` full page, `g` to the top and `G` (shift+g)
 * to the bottom (which re-engages follow). Arrow and PageUp/PageDown keys are kept
 * as synonyms so the bindings stay discoverable for non-vim users. Returns
 * `undefined` for any other key so the caller can handle it (close, copy path).
 */
export function classifyScrollKey(data: string): ScrollAction | undefined {
	if (matchesKey(data, "up") || matchesKey(data, "k")) return "up";
	if (matchesKey(data, "down") || matchesKey(data, "j")) return "down";
	if (matchesKey(data, "ctrl+u")) return "halfPageUp";
	if (matchesKey(data, "ctrl+d")) return "halfPageDown";
	if (matchesKey(data, "ctrl+b") || matchesKey(data, "pageUp") || matchesKey(data, "shift+up")) return "pageUp";
	if (matchesKey(data, "ctrl+f") || matchesKey(data, "pageDown") || matchesKey(data, "shift+down")) return "pageDown";
	if (matchesKey(data, "home") || matchesKey(data, "g")) return "home";
	if (matchesKey(data, "end") || matchesKey(data, "shift+g")) return "end";
	return undefined;
}

/**
 * Full-screen, borderless view of a single subagent's conversation. Replaces the
 * old bordered modal: the transcript fills the screen and reads like the main
 * thread, while `ctx.ui.custom` captures keyboard focus so the prompt is disabled
 * for the duration (you are "inside" the subagent). Live-updates as the run streams
 * and unsubscribes from the runtime on dispose. Esc/q returns to the main thread.
 */
export class ConversationViewer implements Component {
	private scrollOffset = 0;
	private autoScroll = true;
	private closed = false;
	private unsubscribe: (() => void) | undefined;

	private lastMaxScroll = 0;
	private lastViewportHeight = MIN_VIEWPORT;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly runtime: ViewerRuntime,
		private readonly runId: string,
		private readonly done: (result: void) => void,
		private readonly transcriptPath?: string,
		private readonly onShowPath?: () => void,
	) {
		this.unsubscribe = this.runtime.subscribe((event) => {
			if (this.closed || event.runId !== this.runId) return;
			this.tui.requestRender();
		});
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q")) {
			this.closed = true;
			this.done(undefined);
			return;
		}

		if (matchesKey(data, "o")) {
			this.onShowPath?.();
			return;
		}

		const action = classifyScrollKey(data);
		if (!action) return;

		const next = applyScroll(
			action,
			{ scrollOffset: this.scrollOffset, autoScroll: this.autoScroll },
			this.lastMaxScroll,
			this.lastViewportHeight,
		);
		this.scrollOffset = next.scrollOffset;
		this.autoScroll = next.autoScroll;
		this.tui.requestRender();
	}

	/**
	 * Renders the subagent's conversation as a borderless, full-screen view that
	 * reads like the main thread rather than a modal: the transcript body fills the
	 * screen top-down, with a two-row footer at the bottom carrying the subagent's
	 * identity (status, elapsed, tokens, model/effort) and the scroll/key hints. The
	 * body lines come straight from `buildViewerModel`, so tool calls, thinking, and
	 * output are styled exactly as the main conversation.
	 */
	render(width: number): string[] {
		if (width < 6) return [];

		const snapshot = this.runtime.snapshot(this.runId);

		const viewportHeight = Math.max(MIN_VIEWPORT, this.viewportHeight());
		this.lastViewportHeight = viewportHeight;

		const model = buildViewerModel({
			snapshot,
			events: this.runtime.events(this.runId),
			scrollOffset: this.scrollOffset,
			width,
			height: viewportHeight,
			now: Date.now(),
			autoScroll: this.autoScroll,
		});

		this.lastMaxScroll = model.maxScroll;
		if (this.autoScroll) this.scrollOffset = model.maxScroll;

		const lines: string[] = [];
		for (let i = 0; i < viewportHeight; i++) {
			lines.push(this.styleBodyLine(model.bodyLines[i] ?? ""));
		}

		lines.push(this.renderAgentLine(model.headerLines[0] ?? "subagent", snapshot, width));
		lines.push(this.renderHintLine(model.footerLine, width));

		return lines;
	}

	invalidate(): void {}

	dispose(): void {
		this.closed = true;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
	}

	/**
	 * The bottom identity line: a status glyph, the bold run summary (agent · status
	 * · elapsed · tokens · tools) and, when known, a dim model/effort tail. Truncated
	 * to the full width since there is no border to fit inside.
	 */
	private renderAgentLine(header: string, snapshot: RunSnapshot | undefined, width: number): string {
		const th = this.theme;
		const status = snapshot?.status ?? "unknown";
		const icon = status === "running"
			? th.fg("accent", ">")
			: status === "completed"
				? th.fg("success", "+")
				: status === "failed"
					? th.fg("error", "x")
					: th.fg("dim", "-");

		const modelEffort = formatModelEffort(snapshot?.model, snapshot?.thinking);
		const styled = modelEffort
			? `${icon} ${th.bold(header)} ${th.fg("dim", `· ${modelEffort}`)}`
			: `${icon} ${th.bold(header)}`;

		return truncateToWidth(styled, width);
	}

	/**
	 * Applies a semantic colour to one body line so assistant text, tool activity,
	 * result summaries, edit diffs, and status transitions stand apart. Tool lines
	 * get mixed colouring (bold-accent verb, muted args, status-coloured summary,
	 * with wrapped continuation lines kept in the muted args colour) and diff lines
	 * colour by their `+`/`-` change kind, both via `styleTranscriptLine`;
	 * free-flowing text keeps the default colour. The outer `row` handles padding
	 * and width truncation.
	 */
	private styleBodyLine(line: string): string {
		const styler: TranscriptStyler = {
			fg: (color, text) => this.theme.fg(color, text),
			bold: (text) => this.theme.bold(text),
		};
		return styleTranscriptLine(line, styler);
	}

	/**
	 * The bottom hint line: scroll stats (plus the transcript path when known) on the
	 * left, the vim-style key hints on the right. `Esc`/`q` returns to the main
	 * thread; `o` surfaces the full transcript path for copy/open. The full path stays
	 * reachable via `o` even when the left text truncates.
	 */
	private renderHintLine(footerLine: string, width: number): string {
		const th = this.theme;
		const hintText = this.transcriptPath
			? "o copy path · j/k · C-d/u · g/G · q back"
			: "j/k · C-d/u · g/G · q back";
		const hint = th.fg("dim", hintText);

		const leftText = this.transcriptPath ? `${footerLine} · ${this.transcriptPath}` : footerLine;
		const leftWidth = Math.max(0, width - visibleWidth(hint) - 1);
		const left = th.fg("dim", truncateToWidth(leftText, leftWidth));

		const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(hint));
		return left + " ".repeat(gap) + hint;
	}

	private viewportHeight(): number {
		return Math.max(MIN_VIEWPORT, this.tui.terminal.rows - FOOTER_ROWS);
	}
}

/**
 * Opens the conversation viewer as a focused overlay and resolves when it closes.
 * Mirrors the `showModelPanel` overlay pattern.
 */
export function showConversationViewer(
	ctx: ExtensionContext,
	runtime: ViewerRuntime,
	runId: string,
	transcriptPath?: string,
): Promise<void> {
	openViewerCount += 1;
	enterOverlay();
	const showPath = transcriptPath ? () => ctx.ui.notify(transcriptPath, "info") : undefined;
	const closed = ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) =>
			new ConversationViewer(tui, theme, runtime, runId, done, transcriptPath, showPath),
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "100%",
				maxHeight: "100%",
				margin: 0,
			},
		},
	);
	return closed.finally(() => {
		openViewerCount = Math.max(0, openViewerCount - 1);
		exitOverlay();
	});
}
