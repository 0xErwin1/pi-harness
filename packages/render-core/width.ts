/**
 * Width-safety primitives for render-core.
 *
 * An over-width line is a FATAL error in pi-tui's doRender and is NOT caught by
 * safeRenderWrapper. Width-safety is therefore structural: every formatter emits
 * output exclusively through `LineBuffer`, which clamps every line to the render
 * width before storing it. A formatter cannot structurally produce an over-width
 * line — missing a clamp call is not an option because the only emission API is
 * `LineBuffer`.
 *
 * Consumers inject the real pi-tui `visibleWidth`/`truncateToWidth` via
 * `WidthOps`; tests inject a deterministic ASCII-width double. `render-core`
 * itself has no dependency on pi-tui.
 */

import type { RenderStyler } from "./styler.ts";
import type { RenderConfig } from "./config.ts";

/** Width primitives injected by consumers; keeps render-core pi-tui-free. */
export interface WidthOps {
	/** Returns the visible column width of a string, ANSI-aware. */
	visibleWidth(s: string): number;
	/** Returns the string truncated to at most `w` visible columns, ANSI-aware. */
	truncateToWidth(s: string, w: number): string;
}

/**
 * Full render context passed to every formatter that emits styled, width-clamped
 * lines. Created once per render call by the consumer (because `maxWidth` is only
 * known at draw time).
 */
export interface RenderCtx {
	styler: RenderStyler;
	width: WidthOps;
	/** Maximum visible columns a line may occupy. Non-positive means no clamping. */
	maxWidth: number;
	config: RenderConfig;
}

/**
 * The single emission choke point for all render-core formatters.
 *
 * Every `push` / `pushAll` call clamps its line(s) to `ctx.maxWidth` via the
 * injected `WidthOps.truncateToWidth`. Because formatters can ONLY emit through
 * `LineBuffer`, over-width output is structurally impossible — the guarantee does
 * not rely on each formatter remembering to clamp.
 *
 * A non-positive `maxWidth` disables clamping (passthrough), which makes the
 * buffer safe for tests or contexts where the draw width is unknown.
 */
export class LineBuffer {
	private readonly lines: string[] = [];

	constructor(private readonly ctx: RenderCtx) {}

	push(line: string): void {
		if (this.ctx.maxWidth <= 0) {
			this.lines.push(line);
		} else {
			this.lines.push(this.ctx.width.truncateToWidth(line, this.ctx.maxWidth));
		}
	}

	pushAll(lines: string[]): void {
		for (const line of lines) {
			this.push(line);
		}
	}

	/** Returns all accumulated lines as a fresh array. */
	done(): string[] {
		return this.lines.slice();
	}
}
