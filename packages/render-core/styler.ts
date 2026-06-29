/**
 * Shared styling surface for render-core formatters.
 *
 * Formatters call the injected `RenderStyler` instead of emitting raw ANSI, so
 * they remain theme-agnostic and headlessly testable. Both Consumer A
 * (tool-renderer.ts on the main thread) and Consumer B (conversation-viewer)
 * satisfy this interface with their own theme adapters.
 */

/** Semantic colour roles used across all render-core formatters. */
export type RenderColor =
	| "accent"
	| "success"
	| "error"
	| "dim"
	| "muted"
	| "warning"
	| "text";

/**
 * Theme-agnostic styling surface: `fg` applies a semantic colour, `bold`
 * weights text. Both consumers inject an adapter; tests inject a deterministic
 * double that wraps text in assertable tokens.
 */
export interface RenderStyler {
	fg(color: RenderColor, text: string): string;
	bold(text: string): string;
}
