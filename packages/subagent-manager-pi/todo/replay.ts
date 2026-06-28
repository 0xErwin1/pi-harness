import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { EMPTY_STATE } from "./state.ts";
import type { TaskState } from "./state.ts";
import type { Task } from "./types.ts";
import { replaceState } from "./store.ts";

interface TodoToolResultMessage {
	role: "toolResult";
	toolName: string;
	details: unknown;
}

interface BranchEntry {
	type: string;
	message?: unknown;
}

function isTodoToolResult(message: unknown): message is TodoToolResultMessage & { details: { tasks: Task[]; nextId: number } } {
	if (!message || typeof message !== "object") return false;
	const m = message as Record<string, unknown>;

	if (m["role"] !== "toolResult") return false;
	if (m["toolName"] !== "todo") return false;

	const details = m["details"];
	if (!details || typeof details !== "object") return false;
	const d = details as Record<string, unknown>;

	if (!Array.isArray(d["tasks"])) return false;
	if (typeof d["nextId"] !== "number") return false;

	return true;
}

/**
 * Scans the current session branch for the last tool result produced by the
 * "todo" tool and restores that state into the in-memory store. This is the
 * branch-replay mechanism that lets todo state survive context compaction and
 * session tree navigation.
 *
 * Last-write-wins: only the most recent qualifying entry is used. A new
 * session with no prior "todo" tool calls starts from EMPTY_STATE.
 *
 * Compatible with the rpiv-todo details envelope shape:
 *   { action, params, tasks: Task[], nextId: number, error? }
 */
export function replayFromBranch(ctx: Pick<ExtensionContext, "sessionManager">): void {
	const branch = ctx.sessionManager.getBranch() as BranchEntry[];

	let lastState: TaskState | null = null;

	for (const entry of branch) {
		if (entry.type !== "message") continue;

		const message = entry.message;
		if (isTodoToolResult(message)) {
			const d = (message.details as { tasks: Task[]; nextId: number });
			lastState = { tasks: d.tasks, nextId: d.nextId };
		}
	}

	replaceState(lastState ?? { ...EMPTY_STATE, tasks: [] });
}
