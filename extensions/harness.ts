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
} from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@mariozechner/pi-tui";

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

const SDD_AGENT_NAMES = [
	"sdd-init",
	"sdd-explore",
	"sdd-proposal",
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

type AgentModelConfig = Record<string, AgentRoutingEntry>;
type AgentSource = "project" | "user" | "builtin";

interface AgentEntry {
	name: string;
	source: AgentSource;
	filePath?: string;
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

function modelConfigPath(cwd: string): string {
	return join(cwd, ".pi", "harness", "models.json");
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

function readModelConfig(cwd: string): AgentModelConfig {
	const path = modelConfigPath(cwd);
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

function writeModelConfig(cwd: string, config: AgentModelConfig): void {
	const path = modelConfigPath(cwd);
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

/**
 * Rewrites the `model:` / `thinking:` keys in an agent file's YAML frontmatter
 * to match `entry`. Existing routing keys are stripped first; new ones are
 * inserted just after `description:` when present. Files without frontmatter
 * are returned unchanged.
 */
function updateFrontmatterRouting(
	content: string,
	entry: AgentRoutingEntry | undefined,
): string {
	if (!content.startsWith("---\n")) return content;

	const endIndex = content.indexOf("\n---", 4);
	if (endIndex === -1) return content;

	const frontmatter = content.slice(4, endIndex);
	const body = content.slice(endIndex);

	const lines = frontmatter
		.split("\n")
		.filter(
			(line) => !line.startsWith("model:") && !line.startsWith("thinking:"),
		);

	const toInsert: string[] = [];
	if (entry?.model) toInsert.push(`model: ${entry.model}`);
	if (entry?.thinking) toInsert.push(`thinking: ${entry.thinking}`);

	if (toInsert.length > 0) {
		const descriptionIndex = lines.findIndex((line) =>
			line.startsWith("description:"),
		);
		const insertIndex =
			descriptionIndex >= 0 ? descriptionIndex + 1 : Math.min(1, lines.length);
		lines.splice(insertIndex, 0, ...toInsert);
	}

	return `---\n${lines.join("\n")}${body}`;
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
			return name ? { name, source, filePath } : undefined;
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
	const builtinDirs = [
		join(PACKAGE_ROOT, "..", "pi-subagents", "agents"),
		join(cwd, ".pi", "npm", "node_modules", "pi-subagents", "agents"),
		join(homedir(), ".local", "lib", "node_modules", "pi-subagents", "agents"),
	];

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

function projectSettingsPath(cwd: string): string {
	return join(cwd, ".pi", "settings.json");
}

/**
 * Applies a routing override for a builtin agent into `.pi/settings.json`
 * under `subagents.agentOverrides`. Builtin agents have no editable file on
 * disk, so their routing is expressed as settings instead. Empty objects are
 * pruned so the settings file does not accumulate dead keys.
 */
function updateBuiltinModelOverride(
	cwd: string,
	name: string,
	entry: AgentRoutingEntry | undefined,
): boolean {
	const path = projectSettingsPath(cwd);

	let settings: Record<string, unknown> = {};
	if (existsSync(path)) {
		try {
			const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
			if (isRecord(parsed)) settings = parsed;
		} catch {
			settings = {};
		}
	}

	const subagents = isRecord(settings.subagents)
		? { ...settings.subagents }
		: {};
	const agentOverrides = isRecord(subagents.agentOverrides)
		? { ...subagents.agentOverrides }
		: {};
	const current = isRecord(agentOverrides[name])
		? { ...agentOverrides[name] }
		: {};

	if (entry?.model === undefined) delete current.model;
	else current.model = entry.model;

	if (entry?.thinking === undefined) delete current.thinking;
	else current.thinking = entry.thinking;

	if (Object.keys(current).length > 0) agentOverrides[name] = current;
	else delete agentOverrides[name];

	if (Object.keys(agentOverrides).length > 0)
		subagents.agentOverrides = agentOverrides;
	else delete subagents.agentOverrides;

	if (Object.keys(subagents).length > 0) settings.subagents = subagents;
	else delete settings.subagents;

	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(settings, null, "\t")}\n`);
	return true;
}

/**
 * Propagates the saved model config to every discoverable agent: builtin
 * agents via settings overrides, file-backed agents via frontmatter rewrites.
 * Returns counts of agents that were changed vs. left untouched.
 */
function applyModelConfig(
	cwd: string,
	config: AgentModelConfig,
): { updated: number; skipped: number } {
	let updated = 0;
	let skipped = 0;

	for (const agent of listDiscoverableAgents(cwd)) {
		const entry = config[agent.name];

		if (agent.source === "builtin") {
			if (updateBuiltinModelOverride(cwd, agent.name, entry)) updated += 1;
			else skipped += 1;
			continue;
		}

		if (!agent.filePath || !existsSync(agent.filePath)) {
			skipped += 1;
			continue;
		}

		const original = readFileSync(agent.filePath, "utf8");
		const next = updateFrontmatterRouting(original, entry);
		if (next === original) {
			skipped += 1;
			continue;
		}

		writeFileSync(agent.filePath, next);
		updated += 1;
	}

	return { updated, skipped };
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

type ModelPanelResult =
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
class ModelPanel implements OverlayComponent {
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

		if (matchesKey(data, "ctrl+c") || matchesKey(data, "escape")) {
			this.done({ type: "cancel" });
			return;
		}
		if (matchesKey(data, "ctrl+s")) {
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
			lines.push(line(`${focused ? "▸" : " "} ${label}`));
		}

		lines.push("");
		lines.push(
			line(`${this.cursor === this.rows.length ? "▸" : " "} Continue`),
		);
		lines.push(
			line(`${this.cursor === this.rows.length + 1 ? "▸" : " "} ← Back`),
		);
		lines.push("");
		lines.push(
			line(
				"j/k: navigate • enter: change model / confirm • e: change effort • i: inherit all • c: custom model • ctrl+s: save • esc: back",
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
		lines.push(line(`◎ ${this.query || "search..."}`));
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
			lines.push(line(`${focused ? "▸" : " "} ${options[i]}`));
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
			lines.push(line(`${focused ? "▸" : " "} ${THINKING_OPTIONS[i]}`));
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

	return ctx.ui.custom<ModelPanelResult>(
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
	);
}

/**
 * Drives the `sdd:models` command: shows the assignment panel, services any
 * custom-model input requests by re-opening the panel with the updated draft,
 * and on save persists the config and applies it to all agents.
 */
async function handleModelsCommand(ctx: ExtensionContext): Promise<void> {
	let config = readModelConfig(ctx.cwd);
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

	writeModelConfig(ctx.cwd, result.config);
	const applyResult = applyModelConfig(ctx.cwd, result.config);

	ctx.ui.notify(
		[
			"Model config saved.",
			`Config: ${modelConfigPath(ctx.cwd)}`,
			`Agents updated: ${applyResult.updated}`,
			...describeModelConfig(ctx.cwd, result.config),
		].join("\n"),
		"info",
	);
}

export default function harness(pi: ExtensionAPI): void {
	// Append the orchestrator contract to the system prompt. The asset is read
	// at runtime so a not-yet-created or unreadable file simply skips injection.
	pi.on("before_agent_start", (event, _ctx) => {
		const orchestratorPrompt = readOrchestratorPrompt();
		if (!orchestratorPrompt) return undefined;

		return {
			systemPrompt: `${event.systemPrompt}\n\n${orchestratorPrompt}`,
		};
	});

	pi.registerCommand("sdd:models", {
		description: "Configure per-agent models and thinking effort.",
		handler: async (_args, ctx) => {
			await handleModelsCommand(ctx);
		},
	});

	pi.registerCommand("sdd:status", {
		description: "Show harness model configuration status for this project.",
		handler: async (_args, ctx) => {
			const modelConfig = readModelConfig(ctx.cwd);
			const orchestratorPrompt = readOrchestratorPrompt();

			ctx.ui.notify(
				[
					"Harness extension is active.",
					`Orchestrator contract: ${orchestratorPrompt ? "loaded" : "missing"}`,
					`Model config: ${existsSync(modelConfigPath(ctx.cwd)) ? "present" : "missing"}`,
					...describeModelConfig(ctx.cwd, modelConfig),
				].join("\n"),
				"info",
			);
		},
	});
}
