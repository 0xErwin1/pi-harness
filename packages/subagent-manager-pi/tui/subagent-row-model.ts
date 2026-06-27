import type { RunEvent, RunSnapshot, RunStatus } from "../../subagent-manager-core/events.ts";
import type { RunMessage } from "../../subagent-manager-core/store.ts";
import { TOOL_PROGRESS_PREFIX } from "../../subagent-manager-core/providers/process-runner.ts";

export interface SubagentRowAccess {
	snapshot(id: string): RunSnapshot | undefined;
	messages(id: string): RunMessage[];
	events?(id: string): RunEvent[];
}

export interface SubagentRowModel {
	agent: string;
	status: RunStatus;
	activity: string;
	elapsedMs: number;
	turns: number;
	tools: number;
	lastLine: string;
}

const MAX_LAST_LINE = 60;

function truncateFirstLine(text: string): string {
	const firstLine = text.split("\n")[0] ?? "";
	if (firstLine.length <= MAX_LAST_LINE) return firstLine;
	return `${firstLine.slice(0, MAX_LAST_LINE)}…`;
}

export function buildSubagentRowModel(
	access: SubagentRowAccess,
	runIds: string[],
	now: number,
): SubagentRowModel {
	const firstSnapshot = runIds.map((id) => access.snapshot(id)).find((s) => s !== undefined);

	const agent = firstSnapshot?.agent ?? "";
	const status: RunStatus = firstSnapshot?.status ?? "queued";
	const startedAt = firstSnapshot ? Date.parse(firstSnapshot.startedAt) : now;
	const elapsedMs = now - startedAt;

	let turns = 0;
	let tools = 0;
	let lastProgressMessage = "";
	let lastMessageText = "";

	for (const id of runIds) {
		const msgs = access.messages(id);
		turns += msgs.length;

		if (msgs.length > 0) {
			lastMessageText = msgs[msgs.length - 1].text;
		}

		const evts = access.events?.(id) ?? [];
		for (const ev of evts) {
			if (ev.type === "run.progress") {
				const msg = (ev as { message?: string }).message ?? "";
				if (msg.startsWith(TOOL_PROGRESS_PREFIX)) tools += 1;
				lastProgressMessage = msg;
			}
		}
	}

	const activity = lastProgressMessage || status;
	const lastLine = truncateFirstLine(lastMessageText);

	return { agent, status, activity, elapsedMs, turns, tools, lastLine };
}
