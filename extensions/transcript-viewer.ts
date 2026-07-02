import { truncateToWidth, type Component, type TUI, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { enterOverlay, exitOverlay } from "../packages/shared/overlay-gate.ts";

interface TranscriptLine {
	text: string;
	role: "user" | "assistant" | "system" | "tool" | "other";
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	const parts: string[] = [];
	for (const item of content) {
		const block = objectRecord(item);
		if (!block) continue;

		if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
		else if (block.type === "toolCall" && typeof block.name === "string") parts.push(`[tool call: ${block.name}]`);
		else if (block.type === "toolResult" && typeof block.name === "string") parts.push(`[tool result: ${block.name}]`);
	}

	return parts.join("\n");
}

function roleOf(message: Record<string, unknown>): TranscriptLine["role"] {
	const role = message.role;
	if (role === "user" || role === "assistant" || role === "system") return role;
	if (role === "tool" || role === "bashExecution") return "tool";
	return "other";
}

function labelFor(role: TranscriptLine["role"]): string {
	switch (role) {
		case "user":
			return "You";
		case "assistant":
			return "Agent";
		case "system":
			return "System";
		case "tool":
			return "Tool";
		case "other":
			return "Other";
	}
}

export function buildTranscriptLines(entries: unknown[]): TranscriptLine[] {
	const lines: TranscriptLine[] = [];

	for (const entry of entries) {
		const record = objectRecord(entry);
		if (!record) continue;

		if (record.type === "message") {
			const message = objectRecord(record.message);
			if (!message) continue;

			const role = roleOf(message);
			const text = textFromContent(message.content).trim();
			if (text.length === 0) continue;

			if (lines.length > 0) lines.push({ role: "other", text: "" });
			lines.push({ role, text: `${labelFor(role)}:` });
			for (const bodyLine of text.split("\n")) lines.push({ role, text: bodyLine });
			continue;
		}

		if (record.type === "custom_message" && typeof record.content === "string") {
			if (lines.length > 0) lines.push({ role: "other", text: "" });
			lines.push({ role: "other", text: "Custom:" });
			for (const bodyLine of record.content.split("\n")) lines.push({ role: "other", text: bodyLine });
		}
	}

	return lines;
}

function styleLine(theme: Theme, line: TranscriptLine): string {
	if (line.text.length === 0) return "";

	if (line.text.endsWith(":")) {
		switch (line.role) {
			case "user":
				return theme.bold(theme.fg("accent", line.text));
			case "assistant":
				return theme.bold(theme.fg("success", line.text));
			case "tool":
				return theme.bold(theme.fg("warning", line.text));
			default:
				return theme.bold(line.text);
		}
	}

	return line.role === "tool" ? theme.fg("dim", line.text) : line.text;
}

class TranscriptViewer implements Component {
	private scroll = 0;
	private lastViewport = 1;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly done: () => void,
		private readonly sourceLines: TranscriptLine[],
	) {
		this.scroll = Math.max(0, this.renderedContentWidth(this.tui.terminal.columns).length - this.lastViewport);
	}

	handleInput(data: string): void {
		const key = data;
		const page = Math.max(1, this.lastViewport - 2);
		if (key === "\x1b" || key === "q") {
			this.done();
			return;
		}
		if (key === "j" || key === "\x1b[B") this.scroll += 1;
		else if (key === "k" || key === "\x1b[A") this.scroll -= 1;
		else if (key === "\x06" || key === "\x1b[6~") this.scroll += page;
		else if (key === "\x02" || key === "\x1b[5~") this.scroll -= page;
		else if (key === "g") this.scroll = 0;
		else if (key === "G") this.scroll = Number.MAX_SAFE_INTEGER;
		else return;

		this.tui.requestRender();
	}

	render(width: number): string[] {
		const innerW = Math.max(1, width - 4);
		const content = this.renderedContentWidth(innerW);
		const viewport = Math.max(3, this.tui.terminal.rows - 8);
		this.lastViewport = viewport;
		this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, content.length - viewport)));

		const th = this.theme;
		const pad = (text: string) => text + " ".repeat(Math.max(0, innerW - visibleWidth(text)));
		const row = (content: string) => `${th.fg("border", "│")} ${truncateToWidth(pad(content), innerW)} ${th.fg("border", "│")}`;
		const top = th.fg("border", `╭${"─".repeat(width - 2)}╮`);
		const bottom = th.fg("border", `╰${"─".repeat(width - 2)}╯`);

		const total = content.length;
		const end = Math.min(total, this.scroll + viewport);
		const pos = total > 0 ? `${this.scroll + 1}-${end}/${total}` : "0/0";
		const lines = [top, row(`${th.bold("Transcript")} ${th.fg("dim", pos)}`), row(th.fg("dim", "jk/↑↓ move · PgUp/PgDn page · g/G top/bottom · q/Esc close")), row(th.fg("dim", "─".repeat(innerW)))];

		for (let i = 0; i < viewport; i++) lines.push(row(content[this.scroll + i] ?? ""));

		lines.push(bottom);
		return lines;
	}

	invalidate(): void {}

	private renderedContentWidth(width: number): string[] {
		const rendered: string[] = [];
		for (const line of this.sourceLines) {
			const styled = styleLine(this.theme, line);
			const wrapped = line.text.length === 0 ? [""] : wrapTextWithAnsi(styled, width);
			rendered.push(...wrapped);
		}
		return rendered;
	}
}

async function openTranscript(ctx: ExtensionContext): Promise<void> {
	if (ctx.mode !== "tui") return;

	const entries = ctx.sessionManager.getEntries() as unknown[];
	const lines = buildTranscriptLines(entries);

	enterOverlay();
	await ctx.ui
		.custom<void>((tui, theme, _keybindings, done) => new TranscriptViewer(tui, theme, done, lines), {
			overlay: true,
			overlayOptions: { anchor: "center", width: "90%", maxHeight: "90%" },
		})
		.finally(exitOverlay);
}

export default function transcriptViewer(pi: ExtensionAPI): void {
	pi.registerCommand("transcript", {
		description: "Browse the current session transcript in a scrollable overlay.",
		handler: (_args, ctx) => openTranscript(ctx),
	});

	pi.registerCommand("log", {
		description: "Alias for /transcript.",
		handler: (_args, ctx) => openTranscript(ctx),
	});
}
