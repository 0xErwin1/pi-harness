import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import harness, { buildHarnessDoctorReport } from "../../extensions/harness.ts";

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
			join(packageRoot, "extensions", "harness.ts"),
			join(packageRoot, "extensions", "shell-guard.ts"),
			join(packageRoot, "extensions", "mcp.ts"),
			join(packageRoot, "extensions", "engram.ts"),
			join(packageRoot, "extensions", "sdd-orchestrator.ts"),
			join(packageRoot, "extensions", "skill-registry.ts"),
			join(packageRoot, "packages", "subagents-compat", "index.ts"),
			join(cwd, ".agent", "skill-registry.md"),
			join(agentHome, "mcp.json"),
		],
		[
			join(packageRoot, "assets", "agents"),
			join(packageRoot, "assets", "chains"),
			join(packageRoot, "assets", "support"),
			join(packageRoot, "vendor", "pi-subagents"),
		],
	);

	const report = buildHarnessDoctorReport({
		cwd,
		packageRoot,
		agentHome,
		probe,
		engramCliAvailable: true,
	});

	assert.equal(report.checks.length, 15);
	assert.equal(report.severity, "info");
	assert.ok(report.checks.every((check) => check.status === "pass"));
	assert.match(report.message, /^pi-harness doctor/m);
	assert.match(report.message, /pass: assets\/orchestrator\.md present/);
	assert.match(report.message, /pass: Engram CLI available/);
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
