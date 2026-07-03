import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ASSETS_DIR = join(PACKAGE_ROOT, "assets");
const ORCHESTRATOR_PROMPT_PATH = join(ASSETS_DIR, "orchestrator.md");
const REQUIRED_ASSET_DIRS = [
	"assets/agents",
	"assets/chains",
	"assets/support",
] as const;
const REQUIRED_EXTENSION_FILES = [
	"extensions/harness.ts",
	"extensions/shell-guard.ts",
	"extensions/mcp.ts",
	"extensions/engram.ts",
	"extensions/sdd-orchestrator.ts",
	"extensions/skill-registry.ts",
] as const;
const REQUIRED_VENDOR_SURFACE = [
	{ path: "vendor/pi-subagents", kind: "dir" as const, status: "fail" as const },
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
	engramCliAvailable?: boolean;
}

interface HarnessDoctorReport {
	checks: DoctorCheck[];
	message: string;
	severity: DoctorSeverity;
}

function readOrchestratorPrompt(): string | undefined {
	if (!existsSync(ORCHESTRATOR_PROMPT_PATH)) return undefined;

	try {
		const content = readFileSync(ORCHESTRATOR_PROMPT_PATH, "utf8").trim();
		return content.length > 0 ? content : undefined;
	} catch {
		return undefined;
	}
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

export function buildHarnessDoctorReport(options: HarnessDoctorOptions): HarnessDoctorReport {
	const packageRoot = options.packageRoot ?? PACKAGE_ROOT;
	const cwd = options.cwd;
	const probe = options.probe ?? probePath;
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
		...REQUIRED_ASSET_DIRS.map((relativePath) =>
			expectedPathCheck(
				probe,
				join(packageRoot, relativePath),
				"dir",
				"fail",
				relativePath,
			),
		),
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

export function isOrchestratorRoot(): boolean {
	return true;
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
