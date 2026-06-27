import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import type { RunEvent } from "../events.ts";

/** Writes the initial prompt line (line 0) to a new jsonl transcript file. */
export function writePromptLine(
	path: string,
	entry: { agentId: string; prompt: string; cwd: string; at: string },
): void {
	writeFileSync(path, JSON.stringify({ kind: "prompt", ...entry }) + "\n", "utf-8");
}

/** Appends a single RunEvent as a jsonl line to an existing transcript file. */
export function appendEventLine(path: string, event: RunEvent): void {
	appendFileSync(path, JSON.stringify({ kind: "event", event }) + "\n", "utf-8");
}

/**
 * Reads a jsonl transcript and returns the parsed prompt string (from the
 * prompt line) and all RunEvents (from event lines). Unparseable lines —
 * including a torn trailing line caused by a crash mid-write — are silently
 * skipped. Returns empty results when the file does not exist.
 */
export function readTranscript(path: string): { prompt?: string; events: RunEvent[] } {
	let raw: string;
	try {
		raw = readFileSync(path, "utf-8");
	} catch {
		return { events: [] };
	}

	let prompt: string | undefined;
	const events: RunEvent[] = [];

	for (const line of raw.split("\n")) {
		if (!line) continue;
		try {
			const parsed = JSON.parse(line) as { kind: string; prompt?: string; event?: RunEvent };
			if (parsed.kind === "prompt" && typeof parsed.prompt === "string") {
				prompt = parsed.prompt;
			} else if (parsed.kind === "event" && parsed.event) {
				events.push(parsed.event);
			}
		} catch {
			// ignore unparseable line (torn-tail tolerance)
		}
	}

	return { prompt, events };
}
