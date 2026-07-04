import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import harness, { buildHarnessDoctorReport, shouldInjectOrchestratorPrompt } from "../../extensions/harness.ts";
import { anyOverlayOpen } from "../../packages/shared/overlay-gate.ts";
import { getSubagentInvocationContext, withSubagentProcessEnv } from "../../vendor/pi-subagents/src/invocation-config.ts";
import { askUserQuestion } from "../../vendor/rpiv-ask-user-question/index.ts";

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
			join(packageRoot, "extensions", "harness.ts"),
			join(packageRoot, "extensions", "shell-guard.ts"),
			join(packageRoot, "extensions", "mcp.ts"),
			join(packageRoot, "extensions", "engram.ts"),
			join(packageRoot, "extensions", "sdd-orchestrator.ts"),
			join(packageRoot, "extensions", "skill-registry.ts"),
			join(packageRoot, "extensions", "btw.ts"),
			join(packageRoot, "vendor", "pi-subagents", "src", "index.ts"),
			join(packageRoot, "vendor", "rpiv-ask-user-question", "index.ts"),
			join(packageRoot, "vendor", "rpiv-ask-user-question", "README.md"),
			join(packageRoot, "packages", "subagents-compat", "index.ts"),
			join(cwd, ".agent", "skill-registry.md"),
			join(agentHome, "mcp.json"),
		],
		[
			join(packageRoot, "assets", "agents"),
			join(packageRoot, "assets", "chains"),
			join(packageRoot, "assets", "support"),
			join(packageRoot, "vendor", "pi-subagents"),
			join(packageRoot, "vendor", "rpiv-ask-user-question"),
		],
	);

	const report = buildHarnessDoctorReport({
		cwd,
		packageRoot,
		agentHome,
		probe,
		engramCliAvailable: true,
	});

	assert.equal(report.checks.length, 20);
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

test("ask-user-question wrapper returns a needs_user_answer fallback without UI", async () => {
	const result = await askUserQuestion(
		{ question: "Pick a direction", options: ["Narrow", "Broad"] },
		{ hasUI: false, ui: {} } as any,
	);

	assert.equal(result.details.status, "needs_user_answer");
	assert.match(result.content[0].text, /needs_user_answer/);
	assert.match(result.content[0].text, /Pick a direction/);
	assert.equal(anyOverlayOpen(), false);
});

test("ask-user-question wrapper brackets UI interaction with the overlay gate", async () => {
	const overlayStateDuringSelect: boolean[] = [];
	const result = await askUserQuestion(
		{ question: "Pick a direction", options: ["Narrow", "Broad"] },
		{
			hasUI: true,
			ui: {
				async select(_title: string, options: string[]) {
					overlayStateDuringSelect.push(anyOverlayOpen());
					return options[0];
				},
			},
		} as any,
	);

	assert.deepEqual(overlayStateDuringSelect, [true]);
	assert.equal(result.details.status, "answered");
	assert.equal(result.details.answers[0]?.answer, "Narrow");
	assert.equal(anyOverlayOpen(), false);
});

test("ask-user-question wrapper exits the overlay gate when UI selection throws", async () => {
	await assert.rejects(
		askUserQuestion(
			{ question: "Pick a direction", options: ["Narrow", "Broad"] },
			{
				hasUI: true,
				ui: {
					async select() {
						assert.equal(anyOverlayOpen(), true);
						throw new Error("dialog failed");
					},
				},
			} as any,
		),
		/dialog failed/,
	);
	assert.equal(anyOverlayOpen(), false);
});

test("ask-user-question wrapper preserves all schema questions without UI", async () => {
	const result = await askUserQuestion(
		{
			questions: [
				{ question: "Approve scope?", options: ["Yes", "No"] },
				{ question: "Choose delivery", options: ["Single PR", "Stacked PRs"] },
			],
		},
		{ hasUI: false, ui: {} } as any,
	);

	assert.equal(result.details.status, "needs_user_answer");
	assert.deepEqual(result.details.questions.map((question) => question.question), ["Approve scope?", "Choose delivery"]);
	assert.match(result.content[0].text, /Approve scope\?/);
	assert.match(result.content[0].text, /Choose delivery/);
});

test("ask-user-question wrapper asks schema questions sequentially", async () => {
	const seen: string[] = [];
	const result = await askUserQuestion(
		{
			questions: [
				{ question: "Approve scope?", options: ["Yes", "No"] },
				{ question: "Choose delivery", options: ["Single PR", "Stacked PRs"] },
			],
		},
		{
			hasUI: true,
			ui: {
				async select(title: string, options: string[]) {
					seen.push(title);
					return options[0];
				},
			},
		} as any,
	);

	assert.deepEqual(seen, ["Approve scope?", "Choose delivery"]);
	assert.equal(result.details.status, "answered");
	assert.deepEqual(result.details.answers, [
		{ question: "Approve scope?", answer: "Yes" },
		{ question: "Choose delivery", answer: "Single PR" },
	]);
	assert.equal(anyOverlayOpen(), false);
});
