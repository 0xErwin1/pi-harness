import { Type } from "@sinclair/typebox";

type CompatAgentParams = {
	subagent_type: string;
	prompt: string;
	description?: string;
	run_in_background?: boolean;
	model?: string;
	thinking?: string;
	max_turns?: number;
	resume?: string;
	isolated?: boolean;
	inherit_context?: boolean;
	isolation?: string;
};

type ToolExecute = (
	toolCallId: string,
	params: Record<string, unknown>,
	signal?: AbortSignal,
	onUpdate?: (value: unknown) => void,
	ctx?: unknown,
) => Promise<any>;

type ToolDefinitionLike = { execute: ToolExecute };
type CommandDefinitionLike = { handler: (args: string, ctx: unknown) => Promise<unknown> | unknown };

type RuntimeRegistry = {
	tools?: Map<string, ToolDefinitionLike> | Record<string, ToolDefinitionLike>;
	commands?: Map<string, CommandDefinitionLike> | Record<string, CommandDefinitionLike>;
};

const UNSUPPORTED_AGENT_FIELDS: Array<keyof CompatAgentParams> = [
	"model",
	"thinking",
	"max_turns",
	"resume",
	"isolated",
	"inherit_context",
	"isolation",
];

function textResult(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text" as const, text }], details };
}

function registryGet<T>(registry: Map<string, T> | Record<string, T> | undefined, key: string): T | undefined {
	if (!registry) return undefined;
	if (registry instanceof Map) return registry.get(key);
	return registry[key];
}

function requireTool(runtime: RuntimeRegistry, name: string): ToolDefinitionLike {
	const tool = registryGet(runtime.tools, name);
	if (!tool?.execute) throw new Error(`Required j0k3r tool not available: ${name}`);
	return tool;
}

function requireCommand(runtime: RuntimeRegistry, name: string): CommandDefinitionLike {
	const command = registryGet(runtime.commands, name);
	if (!command?.handler) throw new Error(`Required j0k3r command not available: ${name}`);
	return command;
}

function optionalCommand(runtime: RuntimeRegistry, name: string): CommandDefinitionLike | undefined {
	return registryGet(runtime.commands, name);
}

function unsupportedFieldName(params: CompatAgentParams): keyof CompatAgentParams | undefined {
	return UNSUPPORTED_AGENT_FIELDS.find((field) => params[field] !== undefined);
}

export function buildAgentCompatInvocation(params: CompatAgentParams) {
	const unsupported = unsupportedFieldName(params);
	if (unsupported) {
		throw new Error(
			`Agent compatibility bridge does not support the \`${unsupported}\` override on the j0k3r runtime yet. ` +
				`Use the native subagent tools directly or wait for a later compatibility batch.`,
		);
	}

	return {
		agent: params.subagent_type,
		task: params.prompt,
		mode: params.run_in_background ? "background" : "task",
	} as const;
}

async function runGetResult(
	runtime: RuntimeRegistry,
	toolCallId: string,
	params: { agent_id: string; wait?: boolean; verbose?: boolean },
	signal?: AbortSignal,
): Promise<any> {
	const statusTool = requireTool(runtime, "subagent_status");
	const resultTool = requireTool(runtime, "subagent_result");

	while (true) {
		const statusResult = await statusTool.execute(toolCallId, { task_id: params.agent_id }, signal);
		const task = statusResult?.details?.task;
		const status = typeof task?.status === "string" ? task.status : undefined;
		if (!params.wait || !status || (status !== "queued" && status !== "running")) {
			if (status === "completed" || status === "failed" || status === "cancelled") {
				const result = await resultTool.execute(toolCallId, { task_id: params.agent_id }, signal);
				if (!params.verbose) return result;
				const baseText = result?.content?.[0]?.text ?? "";
				return textResult(
					`${baseText}\n\nVerbose transcript output is not supported by the j0k3r compatibility bridge yet.`,
					result?.details ?? {},
				);
			}
			return statusResult;
		}

		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(resolve, 250);
			const abort = () => {
				clearTimeout(timeout);
				reject(new Error("Agent wait aborted."));
			};
			signal?.addEventListener("abort", abort, { once: true });
		});
	}
}

async function runAgentsCompatCommand(runtime: RuntimeRegistry, args: string, ctx: any) {
	const subagents = requireCommand(runtime, "subagents");
	const modelSettings = optionalCommand(runtime, "subagent-models");
	const select = ctx?.ui?.select;
	if (!modelSettings?.handler || typeof select !== "function") {
		return subagents.handler(args, ctx);
	}

	const choice = await select("Open /agents:", ["Running tasks", "Model & thinking"]);
	if (choice === "Model & thinking") {
		return modelSettings.handler(args, ctx);
	}
	return subagents.handler(args, ctx);
}

export function createCompatRuntime(runtime: RuntimeRegistry) {
	return {
		Agent: {
			async execute(toolCallId: string, params: CompatAgentParams, signal?: AbortSignal, onUpdate?: (value: unknown) => void, ctx?: unknown) {
				const subagentRun = requireTool(runtime, "subagent_run");
				const invocation = buildAgentCompatInvocation(params);
				const result = await subagentRun.execute(toolCallId, invocation, signal, onUpdate, ctx);
				const taskId = result?.details?.task_ids?.[0];
				if (invocation.mode === "background" && typeof taskId === "string") {
					return textResult(
						`Agent started in background. Agent ID: ${taskId}\n\nUse get_subagent_result with this ID to check status or fetch the final output.`,
						{ ...result?.details, agent_id: taskId },
					);
				}
				return result;
			},
		},
		get_subagent_result: {
			async execute(toolCallId: string, params: { agent_id: string; wait?: boolean; verbose?: boolean }, signal?: AbortSignal) {
				return runGetResult(runtime, toolCallId, params, signal);
			},
		},
		steer_subagent: {
			async execute(_toolCallId: string, params: { agent_id: string; message: string }) {
				return textResult(
					`steer_subagent is not supported by the j0k3r compatibility bridge yet for agent ${params.agent_id}. ` +
						`Use the native /subagents workflow until steering support is added.`,
				);
			},
		},
		agents: {
			handler(args: string, ctx: unknown) {
				return runAgentsCompatCommand(runtime, args, ctx);
			},
		},
	};
}

function createLiveRuntime(pi: any): RuntimeRegistry {
	return {
		tools: pi?.tools,
		commands: pi?.commands,
	};
}

export function registerPiHarnessCompat(pi: any, runtimeRegistry?: RuntimeRegistry): void {
	const runtime = createCompatRuntime(runtimeRegistry ?? createLiveRuntime(pi));

	pi.registerTool({
		name: "Agent",
		label: "Agent",
		description: "Compatibility bridge to the active j0k3r subagent runtime.",
		promptSnippet: "Launch a compatible subagent task",
		parameters: Type.Object({
			subagent_type: Type.String(),
			prompt: Type.String(),
			description: Type.Optional(Type.String()),
			model: Type.Optional(Type.String()),
			thinking: Type.Optional(Type.String()),
			max_turns: Type.Optional(Type.Number()),
			run_in_background: Type.Optional(Type.Boolean()),
			resume: Type.Optional(Type.String()),
			isolated: Type.Optional(Type.Boolean()),
			inherit_context: Type.Optional(Type.Boolean()),
			isolation: Type.Optional(Type.String()),
		}),
		execute: runtime.Agent.execute,
	});

	pi.registerTool({
		name: "get_subagent_result",
		label: "Get Agent Result",
		description: "Compatibility bridge for fetching j0k3r subagent results by task ID.",
		parameters: Type.Object({
			agent_id: Type.String(),
			wait: Type.Optional(Type.Boolean()),
			verbose: Type.Optional(Type.Boolean()),
		}),
		execute: runtime.get_subagent_result.execute,
	});

	pi.registerTool({
		name: "steer_subagent",
		label: "Steer Agent",
		description: "Compatibility stub for runtimes that do not yet support steering.",
		parameters: Type.Object({
			agent_id: Type.String(),
			message: Type.String(),
		}),
		execute: runtime.steer_subagent.execute,
	});

	pi.registerCommand("agents", {
		description: "Compatibility alias for /subagents.",
		handler: runtime.agents.handler,
	});
}
