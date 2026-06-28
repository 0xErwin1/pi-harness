import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getState } from "./store.ts";
import { selectTasksByStatus } from "./selectors.ts";
import type { Task } from "./types.ts";

function formatTaskLine(task: Task, showIds: boolean): string {
	const prefix = showIds ? `#${task.id} ` : "";
	const blockedSuffix =
		showIds && task.blockedBy && task.blockedBy.length > 0
			? ` blocked:${task.blockedBy.map((id) => `#${id}`).join(",")}`
			: "";
	return `  ${prefix}${task.subject}${blockedSuffix}`;
}

/**
 * Registers the "/todos" slash command. Shows the current task list grouped
 * by status via ctx.ui.notify. Uses plain ASCII section headers with no emoji.
 */
export function registerTodosCommand(pi: Pick<ExtensionAPI, "registerCommand">): void {
	pi.registerCommand("todos", {
		description: "Show the current task list grouped by status.",
		handler: async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
			const state = getState();
			const grouped = selectTasksByStatus(state);

			const showIds =
				[...grouped.pending, ...grouped.inProgress, ...grouped.completed].some(
					(t) => t.blockedBy !== undefined && t.blockedBy.length > 0,
				);

			const sections: string[] = [];

			if (grouped.pending.length > 0) {
				sections.push("-- Pending --");
				for (const task of grouped.pending) {
					sections.push(formatTaskLine(task, showIds));
				}
			}

			if (grouped.inProgress.length > 0) {
				sections.push("-- In Progress --");
				for (const task of grouped.inProgress) {
					sections.push(formatTaskLine(task, showIds));
				}
			}

			if (grouped.completed.length > 0) {
				sections.push("-- Completed --");
				for (const task of grouped.completed) {
					sections.push(formatTaskLine(task, showIds));
				}
			}

			const output = sections.length > 0
				? sections.join("\n")
				: "No tasks.";

			ctx.ui.notify(output, "info");
		},
	});
}
