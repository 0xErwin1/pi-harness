import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderOrchestratorPrompt } from "../packages/orchestrator-prompt/render.ts";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ASSETS_DIR = join(PACKAGE_ROOT, "assets");
const ORCHESTRATOR_PROMPT_PATH = join(ASSETS_DIR, "orchestrator.md");
const SUBAGENT_INVOCATION_KEY = Symbol.for("pi-harness.subagentInvocationContext");
const REQUIRED_ASSET_DIRS = [
	"assets/agents",
	"assets/chains",
	"assets/support",
] as const;
const REQUIRED_SDD_TESTING_SURFACE = [
	{ path: "assets/agents/sdd-explore-testing.md", kind: "file" as const, status: "fail" as const },
	{ path: "assets/agents/sdd-plan-testing.md", kind: "file" as const, status: "fail" as const },
	{ path: "assets/agents/sdd-run-testing.md", kind: "file" as const, status: "fail" as const },
	{ path: "assets/agents/sdd-report-testing.md", kind: "file" as const, status: "fail" as const },
	{ path: "assets/support/setup-testing.md", kind: "file" as const, status: "fail" as const },
	{ path: "assets/support/sdd-testing-context.md", kind: "file" as const, status: "fail" as const },
	{ path: "assets/support/visual-diff.md", kind: "file" as const, status: "fail" as const },
] as const;
const REQUIRED_EXTENSION_FILES = [
	"extensions/harness.ts",
	"extensions/shell-guard.ts",
	"extensions/mcp.ts",
	"extensions/engram.ts",
	"extensions/sdd-orchestrator.ts",
	"extensions/skill-registry.ts",
	"extensions/btw.ts",
] as const;
const REQUIRED_VENDOR_SURFACE = [
	{ path: "vendor/pi-subagents", kind: "dir" as const, status: "fail" as const },
	{ path: "vendor/pi-subagents/src/index.ts", kind: "file" as const, status: "fail" as const },
	{ path: "vendor/pi-ask-user", kind: "dir" as const, status: "fail" as const },
	{ path: "vendor/pi-ask-user/index.ts", kind: "file" as const, status: "fail" as const },
	{ path: "vendor/pi-ask-user/upstream.ts", kind: "file" as const, status: "fail" as const },
	{ path: "vendor/pi-ask-user/single-select-layout.ts", kind: "file" as const, status: "fail" as const },
	{ path: "vendor/pi-ask-user/package.json", kind: "file" as const, status: "fail" as const },
	{ path: "vendor/pi-ask-user/LICENSE", kind: "file" as const, status: "fail" as const },
	{ path: "vendor/pi-ask-user/README.md", kind: "file" as const, status: "fail" as const },
	{ path: "vendor/pi-ask-user/skills/ask-user/SKILL.md", kind: "file" as const, status: "fail" as const },
	{
		path: "packages/subagents-compat/index.ts",
		kind: "file" as const,
		status: "fail" as const,
	},
] as const;

type DoctorStatus = "pass" | "warn" | "fail";
type DoctorSeverity = "info" | "warning";
type PathKind = "file" | "dir" | "missing";

interface DoctorCheck {
	status: DoctorStatus;
	path: string;
	message: string;
}

interface HarnessDoctorOptions {
	cwd: string;
	packageRoot?: string;
	agentHome?: string;
	probe?: (path: string) => PathKind;
	readText?: (path: string) => string | undefined;
	renderPrompt?: (assetsDir: string) => string;
	engramCliAvailable?: boolean;
}

interface HarnessDoctorReport {
	checks: DoctorCheck[];
	message: string;
	severity: DoctorSeverity;
}

/**
 * Renders and returns the orchestrator core prompt, or `undefined` when no
 * `orchestrator.md` is installed at all.
 *
 * Deliberately does NOT catch a `renderOrchestratorPrompt` failure: an
 * unresolved or missing lazy-file placeholder is a packaging defect, and
 * starting a session with a silently-incomplete orchestrator prompt is worse
 * than failing loudly here.
 */
function readOrchestratorPrompt(): string | undefined {
	if (!existsSync(ORCHESTRATOR_PROMPT_PATH)) return undefined;

	const content = renderOrchestratorPrompt(ASSETS_DIR).trim();
	return content.length > 0 ? content : undefined;
}

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function probePath(path: string): PathKind {
	try {
		const stat = statSync(path);
		if (stat.isDirectory()) return "dir";
		if (stat.isFile()) return "file";
		return "missing";
	} catch {
		return "missing";
	}
}

function readText(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

function detectEngramCliAvailable(): boolean {
	try {
		const result = spawnSync("engram", ["--version"], {
			stdio: "ignore",
			timeout: 1_000,
		});
		return result.error === undefined;
	} catch {
		return false;
	}
}

function doctorSeverity(checks: DoctorCheck[]): DoctorSeverity {
	return checks.some((check) => check.status !== "pass") ? "warning" : "info";
}

function formatDoctorReport(checks: DoctorCheck[]): string {
	return [
		"pi-harness doctor",
		...checks.map((check) => `${check.status}: ${check.message}`),
	].join("\n");
}

function expectedPathCheck(
	probe: (path: string) => PathKind,
	absolutePath: string,
	expectedKind: Exclude<PathKind, "missing">,
	statusWhenMissing: Exclude<DoctorStatus, "pass">,
	displayPath: string,
): DoctorCheck {
	const actualKind = probe(absolutePath);
	if (actualKind === expectedKind) {
		return {
			status: "pass",
			path: displayPath,
			message: `${displayPath} present`,
		};
	}

	return {
		status: statusWhenMissing,
		path: displayPath,
		message: `${displayPath} missing`,
	};
}

function providerSpecificMcpCheck(packageRoot: string, currentReadText: (path: string) => string | undefined): DoctorCheck {
	const references: string[] = [];
	const providerSpecificMcpName = /\bmcp__[A-Za-z0-9_]+\b/g;

	for (const item of REQUIRED_SDD_TESTING_SURFACE) {
		const content = currentReadText(join(packageRoot, item.path));
		if (content === undefined) continue;

		const matches = content.match(providerSpecificMcpName) ?? [];
		for (const match of matches) {
			references.push(`${item.path}: ${match}`);
		}
	}

	if (references.length === 0) {
		return {
			status: "pass",
			path: "assets/sdd-testing-provider-neutral",
			message: "SDD-testing assets are provider-neutral",
		};
	}

	return {
		status: "fail",
		path: "assets/sdd-testing-provider-neutral",
		message: `SDD-testing assets contain provider-specific MCP tool names: ${references.join(", ")}`,
	};
}

function orchestratorPromptResolutionCheck(
	packageRoot: string,
	currentRenderPrompt: (assetsDir: string) => string,
): DoctorCheck {
	try {
		currentRenderPrompt(join(packageRoot, "assets"));
		return {
			status: "pass",
			path: "assets/orchestrator.md#placeholders",
			message: "assets/orchestrator.md renders — every lazy-file placeholder resolves to an existing absolute path",
		};
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			status: "fail",
			path: "assets/orchestrator.md#placeholders",
			message: `assets/orchestrator.md failed to render: ${reason}`,
		};
	}
}

export function buildHarnessDoctorReport(options: HarnessDoctorOptions): HarnessDoctorReport {
	const packageRoot = options.packageRoot ?? PACKAGE_ROOT;
	const cwd = options.cwd;
	const probe = options.probe ?? probePath;
	const currentReadText = options.readText ?? readText;
	const currentRenderPrompt = options.renderPrompt ?? renderOrchestratorPrompt;
	const currentAgentDir = options.agentHome ?? agentDir();
	const engramCliAvailable = options.engramCliAvailable ?? detectEngramCliAvailable();
	const checks: DoctorCheck[] = [
		expectedPathCheck(
			probe,
			join(packageRoot, "assets", "orchestrator.md"),
			"file",
			"fail",
			"assets/orchestrator.md",
		),
		orchestratorPromptResolutionCheck(packageRoot, currentRenderPrompt),
		...REQUIRED_ASSET_DIRS.map((relativePath) =>
			expectedPathCheck(
				probe,
				join(packageRoot, relativePath),
				"dir",
				"fail",
				relativePath,
			),
		),
		...REQUIRED_SDD_TESTING_SURFACE.map((item) =>
			expectedPathCheck(
				probe,
				join(packageRoot, item.path),
				item.kind,
				item.status,
				item.path,
			),
		),
		providerSpecificMcpCheck(packageRoot, currentReadText),
		...REQUIRED_EXTENSION_FILES.map((relativePath) =>
			expectedPathCheck(
				probe,
				join(packageRoot, relativePath),
				"file",
				"fail",
				relativePath,
			),
		),
		...REQUIRED_VENDOR_SURFACE.map((item) =>
			expectedPathCheck(
				probe,
				join(packageRoot, item.path),
				item.kind,
				item.status,
				item.path,
			),
		),
		expectedPathCheck(
			probe,
			join(cwd, ".agent", "skill-registry.md"),
			"file",
			"warn",
			".agent/skill-registry.md",
		),
		expectedPathCheck(
			probe,
			join(currentAgentDir, "mcp.json"),
			"file",
			"warn",
			join(currentAgentDir, "mcp.json"),
		),
	];

	checks.push({
		status: engramCliAvailable ? "pass" : "warn",
		path: "engram",
		message: engramCliAvailable ? "Engram CLI available" : "Engram CLI not available on PATH",
	});

	return {
		checks,
		message: formatDoctorReport(checks),
		severity: doctorSeverity(checks),
	};
}

function hasAsyncLocalSubagentInvocation(): boolean {
	const storage = (globalThis as Record<symbol, { getStore?: () => { depth?: number; native?: boolean } | undefined } | undefined>)[SUBAGENT_INVOCATION_KEY];
	const context = storage?.getStore?.();
	return context?.native === true || (context?.depth ?? 0) > 0;
}

export function isSubagentProcess(env: Record<string, string | undefined> = process.env): boolean {
	if (env === process.env && hasAsyncLocalSubagentInvocation()) return true;
	const depth = Number.parseInt(env.PI_HARNESS_SUBAGENT_DEPTH ?? "0", 10);
	return env.PI_HARNESS_PARENT_AGENT_ID !== undefined || env.PI_HARNESS_NATIVE_SUBAGENT === "1" || depth > 0;
}

export function shouldInjectOrchestratorPrompt(env: Record<string, string | undefined> = process.env): boolean {
	return !isSubagentProcess(env);
}

export function isOrchestratorRoot(): boolean {
	return shouldInjectOrchestratorPrompt();
}

export const __testing = {
	doctorSeverity,
	formatDoctorReport,
	probePath,
};

export default function harness(pi: ExtensionAPI): void {
	pi.on("before_agent_start", (event, _ctx) => {
		if (!isOrchestratorRoot()) return undefined;

		const orchestratorPrompt = readOrchestratorPrompt();
		if (!orchestratorPrompt) return undefined;

		return {
			systemPrompt: `${event.systemPrompt}\n\n${orchestratorPrompt}`,
		};
	});

	const doctorHandler = async (_args: string, ctx: { cwd: string; ui?: { notify?: (message: string, severity: DoctorSeverity) => void } }) => {
		const report = buildHarnessDoctorReport({ cwd: ctx.cwd });
		const notify = ctx.ui?.notify;
		if (typeof notify !== "function") return;
		try {
			notify(report.message, report.severity);
		} catch {}
	};

	pi.registerCommand("harness:doctor", {
		description: "Run read-only pi-harness runtime diagnostics for this workspace.",
		handler: doctorHandler,
	});

	pi.registerCommand("pi-harness:status", {
		description: "Show pi-harness runtime surface status for this workspace.",
		handler: doctorHandler,
	});
}
