import type { RunEvent, RunSnapshot } from "../../subagent-manager-core/events.ts";
import { TOOL_PROGRESS_PREFIX } from "../../subagent-manager-core/events.ts";

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

/**
 * Markers for a grouped thinking block. Pi's native thread renders reasoning as a
 * dim header followed by a wrapped paragraph, NOT a per-line tag; these reproduce
 * that. The body gutter uses the box-drawing vertical (kept under the de-emoji
 * scheme) so a continuation line reads like a quoted sidebar and is classifiable
 * as dim without a visible `[thinking]` tag. Markers and `transcriptLineColor`
 * must stay in sync.
 */
const THINKING_HEADER = "Thinking";
const THINKING_BODY_PREFIX = "│ ";

/**
 * Formats a token total compactly: a bare count under 1k, then `k`/`M` with one
 * decimal so the collapsed row and overlay header stay short.
 */
export function formatTokens(tokens: number): string {
	if (tokens < 1000) return String(tokens);
	if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
	return `${(tokens / 1_000_000).toFixed(1)}M`;
}

/**
 * Splits a thinking text into an optional title and the remaining body. The model
 * sometimes leads its reasoning with its own title — either a markdown bold
 * (`**Weighing options**`) or a `Thinking:` prefix. When present that title is
 * lifted into the block header (so the rendered header never doubles up as
 * `Thinking: Thinking:`); otherwise the whole text is the body and a plain
 * `Thinking` header is used.
 */
function splitThinkingTitle(text: string): { title?: string; body: string } {
	const trimmed = text.trim();

	const bold = trimmed.match(/^\*\*(.+?)\*\*\s*/);
	if (bold) {
		return { title: bold[1].trim() || undefined, body: trimmed.slice(bold[0].length).trim() };
	}

	if (/^Thinking:/i.test(trimmed)) {
		const afterLabel = trimmed.replace(/^Thinking:\s*/i, "");
		const newlineAt = afterLabel.indexOf("\n");
		if (newlineAt >= 0) {
			return { title: afterLabel.slice(0, newlineAt).trim() || undefined, body: afterLabel.slice(newlineAt + 1).trim() };
		}
		return { title: afterLabel.trim() || undefined, body: "" };
	}

	return { body: trimmed };
}

/**
 * Renders one or more consecutive thinking texts as a single grouped block: a dim
 * `Thinking`/`Thinking: <title>` header followed by the reasoning body wrapped to
 * width under a dim gutter. Empty bodies (title-only thinking) yield just the
 * header.
 */
function renderThinkingBlock(texts: string[], width: number): string[] {
	const combined = texts.join("\n").trim();
	if (combined.length === 0) return [];

	const { title, body } = splitThinkingTitle(combined);
	const lines = [title ? `${THINKING_HEADER}: ${title}` : THINKING_HEADER];

	const bodyWidth = width > 0 ? width - THINKING_BODY_PREFIX.length : width;
	for (const line of wrapText(body, bodyWidth)) {
		if (line.length === 0) continue;
		lines.push(`${THINKING_BODY_PREFIX}${line}`);
	}

	return lines;
}

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
	if (line.startsWith("[prompt]")) return "dim";
	if (line.startsWith("[Assistant")) return "accent";
	if (line.startsWith(TOOL_LINE_PREFIX)) return "success";
	if (line.startsWith("[done]")) return "success";
	if (line.startsWith("[failed]")) return "error";
	if (line.startsWith("[attention]")) return "warning";
	if (line.startsWith("[degraded]")) return "warning";
	if (line.startsWith("[interrupted]")) return "warning";
	if (line.startsWith("[started]")) return "dim";
	if (line === THINKING_HEADER || line.startsWith(`${THINKING_HEADER}: `)) return "dim";
	if (line.startsWith(THINKING_BODY_PREFIX)) return "dim";
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
 * When `prompt` is provided it is prepended as a `[prompt]` block before the
 * event stream, so the viewer shows what the subagent was asked to do first.
 *
 * This is the core of the live viewer: tool-use turns carry no assistant text,
 * so a transcript built only from accumulated assistant messages stays empty
 * while the subagent is actually working. Reading the event stream surfaces the
 * tool calls (and progress/status changes) as they happen, mirroring Ctrl-O.
 */
export function eventsToBodyLines(events: RunEvent[], width: number, prompt?: string): string[] {
	const lines: string[] = [];
	let thinkingRun: string[] = [];

	if (prompt) {
		lines.push("[prompt]");
		for (const line of wrapText(prompt, width)) lines.push(line);
	}

	const flushThinking = () => {
		if (thinkingRun.length === 0) return;
		lines.push(...renderThinkingBlock(thinkingRun, width));
		thinkingRun = [];
	};

	for (const event of events) {
		if (event.type === "run.output" && event.kind === "thinking" && event.text) {
			thinkingRun.push(event.text);
			continue;
		}

		flushThinking();

		switch (event.type) {
			case "run.started":
				lines.push("[started]");
				break;
			case "run.progress": {
				const tool = toolNameFromProgress(event.message);
				if (tool) {
					const display = event.toolCall ?? (event.target ? `${tool} ${event.target}` : tool);
					lines.push(`${TOOL_LINE_PREFIX}${display}`);
				} else {
					lines.push(`· ${event.message}`);
				}
				break;
			}
			case "run.output":
				if (event.role === "assistant" && event.text) {
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

	flushThinking();

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

	let tools = 0;
	for (const event of events) {
		if (event.type === "run.progress" && toolNameFromProgress(event.message) !== undefined) tools += 1;
	}
	const tokens = snapshot?.tokens ?? 0;

	const headerParts = [agent, status, elapsed, `${formatTokens(tokens)} tok`, `${tools} tools`].filter(
		(p) => p.length > 0,
	);
	const headerLines = [headerParts.join(" · ")];

	const allBodyLines = eventsToBodyLines(events, width, snapshot?.prompt);
	const maxScroll = Math.max(0, allBodyLines.length - height);

	const effectiveOffset = resolveViewportOffset(input.scrollOffset, maxScroll, autoScroll ?? false);
	const bodyLines = allBodyLines.slice(effectiveOffset, effectiveOffset + height);

	const following = effectiveOffset >= maxScroll;
	const totalLines = allBodyLines.length;
	const pct = totalLines === 0 ? 100 : Math.min(100, Math.round(((effectiveOffset + height) / totalLines) * 100));
	const footerLine = `${totalLines} lines · ${pct}% · ${following ? "following" : "paused"}`;

	return { headerLines, bodyLines, footerLine, maxScroll };
}
