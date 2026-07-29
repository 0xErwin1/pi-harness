import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import harness, { buildHarnessDoctorReport } from "../../extensions/harness.ts";

const NATIVE_SUBAGENT_PACKAGE = "npm:pi-subagents-j0k3r@1.4.4";

function createProbe(files: string[], dirs: string[]) {
	const fileSet = new Set(files);
	const dirSet = new Set(dirs);
	return (path: string) => {
		if (fileSet.has(path)) return "file" as const;
		if (dirSet.has(path)) return "dir" as const;
		return "missing" as const;
	};
}

test("buildHarnessDoctorReport reports a clean runtime surface", () => {
	const packageRoot = "/repo";
	const cwd = "/repo/worktree";
	const agentHome = "/home/tester/.pi/agent";
	const probe = createProbe(
		[
			join(packageRoot, "assets", "orchestrator.md"),
			join(packageRoot, "assets", "agents", "sdd-explore-testing.md"),
			join(packageRoot, "assets", "agents", "sdd-plan-testing.md"),
			join(packageRoot, "assets", "agents", "sdd-run-testing.md"),
			join(packageRoot, "assets", "agents", "sdd-report-testing.md"),
			join(packageRoot, "assets", "support", "setup-testing.md"),
			join(packageRoot, "assets", "support", "sdd-testing-context.md"),
			join(packageRoot, "assets", "support", "visual-diff.md"),
			join(packageRoot, "extensions", "harness.ts"),
			join(packageRoot, "extensions", "shell-guard.ts"),
			join(packageRoot, "extensions", "mcp.ts"),
			join(packageRoot, "extensions", "engram.ts"),
			join(packageRoot, "extensions", "sdd-orchestrator.ts"),
			join(packageRoot, "extensions", "skill-registry.ts"),
			join(packageRoot, "extensions", "btw.ts"),
			join(packageRoot, "vendor", "pi-ask-user", "index.ts"),
			join(packageRoot, "vendor", "pi-ask-user", "upstream.ts"),
			join(packageRoot, "vendor", "pi-ask-user", "single-select-layout.ts"),
			join(packageRoot, "vendor", "pi-ask-user", "package.json"),
			join(packageRoot, "vendor", "pi-ask-user", "LICENSE"),
			join(packageRoot, "vendor", "pi-ask-user", "README.md"),
			join(packageRoot, "vendor", "pi-ask-user", "skills", "ask-user", "SKILL.md"),
			join(cwd, ".agent", "skill-registry.md"),
			join(agentHome, "mcp.json"),
		],
		[
			join(packageRoot, "assets", "agents"),
			join(packageRoot, "assets", "chains"),
			join(packageRoot, "assets", "support"),
			join(packageRoot, "vendor", "pi-ask-user"),
		],
	);

	const report = buildHarnessDoctorReport({
		cwd,
		packageRoot,
		agentHome,
		probe,
		engramCliAvailable: true,
		readText: (path) => path === join(agentHome, "settings.json")
			? JSON.stringify({ packages: [NATIVE_SUBAGENT_PACKAGE] })
			: "",
		renderPrompt: () => "rendered orchestrator core",
	});

	assert.equal(report.checks.length, 32);
	assert.equal(report.severity, "info");
	assert.ok(report.checks.every((check) => check.status === "pass"));
	assert.match(report.message, /^pi-harness doctor/m);
	assert.match(report.message, /pass: assets\/orchestrator\.md present/);
	assert.match(report.message, /pass: assets\/orchestrator\.md renders/);
	assert.match(report.message, /pass: Engram CLI available/);
	assert.match(report.message, /pass: SDD-testing assets are provider-neutral/);
	assert.match(report.message, /pass: .*settings\.json contains npm:pi-subagents-j0k3r@1\.4\.4/);
	assert.doesNotMatch(report.message, /vendor\/pi-subagents|packages\/subagents-compat/);
});

test("buildHarnessDoctorReport clearly reports missing or malformed native subagent configuration", () => {
	const baseOptions = {
		cwd: "/repo/worktree",
		packageRoot: "/repo",
		agentHome: "/home/tester/.pi/agent",
		probe: createProbe([], []),
		engramCliAvailable: true,
		renderPrompt: () => "rendered orchestrator core",
	};

	const missing = buildHarnessDoctorReport({ ...baseOptions, readText: () => undefined });
	assert.match(missing.message, /fail: .*settings\.json missing; add npm:pi-subagents-j0k3r@1\.4\.4 to the packages array/);

	const malformed = buildHarnessDoctorReport({ ...baseOptions, readText: () => "{not-json" });
	assert.match(malformed.message, /fail: .*settings\.json is malformed JSON; add npm:pi-subagents-j0k3r@1\.4\.4 to the packages array/);

	const unconfigured = buildHarnessDoctorReport({
		...baseOptions,
		readText: () => JSON.stringify({ packages: ["npm:another-package@1.0.0"] }),
	});
	assert.match(unconfigured.message, /fail: .*settings\.json packages must contain exact npm:pi-subagents-j0k3r@1\.4\.4/);
});

test("buildHarnessDoctorReport fails the placeholder-resolution check when rendering throws", () => {
	const packageRoot = "/repo";
	const cwd = "/repo/worktree";
	const report = buildHarnessDoctorReport({
		cwd,
		packageRoot,
		agentHome: "/home/tester/.pi/agent",
		probe: createProbe([join(packageRoot, "assets", "orchestrator.md")], []),
		engramCliAvailable: true,
		renderPrompt: () => {
			throw new Error("renderOrchestratorPrompt: unknown placeholder {{NOT_REGISTERED}}");
		},
	});

	assert.equal(report.severity, "warning");
	assert.match(report.message, /fail: assets\/orchestrator\.md failed to render: renderOrchestratorPrompt: unknown placeholder \{\{NOT_REGISTERED\}\}/);
});

test("buildHarnessDoctorReport flags missing optional and critical surface entries", () => {
	const packageRoot = "/repo";
	const cwd = "/repo/worktree";
	const report = buildHarnessDoctorReport({
		cwd,
		packageRoot,
		agentHome: "/home/tester/.pi/agent",
		probe: createProbe([], []),
		engramCliAvailable: false,
	});

	assert.equal(report.severity, "warning");
	assert.match(report.message, /fail: assets\/orchestrator\.md missing/);
	assert.match(report.message, /warn: \.agent\/skill-registry\.md missing/);
	assert.match(report.message, /warn: Engram CLI not available on PATH/);
});


test("buildHarnessDoctorReport rejects provider-specific MCP names in testing assets", () => {
	const packageRoot = "/repo";
	const cwd = "/repo/worktree";
	const agentHome = "/home/tester/.pi/agent";
	const testingSurface = [
		"assets/agents/sdd-explore-testing.md",
		"assets/agents/sdd-plan-testing.md",
		"assets/agents/sdd-run-testing.md",
		"assets/agents/sdd-report-testing.md",
		"assets/support/setup-testing.md",
		"assets/support/sdd-testing-context.md",
		"assets/support/visual-diff.md",
	];
	const existingFiles = [
		"assets/orchestrator.md",
		"extensions/harness.ts",
		"extensions/shell-guard.ts",
		"extensions/mcp.ts",
		"extensions/engram.ts",
		"extensions/sdd-orchestrator.ts",
		"extensions/skill-registry.ts",
		"extensions/btw.ts",
		"vendor/pi-ask-user/index.ts",
		"vendor/pi-ask-user/upstream.ts",
		"vendor/pi-ask-user/single-select-layout.ts",
		"vendor/pi-ask-user/package.json",
		"vendor/pi-ask-user/LICENSE",
		"vendor/pi-ask-user/README.md",
		"vendor/pi-ask-user/skills/ask-user/SKILL.md",
		".agent/skill-registry.md",
		...testingSurface,
	];
	const report = buildHarnessDoctorReport({
		cwd,
		packageRoot,
		agentHome,
		probe: createProbe(
			existingFiles.map((relativePath) => relativePath.startsWith(".") ? join(cwd, relativePath) : join(packageRoot, relativePath)),
			[
				join(packageRoot, "assets", "agents"),
				join(packageRoot, "assets", "chains"),
				join(packageRoot, "assets", "support"),
				join(packageRoot, "vendor", "pi-ask-user"),
			],
		),
		engramCliAvailable: true,
		readText: (absolutePath: string) => absolutePath.endsWith("sdd-run-testing.md") ? "tools:\n  - mcp__browser" : "",
	} as any);

	assert.equal(report.severity, "warning");
	assert.match(report.message, /fail: SDD-testing assets contain provider-specific MCP tool names/);
	assert.match(report.message, /assets\/agents\/sdd-run-testing\.md: mcp__browser/);
});


test("extension registers doctor and status commands", () => {
	const commands = new Map<string, unknown>();
	const handlers = new Map<string, unknown>();
	const pi = {
		on(event: string, handler: unknown) {
			handlers.set(event, handler);
		},
		registerCommand(name: string, command: unknown) {
			commands.set(name, command);
		},
	};

	harness(pi as any);

	assert.ok(handlers.has("before_agent_start"));
	assert.ok(commands.has("harness:doctor"));
	assert.ok(commands.has("pi-harness:status"));
});

test("before_agent_start injects the orchestrator prompt in the parent session", () => {
	type BeforeAgentStartHandler = (event: { systemPrompt: string }, ctx: object) => { systemPrompt: string } | undefined;
	const handlers = new Map<string, BeforeAgentStartHandler>();
	const pi = {
		on(event: string, handler: BeforeAgentStartHandler) {
			handlers.set(event, handler);
		},
		registerCommand() {},
	};

	harness(pi as any);
	const handler = handlers.get("before_agent_start");
	assert.equal(typeof handler, "function");

	const result = handler?.({ systemPrompt: "parent prompt" }, {});
	assert.ok(result);
	assert.ok(result.systemPrompt.startsWith("parent prompt\n\n"));
	assert.ok(result.systemPrompt.length > "parent prompt\n\n".length);
});
