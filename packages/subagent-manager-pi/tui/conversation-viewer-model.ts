import type { RunSnapshot } from "../../subagent-manager-core/events.ts";
import type { RunMessage } from "../../subagent-manager-core/store.ts";

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

function buildBody(messages: RunMessage[], width: number): string[] {
	const lines: string[] = [];
	for (const msg of messages) {
		lines.push("[Assistant]");
		for (const line of wrapText(msg.text, width)) {
			lines.push(line);
		}
	}
	return lines;
}

export function buildViewerModel(input: {
	snapshot?: RunSnapshot;
	messages: RunMessage[];
	scrollOffset: number;
	width: number;
	height: number;
	now: number;
	autoScroll?: boolean;
}): ViewerModel {
	const { snapshot, messages, width, height, now, autoScroll } = input;

	const agent = snapshot?.agent ?? "";
	const status = snapshot?.status ?? "unknown";
	const elapsedMs = snapshot ? now - Date.parse(snapshot.startedAt) : undefined;
	const elapsed = elapsedMs !== undefined ? formatElapsedMs(elapsedMs) : "";

	const headerParts = [agent, status, elapsed].filter((p) => p.length > 0);
	const headerLines = [headerParts.join(" · ")];

	const allBodyLines = buildBody(messages, width);
	const maxScroll = Math.max(0, allBodyLines.length - height);

	const effectiveOffset = autoScroll ? maxScroll : Math.max(0, Math.min(input.scrollOffset, maxScroll));
	const bodyLines = allBodyLines.slice(effectiveOffset, effectiveOffset + height);

	const totalLines = allBodyLines.length;
	const pct = totalLines === 0 ? 100 : Math.round(((effectiveOffset + height) / totalLines) * 100);
	const footerLine = `${totalLines} lines · ${Math.min(pct, 100)}%`;

	return { headerLines, bodyLines, footerLine, maxScroll };
}
