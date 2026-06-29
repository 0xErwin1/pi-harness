/**
 * render-core: pure, theme-agnostic, pi-tui-free formatting kernel.
 *
 * Width primitives and theme are injected via interfaces so this package can be
 * imported by both Consumer A (main thread, with pi-tui) and Consumer B
 * (subagent viewer, headless) without coupling either to the other's runtime.
 *
 * For testing infrastructure see `render-core/testing/`.
 */

export type { RenderColor, RenderStyler } from "./styler.ts";
export type { RenderConfig, DiffConfig } from "./config.ts";
export { RENDER_DEFAULTS } from "./config.ts";
export type { WidthOps, RenderCtx } from "./width.ts";
export { LineBuffer } from "./width.ts";

export type { ToolSummaryStatus, DiffLineKind, DiffBlockLine } from "./formatters/tool-summary.ts";
export { toolVerb, formatToolArgs } from "./formatters/tool-args.ts";
export { summarizeToolResult, parseDiffStat, diffBlockLines } from "./formatters/tool-summary.ts";
export { outputBlockLines } from "./formatters/output-block.ts";
export { buildToolCallLine } from "./formatters/tool-call.ts";
export type { ToolResultData } from "./formatters/tool-result.ts";
export { buildToolResultLines } from "./formatters/tool-result.ts";
export { formatMcpCall, formatMcpResult } from "./formatters/mcp.ts";
export type { SpinnerState } from "./formatters/bash-spinner.ts";
export { nextSpinner, buildBashCallLine } from "./formatters/bash-spinner.ts";
export { projectPendingEdit } from "./formatters/pending-diff.ts";
