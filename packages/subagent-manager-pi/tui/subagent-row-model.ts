import type { RunEvent, RunOutputEvent, RunSnapshot, RunStatus } from "../../subagent-manager-core/events.ts";
import type { RunMessage } from "../../subagent-manager-core/store.ts";
import { TOOL_PROGRESS_PREFIX } from "../../subagent-manager-core/providers/process-runner.ts";
import { eventsToBodyLines } from "./conversation-viewer-model.ts";

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

/** Renders a progress message for the collapsed row, surfacing the tool name. */
function humanizeActivity(message: string): string {
	if (!message) return "";
	if (message.startsWith(TOOL_PROGRESS_PREFIX)) {
		return `[tool] ${message.slice(TOOL_PROGRESS_PREFIX.length).trim()}`;
	}
	return message;
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
	let lastThinkingText = "";

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
			} else if (ev.type === "run.output") {
				const out = ev as RunOutputEvent;
				if (out.kind === "thinking" && out.text) lastThinkingText = out.text;
			}
		}
	}

	const activity = lastProgressMessage || status;
	const lastLine = lastMessageText
		? truncateFirstLine(lastMessageText)
		: lastThinkingText
			? truncateFirstLine(`thinking ${lastThinkingText}`)
			: truncateFirstLine(humanizeActivity(lastProgressMessage));

	return { agent, status, activity, elapsedMs, turns, tools, lastLine };
}

/**
 * Builds the chronological transcript lines for the expanded (native Ctrl-O) tool
 * row. Mirrors the conversation overlay: each run's event stream is rendered via
 * the shared `eventsToBodyLines`, so tool-only turns surface their `[tool] <tool>`
 * activity instead of an empty transcript. A `width` of 0 leaves assistant text
 * unwrapped so the caller's text component can wrap it to the terminal.
 *
 * Runs whose event stream is unavailable (no `events` accessor) fall back to their
 * accumulated assistant messages, preserving the prior assistant-only behavior.
 */
export function buildExpandedBodyLines(
	access: SubagentRowAccess,
	runIds: string[],
	width: number,
): string[] {
	const lines: string[] = [];

	for (const id of runIds) {
		const events = access.events?.(id) ?? [];

		if (events.length > 0) {
			lines.push(...eventsToBodyLines(events, width));
			continue;
		}

		for (const message of access.messages(id)) {
			lines.push(`[Assistant · turn ${message.turn}]`);
			lines.push(message.text);
		}
	}

	return lines;
}
