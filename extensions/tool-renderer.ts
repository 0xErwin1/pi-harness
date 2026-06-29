/**
 * Global main-thread rich tool renderer.
 *
 * This extension re-skins Pi's BUILT-IN coding tools (read, bash, edit, write,
 * grep, find, ls) in the MAIN interactive thread so each call reads as
 * `<Verb> <args> · <summary>` (and an inline diff for edits), matching the
 * subagent conversation viewer's style.
 *
 * WHY override the built-ins: there is no hook to restyle a tool you do not own,
 * so for each built-in we obtain its original `ToolDefinition` from the SDK
 * factory and re-register it under the SAME name with ONLY `renderShell`,
 * `renderCall`, and `renderResult` replaced. The original `name`, `description`,
 * `parameters`, and — crucially — `execute` are spread through untouched, so
 * tool BEHAVIOR is 100% preserved: we delegate execution to the original and
 * change rendering only. Pi's extension registry overrides tools by name, and
 * `renderShell: "self"` suppresses Pi's default colored shell so our line is the
 * whole row.
 *
 * GLOBAL-IMPACT SAFETY: this affects every interactive Pi session (the harness
 * is globally linked). Rendering is therefore best-effort — every render path is
 * wrapped so a formatting bug degrades to a minimal `<verb> <args>` line and can
 * NEVER throw out of a renderer and break tool execution. To disable the feature
 * entirely, remove this file from `extensions/` (it is auto-discovered there) or
 * drop it from the `"pi".extensions` entry in `package.json`.
 */
import { type Component, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type {
	AgentToolResult,
	ExtensionAPI,
	Theme,
	ToolDefinition,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import {
	diffBlockLines,
	formatToolArgs,
	outputBlockLines,
	summarizeToolResult,
	type DiffLineKind,
	type ToolSummaryStatus,
} from "../packages/subagent-manager-pi/tool-format/index.ts";
import {
	imageAutoResize,
	readPiSettings,
	shellCommandPrefix,
	type PiSettingsReader,
} from "../packages/subagent-manager-pi/pi-settings.ts";

/** Subset of the extension API this module needs; the real `pi` satisfies it. */
export type ToolRegistrar = Pick<ExtensionAPI, "registerTool">;

/** Semantic colours the styled tool lines use; all are valid theme colours. */
export type ToolLineColor = "accent" | "success" | "error" | "dim" | "muted";

/**
 * Styling surface the pure line builders delegate to so they stay theme-agnostic
 * and headlessly testable: `fg` applies a semantic colour, `bold` weights text.
 * The renderer wires these to its theme; tests pass deterministic doubles.
 */
export interface ToolLineStyler {
	fg(color: ToolLineColor, text: string): string;
	bold(text: string): string;
}

const TOOL_VERBS: Record<string, string> = {
	read: "Read",
	bash: "Bash",
	edit: "Edit",
	write: "Write",
	grep: "Grep",
	find: "Find",
	ls: "Ls",
};

/** Capitalizes the tool name to its display verb (`read` → `Read`). */
export function toolVerb(toolName: string): string {
	const known = TOOL_VERBS[toolName.toLowerCase()];
	if (known) return known;

	const lower = toolName.toLowerCase();
	return lower.length === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
}

function statusColor(status: ToolSummaryStatus): ToolLineColor {
	switch (status) {
		case "ok":
			return "success";
		case "error":
			return "error";
		default:
			return "dim";
	}
}

function diffColor(kind: DiffLineKind): ToolLineColor {
	switch (kind) {
		case "add":
			return "success";
		case "del":
			return "error";
		default:
			return "dim";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Minimal shape of a tool result the line builders read. */
interface ToolResultShape {
	content?: unknown;
	details?: unknown;
}

/** Joins the text parts of an `AgentToolResult.content` array, ignoring non-text parts. */
function resultText(result: ToolResultShape): string | undefined {
	const content = result.content;
	if (!Array.isArray(content)) return undefined;

	const parts: string[] = [];
	for (const item of content) {
		if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
			parts.push(item.text);
		}
	}
	return parts.length > 0 ? parts.join("\n") : undefined;
}

function editDiff(details: unknown): string | undefined {
	if (!isRecord(details)) return undefined;
	return typeof details.diff === "string" ? details.diff : undefined;
}

/** Builds the pending/streaming call line: `<Verb> <args>` (verb bold, args accent). */
export function buildToolCallLine(toolName: string, args: unknown, styler: ToolLineStyler): string {
	const verb = toolVerb(toolName);
	const display = formatToolArgs(toolName, args);
	if (display.length === 0) return styler.bold(verb);
	return `${styler.bold(verb)} ${styler.fg("accent", display)}`;
}

/**
 * Builds the coloured diff block for an edit result: additions success, deletions
 * error, hunk/context/continuation dim. Capped at 20 lines when collapsed; the
 * full diff is shown when expanded. Non-edit details (no diff) yield no lines.
 */
export function buildToolDiffLines(details: unknown, expanded: boolean, styler: ToolLineStyler): string[] {
	const diff = editDiff(details);
	if (diff === undefined) return [];

	const cap = expanded ? Number.MAX_SAFE_INTEGER : undefined;
	return diffBlockLines(diff, cap).map((line) => styler.fg(diffColor(line.kind), line.text));
}

/** Strips ANSI escape sequences and C0 control characters (except tab) from one line. */
function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0a-\x1f\x7f]/g, "");
}

/**
 * Builds the muted output block for a bash result: the lines the command actually
 * printed, sanitized of ANSI/control bytes and dimmed. Capped at 20 lines when
 * collapsed; the full output is shown when expanded. The `exit code: N` trailer is
 * dropped by `outputBlockLines` since the summary already carries it.
 */
export function buildToolOutputLines(resultText: string | undefined, expanded: boolean, styler: ToolLineStyler): string[] {
	const cap = expanded ? Number.MAX_SAFE_INTEGER : undefined;
	return outputBlockLines(resultText, cap).map((line) => styler.fg("dim", stripAnsi(line)));
}

/**
 * Builds the result row: the `<Verb> <args> · <summary>` line plus a body block —
 * the diff for edits, the printed output for bash — beneath it. The summary colour
 * follows the tool status (bash exit 0 success / nonzero error, others neutral/dim);
 * `isError` forces error and supplies a bare `error` summary when the tool produced
 * none. May throw if the styler throws — callers use `safeBuildToolResultLines` for
 * the guarded variant.
 */
export function buildToolResultLines(
	toolName: string,
	args: unknown,
	result: ToolResultShape,
	isError: boolean,
	expanded: boolean,
	styler: ToolLineStyler,
): string[] {
	const verb = toolVerb(toolName);
	const display = formatToolArgs(toolName, args);
	const summary = summarizeToolResult(toolName, args, resultText(result), result.details);

	let summaryText = summary.text;
	let status = summary.status;
	if (isError) {
		status = "error";
		if (summaryText.length === 0) summaryText = "error";
	}

	let line = styler.bold(verb);
	if (display.length > 0) line += ` ${styler.fg("muted", display)}`;
	if (summaryText.length > 0) line += ` · ${styler.fg(statusColor(status), summaryText)}`;

	const lines = [line];
	const tool = toolName.toLowerCase();
	if (tool === "edit") {
		lines.push(...buildToolDiffLines(result.details, expanded, styler));
	} else if (tool === "bash") {
		lines.push(...buildToolOutputLines(resultText(result), expanded, styler));
	}
	return lines;
}

/**
 * Defensive wrapper around `buildToolResultLines`: if anything in formatting or
 * styling throws, it degrades to a single minimal `<verb> <args>` plain line
 * (no styler involved) so a render bug can never propagate out of a renderer and
 * break tool execution globally.
 */
export function safeBuildToolResultLines(
	toolName: string,
	args: unknown,
	result: ToolResultShape,
	isError: boolean,
	expanded: boolean,
	styler: ToolLineStyler,
): string[] {
	try {
		return buildToolResultLines(toolName, args, result, isError, expanded, styler);
	} catch {
		return [minimalLine(toolName, args)];
	}
}

/** Plain, unstyled `<Verb> <args>` fallback used when styled rendering fails. */
function minimalLine(toolName: string, args: unknown): string {
	const verb = toolVerb(toolName);
	let display = "";
	try {
		display = formatToolArgs(toolName, args);
	} catch {
		display = "";
	}
	return display.length > 0 ? `${verb} ${display}` : verb;
}

function themeStyler(theme: Theme): ToolLineStyler {
	return {
		fg: (color, text) => theme.fg(color, text),
		bold: (text) => theme.bold(text),
	};
}

/**
 * Builds a DEFERRED render component that word-wraps its styled lines to the real
 * draw width.
 *
 * The draw width is only known at draw time (`render(width)`), so both the line
 * building and the wrapping are postponed to then: each styled line is wrapped with
 * `wrapTextWithAnsi`, which word-wraps while preserving the ANSI colour across the
 * breaks, so long calls/results flow onto continuation lines instead of being chopped
 * with an ellipsis. A non-positive width degrades to the unwrapped lines.
 *
 * DEFENSIVE: this renderer is installed globally over Pi's built-ins, so a formatting
 * bug must never escape and break tool execution. If building or wrapping throws, it
 * falls back to a minimal `<verb> <args>` line (wrapped when a width is available,
 * plain otherwise).
 */
function deferredWrappedLines(buildLines: () => string[], fallback: () => string): Component {
	const wrap = (line: string, width: number): string[] => {
		if (width <= 0) return [line];
		return wrapTextWithAnsi(line, width);
	};

	return {
		invalidate(): void {},
		render(width: number): string[] {
			try {
				return buildLines().flatMap((line) => wrap(line, width));
			} catch {
				const line = fallback();
				try {
					return wrap(line, width);
				} catch {
					return [line];
				}
			}
		},
	};
}

/**
 * Registers one tool override: spreads the original definition (preserving name,
 * description, parameters, and `execute`) and replaces only `renderShell`,
 * `renderCall`, and `renderResult`. Generic over the tool's own param/details/
 * state types so each built-in keeps full typing with no `any`.
 */
export function overrideToolRendering<TParams extends TSchema, TDetails, TState>(
	pi: ToolRegistrar,
	definition: ToolDefinition<TParams, TDetails, TState>,
): void {
	const toolName = definition.name;

	pi.registerTool<TParams, TDetails, TState>({
		...definition,
		renderShell: "self",
		renderCall: (args, theme) =>
			deferredWrappedLines(
				() => [buildToolCallLine(toolName, args, themeStyler(theme))],
				() => minimalLine(toolName, args),
			),
		renderResult: (result: AgentToolResult<TDetails>, options: ToolRenderResultOptions, theme, context) =>
			deferredWrappedLines(
				() =>
					safeBuildToolResultLines(
						toolName,
						context.args,
						result,
						context.isError,
						options.expanded,
						themeStyler(theme),
					),
				() => minimalLine(toolName, context.args),
			),
	});
}

/**
 * The seven SDK tool-definition factories, bundled so they can be injected for
 * deterministic testing. Defaults to the real `@earendil-works/pi-coding-agent`
 * factories.
 */
export interface ToolDefinitionFactories {
	read: typeof createReadToolDefinition;
	bash: typeof createBashToolDefinition;
	edit: typeof createEditToolDefinition;
	write: typeof createWriteToolDefinition;
	grep: typeof createGrepToolDefinition;
	find: typeof createFindToolDefinition;
	ls: typeof createLsToolDefinition;
}

const DEFAULT_FACTORIES: ToolDefinitionFactories = {
	read: createReadToolDefinition,
	bash: createBashToolDefinition,
	edit: createEditToolDefinition,
	write: createWriteToolDefinition,
	grep: createGrepToolDefinition,
	find: createFindToolDefinition,
	ls: createLsToolDefinition,
};

export interface RegisterToolRendererOptions {
	/** Session working directory the factories bind for relative-path resolution. */
	cwd: string;
	/** Tool-definition factories; defaults to the real SDK factories. */
	factories?: ToolDefinitionFactories;
	/** Settings provider; defaults to reading Pi's `~/.pi/agent/settings.json`. */
	readSettings?: PiSettingsReader;
}

/**
 * Re-registers all seven built-in coding tools with the rich renderer.
 *
 * Because this override REPLACES Pi's built-ins by name in every interactive
 * session, it must reproduce Pi's CONFIGURED execution semantics exactly — only
 * rendering may differ. Pi builds its built-ins with the session cwd and a small
 * set of settings-derived options (`createAllToolDefinitions(cwd, { read:
 * { autoResizeImages }, bash:{ commandPrefix } })`). We therefore thread the
 * session `cwd` and reconstruct those same options from settings; dropping them
 * would silently change execution (for example bypassing a configured shell
 * command prefix that wraps every command). Only `read` and `bash` take
 * configured options in Pi; the other five are created with cwd only.
 *
 * Reading settings is defensive: a missing, unreadable, or throwing provider
 * degrades to no command prefix and the default auto-resize, and never throws at
 * registration. Execution is delegated to the freshly-created (now correctly
 * configured) original definition, so tool BEHAVIOR matches Pi's built-in.
 */
export function registerToolRenderer(pi: ToolRegistrar, options: RegisterToolRendererOptions): void {
	const { cwd } = options;
	const factories = options.factories ?? DEFAULT_FACTORIES;
	const settings = safeReadSettings(options.readSettings ?? readPiSettings);

	const prefix = shellCommandPrefix(settings);
	const bashOptions = prefix === undefined ? undefined : { commandPrefix: prefix };
	const readOptions = { autoResizeImages: imageAutoResize(settings) };

	overrideToolRendering(pi, factories.read(cwd, readOptions));
	overrideToolRendering(pi, factories.bash(cwd, bashOptions));
	overrideToolRendering(pi, factories.edit(cwd));
	overrideToolRendering(pi, factories.write(cwd));
	overrideToolRendering(pi, factories.grep(cwd));
	overrideToolRendering(pi, factories.find(cwd));
	overrideToolRendering(pi, factories.ls(cwd));
}

/** Reads settings via the provider, degrading any failure to empty defaults. */
function safeReadSettings(read: PiSettingsReader): Record<string, unknown> {
	try {
		return read();
	} catch {
		return {};
	}
}

/**
 * Extension entry point: auto-discovered from `extensions/` and invoked by Pi.
 *
 * The entry receives only the `ExtensionAPI`, which exposes neither the session
 * cwd nor settings. Both are available on the `ExtensionContext` passed to
 * handlers, so registration is deferred to `session_start`: that event is awaited
 * before the session proceeds, and `registerTool` refreshes the tool registry,
 * so the override is in place for the first turn. Registering per cwd keeps each
 * session bound to its own working directory and re-reads settings on reload.
 */
export default function toolRenderer(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		registerToolRenderer(pi, { cwd: ctx.cwd });
	});
}
