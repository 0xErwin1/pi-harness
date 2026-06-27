import { chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Encode a cwd path as a filesystem-safe directory name. Ported verbatim from
 * tintinweb pi-subagents output-file.ts. Handles:
 *   - POSIX:   "/home/user/project"          → "home-user-project"
 *   - Windows: "C:\Users\foo\project"        → "Users-foo-project"
 *   - UNC:     "\\\\server\\share\\project"  → "server-share-project"
 */
export function encodeCwd(cwd: string): string {
	return cwd
		.replace(/[/\\]/g, "-")      // both separators → dash
		.replace(/^[A-Za-z]:-/, "")  // strip Windows drive prefix ("C:-")
		.replace(/^-+/, "");         // strip leading dashes (POSIX root, UNC)
}

/** Unique identity token for the current process. Generated once at module load. */
const _processToken = `${process.pid}-${randomUUID().slice(0, 8)}`;

export function processToken(): string {
	return _processToken;
}

/** Returns a globally-unique agentId for a given runId in the current process. */
export function agentIdFor(runId: string): string {
	return `${processToken()}-${runId}`;
}

export function currentDepth(): number {
	return Number.parseInt(process.env.PI_HARNESS_SUBAGENT_DEPTH ?? "0", 10);
}

export function maxDepth(): number {
	return Number.parseInt(process.env.PI_HARNESS_MAX_SUBAGENT_DEPTH ?? "5", 10);
}

/**
 * Returns the absolute session root directory for this pi-harness session.
 *
 * If `PI_HARNESS_RUN_ROOT` is already set (top-level set it, or it was
 * inherited by a child process), returns it directly. Otherwise generates a
 * new unique root, creates the directory with mode 0o700, writes the path
 * back into `process.env.PI_HARNESS_RUN_ROOT` so that child processes inherit
 * it, and returns it.
 *
 * Tests can pre-set `PI_HARNESS_RUN_ROOT` to a temp directory before calling
 * this function and clear it afterward without polluting the real environment.
 */
export function sessionRoot(): string {
	const existing = process.env.PI_HARNESS_RUN_ROOT;
	if (existing) return existing;

	const uid = process.getuid?.() ?? 0;
	const rootSessionId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
	const root = join(
		tmpdir(),
		`pi-harness-agents-${uid}`,
		encodeCwd(process.cwd()),
		rootSessionId,
	);

	mkdirSync(root, { recursive: true, mode: 0o700 });
	try {
		chmodSync(root, 0o700);
	} catch (err) {
		if (process.platform !== "win32") throw err;
	}

	process.env.PI_HARNESS_RUN_ROOT = root;
	return root;
}

export function metaPath(root: string, agentId: string): string {
	return join(root, `${agentId}.meta.json`);
}

export function jsonlPath(root: string, agentId: string): string {
	return join(root, `${agentId}.jsonl`);
}
