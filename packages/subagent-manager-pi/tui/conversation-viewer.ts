import {
	type Component,
	matchesKey,
	truncateToWidth,
	type TUI,
	visibleWidth,
} from "@mariozechner/pi-tui";
import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import type { RunEvent, RunSnapshot } from "../../subagent-manager-core/events.ts";
import type { RunStoreListener } from "../../subagent-manager-core/store.ts";
import { buildViewerModel, transcriptLineColor } from "./conversation-viewer-model.ts";

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

/** Lines consumed by the bordered chrome: top, header, header separator, footer separator, footer, bottom. */
const CHROME_LINES = 6;
const MIN_VIEWPORT = 3;
const VIEWPORT_HEIGHT_PCT = 80;

export type ScrollAction = "up" | "down" | "pageUp" | "pageDown" | "home" | "end";

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

function classifyScrollKey(data: string): ScrollAction | undefined {
	if (matchesKey(data, "up") || matchesKey(data, "k")) return "up";
	if (matchesKey(data, "down") || matchesKey(data, "j")) return "down";
	if (matchesKey(data, "pageUp") || matchesKey(data, "shift+up")) return "pageUp";
	if (matchesKey(data, "pageDown") || matchesKey(data, "shift+down")) return "pageDown";
	if (matchesKey(data, "home")) return "home";
	if (matchesKey(data, "end") || matchesKey(data, "shift+g") || matchesKey(data, "g")) return "end";
	return undefined;
}

/**
 * Scrollable overlay that replays a run's accumulated assistant transcript and
 * live-updates as the run streams. Built on the proven `ctx.ui.custom({ overlay })`
 * lifecycle (mirrors `showModelPanel`); unsubscribes from the runtime on dispose.
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

	render(width: number): string[] {
		if (width < 6) return [];

		const th = this.theme;
		const innerW = width - 4;
		const viewportHeight = this.viewportHeight();
		this.lastViewportHeight = viewportHeight;

		const snapshot = this.runtime.snapshot(this.runId);
		const model = buildViewerModel({
			snapshot,
			events: this.runtime.events(this.runId),
			scrollOffset: this.scrollOffset,
			width: innerW,
			height: viewportHeight,
			now: Date.now(),
			autoScroll: this.autoScroll,
		});

		this.lastMaxScroll = model.maxScroll;
		if (this.autoScroll) this.scrollOffset = model.maxScroll;

		const pad = (text: string) => text + " ".repeat(Math.max(0, innerW - visibleWidth(text)));
		const row = (content: string) =>
			`${th.fg("border", "│")} ${truncateToWidth(pad(content), innerW)} ${th.fg("border", "│")}`;
		const top = th.fg("border", `╭${"─".repeat(width - 2)}╮`);
		const bottom = th.fg("border", `╰${"─".repeat(width - 2)}╯`);
		const separator = row(th.fg("dim", "─".repeat(innerW)));

		const lines: string[] = [];
		lines.push(top);
		lines.push(row(this.renderHeader(model.headerLines, snapshot)));
		lines.push(separator);

		for (let i = 0; i < viewportHeight; i++) {
			lines.push(row(this.styleBodyLine(model.bodyLines[i] ?? "")));
		}

		lines.push(separator);
		lines.push(row(this.renderFooter(model.footerLine, innerW)));
		lines.push(bottom);

		return lines;
	}

	invalidate(): void {}

	dispose(): void {
		this.closed = true;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
	}

	private renderHeader(headerLines: string[], snapshot: RunSnapshot | undefined): string {
		const th = this.theme;
		const status = snapshot?.status ?? "unknown";
		const icon = status === "running"
			? th.fg("accent", ">")
			: status === "completed"
				? th.fg("success", "+")
				: status === "failed"
					? th.fg("error", "x")
					: th.fg("dim", "-");
		return `${icon} ${th.bold(headerLines[0] ?? "")}`;
	}

	/**
	 * Applies a semantic colour to one body line so assistant text, tool activity,
	 * and status transitions stand apart. Free-flowing text keeps the default
	 * colour; the outer `row` handles padding and width truncation.
	 */
	private styleBodyLine(line: string): string {
		if (line.length === 0) return "";
		return this.theme.fg(transcriptLineColor(line), line);
	}

	/**
	 * Renders the footer. When a transcript path is known it is shown after the
	 * scroll stats (left-aligned, truncated to leave room for the hint) and the
	 * hint advertises `o` to surface the full path for copy/open; the full path is
	 * always available via `o` even when the line truncates. Without a path the
	 * legacy scroll hint is shown.
	 */
	private renderFooter(footerLine: string, innerW: number): string {
		const th = this.theme;
		const hintText = this.transcriptPath
			? "o copy path · End/G follow · Esc close"
			: "up/down/jk · PgUp/PgDn · End/G follow · Esc close";
		const hint = th.fg("dim", hintText);

		const leftText = this.transcriptPath ? `${footerLine} · ${this.transcriptPath}` : footerLine;
		const leftWidth = Math.max(0, innerW - visibleWidth(hint) - 1);
		const left = th.fg("dim", truncateToWidth(leftText, leftWidth));

		const gap = Math.max(1, innerW - visibleWidth(left) - visibleWidth(hint));
		return left + " ".repeat(gap) + hint;
	}

	private viewportHeight(): number {
		const rows = this.tui.terminal.rows;
		const maxRows = Math.floor((rows * VIEWPORT_HEIGHT_PCT) / 100);
		return Math.max(MIN_VIEWPORT, maxRows - CHROME_LINES);
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
	const showPath = transcriptPath ? () => ctx.ui.notify(transcriptPath, "info") : undefined;
	const closed = ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) =>
			new ConversationViewer(tui, theme, runtime, runId, done, transcriptPath, showPath),
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "80%",
				maxHeight: "80%",
			},
		},
	);
	return closed.finally(() => {
		openViewerCount = Math.max(0, openViewerCount - 1);
	});
}
