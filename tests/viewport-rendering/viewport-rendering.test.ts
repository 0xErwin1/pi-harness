import assert from "node:assert/strict";
import test from "node:test";
import { CURSOR_MARKER, TUI, type Component, type Terminal } from "@earendil-works/pi-tui";

import { getViewportRenderingMetrics, installViewportRenderingPatch } from "../../extensions/viewport-rendering.ts";

installViewportRenderingPatch({ force: true });

class FakeTerminal implements Terminal {
	writes: string[] = [];
	hideCursorCount = 0;
	showCursorCount = 0;
	kittyProtocolActive = false;

	constructor(public columns: number = 40, public rows: number = 5) {}

	start(_onInput: (data: string) => void, _onResize: () => void): void {}
	stop(): void {}
	async drainInput(): Promise<void> {}
	write(data: string): void { this.writes.push(data); }
	moveBy(lines: number): void { this.write(`moveBy:${lines}`); }
	hideCursor(): void { this.hideCursorCount += 1; }
	showCursor(): void { this.showCursorCount += 1; }
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}
	setTitle(_title: string): void {}
	setProgress(_active: boolean): void {}
}

class LinesComponent implements Component {
	constructor(public lines: string[]) {}

	render(_width: number): string[] { return [...this.lines]; }
	invalidate(): void {}
}

class CountingLinesComponent extends LinesComponent {
	renderCount = 0;

	render(width: number): string[] {
		this.renderCount += 1;
		return super.render(width);
	}
}

function renderNow(tui: TUI): void { (tui as unknown as { doRender(): void }).doRender(); }
function joinedWrites(term: FakeTerminal, from = 0): string { return term.writes.slice(from).join("\n"); }

test("records viewport render metrics including line count, viewport rows, width changes and redraw reason", () => {
	const terminal = new FakeTerminal(20, 4);
	const tui = new TUI(terminal);
	tui.addChild(new LinesComponent(Array.from({ length: 12 }, (_, i) => `line-${i}`)));

	renderNow(tui);
	terminal.columns = 24;
	renderNow(tui);
	terminal.rows = 6;
	renderNow(tui);

	const metrics = getViewportRenderingMetrics(tui);
	assert.equal(metrics.renderCount, 3);
	assert.equal(metrics.lastTotalLineCount, 12);
	assert.equal(metrics.lastViewportRows, 6);
	assert.equal(metrics.lastViewportTop, 6);
	assert.equal(metrics.widthChangeCount, 1);
	assert.equal(metrics.lastRedrawReason, "height-change");
	assert.equal(metrics.lastWrittenLineCount, 6);
});

test("steady-state long transcript renders diff and writes only the bounded viewport", () => {
	const terminal = new FakeTerminal(30, 5);
	const tui = new TUI(terminal);
	const component = new LinesComponent(Array.from({ length: 100 }, (_, i) => `history-${i}`));
	tui.addChild(component);

	renderNow(tui);
	const secondRenderStart = terminal.writes.length;
	component.lines[99] = "history-99 updated";
	renderNow(tui);

	const metrics = getViewportRenderingMetrics(tui);
	assert.equal(metrics.lastRedrawReason, "diff");
	assert.ok(metrics.lastComparedLineCount <= terminal.rows);
	assert.ok(metrics.lastWrittenLineCount <= terminal.rows);
	assert.ok(!joinedWrites(terminal, secondRenderStart).includes("history-0"));
});

test("container transcripts render only tail children needed for the viewport", () => {
	const terminal = new FakeTerminal(30, 5);
	const tui = new TUI(terminal);
	const old = new CountingLinesComponent(["old-0", "old-1"]);
	const middle = new CountingLinesComponent(Array.from({ length: 10 }, (_, i) => `middle-${i}`));
	const recent = new CountingLinesComponent(Array.from({ length: 30 }, (_, i) => `recent-${i}`));
	tui.addChild(old);
	tui.addChild(middle);
	tui.addChild(recent);

	renderNow(tui);

	assert.equal(old.renderCount, 0);
	assert.equal(middle.renderCount, 0);
	assert.equal(recent.renderCount, 1);
	assert.ok(joinedWrites(terminal).includes("recent-29"));
	assert.ok(!joinedWrites(terminal).includes("old-0"));
});

test("cursor markers are translated to viewport-relative hardware cursor coordinates", () => {
	const terminal = new FakeTerminal(30, 4);
	const tui = new TUI(terminal, true);
	tui.addChild(new LinesComponent(["line-0", "line-1", "line-2", "line-3", "line-4", "line-5", "line-6", "line-7", `ab${CURSOR_MARKER}cd`, "line-9"]));

	renderNow(tui);

	assert.ok(joinedWrites(terminal).includes("\x1b[3G"));
	assert.equal(terminal.showCursorCount, 1);
	assert.equal(getViewportRenderingMetrics(tui).lastViewportTop, 6);
});

test("off-viewport cursor markers hide the hardware cursor", () => {
	const terminal = new FakeTerminal(30, 3);
	const tui = new TUI(terminal, true);
	tui.addChild(new LinesComponent([`ab${CURSOR_MARKER}cd`, "line-1", "line-2", "line-3", "line-4", "line-5"]));

	renderNow(tui);

	assert.equal(terminal.hideCursorCount, 1);
	assert.equal(terminal.showCursorCount, 0);
});

test("overlays are composed in viewport coordinates before visible slicing", () => {
	const terminal = new FakeTerminal(30, 4);
	const tui = new TUI(terminal);
	tui.addChild(new LinesComponent(Array.from({ length: 10 }, (_, i) => `base-${i}`)));
	tui.showOverlay(new LinesComponent(["OV"]), { row: 0, col: 0, width: 2 });

	renderNow(tui);

	assert.ok(joinedWrites(terminal).includes("OV"));
	assert.equal(getViewportRenderingMetrics(tui).lastViewportTop, 6);
});

test("kitty image rows are not split by the viewport top", () => {
	const terminal = new FakeTerminal(40, 4);
	const tui = new TUI(terminal);
	const imageLine = "\x1b_Gi=123,r=3;payload\x1b\\";
	tui.addChild(new LinesComponent(["line-0", "line-1", "line-2", imageLine, "image-reserved-1", "image-reserved-2", "tail-6", "tail-7"]));

	renderNow(tui);

	const metrics = getViewportRenderingMetrics(tui);
	assert.equal(metrics.lastViewportTop, 3);
	assert.ok(joinedWrites(terminal).includes(imageLine));
	assert.ok(!joinedWrites(terminal).includes("tail-7"));
});

test("deleted visible rows are cleared without replaying older scrollback", () => {
	const terminal = new FakeTerminal(30, 4);
	const tui = new TUI(terminal);
	const component = new LinesComponent(Array.from({ length: 10 }, (_, i) => `row-${i}`));
	tui.addChild(component);

	renderNow(tui);
	const secondRenderStart = terminal.writes.length;
	component.lines = ["short-0", "short-1"];
	renderNow(tui);

	const secondRender = joinedWrites(terminal, secondRenderStart);
	const metrics = getViewportRenderingMetrics(tui);
	assert.equal(metrics.lastRedrawReason, "diff");
	assert.ok(metrics.lastWrittenLineCount <= terminal.rows);
	assert.ok(secondRender.includes("\x1b[2K"));
	assert.ok(!secondRender.includes("row-0"));
});

test("removed kitty images emit deletion escapes before the next viewport write", () => {
	const terminal = new FakeTerminal(40, 4);
	const tui = new TUI(terminal);
	const imageLine = "\x1b_Gi=456,r=2;payload\x1b\\";
	const component = new LinesComponent(["head", imageLine, "image-reserved", "tail"]);
	tui.addChild(component);

	renderNow(tui);
	const secondRenderStart = terminal.writes.length;
	component.lines = ["head", "plain", "tail"];
	renderNow(tui);

	const secondRender = joinedWrites(terminal, secondRenderStart);
	assert.ok(secondRender.includes("\x1b_Ga=d,d=I,i=456,q=2\x1b\\"));
	assert.ok(!secondRender.includes(imageLine));
});
