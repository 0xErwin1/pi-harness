import { type Component, Container, Text, TruncatedText } from "@mariozechner/pi-tui";
import type { AgentToolResult, Theme, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import type { RunStatus } from "../../subagent-manager-core/events.ts";
import {
	buildExpandedBodyLines,
	buildPerAgentRowModels,
	buildSubagentRowModel,
	type SubagentRowAccess,
	type SubagentRowModel,
} from "./subagent-row-model.ts";
import {
	formatModelEffort,
	formatTokens,
	styleDiffLine,
	styleToolLine,
	type TranscriptStyler,
	transcriptLineColor,
} from "./conversation-viewer-model.ts";
import { getIcons } from "../icons/config.ts";

/**
 * Live state threaded through the tool result `details` by the harness `execute`
 * wiring (WU-U2). `runIds` lets the renderer pull live snapshots/messages from the
 * shared runtime; `turns`/`tools` are optional pre-counted values that take
 * precedence over the values derived from the runtime accessor.
 */
export interface SubagentResultDetails {
	runIds?: string[];
	turns?: number;
	tools?: number;
}

/** Minimal render context surface: only the working directory is needed to resolve the runtime. */
export interface SubagentRenderContext {
	cwd: string;
}

/** Resolves the live row accessor for a tool execution's working directory. */
export type RuntimeAccessor = (cwd: string) => SubagentRowAccess;

const ICON_RUNNING = ">";
const ICON_DONE = "+";
const ICON_FAILED = "x";
const ICON_INTERRUPTED = "/";
const ICON_ATTENTION = "!";
const ICON_QUEUED = "-";

const SPINNER_TICK_MS = 80;

/**
 * Selects the active spinner frame from the icon registry by wall-clock time
 * (`% spinner.length`). Pure over the injected spinner array and clock so it is
 * deterministic and headlessly testable; the glyphs honor the active icon mode.
 */
export function collapsedSpinnerFrame(spinner: readonly string[], now: number): string {
	return spinner[Math.floor(now / SPINNER_TICK_MS) % spinner.length];
}

function statusGlyph(status: RunStatus): string {
	switch (status) {
		case "running":
			return ICON_RUNNING;
		case "completed":
			return ICON_DONE;
		case "failed":
			return ICON_FAILED;
		case "interrupted":
			return ICON_INTERRUPTED;
		case "needs-attention":
			return ICON_ATTENTION;
		default:
			return ICON_QUEUED;
	}
}

function statusColor(status: RunStatus): Parameters<Theme["fg"]>[0] {
	switch (status) {
		case "running":
			return "accent";
		case "completed":
			return "success";
		case "failed":
			return "error";
		case "interrupted":
		case "needs-attention":
			return "warning";
		default:
			return "dim";
	}
}

function formatElapsed(ms: number): string {
	if (ms < 1000) return `${Math.max(0, ms)}ms`;
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m${seconds % 60}s`;
}

/**
 * Resolves the turn/tool counts to display, preferring the pre-counted values
 * threaded through `details` (authoritative, captured at execute time) and
 * falling back to the values the row model derived from the live runtime.
 */
export function resolveRowCounts(
	details: SubagentResultDetails | undefined,
	model: SubagentRowModel,
): { turns: number; tools: number } {
	const turns = typeof details?.turns === "number" ? details.turns : model.turns;
	const tools = typeof details?.tools === "number" ? details.tools : model.tools;
	return { turns, tools };
}

/**
 * Composes the collapsed single-line row text (no ANSI) from the row model and
 * resolved counts. Shape: `<model> · thinking: <level> · <agent> · <status> ·
 * <elapsed> · <tokens> tok · <N> tools · <current activity>`. The leading
 * model/effort segment is omitted when unknown; the render layer dims it. Turns
 * are intentionally dropped (they read ~0 during tool use and confuse); tokens and
 * a concise current-activity phrase replace the old turns count and thinking dump.
 * The status glyph and colouring are applied by the component; this stays pure so
 * it is headlessly assertable.
 */
export function buildCollapsedLine(
	model: SubagentRowModel,
	counts: { turns: number; tools: number },
): string {
	const parts: string[] = [];

	const modelEffort = formatModelEffort(model.model, model.thinking);
	if (modelEffort) parts.push(modelEffort);
	if (model.agent) parts.push(model.agent);
	parts.push(model.status);
	parts.push(formatElapsed(model.elapsedMs));
	parts.push(`${formatTokens(model.tokens)} tok`);
	parts.push(`${counts.tools} tools`);
	if (model.currentActivity) parts.push(model.currentActivity);

	return parts.join(" · ");
}

function runIdsOf(details: SubagentResultDetails | undefined): string[] {
	return Array.isArray(details?.runIds) ? details.runIds : [];
}

/**
 * Renders the compact tool-call placeholder shown before the run produces output.
 * Replaces the bare "Working…" with the agent label being launched.
 */
export function renderSubagentCall(
	args: { agent?: string; subagent_type?: string; description?: string },
	theme: Theme,
	_context: SubagentRenderContext,
): Component {
	const label = args.agent ?? args.subagent_type ?? "subagent";
	const line = `${theme.fg("accent", statusGlyph("queued"))} ${theme.fg("muted", `launching ${label}…`)}`;
	return new TruncatedText(line);
}

/**
 * Factory for the tool-result renderer. Closes over the runtime accessor so the
 * row reads the SAME live store the execution writes. Honors the native Ctrl-O
 * `expanded` flag (no chord is registered): collapsed shows a single status line,
 * expanded shows the full accumulated transcript per run.
 */
export function renderSubagentResult(getRuntime: RuntimeAccessor) {
	return (
		result: AgentToolResult<SubagentResultDetails>,
		options: ToolRenderResultOptions,
		theme: Theme,
		context: SubagentRenderContext,
	): Component => {
		const access = getRuntime(context.cwd);
		const runIds = runIdsOf(result.details);
		const now = Date.now();
		const model = buildSubagentRowModel(access, runIds, now);
		const counts = resolveRowCounts(result.details, model);

		if (options.expanded) {
			return renderExpanded(access, runIds, model, theme);
		}

		if (runIds.length > 1) {
			return renderCollapsedPerAgent(access, runIds, now, options.isPartial, theme);
		}

		return renderCollapsed(model, counts, options.isPartial, theme);
	};
}

/**
 * Renders a parallel tool call (more than one run) as one collapsed line per
 * agent, each showing that run's own status, elapsed time, tokens, tool count,
 * and current activity. Lets the user see each parallel agent's progress at a
 * glance instead of a single aggregate line.
 */
function renderCollapsedPerAgent(
	access: SubagentRowAccess,
	runIds: string[],
	now: number,
	isPartial: boolean,
	theme: Theme,
): Component {
	const container = new Container();

	for (const model of buildPerAgentRowModels(access, runIds, now)) {
		const counts = { turns: model.turns, tools: model.tools };
		container.addChild(renderCollapsed(model, counts, isPartial, theme));
	}

	return container;
}

function renderCollapsed(
	model: SubagentRowModel,
	counts: { turns: number; tools: number },
	isPartial: boolean,
	theme: Theme,
): Component {
	const glyph = isPartial && (model.status === "running" || model.status === "starting")
		? collapsedSpinnerFrame(getIcons().spinner, Date.now())
		: statusGlyph(model.status);

	const icon = theme.fg(statusColor(model.status), glyph);
	const body = buildCollapsedLine(model, counts);

	const modelEffort = formatModelEffort(model.model, model.thinking);
	const coloredBody =
		modelEffort && body.startsWith(modelEffort)
			? theme.fg("dim", modelEffort) + theme.fg("text", body.slice(modelEffort.length))
			: theme.fg("text", body);

	return new TruncatedText(`${icon} ${coloredBody}`);
}

function renderExpanded(
	access: SubagentRowAccess,
	runIds: string[],
	model: SubagentRowModel,
	theme: Theme,
): Component {
	const container = new Container();

	const icon = theme.fg(statusColor(model.status), statusGlyph(model.status));
	const header = `${icon} ${theme.bold(model.agent || "subagent")} ${theme.fg("dim", "·")} ${theme.fg("dim", `${model.status} · ${formatElapsed(model.elapsedMs)}`)}`;
	container.addChild(new TruncatedText(header));

	const bodyLines = buildExpandedBodyLines(access, runIds, 0);

	if (bodyLines.length === 0) {
		container.addChild(new Text(""));
		container.addChild(new TruncatedText(theme.fg("dim", "(no activity yet)")));
		return container;
	}

	container.addChild(new Text(""));
	for (const line of bodyLines) {
		container.addChild(renderExpandedLine(line, theme));
	}

	return container;
}

/**
 * Maps one transcript line to a component using the shared colouring: tool lines
 * get the bold-verb / accent-args / status-coloured-summary treatment via
 * `styleToolLine`, diff lines colour by their `+`/`-` change kind via
 * `styleDiffLine`, assistant headers and status transitions take a single semantic
 * colour, and free-flowing text keeps the default colour and wraps naturally.
 * Sharing the model helpers keeps the expanded row and the overlay viewer visually
 * consistent.
 */
function renderExpandedLine(line: string, theme: Theme): Component {
	if (line.length === 0) return new Text("");

	const styler: TranscriptStyler = {
		fg: (color, text) => theme.fg(color, text),
		bold: (text) => theme.bold(text),
	};

	const styledTool = styleToolLine(line, styler);
	if (styledTool !== undefined) return new TruncatedText(styledTool);

	const styledDiff = styleDiffLine(line, styler);
	if (styledDiff !== undefined) return new TruncatedText(styledDiff);

	const color = transcriptLineColor(line);
	if (color === "text") return new Text(line);

	return new TruncatedText(theme.fg(color, line));
}
