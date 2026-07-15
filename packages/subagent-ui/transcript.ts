import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { IconSet } from "../icons/types.ts";
import type { UiTheme } from "./theme.ts";

/**
 * Transcript rendering for the takeover view.
 *
 * `applyTranscriptEvent` folds the (normalized) events streamed from a live
 * `getRecord(id).session.subscribe(...)` into a plain transcript state, and
 * `buildTranscriptLines` turns that state into wrapped, prefixed lines. The
 * logic is pure so the panel/streaming glue in the extension stays thin.
 *
 * Aesthetic: role prefixes follow the my-pi-setup layout — user `> `, thinking
 * `~ ` (dim italic), tool call `→ ` + name, tool result `output:`/`error:` — with
 * Ayu theme roles and `packages/icons` glyphs instead of monochrome sigils.
 */

/** A raw agent message as it arrives on the session event stream. */
export interface RawMessage {
	role: string;
	content: unknown;
}

/**
 * The subset of `AgentSessionEvent` the takeover reads. The extension passes the
 * real events, which match structurally; tests hand-build them.
 */
export type TranscriptEvent =
	| { type: "message_start"; message: RawMessage }
	| { type: "message_update"; message: RawMessage }
	| { type: "message_end"; message: RawMessage }
	| { type: "tool_execution_start"; toolCallId: string; toolName: string }
	| { type: "tool_execution_end"; toolCallId: string; toolName: string; isError: boolean; result: unknown };

export type AssistantPart =
	| { type: "text"; text: string }
	| { type: "thinking"; text: string; redacted: boolean }
	| { type: "toolCall"; name: string; argsPreview: string };

export type TranscriptItem =
	| { kind: "user"; text: string }
	| { kind: "assistant"; parts: AssistantPart[] }
	| { kind: "toolResult"; name: string; isError: boolean; outputPreview: string };

export interface LiveTool {
	id: string;
	name: string;
}

export interface TranscriptState {
	readonly items: readonly TranscriptItem[];
	readonly liveAssistant: { thinking: string; text: string } | null;
	readonly liveTools: readonly LiveTool[];
}

export function emptyTranscript(): TranscriptState {
	return { items: [], liveAssistant: null, liveTools: [] };
}

// --- content extraction (structural, matches the pi-ai content block shapes) ---

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function contentBlocks(content: unknown): Record<string, unknown>[] {
	if (!Array.isArray(content)) return [];

	const blocks: Record<string, unknown>[] = [];
	for (const item of content) {
		const block = asRecord(item);
		if (block) blocks.push(block);
	}
	return blocks;
}

/** Flatten a message's content into plain text (user messages may be a bare string). */
export function extractUserText(content: unknown): string {
	if (typeof content === "string") return content;

	const parts: string[] = [];
	for (const block of contentBlocks(content)) {
		if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
	}
	return parts.join("\n");
}

/** Pull the assistant's text / thinking / tool-call parts out of a message. */
export function extractAssistantParts(content: unknown): AssistantPart[] {
	const parts: AssistantPart[] = [];

	for (const block of contentBlocks(content)) {
		if (block.type === "text" && typeof block.text === "string") {
			parts.push({ type: "text", text: block.text });
		} else if (block.type === "thinking") {
			const redacted = block.redacted === true;
			const text = typeof block.thinking === "string" ? block.thinking : "";
			parts.push({ type: "thinking", text, redacted });
		} else if (block.type === "toolCall" && typeof block.name === "string") {
			parts.push({ type: "toolCall", name: block.name, argsPreview: previewArgs(block.arguments) });
		}
	}

	return parts;
}

function previewArgs(args: unknown): string {
	const record = asRecord(args);
	if (!record) return "";
	try {
		const json = JSON.stringify(record);
		return json === "{}" ? "" : json;
	} catch {
		return "";
	}
}

/** Reduce an arbitrary tool result into a single-line preview string. */
export function previewResult(result: unknown): string {
	if (typeof result === "string") return sanitizeText(result);

	const record = asRecord(result);
	if (record && Array.isArray(record.content)) {
		for (const block of contentBlocks(record.content)) {
			if (block.type === "text" && typeof block.text === "string") return sanitizeText(block.text);
		}
	}

	if (record && typeof record.text === "string") return sanitizeText(record.text);

	try {
		return sanitizeText(JSON.stringify(result) ?? "");
	} catch {
		return "";
	}
}

// --- reducer ------------------------------------------------------------------

export function applyTranscriptEvent(state: TranscriptState, event: TranscriptEvent): TranscriptState {
	switch (event.type) {
		case "message_start": {
			if (event.message.role !== "assistant") return state;
			return { ...state, liveAssistant: { thinking: "", text: "" } };
		}

		case "message_update": {
			if (event.message.role !== "assistant") return state;
			const parts = extractAssistantParts(event.message.content);
			const text = parts
				.filter((p): p is Extract<AssistantPart, { type: "text" }> => p.type === "text")
				.map((p) => p.text)
				.join("");
			const thinking = parts
				.filter((p): p is Extract<AssistantPart, { type: "thinking" }> => p.type === "thinking")
				.map((p) => p.text)
				.join("");
			return { ...state, liveAssistant: { thinking, text } };
		}

		case "message_end": {
			const role = event.message.role;
			if (role === "user") {
				const item: TranscriptItem = { kind: "user", text: extractUserText(event.message.content) };
				return { ...state, items: [...state.items, item] };
			}
			if (role === "assistant") {
				const item: TranscriptItem = { kind: "assistant", parts: extractAssistantParts(event.message.content) };
				return { ...state, items: [...state.items, item], liveAssistant: null };
			}
			return state;
		}

		case "tool_execution_start":
			return { ...state, liveTools: [...state.liveTools, { id: event.toolCallId, name: event.toolName }] };

		case "tool_execution_end": {
			const item: TranscriptItem = {
				kind: "toolResult",
				name: event.toolName,
				isError: event.isError,
				outputPreview: previewResult(event.result),
			};
			return {
				...state,
				items: [...state.items, item],
				liveTools: state.liveTools.filter((tool) => tool.id !== event.toolCallId),
			};
		}
	}
}

// --- sanitize -----------------------------------------------------------------

const ANSI_PATTERN =
	// eslint-disable-next-line no-control-regex
	/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

/**
 * Strip raw ANSI codes, expand tabs to two spaces, and drop control chars.
 * Terminal-expanded tabs and stray escapes make lines wider than the width we
 * declare to the TUI, which desyncs the renderer and smears the overlay.
 */
export function sanitizeText(text: string): string {
	return (
		text
			.replace(ANSI_PATTERN, "")
			.replaceAll("\t", "  ")
			// eslint-disable-next-line no-control-regex
			.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
	);
}

// --- render -------------------------------------------------------------------

function pushWrapped(out: string[], prefix: string, hangingIndent: string, body: string, width: number): void {
	const wrapped = wrapTextWithAnsi(body, Math.max(10, width - visibleWidth(prefix)));
	for (let i = 0; i < wrapped.length; i++) {
		out.push(truncateToWidth((i === 0 ? prefix : hangingIndent) + wrapped[i], width));
	}
}

function renderUser(theme: UiTheme, text: string, width: number, out: string[]): void {
	const clean = sanitizeText(text).trim();
	if (!clean) return;
	pushWrapped(out, theme.fg("accent", "> "), "  ", theme.fg("userMessageText", clean), width);
}

function renderThinking(theme: UiTheme, text: string, width: number, out: string[]): void {
	const clean = sanitizeText(text).trim();
	if (!clean) return;
	pushWrapped(out, theme.fg("dim", "~ "), "  ", theme.fg("muted", theme.italic(clean)), width);
}

function renderAssistant(theme: UiTheme, parts: readonly AssistantPart[], width: number, out: string[]): void {
	for (const part of parts) {
		if (part.type === "text") {
			const clean = sanitizeText(part.text).trim();
			if (clean) out.push(...wrapTextWithAnsi(clean, width));
		} else if (part.type === "thinking") {
			renderThinking(theme, part.redacted ? "[redacted reasoning]" : part.text, width, out);
		} else {
			const arrow = theme.fg("muted", "→ ");
			const name = theme.fg("toolTitle", part.name);
			const preview = part.argsPreview ? theme.fg("dim", ` ${sanitizeText(part.argsPreview)}`) : "";
			out.push(truncateToWidth(arrow + name + preview, width));
		}
	}
}

function renderToolResult(theme: UiTheme, item: Extract<TranscriptItem, { kind: "toolResult" }>, width: number, out: string[]): void {
	const firstLine = item.outputPreview.split("\n").find((line) => line.trim()) ?? "";
	const label = item.isError ? theme.fg("error", "error: ") : theme.fg("dim", "output: ");
	out.push(truncateToWidth(label + theme.fg("dim", firstLine || "(no output)"), width));
}

/** Render the transcript as plain lines wrapped to `width`, newest at the bottom. */
export function buildTranscriptLines(state: TranscriptState, width: number, theme: UiTheme, icons: IconSet): string[] {
	const out: string[] = [];

	for (const item of state.items) {
		const before = out.length;
		if (item.kind === "user") renderUser(theme, item.text, width, out);
		else if (item.kind === "assistant") renderAssistant(theme, item.parts, width, out);
		else renderToolResult(theme, item, width, out);

		if (out.length > before) out.push("");
	}
	while (out.length > 0 && out[out.length - 1] === "") out.pop();

	if (state.liveAssistant) {
		const { thinking, text } = state.liveAssistant;
		const separated = out.length > 0;
		if (separated) out.push("");
		const before = out.length;
		if (thinking.trim()) renderThinking(theme, thinking, width, out);
		const clean = sanitizeText(text).trim();
		if (clean) out.push(...wrapTextWithAnsi(clean, width));
		// Drop the dangling separator when the live buffer contributed nothing.
		if (out.length === before && separated) out.pop();
	}

	for (const tool of state.liveTools) {
		if (out.length > 0) out.push("");
		const marker = theme.fg("warning", "running");
		const line = theme.fg("toolTitle", tool.name) + " " + theme.fg("dim", icons.spinner[0] ?? "") + " " + marker;
		out.push(truncateToWidth(line, width));
	}

	return out;
}
