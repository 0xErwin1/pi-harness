import { performance } from "node:perf_hooks";
import { TUI, visibleWidth, type Component, type Terminal } from "@earendil-works/pi-tui";
import { isImageLine } from "@earendil-works/pi-tui/dist/terminal-image.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const INSTALL_SYMBOL = Symbol.for("pi-harness.viewport-rendering.installed");
const STATE_SYMBOL = Symbol.for("pi-harness.viewport-rendering.state");
const CURSOR_MARKER = "\x1b_pi:c\x07";
const VIEWPORT_OVERSCAN_LINES = 20;

type RedrawReason = "first-render" | "width-change" | "height-change" | "diff";

export interface ViewportRenderingMetrics {
	renderCount: number;
	fullRedrawCount: number;
	widthChangeCount: number;
	lastRenderMs: number;
	totalRenderMs: number;
	lastTotalLineCount: number;
	lastViewportRows: number;
	lastViewportTop: number;
	lastRedrawReason: RedrawReason;
	lastComparedLineCount: number;
	lastChangedLineCount: number;
	lastWrittenLineCount: number;
	lastWidth: number;
	lastHeight: number;
}

interface CursorPosition {
	row: number;
	col: number;
}

interface TuiInternals {
	terminal: Terminal;
	children?: Component[];
	render(width: number): string[];
	previousLines: string[];
	previousKittyImageIds: Set<number>;
	previousWidth: number;
	previousHeight: number;
	cursorRow: number;
	hardwareCursorRow: number;
	previousViewportTop: number;
	fullRedrawCount: number;
	stopped: boolean;
	overlayStack: unknown[];
	compositeOverlays(lines: string[], width: number, height: number): string[];
	applyLineResets(lines: string[]): string[];
	collectKittyImageIds(lines: string[]): Set<number>;
	deleteKittyImages(ids: Set<number>): string;
	getKittyImageReservedRows(lines: string[], index: number): number;
	positionHardwareCursor(cursorPos: CursorPosition | null, totalLines: number): void;
}

interface InstallOptions {
	force?: boolean;
}

function blankMetrics(): ViewportRenderingMetrics {
	return {
		renderCount: 0,
		fullRedrawCount: 0,
		widthChangeCount: 0,
		lastRenderMs: 0,
		totalRenderMs: 0,
		lastTotalLineCount: 0,
		lastViewportRows: 0,
		lastViewportTop: 0,
		lastRedrawReason: "first-render",
		lastComparedLineCount: 0,
		lastChangedLineCount: 0,
		lastWrittenLineCount: 0,
		lastWidth: 0,
		lastHeight: 0,
	};
}

function metricsFor(tui: object): ViewportRenderingMetrics {
	const holder = tui as Record<PropertyKey, unknown>;
	let metrics = holder[STATE_SYMBOL] as ViewportRenderingMetrics | undefined;
	if (metrics === undefined) {
		metrics = blankMetrics();
		holder[STATE_SYMBOL] = metrics;
	}
	return metrics;
}

export function getViewportRenderingMetrics(tui: object): ViewportRenderingMetrics {
	return { ...metricsFor(tui) };
}

function kittyRows(line: string): number {
	const start = line.indexOf("\x1b_G");
	const paramsEnd = start === -1 ? -1 : line.indexOf(";", start);
	if (paramsEnd === -1) return 1;

	for (const param of line.slice(start + "\x1b_G".length, paramsEnd).split(",")) {
		const [key, value] = param.split("=", 2);
		const rows = value === undefined ? NaN : Number(value);
		if (key === "r" && Number.isInteger(rows) && rows > 0) return rows;
	}

	return 1;
}

function viewportTopFor(lines: string[], height: number): number {
	let top = Math.max(0, lines.length - height);
	for (let pass = 0; pass < 4; pass++) {
		let changed = false;
		const bottom = top + height - 1;

		for (let i = 0; i < lines.length; i++) {
			const rows = kittyRows(lines[i] ?? "");
			if (rows <= 1 || rows > height) continue;

			const imageBottom = i + rows - 1;
			if (top > i && top <= imageBottom) {
				top = i;
				changed = true;
				break;
			}

			if (i >= top && i <= bottom && imageBottom > bottom) {
				top = Math.max(0, imageBottom - height + 1);
				changed = true;
				break;
			}
		}

		if (!changed) break;
	}

	return top;
}

function hasChildren(component: Component | TuiInternals): component is Component & { children: Component[] } {
	return Array.isArray((component as { children?: unknown }).children);
}

function renderTail(component: Component | TuiInternals, width: number, budget: number): string[] {
	if (!hasChildren(component)) return component.render(width);

	const target = Math.max(1, budget);
	const lines: string[] = [];
	for (let i = component.children.length - 1; i >= 0; i--) {
		const remaining = target + VIEWPORT_OVERSCAN_LINES - lines.length;
		const childLines = renderTail(component.children[i], width, Math.max(1, remaining));
		lines.unshift(...childLines);
		if (lines.length >= target + VIEWPORT_OVERSCAN_LINES) break;
	}

	return lines;
}

function extractCursor(lines: string[]): CursorPosition | null {
	for (let row = lines.length - 1; row >= 0; row--) {
		const line = lines[row] ?? "";
		const markerIndex = line.indexOf(CURSOR_MARKER);
		if (markerIndex === -1) continue;

		lines[row] = line.slice(0, markerIndex) + line.slice(markerIndex + CURSOR_MARKER.length);
		return { row, col: visibleWidth(line.slice(0, markerIndex)) };
	}

	return null;
}

function writeVisible(tui: TuiInternals, lines: string[], height: number, prelude = ""): void {
	let buffer = `\x1b[?2026h${prelude}\x1b[H`;

	for (let i = 0; i < height; i++) {
		if (i > 0) buffer += "\r\n";
		buffer += "\x1b[2K";

		const line = lines[i];
		if (line === undefined) continue;

		const rows = isImageLine(line) ? tui.getKittyImageReservedRows(lines, i) : 1;
		if (rows > 1 && rows <= height) {
			for (let row = 1; row < rows; row++) buffer += "\r\n\x1b[2K";
			buffer += `\x1b[${rows - 1}A${line}\x1b[${rows - 1}B`;
			i += rows - 1;
			continue;
		}

		buffer += line;
	}

	tui.terminal.write(`${buffer}\x1b[?2026l`);
}

function reasonFor(tui: TuiInternals, width: number, height: number): RedrawReason {
	if (tui.previousLines.length === 0) return "first-render";
	if (tui.previousWidth !== width) return "width-change";
	if (tui.previousHeight !== height) return "height-change";
	return "diff";
}

function recordMetrics(
	tui: TuiInternals,
	startedAt: number,
	reason: RedrawReason,
	logicalLines: string[],
	visibleLines: string[],
	viewportTop: number,
): void {
	const metrics = metricsFor(tui);
	const elapsed = performance.now() - startedAt;

	metrics.renderCount += 1;
	metrics.fullRedrawCount = tui.fullRedrawCount;
	metrics.widthChangeCount += reason === "width-change" ? 1 : 0;
	metrics.lastRenderMs = elapsed;
	metrics.totalRenderMs += elapsed;
	metrics.lastTotalLineCount = logicalLines.length;
	metrics.lastViewportRows = tui.terminal.rows;
	metrics.lastViewportTop = viewportTop;
	metrics.lastRedrawReason = reason;
	metrics.lastComparedLineCount = Math.max(tui.previousLines.length, visibleLines.length);
	metrics.lastChangedLineCount = visibleLines.length;
	metrics.lastWrittenLineCount = visibleLines.length;
	metrics.lastWidth = tui.terminal.columns;
	metrics.lastHeight = tui.terminal.rows;
}

function viewportDoRender(this: TuiInternals): void {
	if (this.stopped) return;

	const startedAt = performance.now();
	const width = this.terminal.columns;
	const height = this.terminal.rows;
	const reason = reasonFor(this, width, height);

	let logicalLines = renderTail(this, width, height);
	if (this.overlayStack.length > 0) logicalLines = this.compositeOverlays(logicalLines, width, height);

	const viewportTop = viewportTopFor(logicalLines, height);
	let visibleLines = logicalLines.slice(viewportTop, viewportTop + height);
	const cursorPos = extractCursor(visibleLines);
	visibleLines = this.applyLineResets(visibleLines);

	this.fullRedrawCount += 1;
	const deletePreviousImages = this.deleteKittyImages(this.previousKittyImageIds);
	writeVisible(this, visibleLines, height, deletePreviousImages);

	recordMetrics(this, startedAt, reason, logicalLines, visibleLines, viewportTop);
	this.cursorRow = Math.max(0, visibleLines.length - 1);
	this.hardwareCursorRow = this.cursorRow;
	this.previousViewportTop = viewportTop;
	this.previousLines = visibleLines;
	this.previousKittyImageIds = this.collectKittyImageIds(visibleLines);
	this.previousWidth = width;
	this.previousHeight = height;
	this.positionHardwareCursor(cursorPos, visibleLines.length);
}

export function installViewportRenderingPatch(options: InstallOptions = {}): boolean {
	const prototype = TUI.prototype as unknown as Record<PropertyKey, unknown>;
	if (prototype[INSTALL_SYMBOL]) return false;
	if (!options.force && process.env.PI_VIEWPORT_RENDERING === "0") return false;

	prototype[INSTALL_SYMBOL] = true;
	prototype.doRender = viewportDoRender;
	return true;
}

export default function viewportRendering(_pi: ExtensionAPI): void {
	installViewportRenderingPatch();
}
