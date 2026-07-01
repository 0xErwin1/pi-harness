import test from "node:test";
import assert from "node:assert/strict";
import {
	buildAgentCompatInvocation,
	createCompatRuntime,
	registerPiHarnessCompat,
} from "../../packages/subagents-compat/index.ts";

test("buildAgentCompatInvocation maps Agent params to subagent_run", () => {
	assert.deepEqual(
		buildAgentCompatInvocation({
			subagent_type: "sdd-apply",
			prompt: "Implement batch 1",
			description: "runtime swap",
			run_in_background: true,
		}),
		{
			agent: "sdd-apply",
			task: "Implement batch 1",
			mode: "background",
		},
	);
});

test("buildAgentCompatInvocation rejects unsupported overrides explicitly", () => {
	assert.throws(
		() =>
			buildAgentCompatInvocation({
				subagent_type: "sdd-apply",
				prompt: "Implement batch 1",
				model: "openai/gpt-5",
			}),
		/error.*model/i,
	);
});

test("createCompatRuntime bridges Agent and get_subagent_result to j0k3r tool names", async () => {
	const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
	const tools = new Map<string, { execute: (...args: any[]) => Promise<any> }>([
		[
			"subagent_run",
			{
				async execute(_id, params) {
					calls.push({ name: "subagent_run", params });
					return {
						content: [{ type: "text", text: "Started" }],
						details: { task_ids: ["task-123"] },
					};
				},
			},
		],
		[
			"subagent_status",
			{
				async execute(_id, params) {
					calls.push({ name: "subagent_status", params });
					return {
						content: [{ type: "text", text: "running" }],
						details: { task: { id: "task-123", status: "running", agent: "sdd-apply" } },
					};
				},
			},
		],
		[
			"subagent_result",
			{
				async execute(_id, params) {
					calls.push({ name: "subagent_result", params });
					return {
						content: [{ type: "text", text: "done" }],
						details: { task: { id: "task-123", status: "completed", agent: "sdd-apply" } },
					};
				},
			},
		],
	]);
	const commands = new Map<string, { handler: (...args: any[]) => Promise<any> | any }>([
		[
			"subagents",
			{
				handler: async () => "opened",
			},
			],
	]);

	const runtime = createCompatRuntime({ tools, commands });
	const agentResult = await runtime.Agent.execute("call-1", {
		subagent_type: "sdd-apply",
		prompt: "Implement batch 1",
		description: "runtime swap",
		run_in_background: true,
	});

	assert.equal(calls[0]?.name, "subagent_run");
	assert.deepEqual(calls[0]?.params, {
		agent: "sdd-apply",
		task: "Implement batch 1",
		mode: "background",
	});
	assert.match(agentResult.content[0]?.text ?? "", /task-123/);

	const statusResult = await runtime.get_subagent_result.execute("call-2", { agent_id: "task-123" });
	assert.equal(calls[1]?.name, "subagent_status");
	assert.match(statusResult.content[0]?.text ?? "", /running/i);

	const steerResult = await runtime.steer_subagent.execute("call-3", {
		agent_id: "task-123",
		message: "keep going",
	});
	assert.match(steerResult.content[0]?.text ?? "", /not supported/i);

	const aliasResult = await runtime.agents.handler("", {});
	assert.equal(aliasResult, "opened");
});

test("registerPiHarnessCompat can use captured j0k3r tools when pi does not expose a tool registry", async () => {
	const registeredTools = new Map<string, any>();
	const registeredCommands = new Map<string, any>();
	const pi = {
		registerTool(tool: any) {
			registeredTools.set(tool.name, tool);
		},
		registerCommand(name: string, command: any) {
			registeredCommands.set(name, command);
		},
	};
	const runtimeTools = new Map<string, any>([
		[
			"subagent_run",
			{
				async execute() {
					return { content: [{ type: "text", text: "Started" }], details: { task_ids: ["task-456"] } };
				},
			},
		],
	]);
	const runtimeCommands = new Map<string, any>([
		["subagents", { handler: async () => "opened" }],
	]);

	registerPiHarnessCompat(pi, { tools: runtimeTools, commands: runtimeCommands });

	const agent = registeredTools.get("Agent");
	assert.ok(agent);
	const result = await agent.execute("call-1", { subagent_type: "worker", prompt: "Do work" });
	assert.match(result.content[0]?.text ?? "", /Started|task-456/);
});

test("/agents offers a fast path to model and thinking assignment", async () => {
	const commandCalls: string[] = [];
	const runtime = createCompatRuntime({
		commands: new Map([
			[
				"subagents",
				{
					handler: async () => {
						commandCalls.push("subagents");
						return "tasks";
					},
				},
			],
			[
				"subagent-models",
				{
					handler: async () => {
						commandCalls.push("subagent-models");
						return "models";
					},
				},
			],
		]),
	});

	const result = await runtime.agents.handler("", {
		ui: {
			select: async () => "Model & thinking",
		},
	});

	assert.equal(result, "models");
	assert.deepEqual(commandCalls, ["subagent-models"]);
});
