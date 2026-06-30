/**
 * Render configuration defaults.
 *
 * A plain frozen constant — no persistence and no runtime command. Consumers
 * may pass their own `RenderConfig` to override specific fields, but the
 * defaults cover the expected production behaviour for all current slices.
 */

export interface DiffConfig {
	mode: "unified" | "split" | "auto";
	splitMinWidth: number;
	collapsedLines: number;
	wordWrap: boolean;
	lineNumbers: boolean;
	charSpans: boolean;
}

export interface RenderConfig {
	/** How MCP tool output is presented by default. */
	mcpOutput: "hidden" | "summary" | "preview";
	/** Number of lines shown in a preview before truncation. */
	previewLines: number;
	/** Maximum bash output lines shown before the collapsed view. */
	bashCollapsed: number;
	diff: DiffConfig;
}

export const RENDER_DEFAULTS: RenderConfig = Object.freeze({
	mcpOutput: "summary",
	previewLines: 3,
	bashCollapsed: 6,
	diff: Object.freeze({
		mode: "split",
		splitMinWidth: 120,
		collapsedLines: 20,
		wordWrap: true,
		lineNumbers: true,
		charSpans: true,
	}),
});
