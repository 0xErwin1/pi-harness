import { homedir } from "node:os";
import { join } from "node:path";
import { PromptDb } from "./db.ts";

/** On-disk location of the shared prompt database, under the pi agent dir. */
export const PROMPT_DB_PATH = join(homedir(), ".pi", "agent", "harness-prompts.db");

let instance: PromptDb | undefined;

/**
 * The single process-wide prompt database. ONE connection per process is the
 * rule: node:sqlite serializes statements on a connection, and a lone connection
 * avoids self-contention. Cross-process concurrency (several pi instances on the
 * same file) is handled INSIDE PromptDb via WAL + busy_timeout, not here.
 *
 * Opened lazily and kept for the whole process — never closed mid-run, because
 * the prompt history spans sessions. Every consumer (the extension, the popup,
 * the indicator) goes through this accessor and resolves it lazily (a `() =>
 * PromptDb` getter), never capturing the instance, so no caller can ever hold a
 * stale or closed handle.
 */
export function getPromptDb(): PromptDb {
	if (!instance) instance = new PromptDb(PROMPT_DB_PATH);
	return instance;
}
