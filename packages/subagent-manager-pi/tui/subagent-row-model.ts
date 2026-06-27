import type { RunEvent, RunOutputEvent, RunSnapshot, RunStatus } from "../../subagent-manager-core/events.ts";
import type { RunMessage } from "../../subagent-manager-core/store.ts";
import { TOOL_PROGRESS_PREFIX } from "../../subagent-manager-core/events.ts";
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
	/** Running total of tokens (input + output) across the row's runs. */
	tokens: number;
	/**
	 * A short human phrase of what the run is doing right now — the latest tool as
	 * `<tool> <target>`, the latest assistant text, the word `thinking` while it
	 * reasons, or the status when nothing else applies. Never dumps reasoning prose.
	 */
	currentActivity: string;
}

const MAX_ACTIVITY = 50;

/** Collapses a value to a single, hard-truncated line for the one-line collapsed row. */
function conciseActivity(text: string): string {
	const firstLine = text.split("\n")[0]?.trim() ?? "";
	if (firstLine.length <= MAX_ACTIVITY) return firstLine;
	return `${firstLine.slice(0, MAX_ACTIVITY - 1)}…`;
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
	let tokens = 0;
	let lastProgressMessage = "";
	let lastMessageText = "";
	let currentActivity = "";

	for (const id of runIds) {
		tokens += access.snapshot(id)?.tokens ?? 0;

		const msgs = access.messages(id);
		turns += msgs.length;
		if (msgs.length > 0) lastMessageText = msgs[msgs.length - 1].text;

		const evts = access.events?.(id) ?? [];
		for (const ev of evts) {
			if (ev.type === "run.progress") {
				const msg = (ev as { message?: string }).message ?? "";
				lastProgressMessage = msg;
				if (msg.startsWith(TOOL_PROGRESS_PREFIX)) {
					tools += 1;
					const name = msg.slice(TOOL_PROGRESS_PREFIX.length).trim();
					const target = (ev as { target?: string }).target;
					currentActivity = target ? `${name} ${target}` : name;
				}
			} else if (ev.type === "run.output") {
				const out = ev as RunOutputEvent;
				if (out.kind === "thinking" && out.text) {
					currentActivity = "thinking";
				} else if (out.role === "assistant" && out.text) {
					currentActivity = out.text;
				}
			}
		}
	}

	const activity = lastProgressMessage || status;
	if (!currentActivity && lastMessageText) currentActivity = lastMessageText;
	if (!currentActivity) currentActivity = status;

	return { agent, status, activity, elapsedMs, turns, tools, tokens, currentActivity: conciseActivity(currentActivity) };
}

/**
 * Builds one row model per run id, each derived from only its own run, for the
 * per-agent breakdown shown when a single tool call launched several agents in
 * parallel. Order matches `runIds` so the rows line up with the launch order.
 * Single-run callers keep using `buildSubagentRowModel` directly.
 */
export function buildPerAgentRowModels(
	access: SubagentRowAccess,
	runIds: string[],
	now: number,
): SubagentRowModel[] {
	return runIds.map((id) => buildSubagentRowModel(access, [id], now));
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
