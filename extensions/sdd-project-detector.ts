import { access, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";

export interface SddCommand {
	command: string;
	purpose: string;
	source: string;
	reliable: boolean;
}

export interface SddProjectDetection {
	projectName: string;
	cwd: string;
	detectedAt: string;
	packageManagers: Array<{ name: string; version?: string; source: string }>;
	stack: Array<{ name: string; confidence: "high" | "medium" | "low"; evidence: string[] }>;
	scripts: Record<string, string>;
	commands: {
		test?: SddCommand;
		check?: SddCommand;
		typecheck?: SddCommand;
		lint?: SddCommand;
		format?: SddCommand;
		coverage?: SddCommand;
		runtimeVerify?: SddCommand;
		byPurpose: Record<string, SddCommand[]>;
	};
	strictTdd: boolean;
	evidence: string[];
	legacy?: { openspecConfigFound: boolean; summary?: string };
}

interface PackageJsonData {
	name?: string;
	type?: string;
	packageManager?: string;
	scripts: Record<string, string>;
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
}

const LOCKFILES: Array<{ file: string; name: string }> = [
	{ file: "pnpm-lock.yaml", name: "pnpm" },
	{ file: "package-lock.json", name: "npm" },
	{ file: "yarn.lock", name: "yarn" },
	{ file: "bun.lockb", name: "bun" },
	{ file: "bun.lock", name: "bun" },
];

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
	if (!isRecord(value)) return {};
	const entries = Object.entries(value).filter(
		(entry): entry is [string, string] => typeof entry[1] === "string",
	);
	return Object.fromEntries(entries);
}

async function readPackageJson(cwd: string): Promise<PackageJsonData | undefined> {
	const path = join(cwd, "package.json");
	if (!(await fileExists(path))) return undefined;
	const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
	if (!isRecord(parsed)) return undefined;
	return {
		name: typeof parsed.name === "string" ? parsed.name : undefined,
		type: typeof parsed.type === "string" ? parsed.type : undefined,
		packageManager:
			typeof parsed.packageManager === "string" ? parsed.packageManager : undefined,
		scripts: stringRecord(parsed.scripts),
		dependencies: stringRecord(parsed.dependencies),
		devDependencies: stringRecord(parsed.devDependencies),
	};
}

function parsePackageManager(value: string): { name: string; version?: string } {
	const separator = value.lastIndexOf("@");
	if (separator > 0) {
		return { name: value.slice(0, separator), version: value.slice(separator + 1) };
	}
	return { name: value };
}

async function detectPackageManagers(
	cwd: string,
	packageJson: PackageJsonData | undefined,
): Promise<Array<{ name: string; version?: string; source: string }>> {
	if (packageJson?.packageManager) {
		return [
			{
				...parsePackageManager(packageJson.packageManager),
				source: "package.json#packageManager",
			},
		];
	}

	const managers: Array<{ name: string; version?: string; source: string }> = [];
	for (const lockfile of LOCKFILES) {
		if (await fileExists(join(cwd, lockfile.file))) {
			managers.push({ name: lockfile.name, source: lockfile.file });
		}
	}
	return managers;
}

function commandPrefix(packageManagers: Array<{ name: string }>, packageJson: PackageJsonData | undefined): string {
	return packageManagers[0]?.name ?? (packageJson ? "npm" : "make");
}

function scriptCommand(manager: string, script: string): string {
	if (script === "test") return `${manager} test`;
	return `${manager} run ${script}`;
}

function buildCommand(manager: string, script: string, purpose: string): SddCommand {
	return {
		command: scriptCommand(manager, script),
		purpose,
		source: `package.json#scripts.${script}`,
		reliable: true,
	};
}

function addCommand(target: Record<string, SddCommand[]>, command: SddCommand): void {
	target[command.purpose] = [...(target[command.purpose] ?? []), command];
}

function detectCommands(scripts: Record<string, string>, manager: string): SddProjectDetection["commands"] {
	const byPurpose: Record<string, SddCommand[]> = {};
	const commands: SddProjectDetection["commands"] = { byPurpose };

	if (typeof scripts.test === "string") {
		commands.test = buildCommand(manager, "test", "test");
		addCommand(byPurpose, commands.test);
	}
	if (typeof scripts.check === "string") {
		commands.check = buildCommand(manager, "check", "check");
		commands.typecheck = { ...commands.check, purpose: "typecheck" };
		addCommand(byPurpose, commands.check);
		addCommand(byPurpose, commands.typecheck);
	} else if (typeof scripts.typecheck === "string") {
		commands.typecheck = buildCommand(manager, "typecheck", "typecheck");
		addCommand(byPurpose, commands.typecheck);
	}
	if (typeof scripts.lint === "string") {
		commands.lint = buildCommand(manager, "lint", "lint");
		addCommand(byPurpose, commands.lint);
	}
	if (typeof scripts.format === "string") {
		commands.format = buildCommand(manager, "format", "format");
		addCommand(byPurpose, commands.format);
	}
	if (typeof scripts.coverage === "string") {
		commands.coverage = buildCommand(manager, "coverage", "coverage");
		addCommand(byPurpose, commands.coverage);
	}
	if (typeof scripts["verify:runtime"] === "string") {
		commands.runtimeVerify = buildCommand(manager, "verify:runtime", "runtime-verify");
		addCommand(byPurpose, commands.runtimeVerify);
	}

	return commands;
}

async function detectStack(cwd: string, packageJson: PackageJsonData | undefined): Promise<SddProjectDetection["stack"]> {
	const stack: SddProjectDetection["stack"] = [];
	if (packageJson) {
		stack.push({ name: "Node.js", confidence: "high", evidence: ["package.json"] });
	}
	const tsEvidence: string[] = [];
	if (await fileExists(join(cwd, "tsconfig.json"))) tsEvidence.push("tsconfig.json");
	if (packageJson?.dependencies.typescript) tsEvidence.push("package.json#dependencies.typescript");
	if (packageJson?.devDependencies.typescript) tsEvidence.push("package.json#devDependencies.typescript");
	if (tsEvidence.length > 0) {
		stack.push({ name: "TypeScript", confidence: "high", evidence: tsEvidence });
	}
	if (packageJson?.type === "module") {
		stack.push({ name: "ESM", confidence: "high", evidence: ["package.json#type=module"] });
	}
	return stack;
}

async function readLegacy(cwd: string): Promise<SddProjectDetection["legacy"]> {
	const path = join(cwd, "openspec", "config.yaml");
	if (!(await fileExists(path))) return { openspecConfigFound: false };
	const content = await readFile(path, "utf8");
	return { openspecConfigFound: true, summary: content.slice(0, 500) };
}

async function collectEvidence(cwd: string): Promise<string[]> {
	const candidates = [
		"package.json",
		"tsconfig.json",
		"Makefile",
		"openspec/config.yaml",
		...LOCKFILES.map((lockfile) => lockfile.file),
	];
	const evidence: string[] = [];
	for (const candidate of candidates) {
		if (await fileExists(join(cwd, candidate))) evidence.push(candidate);
	}
	return evidence;
}

export async function detectSddProject(options: {
	cwd: string;
	projectName?: string;
	now?: () => Date;
}): Promise<SddProjectDetection> {
	const cwdStat = await stat(options.cwd);
	if (!cwdStat.isDirectory()) throw new Error(`Not a directory: ${options.cwd}`);
	const packageJson = await readPackageJson(options.cwd);
	const packageManagers = await detectPackageManagers(options.cwd, packageJson);
	const manager = commandPrefix(packageManagers, packageJson);
	const scripts = packageJson?.scripts ?? {};
	const commands = detectCommands(scripts, manager);
	const legacy = await readLegacy(options.cwd);

	return {
		projectName: options.projectName ?? packageJson?.name ?? basename(options.cwd),
		cwd: options.cwd,
		detectedAt: (options.now ?? (() => new Date()))().toISOString(),
		packageManagers,
		stack: await detectStack(options.cwd, packageJson),
		scripts,
		commands,
		strictTdd: commands.test?.reliable === true,
		evidence: await collectEvidence(options.cwd),
		legacy,
	};
}

function formatCommand(command: SddCommand | undefined): string {
	return command ? `\`${command.command}\`` : "not detected";
}

export function renderSddInitMarkdown(detection: SddProjectDetection): string {
	const packageManagers = detection.packageManagers.length > 0
		? detection.packageManagers.map((manager) => {
			const version = manager.version ? `@${manager.version}` : "";
			return `- ${manager.name}${version} (${manager.source})`;
		}).join("\n")
		: "- none detected";
	const stack = detection.stack.length > 0
		? detection.stack.map((item) => `- ${item.name} (${item.confidence}): ${item.evidence.join(", ")}`).join("\n")
		: "- none detected";
	const evidence = detection.evidence.length > 0
		? detection.evidence.map((item) => `- ${item}`).join("\n")
		: "- none detected";

	return [
		`# SDD Project Detection: ${detection.projectName}`,
		"",
		`Detected at: ${detection.detectedAt}`,
		`Repository: ${detection.cwd}`,
		"",
		"## Package managers",
		packageManagers,
		"",
		"## Stack",
		stack,
		"",
		"## Commands",
		`- Primary test command: ${formatCommand(detection.commands.test)}`,
		`- Primary check command: ${formatCommand(detection.commands.check)}`,
		`- Typecheck command: ${formatCommand(detection.commands.typecheck)}`,
		`- Runtime verification command: ${formatCommand(detection.commands.runtimeVerify)}`,
		"",
		`Strict TDD: \`${detection.strictTdd}\``,
		"",
		"## Evidence",
		evidence,
	].join("\n");
}
