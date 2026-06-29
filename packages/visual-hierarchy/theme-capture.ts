/**
 * Shared theme-styler singleton for prototype-patch extensions.
 *
 * Prototype-patch render wrappers receive only `(baseline, self, width)` — no
 * `Theme` parameter. This module captures the active pi-tui `Theme` at
 * `session_start` and exposes a `currentRenderStyler()` that bridges the gap:
 * callers get a `RenderStyler` backed by the real user theme. When the theme
 * has not been captured yet (first render before `session_start` fires, or after
 * `session_shutdown`), the returned styler is a plain passthrough that emits no
 * ANSI codes — legible in all terminals.
 *
 * Usage per extension that participates in theme-aware rendering:
 * ```ts
 * pi.on("session_start", (_event, ctx) => {
 *   captureTheme(ctx.ui.theme);
 *   // ... rest of session_start setup
 * });
 * pi.on("session_shutdown", () => {
 *   releaseTheme();
 *   // ... rest of session_shutdown teardown
 * });
 * ```
 *
 * Multiple extensions may call `captureTheme` / `releaseTheme` independently;
 * all share the same module-level singleton so the last capture wins (all
 * sessions within a process use the same theme anyway).
 *
 * `RenderColor` is a strict subset of pi-tui `ThemeColor`, so the `fg` cast
 * is safe: every `RenderColor` literal exists in `ThemeColor`.
 */
import { type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import type { RenderStyler } from "../render-core/styler.ts";
import type { RenderColor } from "../render-core/styler.ts";

const PLAIN_STYLER: RenderStyler = {
	fg: (_color, text) => text,
	bold: (text) => text,
	italic: (text) => text,
};

/**
 * Maps each render-core colour role to a pi `ThemeColor`. Most are identity
 * (the role names overlap), except `thinking`, which resolves to pi's dedicated
 * `thinkingText` colour so reasoning blocks pick up the theme's reasoning tint.
 */
const RENDER_COLOR_TO_THEME: Record<RenderColor, ThemeColor> = {
	accent: "accent",
	success: "success",
	error: "error",
	dim: "dim",
	muted: "muted",
	warning: "warning",
	text: "text",
	thinking: "thinkingText",
};

let currentStyler: RenderStyler = PLAIN_STYLER;

/**
 * Builds a `RenderStyler` backed by a pi `Theme`, mapping each render-core colour
 * role through `RENDER_COLOR_TO_THEME` and wiring `bold`/`italic` to the theme.
 * Shared by the captured singleton and by main-thread consumers that hold a
 * `Theme` directly (e.g. `tool-renderer`), so both resolve `thinking` to the same
 * `thinkingText` tint instead of casting and crashing on the unknown role.
 */
export function buildRenderStyler(theme: Theme): RenderStyler {
	return {
		fg: (color: RenderColor, text: string): string =>
			theme.fg(RENDER_COLOR_TO_THEME[color], text),
		bold: (text: string): string => theme.bold(text),
		italic: (text: string): string => theme.italic(text),
	};
}

/**
 * Captures the active `Theme` and pre-builds a `RenderStyler` that delegates to
 * it. Call from every participating extension's `session_start` handler.
 */
export function captureTheme(theme: Theme): void {
	currentStyler = buildRenderStyler(theme);
}

/**
 * Releases the captured theme and reverts to the plain fallback styler.
 * Call from every participating extension's `session_shutdown` handler.
 */
export function releaseTheme(): void {
	currentStyler = PLAIN_STYLER;
}

/**
 * Returns a `RenderStyler` backed by the currently captured theme, or a plain
 * no-ANSI styler when no theme has been captured. Safe to call at any time,
 * including inside prototype-patch render transforms.
 */
export function currentRenderStyler(): RenderStyler {
	return currentStyler;
}
