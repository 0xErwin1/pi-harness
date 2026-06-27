import type { RunEvent, RunSnapshot } from "../../subagent-manager-core/events.ts";
import { TOOL_PROGRESS_PREFIX } from "../../subagent-manager-core/providers/process-runner.ts";

export interface ViewerModel {
	headerLines: string[];
	bodyLines: string[];
	footerLine: string;
	maxScroll: number;
}

function formatElapsedMs(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m${seconds % 60}s`;
}

function wrapText(text: string, width: number): string[] {
	if (width <= 0) return [text];

	const lines: string[] = [];
	for (const paragraph of text.split("\n")) {
		if (paragraph.length <= width) {
			lines.push(paragraph);
			continue;
		}
		let remaining = paragraph;
		while (remaining.length > width) {
			const breakAt = remaining.lastIndexOf(" ", width);
			if (breakAt <= 0) {
				lines.push(remaining.slice(0, width));
				remaining = remaining.slice(width);
			} else {
				lines.push(remaining.slice(0, breakAt));
				remaining = remaining.slice(breakAt + 1);
			}
		}
		if (remaining.length > 0) lines.push(remaining);
	}
	return lines;
}

function toolNameFromProgress(message: string): string | undefined {
	if (!message.startsWith(TOOL_PROGRESS_PREFIX)) return undefined;
	return message.slice(TOOL_PROGRESS_PREFIX.length).trim();
}

/** Truncates by character count (ANSI-free input) leaving room for an ellipsis. */
function truncateByLength(text: string, max: number): string {
	if (max <= 0 || text.length <= max) return text;
	if (max === 1) return "…";
	return `${text.slice(0, max - 1)}…`;
}

const TOOL_LINE_PREFIX = "[tool] ";
const THINKING_LINE_PREFIX = "[thinking] ";

/**
 * Collapses consecutive identical tool lines into a single `… ×N` line so a long
 * run of the same call (same tool AND same target) reads as one grouped entry
 * instead of dozens of repeats. Distinct calls are never merged, so no
 * information is lost. When `width` is positive, lines are truncated to fit while
 * preserving the trailing count.
 */
function collapseToolRuns(lines: string[], width: number): string[] {
	const out: string[] = [];
	let runLine: string | undefined;
	let runCount = 0;

	const flush = () => {
		if (runLine === undefined) return;
		const suffix = runCount > 1 ? ` ×${runCount}` : "";
		const base = width > 0 ? truncateByLength(runLine, width - suffix.length) : runLine;
		out.push(`${base}${suffix}`);
		runLine = undefined;
		runCount = 0;
	};

	for (const line of lines) {
		if (line.startsWith(TOOL_LINE_PREFIX)) {
			if (line === runLine) {
				runCount += 1;
			} else {
				flush();
				runLine = line;
				runCount = 1;
			}
			continue;
		}

		flush();
		out.push(width > 0 ? truncateByLength(line, width) : line);
	}

	flush();
	return out;
}

export type TranscriptColor = "accent" | "success" | "error" | "warning" | "dim" | "text";

/**
 * Maps a transcript line to a semantic colour so the viewer can give assistant
 * text, reasoning, tool activity, and status transitions a distinct visual
 * hierarchy. Pure and theme-agnostic: callers translate the colour name through
 * their theme. Detection keys off the plain-text markers emitted by
 * `eventsToBodyLines` (no pictographs), so the markers and this classifier must
 * stay in sync.
 */
export function transcriptLineColor(line: string): TranscriptColor {
	if (line.startsWith("[Assistant")) return "accent";
	if (line.startsWith(TOOL_LINE_PREFIX)) return "success";
	if (line.startsWith("[done]")) return "success";
	if (line.startsWith("[failed]")) return "error";
	if (line.startsWith("[attention]")) return "warning";
	if (line.startsWith("[degraded]")) return "warning";
	if (line.startsWith("[interrupted]")) return "warning";
	if (line.startsWith("[started]")) return "dim";
	if (line.startsWith(THINKING_LINE_PREFIX)) return "dim";
	if (line.startsWith("·")) return "dim";
	return "text";
}

/**
 * Resolves the viewport's top offset. When following the newest line the offset
 * tracks the growing tail; when paused it stays where the user left it, clamped
 * into range as the transcript grows. This is the heart of independent scroll:
 * new events never yank a paused viewport back to the bottom.
 */
export function resolveViewportOffset(scrollOffset: number, maxScroll: number, following: boolean): number {
	if (following) return maxScroll;
	return Math.max(0, Math.min(scrollOffset, maxScroll));
}

/**
 * Renders the run's chronological event stream into displayable body lines,
 * merging assistant text turns with live tool activity and status transitions.
 *
 * This is the core of the live viewer: tool-use turns carry no assistant text,
 * so a transcript built only from accumulated assistant messages stays empty
 * while the subagent is actually working. Reading the event stream surfaces the
 * tool calls (and progress/status changes) as they happen, mirroring Ctrl-O.
 */
export function eventsToBodyLines(events: RunEvent[], width: number): string[] {
	const lines: string[] = [];

	for (const event of events) {
		switch (event.type) {
			case "run.started":
				lines.push("[started]");
				break;
			case "run.progress": {
				const tool = toolNameFromProgress(event.message);
				if (tool) {
					lines.push(event.target ? `${TOOL_LINE_PREFIX}${tool} ${event.target}` : `${TOOL_LINE_PREFIX}${tool}`);
				} else {
					lines.push(`· ${event.message}`);
				}
				break;
			}
			case "run.output":
				if (event.kind === "thinking" && event.text) {
					const wrapWidth = width > 0 ? width - THINKING_LINE_PREFIX.length : width;
					for (const line of wrapText(event.text, wrapWidth)) lines.push(`${THINKING_LINE_PREFIX}${line}`);
				} else if (event.role === "assistant" && event.text) {
					lines.push("[Assistant]");
					for (const line of wrapText(event.text, width)) lines.push(line);
				}
				break;
			case "run.needs_attention":
				lines.push(`[attention] ${event.reason}`);
				break;
			case "run.completed":
				lines.push("[done]");
				break;
			case "run.failed":
				lines.push(`[failed] ${event.error}`);
				break;
			case "run.interrupted":
				lines.push("[interrupted]");
				break;
			case "provider.degraded":
				lines.push(`[degraded] ${event.provider}: ${event.reason}`);
				break;
		}
	}

	return collapseToolRuns(lines, width);
}

export function buildViewerModel(input: {
	snapshot?: RunSnapshot;
	events: RunEvent[];
	scrollOffset: number;
	width: number;
	height: number;
	now: number;
	autoScroll?: boolean;
}): ViewerModel {
	const { snapshot, events, width, height, now, autoScroll } = input;

	const agent = snapshot?.agent ?? "";
	const status = snapshot?.status ?? "unknown";
	const elapsedMs = snapshot ? now - Date.parse(snapshot.startedAt) : undefined;
	const elapsed = elapsedMs !== undefined ? formatElapsedMs(elapsedMs) : "";

	let turns = 0;
	let tools = 0;
	for (const event of events) {
		if (event.type === "run.output" && event.role === "assistant" && event.text) turns += 1;
		if (event.type === "run.progress" && toolNameFromProgress(event.message) !== undefined) tools += 1;
	}
	const counts = `${turns}t/${tools} tools`;

	const headerParts = [agent, status, elapsed, counts].filter((p) => p.length > 0);
	const headerLines = [headerParts.join(" · ")];

	const allBodyLines = eventsToBodyLines(events, width);
	const maxScroll = Math.max(0, allBodyLines.length - height);

	const effectiveOffset = resolveViewportOffset(input.scrollOffset, maxScroll, autoScroll ?? false);
	const bodyLines = allBodyLines.slice(effectiveOffset, effectiveOffset + height);

	const following = effectiveOffset >= maxScroll;
	const totalLines = allBodyLines.length;
	const pct = totalLines === 0 ? 100 : Math.min(100, Math.round(((effectiveOffset + height) / totalLines) * 100));
	const footerLine = `${totalLines} lines · ${pct}% · ${following ? "following" : "paused"}`;

	return { headerLines, bodyLines, footerLine, maxScroll };
}
