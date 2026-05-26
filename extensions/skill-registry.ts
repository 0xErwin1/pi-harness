import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	statSync,
	watch,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, normalize, relative, sep } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const REGISTRY_REL_PATH = ".agent/skill-registry.md";
const CACHE_REL_PATH = ".agent/.skill-registry.cache.json";
const SECTION_MARKER = "## Skills";
const EXCLUDE_NAMES = new Set(["_shared", "skill-registry"]);
const EXCLUDE_PREFIXES = ["sdd-"];
const AGENT_IGNORE_ENTRY = ".agent/";
const WATCH_DEBOUNCE_MS = 500;
const REGISTRY_SCHEMA_VERSION = 5;
const NO_SKILL_REGISTRY_FLAG = "no-skill-registry";
const NO_SKILL_REGISTRY_ENV = "PI_HARNESS_NO_SKILL_REGISTRY";
const LEGACY_PROJECT_REGISTRY_REL_PATH = ".pi/extensions/skill-registry.ts";
const LEGACY_PROJECT_REGISTRY_DISABLED_REL_PATH =
	".pi/extensions/skill-registry.ts.disabled";

interface SkillEntry {
	name: string;
	path: string;
	description: string;
	scope?: string;
}

function userSkillDirs(): string[] {
	const home = homedir();
	return [
		join(home, ".pi/agent/skills"),
		join(home, ".config/agents/skills"),
		join(home, ".agents/skills"),
		join(home, ".kimi/skills"),
		join(home, ".config/opencode/skills"),
		join(home, ".config/kilo/skills"),
		join(home, ".claude/skills"),
		join(home, ".gemini/skills"),
		join(home, ".gemini/antigravity/skills"),
		join(home, ".cursor/skills"),
		join(home, ".copilot/skills"),
		join(home, ".codex/skills"),
		join(home, ".codeium/windsurf/skills"),
		join(home, ".qwen/skills"),
		join(home, ".kiro/skills"),
		join(home, ".openclaw/skills"),
	];
}

function projectSkillDirs(cwd: string): string[] {
	return [
		join(cwd, "skills"),
		join(cwd, ".opencode/skills"),
		join(cwd, ".claude/skills"),
		join(cwd, ".gemini/skills"),
		join(cwd, ".cursor/skills"),
		join(cwd, ".github/skills"),
		join(cwd, ".codex/skills"),
		join(cwd, ".qwen/skills"),
		join(cwd, ".kiro/skills"),
		join(cwd, ".openclaw/skills"),
		join(cwd, ".pi/skills"),
		join(cwd, ".agent/skills"),
		join(cwd, ".agents/skills"),
	];
}

function findSkillFiles(root: string): string[] {
	if (!existsSync(root)) return [];
	const out: string[] = [];
	const stack: string[] = [root];
	while (stack.length > 0) {
		const dir = stack.pop()!;
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				stack.push(full);
			} else if (entry.isFile() && entry.name === "SKILL.md") {
				out.push(full);
			}
		}
	}
	return out.sort();
}

function parseFrontmatter(source: string): { name?: string; description?: string; body: string } {
	if (!source.startsWith("---\n")) return { body: source };
	const end = source.indexOf("\n---", 4);
	if (end === -1) return { body: source };
	const fm = source.slice(4, end);
	const body = source.slice(end + 4).replace(/^\n/, "");
	const out: { name?: string; description?: string } = {};
	const lines = fm.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const m = line.match(/^(\w+):\s*(.*)$/);
		if (!m) continue;
		const key = m[1];
		let value = m[2].trim();
		if (value === ">" || value === ">-" || value === "|" || value === "|-") {
			const block: string[] = [];
			while (i + 1 < lines.length) {
				const next = lines[i + 1];
				if (next.trim() === "") {
					block.push("");
					i++;
					continue;
				}
				if (!next.startsWith(" ") && !next.startsWith("\t")) break;
				block.push(next.trim());
				i++;
			}
			value = block.join(" ").trim();
		} else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		if (key === "name") out.name = value;
		else if (key === "description") out.description = value;
	}
	return { ...out, body };
}

function deriveSkillName(file: string, frontmatterName: string | undefined): string {
	if (frontmatterName) return frontmatterName;
	return basename(join(file, ".."));
}

function isExcluded(name: string): boolean {
	if (EXCLUDE_NAMES.has(name)) return true;
	return EXCLUDE_PREFIXES.some((p) => name.startsWith(p));
}

function comparablePath(path: string): string {
	const clean = normalize(path);
	return clean.length > 1 ? clean.replace(/[\\/]+$/, "") : clean;
}

function uniqueExistingDirs(dirs: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const dir of dirs) {
		const clean = comparablePath(dir);
		if (seen.has(clean) || !existsSync(clean)) continue;
		seen.add(clean);
		out.push(clean);
	}
	return out;
}

function loadSkill(file: string): SkillEntry | undefined {
	let source: string;
	try {
		source = readFileSync(file, "utf8");
	} catch {
		return undefined;
	}
	const fm = parseFrontmatter(source);
	const name = deriveSkillName(file, fm.name);
	if (isExcluded(name)) return undefined;
	return {
		name,
		path: file,
		description: normalizeSkillDescription(fm.description ?? ""),
	};
}

function normalizeSkillDescription(description: string): string {
	return description.replace(/\s+/g, " ").trim();
}

function scopeForPath(cwd: string, path: string): string {
	const cleanCwd = comparablePath(cwd);
	const projectPrefix = cleanCwd.endsWith(sep) ? cleanCwd : `${cleanCwd}${sep}`;
	return comparablePath(path).startsWith(projectPrefix) ? "project" : "user";
}

function markdownCell(value: string): string {
	const trimmed = value.replace(/\n/g, " ").replace(/\|/g, "\\|").trim();
	return trimmed.length > 0 ? trimmed : "—";
}

function isCacheFile(value: unknown): value is { fingerprint: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		"fingerprint" in value &&
		typeof value.fingerprint === "string"
	);
}

function dedupeBySkillName(entries: SkillEntry[], cwd: string): SkillEntry[] {
	const cleanCwd = comparablePath(cwd);
	const projectPrefix = cleanCwd.endsWith(sep) ? cleanCwd : `${cleanCwd}${sep}`;
	const buckets = new Map<string, SkillEntry[]>();
	for (const entry of entries) {
		const list = buckets.get(entry.name) ?? [];
		list.push(entry);
		buckets.set(entry.name, list);
	}
	const out: SkillEntry[] = [];
	for (const [, list] of buckets) {
		const projectScoped = list.find((e) => comparablePath(e.path).startsWith(projectPrefix));
		out.push(projectScoped ?? list[0]);
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

function fingerprint(files: string[]): string {
	const lines = [
		`schema:${REGISTRY_SCHEMA_VERSION}`,
		...files.map((f) => {
			try {
				const stat = statSync(f);
				return `${f}:${stat.mtimeMs}:${stat.size}`;
			} catch {
				return `${f}:missing`;
			}
		}),
	].sort();
	return createHash("sha1").update(lines.join("\n")).digest("hex");
}

function renderRegistry(cwd: string, sources: string[], entries: SkillEntry[]): string {
	const projectName = basename(cwd);
	const today = new Date().toISOString().slice(0, 10);
	const lines: string[] = [];
	lines.push(`# Skill Registry — ${projectName}`);
	lines.push("");
	lines.push("<!-- Auto-generated by extensions/skill-registry.ts. Run /skill-registry:refresh to regenerate. -->");
	lines.push("");
	lines.push(`Last updated: ${today}`);
	lines.push("");
	lines.push("## Sources scanned");
	lines.push("");
	for (const src of sources) {
		lines.push(`- ${src}`);
	}
	lines.push("");
	lines.push("## Contract");
	lines.push("");
	lines.push("**Delegator use only.** This registry is an index, not a summary. Any agent that launches subagents reads it to select relevant skills, then passes exact `SKILL.md` paths for the subagent to read before work.");
	lines.push("");
	lines.push("`SKILL.md` remains the source of truth. Do not inject generated summaries or compact rules by default; pass paths so subagents load the full runtime contract and preserve author intent.");
	lines.push("");
	lines.push(SECTION_MARKER);
	lines.push("");
	lines.push("| Skill | Trigger / description | Scope | Path |");
	lines.push("| --- | --- | --- | --- |");
	for (const entry of entries) {
		lines.push(`| \`${markdownCell(entry.name)}\` | ${markdownCell(entry.description)} | ${markdownCell(entry.scope ?? scopeForPath(cwd, entry.path))} | \`${markdownCell(entry.path)}\` |`);
	}
	lines.push("");
	lines.push("## Loading protocol");
	lines.push("");
	lines.push("1. Match task context and target files against the `Trigger / description` column.");
	lines.push("2. Pass only the matching `Path` values to the subagent under `## Skills to load before work`.");
	lines.push("3. Instruct the subagent to read those exact `SKILL.md` files before reading, writing, reviewing, testing, or creating artifacts.");
	lines.push("4. If no matching skill exists, proceed without project skill injection and report `skill_resolution: none`.");
	return `${lines.join("\n").trimEnd()}\n`;
}

interface RegenResult {
	regenerated: boolean;
	skillCount: number;
	reason: string;
}

function ensureAgentIgnored(cwd: string): void {
	const gitignorePath = join(cwd, ".gitignore");
	let existing = "";
	if (existsSync(gitignorePath)) {
		existing = readFileSync(gitignorePath, "utf8");
	}
	const hasAgentIgnore = existing
		.split("\n")
		.map((line) => line.trim())
		.some((line) => line === ".agent" || line === AGENT_IGNORE_ENTRY);
	if (hasAgentIgnore) return;
	const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
	const header = existing.includes("# Local Pi runtime state") ? "" : "# Local Pi runtime state\n";
	writeFileSync(gitignorePath, `${existing}${prefix}${header}${AGENT_IGNORE_ENTRY}\n`);
}

function isGeneratedLegacyProjectRegistry(source: string): boolean {
	return (
		source.includes("Auto-generated by .pi/extensions/skill-registry.ts") &&
		source.includes("const REGISTRY_REL_PATH = \".atl/skill-registry.md\"") &&
		source.includes("function projectSkillDirs(cwd: string): string[]") &&
		source.includes("function regenerateRegistry(cwd: string, force: boolean)") &&
		(!source.includes('join(cwd, "skills")') ||
			source.includes("const dirs = [...userSkillDirs(), ...projectSkillDirs(cwd)]") ||
			source.includes("if (rules.length === 0) return undefined"))
	);
}

function nextLegacyDisabledPath(cwd: string): string {
	const base = join(cwd, LEGACY_PROJECT_REGISTRY_DISABLED_REL_PATH);
	if (!existsSync(base)) return base;
	for (let i = 1; i < 100; i++) {
		const candidate = `${base}.${i}`;
		if (!existsSync(candidate)) return candidate;
	}
	return `${base}.${Date.now()}`;
}

function quarantineLegacyProjectRegistry(cwd: string): boolean {
	const legacyPath = join(cwd, LEGACY_PROJECT_REGISTRY_REL_PATH);
	if (!existsSync(legacyPath)) return false;
	let source = "";
	try {
		source = readFileSync(legacyPath, "utf8");
	} catch {
		return false;
	}
	if (!isGeneratedLegacyProjectRegistry(source)) return false;
	const disabledPath = nextLegacyDisabledPath(cwd);
	try {
		renameSync(legacyPath, disabledPath);
		return true;
	} catch {
		return false;
	}
}

function regenerateRegistry(cwd: string, force: boolean): RegenResult {
	const existingDirs = uniqueExistingDirs([...projectSkillDirs(cwd), ...userSkillDirs()]);
	const files = existingDirs.flatMap(findSkillFiles);
	const cachePath = join(cwd, CACHE_REL_PATH);
	const registryPath = join(cwd, REGISTRY_REL_PATH);
	const fp = fingerprint(files);
	let cached: string | undefined;
	if (existsSync(cachePath)) {
		try {
			const parsed: unknown = JSON.parse(readFileSync(cachePath, "utf8"));
			cached = isCacheFile(parsed) ? parsed.fingerprint : undefined;
		} catch {
			cached = undefined;
		}
	}
	if (!force && cached === fp && existsSync(registryPath)) {
		return { regenerated: false, skillCount: 0, reason: "cache-hit" };
	}
	const entries = files
		.map(loadSkill)
		.filter((e): e is SkillEntry => Boolean(e));
	const deduped = dedupeBySkillName(entries, cwd);
	const sources = existingDirs.map((d) => {
		const rel = relative(cwd, d);
		return rel.startsWith("..") ? d : rel || ".";
	});
	const md = renderRegistry(cwd, sources, deduped);
	mkdirSync(join(cwd, ".agent"), { recursive: true });
	writeFileSync(registryPath, md);
	writeFileSync(cachePath, JSON.stringify({ fingerprint: fp }, null, 2));
	return { regenerated: true, skillCount: deduped.length, reason: force ? "forced" : "fingerprint-changed" };
}

const watchedCwds = new Set<string>();

function isTruthyEnv(value: string | undefined): boolean {
	return value === "1" || value === "true" || value === "yes" || value === "on";
}

function hasCliArg(args: string[], ...names: string[]): boolean {
	return args.some((arg) => names.includes(arg));
}

function shouldSkipSkillRegistryStartup(
	pi: Pick<ExtensionAPI, "getFlag">,
	argv = process.argv.slice(2),
	env = process.env,
): boolean {
	return (
		pi.getFlag(NO_SKILL_REGISTRY_FLAG) === true ||
		isTruthyEnv(env[NO_SKILL_REGISTRY_ENV]) ||
		hasCliArg(argv, "--no-skills", "-ns")
	);
}

function startSkillRegistryWatcher(cwd: string, notify: (message: string) => void): void {
	if (watchedCwds.has(cwd)) return;
	watchedCwds.add(cwd);
	const dirs = uniqueExistingDirs([...projectSkillDirs(cwd), ...userSkillDirs()]);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const refresh = () => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			try {
				const result = regenerateRegistry(cwd, false);
				if (result.regenerated) {
					notify(`Skill registry refreshed (${result.skillCount} skills)`);
				}
			} catch {
				// Keep the watcher best-effort; session_start/manual refresh surfaces detailed failures.
			}
		}, WATCH_DEBOUNCE_MS);
	};
	for (const dir of dirs) {
		try {
			watch(dir, { recursive: true }, refresh);
		} catch {
			// Some filesystems do not support recursive watches; session_start/manual refresh still work.
		}
	}
}

export const __testing = {
	projectSkillDirs,
	userSkillDirs,
	uniqueExistingDirs,
	dedupeBySkillName,
	scopeForPath,
	normalizeSkillDescription,
	parseFrontmatter,
	renderRegistry,
	shouldSkipSkillRegistryStartup,
};

export default function (pi: ExtensionAPI) {
	pi.registerFlag(NO_SKILL_REGISTRY_FLAG, {
		description: "Skip the skill registry refresh and watcher on startup.",
		type: "boolean",
		default: false,
	});

	pi.on("session_start", (_event, ctx) => {
		if (shouldSkipSkillRegistryStartup(pi)) return;

		// Keep Pi startup non-blocking. The cached registry is available
		// immediately; refresh happens after the UI/session has opened.
		setTimeout(() => {
			try {
				ensureAgentIgnored(ctx.cwd);
				const quarantinedLegacy = quarantineLegacyProjectRegistry(ctx.cwd);
				const result = regenerateRegistry(ctx.cwd, quarantinedLegacy);
				if (result.regenerated && ctx.hasUI) {
					ctx.ui.notify(`Skill registry refreshed (${result.skillCount} skills)`, "info");
				}
				if (quarantinedLegacy && ctx.hasUI) {
					ctx.ui.notify(
						"Disabled stale project-local skill registry extension; using package registry with project skills first.",
						"warning",
					);
				}
			} catch (error) {
				if (ctx.hasUI) {
					const message = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`Skill registry refresh failed: ${message}`, "warning");
				}
			}
		}, 0);
	});

	pi.registerCommand("skill-registry:refresh", {
		description: "Regenerate .agent/skill-registry.md from local skill sources.",
		handler: async (_args, ctx) => {
			try {
				ensureAgentIgnored(ctx.cwd);
				const result = regenerateRegistry(ctx.cwd, true);
				ctx.ui.notify(
					`Skill registry: ${result.skillCount} skill(s) written to ${REGISTRY_REL_PATH}`,
					"info",
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Skill registry refresh failed: ${message}`, "warning");
			}
		},
	});
}
