import type { Static } from "@sinclair/typebox";
import { TruncatedText } from "@mariozechner/pi-tui";
import type { AgentToolResult, ExtensionAPI, ExtensionContext, Theme, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import { applyTaskMutation } from "./reducer.ts";
import { getState, commitState } from "./store.ts";
import { TodoParams } from "./types.ts";
import type { Task } from "./types.ts";

export const TOOL_NAME = "todo";

type TodoParamsType = Static<typeof TodoParams>;

export interface TodoDetails {
	action: string;
	params: Partial<TodoParamsType>;
	tasks: Task[];
	nextId: number;
	error?: string;
}

function formatOp(action: string, params: Partial<TodoParamsType>, state: { tasks: Task[]; nextId: number }): string {
	switch (action) {
		case "create": {
			const t = state.tasks[state.tasks.length - 1];
			return t ? `Created task #${t.id}: ${t.subject}` : "Created task";
		}
		case "update": {
			const t = state.tasks.find((x) => x.id === params.id);
			return t ? `Updated task #${t.id}: ${t.subject}` : `Updated task #${params.id ?? "?"}`;
		}
		case "list":
			return `${state.tasks.filter((t) => t.status !== "deleted").length} task(s) listed`;
		case "get": {
			const t = state.tasks.find((x) => x.id === params.id);
			return t ? `Task #${t.id}: ${t.subject} [${t.status}]` : `Task #${params.id ?? "?"} not found`;
		}
		case "delete":
			return `Deleted task #${params.id ?? "?"}`;
		case "clear":
			return "All tasks cleared";
		default:
			return `todo: ${action}`;
	}
}

/**
 * Registers the "todo" tool with Pi. The tool name is intentionally kept as
 * "todo" (not namespaced) for branch-replay compatibility with existing
 * rpiv-todo session history: the replay scanner looks for toolName === "todo".
 *
 * The details envelope shape — { action, params, tasks, nextId, error? } — is
 * also kept identical to rpiv-todo for the same reason.
 */
export function registerTodoTool(pi: Pick<ExtensionAPI, "registerTool">): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Todo",
		description: "Manage the current session's task list. Use 'create' to add tasks, 'update' to change status or blocking relationships, 'list' to view tasks, 'get' to inspect a specific task, 'delete' to tombstone a task, and 'clear' to reset all tasks.",
		parameters: TodoParams,
		renderCall(args: TodoParamsType, _theme: Theme) {
			const label = args.subject
				? `todo: ${args.action} "${args.subject}"`
				: `todo: ${args.action}${args.id !== undefined ? ` #${args.id}` : ""}`;
			return new TruncatedText(label);
		},
		renderResult(
			result: AgentToolResult<TodoDetails>,
			_options: ToolRenderResultOptions,
			_theme: Theme,
		) {
			const text = result.details?.error
				? `todo error: ${result.details.error}`
				: (result.content[0]?.type === "text" ? result.content[0].text : "todo: done");
			return new TruncatedText(text);
		},
		async execute(
			_toolCallId: string,
			params: TodoParamsType,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			_ctx: ExtensionContext,
		): Promise<AgentToolResult<TodoDetails>> {
			const state = getState();
			const { state: nextState, op } = applyTaskMutation(state, params.action, params);

			commitState(nextState);

			if (op.type === "error") {
				const details: TodoDetails = {
					action: params.action,
					params,
					tasks: nextState.tasks,
					nextId: nextState.nextId,
					error: op.message,
				};
				return {
					content: [{ type: "text", text: `Error: ${op.message}` }],
					details,
				};
			}

			const text = formatOp(params.action, params, nextState);
			const details: TodoDetails = {
				action: params.action,
				params,
				tasks: nextState.tasks,
				nextId: nextState.nextId,
			};

			return {
				content: [{ type: "text", text }],
				details,
			};
		},
	});
}
