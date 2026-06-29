/**
 * Thin re-export shim: all pure tool-formatting logic now lives in
 * `packages/render-core/`. This file preserves the existing import paths so
 * neither consumer (tool-renderer.ts, conversation-viewer-model.ts, tests) needs
 * any edit at their call sites.
 */

export type { ToolSummaryStatus, DiffLineKind, DiffBlockLine } from "../../render-core/formatters/tool-summary.ts";
export { formatToolArgs } from "../../render-core/formatters/tool-args.ts";
export { summarizeToolResult, parseDiffStat, diffBlockLines } from "../../render-core/formatters/tool-summary.ts";
export { outputBlockLines } from "../../render-core/formatters/output-block.ts";
