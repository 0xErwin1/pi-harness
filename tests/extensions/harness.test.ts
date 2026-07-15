import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import harness, { buildHarnessDoctorReport, shouldInjectOrchestratorPrompt } from "../../extensions/harness.ts";
import { getSubagentInvocationContext, withSubagentProcessEnv } from "../../vendor/pi-subagents/src/invocation-config.ts";

function createProbe(files: string[], dirs: string[]) {
	const fileSet = new Set(files);
	const dirSet = new Set(dirs);
	return (path: string) => {
		if (fileSet.has(path)) return "file" as const;
		if (dirSet.has(path)) return "dir" as const;
		return "missing" as const;
	};
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
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
			join(packageRoot, "vendor", "pi-subagents", "src", "index.ts"),
			join(packageRoot, "vendor", "pi-ask-user", "index.ts"),
			join(packageRoot, "vendor", "pi-ask-user", "upstream.ts"),
			join(packageRoot, "vendor", "pi-ask-user", "single-select-layout.ts"),
			join(packageRoot, "vendor", "pi-ask-user", "package.json"),
			join(packageRoot, "vendor", "pi-ask-user", "LICENSE"),
			join(packageRoot, "vendor", "pi-ask-user", "README.md"),
			join(packageRoot, "vendor", "pi-ask-user", "skills", "ask-user", "SKILL.md"),
			join(packageRoot, "packages", "subagents-compat", "index.ts"),
			join(cwd, ".agent", "skill-registry.md"),
			join(agentHome, "mcp.json"),
		],
		[
			join(packageRoot, "assets", "agents"),
			join(packageRoot, "assets", "chains"),
			join(packageRoot, "assets", "support"),
			join(packageRoot, "vendor", "pi-subagents"),
			join(packageRoot, "vendor", "pi-ask-user"),
		],
	);

	const report = buildHarnessDoctorReport({
		cwd,
		packageRoot,
		agentHome,
		probe,
		engramCliAvailable: true,
		renderPrompt: () => "rendered orchestrator core",
	});

	assert.equal(report.checks.length, 34);
	assert.equal(report.severity, "info");
	assert.ok(report.checks.every((check) => check.status === "pass"));
	assert.match(report.message, /^pi-harness doctor/m);
	assert.match(report.message, /pass: assets\/orchestrator\.md present/);
	assert.match(report.message, /pass: assets\/orchestrator\.md renders/);
	assert.match(report.message, /pass: Engram CLI available/);
	assert.match(report.message, /pass: SDD-testing assets are provider-neutral/);
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
		"vendor/pi-subagents/src/index.ts",
		"vendor/pi-ask-user/index.ts",
		"vendor/pi-ask-user/upstream.ts",
		"vendor/pi-ask-user/single-select-layout.ts",
		"vendor/pi-ask-user/package.json",
		"vendor/pi-ask-user/LICENSE",
		"vendor/pi-ask-user/README.md",
		"vendor/pi-ask-user/skills/ask-user/SKILL.md",
		"packages/subagents-compat/index.ts",
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
				join(packageRoot, "vendor", "pi-subagents"),
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

test("orchestrator prompt injection is limited to the parent session", () => {
	assert.equal(shouldInjectOrchestratorPrompt({}), true);
	assert.equal(shouldInjectOrchestratorPrompt({ PI_HARNESS_SUBAGENT_DEPTH: "0" }), true);
	assert.equal(shouldInjectOrchestratorPrompt({ PI_HARNESS_PARENT_AGENT_ID: "agent-1" }), false);
	assert.equal(shouldInjectOrchestratorPrompt({ PI_HARNESS_NATIVE_SUBAGENT: "1" }), false);
	assert.equal(shouldInjectOrchestratorPrompt({ PI_HARNESS_SUBAGENT_DEPTH: "1" }), false);
});

test("native subagent runner marks child sessions for prompt isolation", async () => {
	const originalNativeMarker = process.env.PI_HARNESS_NATIVE_SUBAGENT;
	const originalParent = process.env.PI_HARNESS_PARENT_AGENT_ID;
	const originalDepth = process.env.PI_HARNESS_SUBAGENT_DEPTH;

	try {
		delete process.env.PI_HARNESS_NATIVE_SUBAGENT;
		delete process.env.PI_HARNESS_PARENT_AGENT_ID;
		delete process.env.PI_HARNESS_SUBAGENT_DEPTH;

		await withSubagentProcessEnv("agent-123", async () => {
			assert.deepEqual(getSubagentInvocationContext(), {
				agentId: "agent-123",
				depth: 1,
				native: true,
			});
			assert.equal(process.env.PI_HARNESS_NATIVE_SUBAGENT, undefined);
			assert.equal(process.env.PI_HARNESS_SUBAGENT_DEPTH, undefined);
			assert.equal(process.env.PI_HARNESS_PARENT_AGENT_ID, undefined);
			assert.equal(shouldInjectOrchestratorPrompt(), false);
		});

		assert.equal(getSubagentInvocationContext(), undefined);
		assert.equal(process.env.PI_HARNESS_NATIVE_SUBAGENT, undefined);
		assert.equal(process.env.PI_HARNESS_PARENT_AGENT_ID, undefined);
		assert.equal(process.env.PI_HARNESS_SUBAGENT_DEPTH, undefined);
	} finally {
		if (originalNativeMarker === undefined) delete process.env.PI_HARNESS_NATIVE_SUBAGENT;
		else process.env.PI_HARNESS_NATIVE_SUBAGENT = originalNativeMarker;
		if (originalParent === undefined) delete process.env.PI_HARNESS_PARENT_AGENT_ID;
		else process.env.PI_HARNESS_PARENT_AGENT_ID = originalParent;
		if (originalDepth === undefined) delete process.env.PI_HARNESS_SUBAGENT_DEPTH;
		else process.env.PI_HARNESS_SUBAGENT_DEPTH = originalDepth;
	}
});

test("overlapping subagent markers stay isolated without mutating process env", async () => {
	const originalNativeMarker = process.env.PI_HARNESS_NATIVE_SUBAGENT;
	const originalParent = process.env.PI_HARNESS_PARENT_AGENT_ID;
	const originalDepth = process.env.PI_HARNESS_SUBAGENT_DEPTH;
	const agentAReady = deferred();
	const agentBReady = deferred();

	try {
		delete process.env.PI_HARNESS_NATIVE_SUBAGENT;
		delete process.env.PI_HARNESS_PARENT_AGENT_ID;
		delete process.env.PI_HARNESS_SUBAGENT_DEPTH;

		const agentA = withSubagentProcessEnv("agent-a", async () => {
			agentAReady.resolve();
			await agentBReady.promise;
			assert.equal(getSubagentInvocationContext()?.agentId, "agent-a");
			assert.equal(getSubagentInvocationContext()?.depth, 1);
			assert.equal(shouldInjectOrchestratorPrompt(), false);
			assert.equal(process.env.PI_HARNESS_PARENT_AGENT_ID, undefined);
		});

		const agentB = withSubagentProcessEnv("agent-b", async () => {
			agentBReady.resolve();
			await agentAReady.promise;
			assert.equal(getSubagentInvocationContext()?.agentId, "agent-b");
			assert.equal(getSubagentInvocationContext()?.depth, 1);
			assert.equal(shouldInjectOrchestratorPrompt(), false);
			assert.equal(process.env.PI_HARNESS_PARENT_AGENT_ID, undefined);
		});

		await Promise.all([agentAReady.promise, agentBReady.promise]);
		assert.equal(process.env.PI_HARNESS_NATIVE_SUBAGENT, undefined);
		assert.equal(process.env.PI_HARNESS_PARENT_AGENT_ID, undefined);
		assert.equal(process.env.PI_HARNESS_SUBAGENT_DEPTH, undefined);
		await Promise.all([agentA, agentB]);
		assert.equal(getSubagentInvocationContext(), undefined);
	} finally {
		if (originalNativeMarker === undefined) delete process.env.PI_HARNESS_NATIVE_SUBAGENT;
		else process.env.PI_HARNESS_NATIVE_SUBAGENT = originalNativeMarker;
		if (originalParent === undefined) delete process.env.PI_HARNESS_PARENT_AGENT_ID;
		else process.env.PI_HARNESS_PARENT_AGENT_ID = originalParent;
		if (originalDepth === undefined) delete process.env.PI_HARNESS_SUBAGENT_DEPTH;
		else process.env.PI_HARNESS_SUBAGENT_DEPTH = originalDepth;
	}
});

test("before_agent_start leaves child agent prompts untouched", () => {
	type BeforeAgentStartHandler = (event: { systemPrompt: string }, ctx: object) => unknown;
	const originalParent = process.env.PI_HARNESS_PARENT_AGENT_ID;
	const originalDepth = process.env.PI_HARNESS_SUBAGENT_DEPTH;
	const handlers = new Map<string, BeforeAgentStartHandler>();
	const pi = {
		on(event: string, handler: BeforeAgentStartHandler) {
			handlers.set(event, handler);
		},
		registerCommand() {},
	};

	try {
		process.env.PI_HARNESS_PARENT_AGENT_ID = "parent-agent";
		delete process.env.PI_HARNESS_SUBAGENT_DEPTH;
		harness(pi as any);

		const handler = handlers.get("before_agent_start");
		assert.equal(typeof handler, "function");
		assert.equal(handler?.({ systemPrompt: "child prompt" }, {}), undefined);
	} finally {
		if (originalParent === undefined) delete process.env.PI_HARNESS_PARENT_AGENT_ID;
		else process.env.PI_HARNESS_PARENT_AGENT_ID = originalParent;
		if (originalDepth === undefined) delete process.env.PI_HARNESS_SUBAGENT_DEPTH;
		else process.env.PI_HARNESS_SUBAGENT_DEPTH = originalDepth;
	}
});

test("before_agent_start leaves async-local child agent prompts untouched", async () => {
	type BeforeAgentStartHandler = (event: { systemPrompt: string }, ctx: object) => unknown;
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

	await withSubagentProcessEnv("agent-456", async () => {
		assert.equal(handler?.({ systemPrompt: "child prompt" }, {}), undefined);
	});
});
