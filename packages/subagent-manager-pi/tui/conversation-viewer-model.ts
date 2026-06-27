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
				lines.push("▶ started");
				break;
			case "run.progress": {
				const tool = toolNameFromProgress(event.message);
				lines.push(tool ? `🔧 ${tool}` : `· ${event.message}`);
				break;
			}
			case "run.output":
				if (event.role === "assistant" && event.text) {
					lines.push("[Assistant]");
					for (const line of wrapText(event.text, width)) lines.push(line);
				}
				break;
			case "run.needs_attention":
				lines.push(`⚠ ${event.reason}`);
				break;
			case "run.completed":
				lines.push("✓ completed");
				break;
			case "run.failed":
				lines.push(`✗ failed: ${event.error}`);
				break;
			case "run.interrupted":
				lines.push("■ interrupted");
				break;
			case "provider.degraded":
				lines.push(`⚠ ${event.provider}: ${event.reason}`);
				break;
		}
	}

	return lines;
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

	const headerParts = [agent, status, elapsed].filter((p) => p.length > 0);
	const headerLines = [headerParts.join(" · ")];

	const allBodyLines = eventsToBodyLines(events, width);
	const maxScroll = Math.max(0, allBodyLines.length - height);

	const effectiveOffset = autoScroll ? maxScroll : Math.max(0, Math.min(input.scrollOffset, maxScroll));
	const bodyLines = allBodyLines.slice(effectiveOffset, effectiveOffset + height);

	const totalLines = allBodyLines.length;
	const pct = totalLines === 0 ? 100 : Math.round(((effectiveOffset + height) / totalLines) * 100);
	const footerLine = `${totalLines} lines · ${Math.min(pct, 100)}%`;

	return { headerLines, bodyLines, footerLine, maxScroll };
}
