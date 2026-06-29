/**
 * MCP tool call/result summary formatter.
 *
 * When an MCP tool is in the COLLAPSED state (default), renders a single
 * `<server> · <tool>` summary line so the output stays minimal. When EXPANDED
 * (ctrl+o), the caller falls through to the original render by receiving an
 * empty array from `formatMcpResult`.
 *
 * Both functions route output through `LineBuffer` for structural width-clamping.
 * They are pure (no SDK imports) and theme-agnostic: colour comes from the
 * injected `RenderStyler`.
 */

import { LineBuffer, type RenderCtx } from "../width.ts";

/**
 * Splits an MCP tool name (`mcp__<server>__<tool>`) into its server and tool
 * segments. Returns `undefined` when the name does not follow the convention.
 */
function parseMcpName(name: string): { server: string; tool: string } | undefined {
	const parts = name.split("__");
	if (parts.length < 3 || parts[0] !== "mcp") return undefined;

	const server = parts[1] ?? "";
	const tool = parts.slice(2).join("__");

	if (server.length === 0 || tool.length === 0) return undefined;
	return { server, tool };
}

function summaryLine(name: string, ctx: RenderCtx): string {
	const parsed = parseMcpName(name);
	if (parsed === undefined) {
		return ctx.styler.fg("muted", name);
	}

	const serverPart = ctx.styler.fg("muted", parsed.server);
	const sep = ctx.styler.fg("dim", " · ");
	const toolPart = ctx.styler.fg("muted", parsed.tool);
	return serverPart + sep + toolPart;
}

/**
 * Formats an in-flight MCP tool call to a one-line `<server> · <tool>` summary.
 *
 * Used during the call phase (before a result is available). Width-clamped via
 * `LineBuffer`. The `args` parameter is accepted but intentionally unused: the
 * summary focuses on what was called rather than the full argument payload.
 */
export function formatMcpCall(name: string, _args: unknown, ctx: RenderCtx): string[] {
	const lb = new LineBuffer(ctx);
	lb.push(summaryLine(name, ctx));
	return lb.done();
}

/**
 * Formats a completed MCP tool result.
 *
 * - When `expanded` is `false` (collapsed): returns a single `<server> · <tool>`
 *   summary line. The full result output is hidden until the user expands with
 *   ctrl+o.
 * - When `expanded` is `true`: returns an empty array, signalling to the caller
 *   that it should fall through to the original native render (full detail).
 *
 * The `resultText` parameter is accepted but the collapsed summary deliberately
 * omits its content: the intent is to show "just that the tool was called",
 * per `RENDER_DEFAULTS.mcpOutput: "summary"` policy.
 */
export function formatMcpResult(
	name: string,
	_resultText: string | undefined,
	expanded: boolean,
	ctx: RenderCtx,
): string[] {
	if (expanded) return [];

	const lb = new LineBuffer(ctx);
	lb.push(summaryLine(name, ctx));
	return lb.done();
}
