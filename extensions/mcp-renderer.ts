/**
 * MCP tool overlay extension (S2).
 *
 * Installs an idempotent prototype patch on `ToolExecutionComponent.prototype.render`
 * so that MCP tool rows render as a compact `<server> · <tool>` one-liner when
 * COLLAPSED (default). When the user presses ctrl+o (expanded=true) the patch
 * falls through to the original render, showing the full native output.
 *
 * Tool classification uses a `mcpToolNames: Set<string>` built from
 * `pi.getAllTools()`: any tool whose name starts with `mcp__` is MCP. The set is
 * re-scanned (union, not replace) at `session_start` AND `before_agent_start` to
 * catch MCP servers that connect asynchronously after the session opens.
 *
 * Theme: the `safeRenderWrapper` transform has no `Theme` parameter at its call
 * site, so the active theme is captured via `captureTheme(ctx.ui.theme)` at
 * `session_start`. Inside the transform, `currentRenderStyler()` returns the
 * theme-backed styler (or a plain fallback when no theme is captured yet).
 *
 * TRANSITION NOTE (S2–S7 coexistence): pi-tool-display is STILL active and also
 * handles MCP output (its config has `mcpOutputMode: "hidden"`). Both handlers are
 * registered on the same `ToolExecutionComponent`, so live MCP rendering may be
 * ambiguous during the transition period. The correctness of this overlay is proven
 * by the unit tests (`tests/render-core/mcp.test.ts`) and the patch logic below.
 * Live verification may require setting pi-tool-display's `mcpOutputMode` to a
 * non-hidden value, or waiting until S8 when pi-tool-display is retired.
 * The patch is always render-safe: any throw degrades to native output.
 */
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	patchPrototypeMethod,
	safeRenderWrapper,
	type PatchHandle,
} from "../packages/visual-hierarchy/index.ts";
import { clampLineWidths } from "../packages/visual-hierarchy/transforms.ts";
import { formatMcpCall, formatMcpResult, RENDER_DEFAULTS } from "../packages/render-core/index.ts";
import type { RenderCtx, WidthOps } from "../packages/render-core/width.ts";
import { captureTheme, releaseTheme, currentRenderStyler } from "../packages/visual-hierarchy/theme-capture.ts";

/**
 * Stable Symbol slot for the idempotent prototype patch.
 * A second install with the same Symbol is detected by `patchPrototypeMethod`
 * and silently skipped — the original is not double-wrapped.
 */
const MCP_RENDER_SYMBOL = Symbol("mcp-render-patch");

/**
 * Minimal subset of a `ToolExecutionComponent` instance that the transform reads.
 *
 * PROBE result (S2-T01): all fields are plain JS class property declarations in
 * the ToolExecutionComponent constructor body — not WeakMap-hidden. Verified by
 * reading the compiled dist at:
 * `node_modules/.pnpm/@earendil-works+pi-coding-agent@0.79.10_.../dist/modes/
 *  interactive/components/tool-execution.js`
 *
 * Readable fields:
 * - `toolName: string` — the tool name (e.g. `mcp__engram__mem_save`)
 * - `expanded: boolean` — ctrl+o expansion state, default `false`
 * - `result: { content?: unknown[] } | undefined` — set by `updateResult()`;
 *    text extracted from `content` items where `type === "text"`
 * - `args: unknown` — current tool call arguments
 */
interface McpComponentShape {
	toolName: string;
	expanded: boolean;
	result: { content?: unknown[] } | undefined;
	args: unknown;
}

/** Joins text-type content blocks from an `AgentToolResult.content` array. */
function extractResultText(result: { content?: unknown[] } | undefined): string | undefined {
	if (!result?.content) return undefined;

	const parts: string[] = [];
	for (const item of result.content) {
		if (
			item !== null &&
			typeof item === "object" &&
			(item as Record<string, unknown>).type === "text" &&
			typeof (item as Record<string, unknown>).text === "string"
		) {
			parts.push((item as { text: string }).text);
		}
	}

	return parts.length > 0 ? parts.join("\n") : undefined;
}

/** pi-tui WidthOps implementation threaded into the `RenderCtx`. */
const PI_TUI_WIDTH: WidthOps = { visibleWidth, truncateToWidth };

function makeRenderCtx(width: number): RenderCtx {
	return { styler: currentRenderStyler(), width: PI_TUI_WIDTH, maxWidth: width, config: RENDER_DEFAULTS };
}

/**
 * Set of MCP tool names active in the current session.
 * Populated by scanning `pi.getAllTools()` for names with the `mcp__` prefix.
 * Cleared on session shutdown. Re-scanned (union) at both `session_start` and
 * `before_agent_start` to catch servers that connect asynchronously.
 */
const mcpToolNames = new Set<string>();

function scanMcpTools(pi: ExtensionAPI): void {
	for (const tool of pi.getAllTools()) {
		if (tool.name.startsWith("mcp__")) {
			mcpToolNames.add(tool.name);
		}
	}
}

/**
 * One prototype-patch handle, reset per session. Restored at `session_shutdown`
 * and on `/reload` (which fires `session_shutdown` before `session_start`).
 * `patchPrototypeMethod` is idempotent under the same Symbol slot, so reinstalling
 * after a restore on a new `session_start` is safe.
 */
let patchHandle: PatchHandle | undefined;

function installPatch(): void {
	if (patchHandle?.installed) return;

	patchHandle = patchPrototypeMethod(
		ToolExecutionComponent,
		"render",
		MCP_RENDER_SYMBOL,
		safeRenderWrapper((baseline, self, width) => {
			const comp = self as Partial<McpComponentShape>;

			if (typeof comp.toolName !== "string") return baseline;
			if (!mcpToolNames.has(comp.toolName)) return baseline;

			if (comp.expanded === true) return baseline;

			const ctx = makeRenderCtx(width);

			let lines: string[];
			if (comp.result !== undefined) {
				const text = extractResultText(comp.result);
				lines = formatMcpResult(comp.toolName, text, false, ctx);
			} else {
				lines = formatMcpCall(comp.toolName, comp.args, ctx);
			}

			return clampLineWidths(lines, width);
		}),
	);
}

export default function mcpRenderer(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		captureTheme(ctx.ui.theme);
		mcpToolNames.clear();
		scanMcpTools(pi);
		installPatch();
	});

	pi.on("before_agent_start", () => {
		scanMcpTools(pi);
	});

	pi.on("session_shutdown", () => {
		patchHandle?.restore();
		patchHandle = undefined;
		mcpToolNames.clear();
		releaseTheme();
	});
}
