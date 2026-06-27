import { type Component, Container, Text, TruncatedText } from "@mariozechner/pi-tui";
import type { AgentToolResult, Theme, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import type { RunStatus } from "../../subagent-manager-core/events.ts";
import {
	buildExpandedBodyLines,
	buildSubagentRowModel,
	type SubagentRowAccess,
	type SubagentRowModel,
} from "./subagent-row-model.ts";
import { transcriptLineColor } from "./conversation-viewer-model.ts";

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

const SPINNER_FRAMES = ["-", "\\", "|", "/"];

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
 * resolved counts. The status glyph and colouring are applied by the component;
 * this stays pure so it is headlessly assertable.
 */
export function buildCollapsedLine(
	model: SubagentRowModel,
	counts: { turns: number; tools: number },
): string {
	const parts: string[] = [];

	if (model.agent) parts.push(model.agent);
	if (model.activity) parts.push(model.activity);
	parts.push(formatElapsed(model.elapsedMs));
	parts.push(`${counts.turns}t/${counts.tools} tools`);
	if (model.lastLine) parts.push(model.lastLine);

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

		return renderCollapsed(model, counts, options.isPartial, theme);
	};
}

function renderCollapsed(
	model: SubagentRowModel,
	counts: { turns: number; tools: number },
	isPartial: boolean,
	theme: Theme,
): Component {
	const glyph = isPartial && model.status === "running"
		? SPINNER_FRAMES[Math.floor(Date.now() / 80) % SPINNER_FRAMES.length]
		: statusGlyph(model.status);

	const icon = theme.fg(statusColor(model.status), glyph);
	const body = buildCollapsedLine(model, counts);

	return new TruncatedText(`${icon} ${theme.fg("text", body)}`);
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
 * Maps one transcript line to a component using the shared semantic colouring:
 * assistant headers, tool activity, and status transitions each get a distinct
 * colour, while free-flowing text keeps the default colour and wraps naturally.
 * Sharing `transcriptLineColor` keeps the expanded row and the overlay viewer
 * visually consistent.
 */
function renderExpandedLine(line: string, theme: Theme): Component {
	if (line.length === 0) return new Text("");

	const color = transcriptLineColor(line);
	if (color === "text") return new Text(line);

	return new TruncatedText(theme.fg(color, line));
}
