/**
 * Pi harness extension.
 *
 * Neutralized core extension for the pi-harness repo. It does two things:
 *
 *   1. Injects the orchestrator contract (from `assets/orchestrator.md`) as an
 *      addition to the system prompt on every agent start.
 *   2. Provides a per-agent model assignment TUI plus a status command.
 *
 * Persona layering, branding, bash safety guards, and SDD asset auto-install
 * from the upstream gentle-pi package are intentionally NOT ported here:
 *   - Bash guards live in `shell-guard.ts`.
 *   - SDD assets are delivered by per-file symlink via `scripts/link.sh`.
 */
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { enterOverlay, exitOverlay } from "../packages/shared/overlay-gate.ts";
import {
	builtinAgentDirectories,
	createManagerCommandSurface,
	readSubagentManagerConfig,
	registerTodoTool,
	registerTodosCommand,
	registerTwoColumnWidget,
	replayFromBranch,
	renderSubagentCall,
	renderSubagentResult,
	selectMostRecentRunId,
	showConversationViewer,
	TOOL_NAME as TODO_TOOL_NAME,
	translateSubagentPayload,
	type CompatPayload,
	type SubagentResultDetails,
	type TwoColumnWidgetHandle,
} from "../packages/subagent-manager-pi/index.ts";
import {
	ManagerRuntime,
	TOOL_PROGRESS_PREFIX,
	InMemoryRunStore,
	agentIdFor,
	attachFileSink,
	createSubprocessProvider,
	currentDepth,
	isTopLevelProcess,
	jsonlPath,
	maxDepth,
	removeSessionRoot,
	sessionRoot,
	sweepStaleSessions,
	type AgentSpec,
	type RunResult,
} from "../packages/subagent-manager-core/index.ts";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ASSETS_DIR = join(PACKAGE_ROOT, "assets");
const ORCHESTRATOR_PROMPT_PATH = join(ASSETS_DIR, "orchestrator.md");

/**
 * Reads the orchestrator contract from `assets/orchestrator.md` at runtime.
 *
 * The asset may be absent (it can be created by a separate process), so a
 * missing file degrades gracefully to `undefined` rather than throwing. Any
 * other read failure is also treated as "no contract available" so a transient
 * filesystem error never crashes agent startup.
 */
function readOrchestratorPrompt(): string | undefined {
	if (!existsSync(ORCHESTRATOR_PROMPT_PATH)) return undefined;

	try {
		const content = readFileSync(ORCHESTRATOR_PROMPT_PATH, "utf8").trim();
		return content.length > 0 ? content : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Whether this process is the orchestrator root rather than a spawned subagent.
 *
 * The orchestrator contract must only shape the root session. A subagent runs at
 * depth > 0 and is a phase EXECUTOR: it follows its own role prompt (its skill)
 * and must NOT receive the coordinator contract, otherwise it re-delegates its
 * own phase to another subagent of the same type (e.g. an `sdd-spec` subagent
 * spawning another `sdd-spec`).
 */
export function isOrchestratorRoot(): boolean {
	return currentDepth() === 0;
}

/**
 * Wraps `ui.custom` so EVERY overlay opened through pi's shared custom-overlay API
 * — including overlays opened by OTHER extensions (e.g. the ask-user-question
 * package) — brackets its lifetime with the shared overlay gate. pi dispatches
 * extension `onTerminalInput` listeners BEFORE the focused overlay, so the global
 * fleet key-router (right-arrow → open agents) otherwise consumes keys meant for an
 * external overlay (e.g. advancing a multi-step question) instead of letting that
 * overlay handle them. Only the harness's own overlays previously registered with
 * the gate; this makes external ones participate without their cooperation.
 *
 * Idempotent (marked on the patched method) so it survives `/reload`. The host's
 * `custom<T>` is generic and the wrapper cannot preserve that generic, so the patch
 * is contained behind one local cast to a loose call signature.
 */
function bracketAllOverlays(ui: ExtensionContext["ui"]): void {
	const target = ui as unknown as {
		custom: (...args: unknown[]) => Promise<unknown>;
		__piHarnessOverlayGated?: boolean;
	};
	if (target.__piHarnessOverlayGated) return;

	const original = target.custom.bind(ui);
	target.custom = (...args: unknown[]): Promise<unknown> => {
		enterOverlay();
		try {
			return original(...args).finally(exitOverlay);
		} catch (error) {
			exitOverlay();
			throw error;
		}
	};
	target.__piHarnessOverlayGated = true;
}

const SDD_AGENT_NAMES = [
	"sdd-init",
	"sdd-explore",
	"sdd-propose",
	"sdd-spec",
	"sdd-design",
	"sdd-tasks",
	"sdd-apply",
	"sdd-verify",
	"sdd-archive",
] as const;

type SddAgentName = (typeof SDD_AGENT_NAMES)[number];
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

interface AgentRoutingEntry {
	model?: string;
	thinking?: ThinkingLevel;
}

export type AgentModelConfig = Record<string, AgentRoutingEntry>;
type AgentSource = "project" | "user" | "builtin";

interface AgentEntry {
	name: string;
	source: AgentSource;
	filePath?: string;
	description?: string;
}

const KEEP_CURRENT = "Keep current";
const INHERIT_MODEL = "Inherit active/default model";
const CUSTOM_MODEL = "Custom model id";
const INHERIT_THINKING = "Inherit effort";

const THINKING_OPTIONS: (ThinkingLevel | typeof INHERIT_THINKING)[] = [
	INHERIT_THINKING,
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
];

const MODEL_CONTROL_OPTIONS = [
	KEEP_CURRENT,
	INHERIT_MODEL,
	CUSTOM_MODEL,
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolves the harness model-config file. The config is GLOBAL: production callers
 * pass the user's home directory, so the file lives at `~/.pi/harness/models.json`
 * and the same per-agent model/thinking assignments apply across every project.
 * The base directory is a parameter (not hardcoded) so tests can redirect it to a
 * temp dir.
 */
function modelConfigPath(baseDir: string): string {
	return join(baseDir, ".pi", "harness", "models.json");
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return (
		value === "off" ||
		value === "minimal" ||
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "xhigh"
	);
}

/**
 * Normalizes an arbitrary JSON value into an `AgentRoutingEntry`.
 *
 * Accepts either a bare model-id string or an object with `model` / `thinking`
 * fields. Returns `undefined` when neither a usable model nor a valid thinking
 * level is present, so empty or malformed entries are dropped.
 */
function normalizeRoutingEntry(value: unknown): AgentRoutingEntry | undefined {
	if (typeof value === "string") {
		const model = value.trim();
		return model.length > 0 ? { model } : undefined;
	}

	if (!isRecord(value)) return undefined;

	const model =
		typeof value.model === "string" && value.model.trim().length > 0
			? value.model.trim()
			: undefined;
	const thinking = isThinkingLevel(value.thinking) ? value.thinking : undefined;

	if (!model && !thinking) return undefined;

	return { model, thinking };
}

export function readModelConfig(baseDir: string): AgentModelConfig {
	const path = modelConfigPath(baseDir);
	if (!existsSync(path)) return {};

	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed)) return {};

		const config: AgentModelConfig = {};
		for (const [name, value] of Object.entries(parsed)) {
			const entry = normalizeRoutingEntry(value);
			if (entry) config[name] = entry;
		}
		return config;
	} catch {
		return {};
	}
}

function writeModelConfig(baseDir: string, config: AgentModelConfig): void {
	const path = modelConfigPath(baseDir);
	mkdirSync(dirname(path), { recursive: true });

	const cleaned: AgentModelConfig = {};
	for (const [name, value] of Object.entries(config)) {
		const entry = normalizeRoutingEntry(value);
		if (entry) cleaned[name] = entry;
	}

	writeFileSync(path, `${JSON.stringify(cleaned, null, 2)}\n`);
}

function cloneModelConfig(config: AgentModelConfig): AgentModelConfig {
	return Object.fromEntries(
		Object.entries(config).map(([name, entry]) => [name, { ...entry }]),
	);
}

function parseAgentName(filePath: string): string | undefined {
	let content: string;
	try {
		content = readFileSync(filePath, "utf8");
	} catch {
		return undefined;
	}

	const name = content.match(/^name:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
	if (!name) return undefined;

	const packageName = content
		.match(/^package:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]
		?.trim();

	return packageName ? `${packageName}.${name}` : name;
}

export function parseAgentDescription(filePath: string): string | undefined {
	let content: string;
	try {
		content = readFileSync(filePath, "utf8");
	} catch {
		return undefined;
	}

	return content.match(/^description:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
}

function listAgentFilesRecursive(dir: string): string[] {
	if (!existsSync(dir)) return [];

	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...listAgentFilesRecursive(path));
		} else if (
			entry.isFile() &&
			entry.name.endsWith(".md") &&
			!entry.name.endsWith(".chain.md")
		) {
			files.push(path);
		}
	}
	return files;
}

function listAgentsFromDir(dir: string, source: AgentSource): AgentEntry[] {
	return listAgentFilesRecursive(dir)
		.map((filePath): AgentEntry | undefined => {
			const name = parseAgentName(filePath);
			if (!name) return undefined;
			const description = parseAgentDescription(filePath);
			return { name, source, filePath, description };
		})
		.filter((entry): entry is AgentEntry => entry !== undefined);
}

/**
 * Discovers all agents reachable from the current project: builtin package
 * agents, user-level agents, and project-level agents. Duplicate names are
 * deduplicated (last one wins), and the result is ordered with the known SDD
 * agents first, followed by the rest sorted alphabetically.
 */
function listDiscoverableAgents(cwd: string): AgentEntry[] {
	const builtinDirs = builtinAgentDirectories(cwd, PACKAGE_ROOT);

	const agents = [
		...builtinDirs.flatMap((dir) => listAgentsFromDir(dir, "builtin")),
		...listAgentsFromDir(join(homedir(), ".pi", "agent", "agents"), "user"),
		...listAgentsFromDir(join(homedir(), ".agents"), "user"),
		...listAgentsFromDir(join(cwd, ".agents"), "project"),
		...listAgentsFromDir(join(cwd, ".pi", "agents"), "project"),
	];

	const byName = new Map<string, AgentEntry>();
	for (const agent of agents) byName.set(agent.name, agent);
	const discovered = Array.from(byName.values());

	const sddFirst = SDD_AGENT_NAMES.map((name) =>
		discovered.find((agent) => agent.name === name),
	).filter((agent): agent is AgentEntry => agent !== undefined);

	const rest = discovered
		.filter((agent) => !SDD_AGENT_NAMES.includes(agent.name as SddAgentName))
		.sort((left, right) => left.name.localeCompare(right.name));

	return [...sddFirst, ...rest];
}

function describeModelConfig(cwd: string, config: AgentModelConfig): string[] {
	return listDiscoverableAgents(cwd).map((agent) => {
		const entry = config[agent.name];
		const model = entry?.model ?? "inherit";
		const thinking = entry?.thinking ?? "inherit";
		return `${agent.name}: model=${model}, effort=${thinking}`;
	});
}

async function getPiModelOptions(ctx: ExtensionContext): Promise<string[]> {
	const models = await ctx.modelRegistry.getAvailable();
	const modelIds = models
		.map((model) => `${model.provider}/${model.id}`)
		.sort((left, right) => left.localeCompare(right));
	return [...MODEL_CONTROL_OPTIONS, ...modelIds];
}

interface OverlayComponent {
	render(width: number): string[];
	handleInput(data: string): void;
	invalidate(): void;
}

export type ModelPanelResult =
	| { type: "save"; config: AgentModelConfig }
	| { type: "custom"; agent: string | "all"; config: AgentModelConfig }
	| { type: "cancel" };

const SET_ALL_AGENTS = "Set all agents";

/**
 * Overlay component for the per-agent model assignment TUI.
 *
 * It is a small three-mode state machine:
 *   - `agents`: the agent list, where each row can be navigated and edited.
 *   - `models`: a searchable model picker for the focused row.
 *   - `effort`: a thinking-level picker for the focused row.
 *
 * The component mutates an internal `draft` config and reports the outcome
 * through the `done` callback as a `ModelPanelResult`.
 */
export class ModelPanel implements OverlayComponent {
	private cursor = 0;
	private mode: "agents" | "models" | "effort" = "agents";
	private selectedRow = SET_ALL_AGENTS;
	private modelCursor = 0;
	private effortCursor = 0;
	private query = "";
	private readonly draft: AgentModelConfig;
	private readonly rows: string[];
	private readonly modelOptions: string[];
	private readonly done: (result: ModelPanelResult) => void;

	constructor(
		initialConfig: AgentModelConfig,
		modelOptions: string[],
		agents: string[],
		done: (result: ModelPanelResult) => void,
	) {
		this.draft = cloneModelConfig(initialConfig);
		this.rows = [SET_ALL_AGENTS, ...agents];
		this.modelOptions = modelOptions;
		this.done = done;
	}

	invalidate(): void {}

	handleInput(data: string): void {
		if (this.mode === "models") {
			this.handleModelInput(data);
			return;
		}
		if (this.mode === "effort") {
			this.handleEffortInput(data);
			return;
		}
		this.handleAgentInput(data);
	}

	render(width: number): string[] {
		if (this.mode === "models") return this.renderModelPicker(width);
		if (this.mode === "effort") return this.renderEffortPicker(width);
		return this.renderAgentList(width);
	}

	private handleAgentInput(data: string): void {
		const maxCursor = this.rows.length + 1;

		if (matchesKey(data, "ctrl+c")) {
			this.done({ type: "cancel" });
			return;
		}
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+s")) {
			this.done({ type: "save", config: this.draft });
			return;
		}
		if (matchesKey(data, "down") || data === "j") {
			this.cursor = Math.min(maxCursor, this.cursor + 1);
			return;
		}
		if (matchesKey(data, "up") || data === "k") {
			this.cursor = Math.max(0, this.cursor - 1);
			return;
		}
		if (data === "i") {
			this.applyInherit();
			return;
		}
		if (data === "e") {
			// Ignore the effort key when the cursor is on the "Continue" or
			// "Back" rows: there is no agent row to act on, and falling back
			// to SET_ALL_AGENTS would silently retarget every agent.
			if (this.cursor >= this.rows.length) return;

			this.selectedRow = this.rows[this.cursor] ?? SET_ALL_AGENTS;
			this.mode = "effort";
			this.effortCursor = 0;
			return;
		}
		if (data === "c") {
			const row = this.rows[this.cursor];
			if (row === SET_ALL_AGENTS)
				this.done({ type: "custom", agent: "all", config: this.draft });
			else if (row)
				this.done({ type: "custom", agent: row, config: this.draft });
			return;
		}

		if (!matchesKey(data, "return")) return;

		if (this.cursor === this.rows.length) {
			this.done({ type: "save", config: this.draft });
			return;
		}
		if (this.cursor === this.rows.length + 1) {
			this.done({ type: "cancel" });
			return;
		}

		this.selectedRow = this.rows[this.cursor] ?? SET_ALL_AGENTS;
		this.mode = "models";
		this.modelCursor = 0;
		this.query = "";
	}

	private handleModelInput(data: string): void {
		const options = this.filteredModelOptions();

		if (matchesKey(data, "ctrl+c")) {
			this.done({ type: "cancel" });
			return;
		}
		if (matchesKey(data, "escape")) {
			this.mode = "agents";
			this.query = "";
			return;
		}
		if (matchesKey(data, "backspace")) {
			this.query = this.query.slice(0, -1);
			this.modelCursor = Math.min(
				this.modelCursor,
				Math.max(0, this.filteredModelOptions().length - 1),
			);
			return;
		}
		if (matchesKey(data, "down") || data === "j") {
			this.modelCursor = Math.min(
				Math.max(0, options.length - 1),
				this.modelCursor + 1,
			);
			return;
		}
		if (matchesKey(data, "up") || data === "k") {
			this.modelCursor = Math.max(0, this.modelCursor - 1);
			return;
		}
		if (matchesKey(data, "return")) {
			const selected = options[this.modelCursor];
			if (!selected) return;

			if (selected === CUSTOM_MODEL) {
				this.done({
					type: "custom",
					agent: this.selectedRow === SET_ALL_AGENTS ? "all" : this.selectedRow,
					config: this.draft,
				});
				return;
			}
			if (selected === KEEP_CURRENT) {
				this.mode = "agents";
				return;
			}

			this.applyModelSelection(
				selected === INHERIT_MODEL ? undefined : selected,
			);
			this.mode = "agents";
			return;
		}

		if (data.length === 1 && data.charCodeAt(0) >= 32) {
			this.query += data;
			this.modelCursor = 0;
		}
	}

	private applyModelSelection(model: string | undefined): void {
		const row = this.rows[this.cursor];
		if (row === SET_ALL_AGENTS) {
			for (const name of this.rows.slice(1)) this.setModel(name, model);
			return;
		}
		if (!row) return;
		this.setModel(row, model);
	}

	private applyThinkingSelection(thinking: ThinkingLevel | undefined): void {
		const row = this.selectedRow;
		if (row === SET_ALL_AGENTS) {
			for (const name of this.rows.slice(1)) this.setThinking(name, thinking);
			return;
		}
		this.setThinking(row, thinking);
	}

	private applyInherit(): void {
		const row = this.rows[this.cursor];
		if (row === SET_ALL_AGENTS) {
			for (const name of this.rows.slice(1)) this.clearEntry(name);
			return;
		}
		if (row) this.clearEntry(row);
	}

	private setModel(name: string, model: string | undefined): void {
		const current = this.draft[name] ?? {};
		if (model === undefined) delete current.model;
		else current.model = model;

		if (!current.model && !current.thinking) delete this.draft[name];
		else this.draft[name] = current;
	}

	private setThinking(name: string, thinking: ThinkingLevel | undefined): void {
		const current = this.draft[name] ?? {};
		if (thinking === undefined) delete current.thinking;
		else current.thinking = thinking;

		if (!current.model && !current.thinking) delete this.draft[name];
		else this.draft[name] = current;
	}

	private clearEntry(name: string): void {
		delete this.draft[name];
	}

	private filteredModelOptions(): string[] {
		const query = this.query.trim().toLowerCase();
		if (!query) return this.modelOptions;
		return this.modelOptions.filter((option) =>
			option.toLowerCase().includes(query),
		);
	}

	private renderAgentList(width: number): string[] {
		const lines: string[] = [];
		const line = (text = "") =>
			truncateToWidth(text, Math.max(1, width), "…", true);

		lines.push(line("Assign Models to Agents"));
		lines.push("");
		lines.push(line("Current assignments:"));
		lines.push("");

		for (let i = 0; i < this.rows.length; i++) {
			const row = this.rows[i] ?? SET_ALL_AGENTS;
			const focused = i === this.cursor;
			const label =
				row === SET_ALL_AGENTS
					? this.renderSetAllLabel(row)
					: this.renderAgentLabel(row);
			lines.push(line(`${focused ? ">" : " "} ${label}`));
		}

		lines.push("");
		lines.push(
			line(`${this.cursor === this.rows.length ? ">" : " "} Continue (save)`),
		);
		lines.push(
			line(
				`${this.cursor === this.rows.length + 1 ? ">" : " "} Cancel (discard)`,
			),
		);
		lines.push("");
		lines.push(
			line(
				"j/k move • enter edit • e effort • i inherit • c custom • esc/ctrl+s save • ctrl+c discard",
			),
		);

		return lines;
	}

	private renderModelPicker(width: number): string[] {
		const lines: string[] = [];
		const options = this.filteredModelOptions();
		const line = (text = "") =>
			truncateToWidth(text, Math.max(1, width), "…", true);

		lines.push(line(`Select model for ${this.selectedRow}`));
		lines.push("");
		lines.push(line(`/ ${this.query || "search..."}`));
		lines.push("");

		const maxVisible = 12;
		const start = Math.max(
			0,
			Math.min(
				this.modelCursor - Math.floor(maxVisible / 2),
				Math.max(0, options.length - maxVisible),
			),
		);
		const end = Math.min(options.length, start + maxVisible);

		for (let i = start; i < end; i++) {
			const focused = i === this.modelCursor;
			lines.push(line(`${focused ? ">" : " "} ${options[i]}`));
		}
		if (options.length === 0) lines.push(line("  No matching models"));

		lines.push("");
		lines.push(
			line("j/k: navigate • type: search • enter: select • esc: back"),
		);

		return lines;
	}

	private handleEffortInput(data: string): void {
		if (matchesKey(data, "ctrl+c")) {
			this.done({ type: "cancel" });
			return;
		}
		if (matchesKey(data, "escape")) {
			this.mode = "agents";
			return;
		}
		if (matchesKey(data, "down") || data === "j") {
			this.effortCursor = Math.min(
				Math.max(0, THINKING_OPTIONS.length - 1),
				this.effortCursor + 1,
			);
			return;
		}
		if (matchesKey(data, "up") || data === "k") {
			this.effortCursor = Math.max(0, this.effortCursor - 1);
			return;
		}

		if (!matchesKey(data, "return")) return;

		const selected = THINKING_OPTIONS[this.effortCursor];
		if (selected === INHERIT_THINKING) this.applyThinkingSelection(undefined);
		else this.applyThinkingSelection(selected);
		this.mode = "agents";
	}

	private renderEffortPicker(width: number): string[] {
		const lines: string[] = [];
		const line = (text = "") =>
			truncateToWidth(text, Math.max(1, width), "…", true);

		lines.push(line(`Select effort for ${this.selectedRow}`));
		lines.push("");

		for (let i = 0; i < THINKING_OPTIONS.length; i++) {
			const focused = i === this.effortCursor;
			lines.push(line(`${focused ? ">" : " "} ${THINKING_OPTIONS[i]}`));
		}

		lines.push("");
		lines.push(line("j/k: navigate • enter: select • esc: back"));

		return lines;
	}

	private renderSetAllLabel(row: string): string {
		const models = this.rows
			.slice(1)
			.map((name) => this.draft[name]?.model ?? "inherit");
		const efforts = this.rows
			.slice(1)
			.map((name) => this.draft[name]?.thinking ?? "inherit");

		const firstModel = models[0] ?? "inherit";
		const firstEffort = efforts[0] ?? "inherit";

		const modelLabel = models.every((value) => value === firstModel)
			? firstModel
			: "mixed";
		const effortLabel = efforts.every((value) => value === firstEffort)
			? firstEffort
			: "mixed";

		return `${row.padEnd(20)} model=${modelLabel}, effort=${effortLabel}`;
	}

	private renderAgentLabel(row: string): string {
		const model = this.draft[row]?.model ?? "inherit";
		const effort = this.draft[row]?.thinking ?? "inherit";
		return `${row.padEnd(20)} model=${model}, effort=${effort}`;
	}
}

async function showModelPanel(
	ctx: ExtensionContext,
	config: AgentModelConfig,
): Promise<ModelPanelResult> {
	const modelOptions = await getPiModelOptions(ctx);
	const agents = listDiscoverableAgents(ctx.cwd).map((agent) => agent.name);

	enterOverlay();
	return ctx.ui
		.custom<ModelPanelResult>(
			(_tui, _theme, _keybindings, done) =>
				new ModelPanel(config, modelOptions, agents, done),
			{
				overlay: true,
				overlayOptions: {
					anchor: "center",
					width: "70%",
					minWidth: 72,
					maxHeight: "85%",
				},
			},
		)
		.finally(exitOverlay);
}

/**
 * Drives the `subagent:models` command: shows the assignment panel, services any
 * custom-model input requests by re-opening the panel with the updated draft,
 * and on save persists the global config (`~/.pi/harness/models.json`).
 */
export interface AgentMenuEntry {
	name: string;
	description?: string;
}

const PIPELINE_AGENT_PREFIXES = ["sdd-", "review-", "jd-"] as const;

function isPipelineAgent(name: string): boolean {
	return PIPELINE_AGENT_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * Builds the "Available subagent types:" routing menu embedded in the subagent
 * tool description. Builtin generics come first; pipeline-only agents (sdd-*,
 * review-*, jd-*) are excluded because they are invoked by their pipelines,
 * not ad-hoc. A short routing hint closes the menu.
 */
export function buildAgentMenu(
	builtinGenerics: AgentMenuEntry[],
	discoveredAgents: AgentMenuEntry[],
): string {
	const genericLines = builtinGenerics.map(
		({ name, description }) => `  ${name} — ${description ?? name}`,
	);

	const discoveredLines = discoveredAgents
		.filter((agent) => !isPipelineAgent(agent.name))
		.map(({ name, description }) => `  ${name} — ${description ?? name}`);

	return [
		"Available subagent types:",
		...genericLines,
		...discoveredLines,
		"Pick the most specific agent for the task; default to general-purpose only when none fits.",
	].join("\n");
}

export function isDepthExceeded(): boolean {
	return currentDepth() >= maxDepth();
}

function readDefaultModelId(): string | undefined {
	try {
		const settings = JSON.parse(readFileSync(join(homedir(), ".pi", "agent", "settings.json"), "utf8")) as { defaultProvider?: string; defaultModel?: string };
		if (settings.defaultProvider && settings.defaultModel) return `${settings.defaultProvider}/${settings.defaultModel}`;
	} catch {
		return undefined;
	}
	return undefined;
}

/**
 * Resolves the model/thinking an agent should run with, preferring the
 * per-agent values saved via `/subagent:models` and falling back to the session
 * default model. `thinking` has no session default, so it is left undefined
 * when unconfigured.
 */
export function resolveAgentRouting(
	config: AgentModelConfig,
	agentName: string,
	defaultModel: string | undefined,
): { model: string | undefined; thinking: ThinkingLevel | undefined } {
	const entry = config[agentName];
	return {
		model: entry?.model ?? defaultModel,
		thinking: entry?.thinking,
	};
}

/**
 * Builds the manager registry. Discovered agents honor the per-agent model and
 * thinking saved via `/subagent:models` (read from the GLOBAL
 * `~/.pi/harness/models.json`, so the assignments apply across every project),
 * falling back to the session default model. The builtin generic agents
 * (general-purpose / Explore / Plan) are not part of the panel's discoverable
 * list, so they intentionally stay on the session default.
 */
function createManagerRegistry(cwd: string): AgentSpec[] {
	const defaultModel = readDefaultModelId();
	const config = readModelConfig(homedir());
	const genericAgents: AgentSpec[] = [
		{
			name: "general-purpose",
			description: "Generic subagent controlled by the parent prompt",
			promptRef: "You are a generic Pi subagent. Follow the parent prompt exactly, stay within scope, use available tools when needed, and return a concise result with evidence.",
			policyMode: "writer",
			model: defaultModel,
			execution: "auto",
			inheritProjectContext: true,
			inheritSkills: true,
		},
		{
			name: "Explore",
			description: "Read-only exploration subagent",
			promptRef: "You are an exploration subagent. Inspect the project with read-only tools, explain what you find, include key files, and do not modify files.",
			policyMode: "advisory",
			model: defaultModel,
			execution: "auto",
			inheritProjectContext: true,
			inheritSkills: true,
		},
		{
			name: "Plan",
			description: "Read-only planning subagent",
			promptRef: "You are a planning subagent. Analyze the request and repository context, then produce an implementation plan. Do not modify files.",
			policyMode: "advisory",
			model: defaultModel,
			execution: "auto",
			inheritProjectContext: true,
			inheritSkills: true,
		},
	];

	const discoveredAgents: AgentSpec[] = listDiscoverableAgents(cwd).map((agent): AgentSpec => {
		const routing = resolveAgentRouting(config, agent.name, defaultModel);
		return {
			name: agent.name,
			description: agent.description ?? `${agent.source} agent ${agent.name}`,
			promptRef: agent.filePath ?? agent.name,
			policyMode: agent.name.startsWith("review-") || agent.name === "sdd-verify" ? "reviewer" : "writer",
			model: routing.model,
			thinking: routing.thinking,
			execution: "auto",
			inheritProjectContext: true,
			inheritSkills: false,
		};
	});

	return [...genericAgents, ...discoveredAgents];
}

function createHarnessManagerRuntime(cwd: string): ManagerRuntime {
	const store = new InMemoryRunStore();
	attachFileSink(store, { root: sessionRoot() });
	return new ManagerRuntime({
		registry: { builtin: createManagerRegistry(cwd) },
		providers: [createSubprocessProvider()],
		store,
	});
}

const runtimes = new Map<string, ManagerRuntime>();

const registeredCwds = new Set<string>();

let twoColumnHandle: TwoColumnWidgetHandle | undefined;

/**
 * Extracts `{ input, output }` token counts from a turn-end message, but only
 * for assistant messages that actually carry usage. Defensive across the message
 * union (a turn can end on a non-assistant message), so it returns `undefined`
 * rather than fabricating zeros when no usage is present.
 */
function assistantTurnUsage(message: unknown): { input: number; output: number } | undefined {
	if (message === null || typeof message !== "object") return undefined;

	const candidate = message as { role?: unknown; usage?: unknown };
	if (candidate.role !== "assistant" || candidate.usage === null || typeof candidate.usage !== "object") {
		return undefined;
	}

	const usage = candidate.usage as Record<string, unknown>;
	const input = typeof usage.input === "number" ? usage.input : 0;
	const output = typeof usage.output === "number" ? usage.output : 0;
	if (input === 0 && output === 0) return undefined;

	return { input, output };
}

let sessionCleanupInstalled = false;

/**
 * Installs top-level cleanup for the file-backed subagent tree, idempotent per
 * process and a no-op for nested processes (subagent depth > 0).
 *
 * Top-level responsibilities:
 *   - A one-time crash-recovery TTL sweep of stale session roots for this cwd.
 *   - Removal of THIS session's own root on shutdown.
 *
 * Shutdown removal is wired through every available path because none is
 * guaranteed alone: Pi's `session_shutdown` hook (best-effort — wrapped so an
 * older Pi without that event is a no-op), the synchronous `process` `exit`
 * event (the guaranteed path on any `process.exit`-driven termination), and
 * `SIGINT`/`SIGTERM` handlers. The signal handlers use `once` so that, by the
 * time they run, their own listener is already removed: they clean up, then
 * re-exit only when no OTHER handler remains for that signal. This preserves
 * the default terminate behavior on a bare signal without forcing an exit that
 * would truncate Pi's own graceful shutdown when Pi handles the signal too.
 *
 * Nested processes never register cleanup: the top-level process owns the tree
 * and may still be reading their files.
 */
function installSessionCleanup(pi: ExtensionAPI): void {
	if (sessionCleanupInstalled) return;
	if (!isTopLevelProcess()) return;
	sessionCleanupInstalled = true;

	sweepStaleSessions();

	const root = sessionRoot();

	try {
		pi.on("session_shutdown", () => removeSessionRoot(root));
	} catch {
		// session_shutdown may be absent on older pi versions; exit/signal handlers cover it.
	}

	process.once("exit", () => removeSessionRoot(root));

	const handleSignal = (signal: NodeJS.Signals, exitCode: number): void => {
		removeSessionRoot(root);
		if (process.listenerCount(signal) === 0) {
			process.exit(exitCode);
		}
	};
	process.once("SIGINT", () => handleSignal("SIGINT", 130));
	process.once("SIGTERM", () => handleSignal("SIGTERM", 143));
}

function getManagerRuntime(cwd: string): ManagerRuntime {
	const existing = runtimes.get(cwd);
	if (existing) return existing;

	const runtime = createHarnessManagerRuntime(cwd);
	runtimes.set(cwd, runtime);
	return runtime;
}

const MAX_CONCURRENCY = 4;

/**
 * Cadence at which an in-flight subagent run re-emits its current state so the
 * inline transcript row re-renders and its time-derived spinner/elapsed advance
 * between tool-call events.
 */
const SUBAGENT_HEARTBEAT_MS = 800;

export async function mapWithConcurrencyLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let index = 0;

	async function worker(): Promise<void> {
		while (index < items.length) {
			const current = index++;
			results[current] = await fn(items[current]!);
		}
	}

	const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
	await Promise.all(workers);
	return results;
}

async function handleModelsCommand(ctx: ExtensionContext): Promise<void> {
	let config = readModelConfig(homedir());
	let result = await showModelPanel(ctx, config);

	while (result.type === "custom") {
		config = cloneModelConfig(result.config);

		const current =
			result.agent === "all"
				? "inherit"
				: (config[result.agent]?.model ?? "inherit");

		const custom = await ctx.ui.input(
			`${result.agent === "all" ? "all agents" : result.agent} custom model id`,
			current === "inherit" ? "provider/model" : current,
		);
		if (custom === undefined) return;

		const trimmed = custom.trim();
		if (trimmed.length > 0) {
			if (result.agent === "all") {
				const next: AgentModelConfig = { ...config };
				for (const agent of listDiscoverableAgents(ctx.cwd)) {
					next[agent.name] = {
						...(next[agent.name] ?? {}),
						model: trimmed,
					};
				}
				config = next;
			} else {
				config = {
					...config,
					[result.agent]: {
						...(config[result.agent] ?? {}),
						model: trimmed,
					},
				};
			}
		}

		result = await showModelPanel(ctx, config);
	}

	if (result.type !== "save") return;

	writeModelConfig(homedir(), result.config);

	ctx.ui.notify(
		[
			"Model config saved (global — applies to every project).",
			`Config: ${modelConfigPath(homedir())}`,
			...describeModelConfig(ctx.cwd, result.config),
		].join("\n"),
		"info",
	);
}

function lastUserText(ctx: ExtensionContext): string | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index] as { type?: string; message?: { role?: string; content?: Array<{ type?: string; text?: string }> } };
		if (entry.type !== "message" || entry.message?.role !== "user") continue;
		const text = entry.message.content?.find((part) => part.type === "text")?.text?.trim();
		if (text) return text;
	}
	return undefined;
}

function normalizeSubagentPayload(params: unknown, ctx: ExtensionContext): CompatPayload {
	if (!params || typeof params !== "object" || Array.isArray(params)) {
		return { prompt: lastUserText(ctx) ?? "Execute the requested subagent task." };
	}
	const payload = { ...(params as Record<string, unknown>) };
	const hasPrompt = ["task", "prompt", "message", "instructions", "input", "query", "description"].some(
		(key) => typeof payload[key] === "string" && (payload[key] as string).trim().length > 0,
	);
	if (!hasPrompt && !Array.isArray(payload.tasks) && !Array.isArray(payload.chain) && typeof payload.action !== "string") {
		payload.prompt = lastUserText(ctx) ?? "Execute the requested subagent task.";
	}
	return payload as CompatPayload;
}

const SubagentToolParameters = Type.Object(
	{
		agent: Type.Optional(Type.String({ description: "Agent name, e.g. general-purpose, Explore, Plan, sdd-apply." })),
		task: Type.Optional(Type.String({ description: "Task for agent/task style calls." })),
		subagent_type: Type.Optional(Type.String({ description: "Claude/OpenCode-style agent type, e.g. Explore or general-purpose." })),
		prompt: Type.Optional(Type.String({ description: "Prompt for Claude/OpenCode-style calls. Use this for the full delegated instruction." })),
		description: Type.Optional(Type.String({ description: "Short task description; also used as prompt if no prompt/task is provided." })),
		message: Type.Optional(Type.String()),
		instructions: Type.Optional(Type.String()),
		input: Type.Optional(Type.String()),
		query: Type.Optional(Type.String()),
		tasks: Type.Optional(Type.Array(Type.Any(), { description: "Parallel task array." })),
		chain: Type.Optional(Type.Array(Type.Any(), { description: "Sequential chain array." })),
		action: Type.Optional(Type.String({ description: "Manager action; unsupported actions fail explicitly until implemented." })),
	},
	{ additionalProperties: true },
);

export default function harness(pi: ExtensionAPI): void {
	const agentMenu = buildAgentMenu(
		[
			{ name: "general-purpose", description: "Generic subagent controlled by the parent prompt" },
			{ name: "Explore", description: "Read-only exploration subagent" },
			{ name: "Plan", description: "Read-only planning subagent" },
		],
		listDiscoverableAgents(process.cwd()),
	);

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: `Launch a harness-owned subagent manager run. Supports agent+task, subagent_type+prompt, and generic prompt-only delegation.\n\n${agentMenu}`,
		parameters: SubagentToolParameters,
		renderCall: renderSubagentCall,
		renderResult: renderSubagentResult((cwd) => getManagerRuntime(cwd)),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			// Only the ROOT session orchestrates. A subagent (depth > 0) is an executor
			// and must never launch another subagent — that is the recursion where an
			// SDD phase agent (e.g. sdd-explore) re-spawns its own phase. The depth-cap
			// (isDepthExceeded) is kept below as a defence-in-depth backstop.
			if (!isOrchestratorRoot()) {
				return {
					content: [{ type: "text", text: `Nested subagents are disabled: a subagent (depth ${currentDepth()}) cannot launch another subagent — only the root session orchestrates. Do the work yourself and return the result.` }],
					details: {} as SubagentResultDetails,
				};
			}

			if (isDepthExceeded()) {
				return {
					content: [{ type: "text", text: `Subagent depth limit reached (depth ${currentDepth()} >= max ${maxDepth()}). Nested subagent refused to prevent unbounded recursion.` }],
					details: {} as SubagentResultDetails,
				};
			}

			const payload = normalizeSubagentPayload(params, ctx);
			const translation = translateSubagentPayload(payload);
			if (translation.unsupported) {
				return {
					content: [{ type: "text", text: `Subagent request unsupported by harness manager (${translation.unsupportedReason}).` }],
					details: {} as SubagentResultDetails,
				};
			}

			const runtime = getManagerRuntime(ctx.cwd);
			const results: RunResult[] = [];
			const runIds: string[] = [];
			const runIdSet = new Set<string>();
			let turns = 0;
			let tools = 0;
			let lastText = "";

			const emitUpdate = (text: string) => {
				lastText = text;
				onUpdate?.({
					content: [{ type: "text", text }],
					details: { runIds, turns, tools },
				});
			};

			const unsubscribe = runtime.subscribe((event, snapshot) => {
				if (!runIdSet.has(event.runId)) return;

				if (event.type === "run.output" && event.role === "assistant") {
					turns += 1;
				} else if (event.type === "run.progress" && event.message.startsWith(TOOL_PROGRESS_PREFIX)) {
					tools += 1;
				}

				const text = event.type === "run.progress"
					? event.message
					: `${snapshot.agent} · ${snapshot.status}`;

				emitUpdate(text);
			});

			// The inline transcript row's spinner and elapsed counter are time-derived,
			// so they only advance when the row re-renders. Events alone leave gaps
			// between tool calls; re-emitting the current state on a fixed cadence keeps
			// the row animating in flight. Cleared on settle and abort so no interval leaks.
			let heartbeat: ReturnType<typeof setInterval> | undefined = setInterval(
				() => emitUpdate(lastText),
				SUBAGENT_HEARTBEAT_MS,
			);
			const stopHeartbeat = () => {
				if (heartbeat === undefined) return;
				clearInterval(heartbeat);
				heartbeat = undefined;
			};
			signal?.addEventListener("abort", stopHeartbeat);

			try {
				if (translation.mode === "parallel") {
					const parallelConcurrency = typeof translation.requests[0]?.metadata?.parallelConcurrency === "number"
						? (translation.requests[0].metadata.parallelConcurrency as number)
						: translation.requests.length;
					const cap = Math.min(MAX_CONCURRENCY, parallelConcurrency, translation.requests.length);
					results.push(...await mapWithConcurrencyLimit(
						translation.requests,
						cap,
						(r) => runtime.run(r, { signal, onStart: (id) => { runIds.push(id); runIdSet.add(id); } }),
					));
				} else {
					for (const request of translation.requests) {
						results.push(await runtime.run(request, { signal, onStart: (id) => { runIds.push(id); runIdSet.add(id); } }));
					}
				}

				const text = results
					.map((r) => `## ${r.runId}\n${r.summary.text}`)
					.join("\n\n") || "No subagent requests were produced.";

				return {
					content: [{ type: "text", text }],
					details: { runIds, turns, tools },
				};
			} finally {
				stopHeartbeat();
				signal?.removeEventListener("abort", stopHeartbeat);
				unsubscribe();
			}
		},
	});

	registerTodoTool(pi);
	registerTodosCommand(pi);

	// Append the orchestrator contract to the system prompt of the ROOT session
	// only. Subagents (depth > 0) are executors and must not inherit the
	// coordinator contract, or they re-delegate their own phase. The asset is read
	// at runtime so a not-yet-created or unreadable file simply skips injection.
	pi.on("before_agent_start", (event, _ctx) => {
		if (!isOrchestratorRoot()) return undefined;

		const orchestratorPrompt = readOrchestratorPrompt();
		if (!orchestratorPrompt) return undefined;

		return {
			systemPrompt: `${event.systemPrompt}\n\n${orchestratorPrompt}`,
		};
	});

	// Hide tasks completed in a turn once the next turn begins, so the Todos
	// column stays uncluttered between turns.
	pi.on("tool_execution_end", (event, _ctx) => {
		if (event.toolName === TODO_TOOL_NAME) twoColumnHandle?.onTodoToolEnd();
	});

	pi.on("agent_start", (_event, _ctx) => {
		twoColumnHandle?.onAgentStart();
	});

	// Attribute each turn's assistant token usage to the active todo tasks so the
	// Todos column can show live per-task token metrics. `turn_end.message` is the
	// turn's assistant message; its `usage` carries `input`/`output` counts.
	pi.on("turn_end", (event, _ctx) => {
		const usage = assistantTurnUsage(event.message);
		if (usage) twoColumnHandle?.addTokenUsage(usage.input, usage.output);
	});

	// Register the combined Agents + Todos widget once per cwd so it captures
	// every run from session start. Also replay the last todo tool result from the
	// branch so todo state survives compaction and session tree navigation, and
	// reset the hide-between-turns state on every session boundary.
	pi.on("session_start", (_event, ctx) => {
		bracketAllOverlays(ctx.ui);
		installSessionCleanup(pi);
		replayFromBranch(ctx);
		if (!registeredCwds.has(ctx.cwd)) {
			registeredCwds.add(ctx.cwd);
			twoColumnHandle = registerTwoColumnWidget(ctx, getManagerRuntime(ctx.cwd));
		}
		twoColumnHandle?.onSessionReset();
	});

	pi.on("session_compact", (_event, ctx) => {
		replayFromBranch(ctx);
		twoColumnHandle?.onSessionReset();
	});

	pi.on("session_tree", (_event, ctx) => {
		replayFromBranch(ctx);
		twoColumnHandle?.onSessionReset();
	});

	pi.registerCommand("subagent:models", {
		description: "Configure per-agent models and thinking effort.",
		handler: async (_args, ctx) => {
			await handleModelsCommand(ctx);
		},
	});

	pi.registerCommand("sdd:status", {
		description: "Show harness model configuration status (global config).",
		handler: async (_args, ctx) => {
			const modelConfig = readModelConfig(homedir());
			const orchestratorPrompt = readOrchestratorPrompt();

			ctx.ui.notify(
				[
					"Harness extension is active.",
					`Orchestrator contract: ${orchestratorPrompt ? "loaded" : "missing"}`,
					`Model config: ${existsSync(modelConfigPath(homedir())) ? "present" : "missing"}`,
					...describeModelConfig(ctx.cwd, modelConfig),
				].join("\n"),
				"info",
			);
		},
	});

	pi.registerCommand("subagent:status", {
		description: "Show in-flight subagent manager run status.",
		handler: async (args, ctx) => {
			const surface = createManagerCommandSurface({
				cwd: ctx.cwd,
				backend: getManagerRuntime(ctx.cwd),
			});
			const result = await surface.status(args.trim() || undefined);
			ctx.ui.notify(result.lines.join("\n"), "info");
		},
	});

	pi.registerCommand("subagent:interrupt", {
		description: "Request interruption for a subagent manager run by id.",
		handler: async (args, ctx) => {
			const runId = args.trim();
			if (!runId) {
				ctx.ui.notify("Usage: /subagent:interrupt <runId>", "error");
				return;
			}
			const surface = createManagerCommandSurface({
				cwd: ctx.cwd,
				backend: getManagerRuntime(ctx.cwd),
			});
			const result = await surface.interrupt(runId);
			ctx.ui.notify(result.lines.join("\n"), "info");
		},
	});

	pi.registerCommand("subagent:doctor", {
		description: "Explain subagent manager runtime readiness.",
		handler: async (_args, ctx) => {
			const surface = createManagerCommandSurface({
				cwd: ctx.cwd,
				backend: getManagerRuntime(ctx.cwd),
			});
			const result = surface.doctor();
			ctx.ui.notify(result.lines.join("\n"), "info");
		},
	});

	pi.registerCommand("subagent:view", {
		description: "Open the conversation viewer for a subagent run. Optionally pass a run ID; defaults to the most recent active run.",
		handler: async (args, ctx) => {
			const runtime = getManagerRuntime(ctx.cwd);
			const runId = args.trim() || selectMostRecentRunId(await runtime.status());
			if (!runId) {
				ctx.ui.notify("No subagent runs found.", "info");
				return;
			}
			const path = jsonlPath(sessionRoot(), agentIdFor(runId));
			await showConversationViewer(ctx, runtime, runId, path);
		},
	});

	pi.registerCommand("subagent:file", {
		description: "Print the transcript file path for a subagent run. Optionally pass an agent ID; defaults to the most recent run.",
		handler: async (args, ctx) => {
			const arg = args.trim();
			if (arg) {
				ctx.ui.notify(jsonlPath(sessionRoot(), arg), "info");
				return;
			}

			const runtime = getManagerRuntime(ctx.cwd);
			const runId = selectMostRecentRunId(await runtime.status());
			if (!runId) {
				ctx.ui.notify("No subagent runs found.", "info");
				return;
			}
			ctx.ui.notify(jsonlPath(sessionRoot(), agentIdFor(runId)), "info");
		},
	});
}
