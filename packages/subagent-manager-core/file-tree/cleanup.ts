import { readdirSync, rmSync, statSync, type Dirent } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeCwd, currentDepth } from "./paths.ts";

/** Default time-to-live for a crashed session's files: 6 hours. */
export const DEFAULT_SESSION_TTL_MS = 6 * 60 * 60 * 1000;

export interface SweepOptions {
	/** Reference instant for the staleness comparison. Defaults to `Date.now()`. */
	now?: number;
	/** Maximum age before a session directory is swept. Defaults to 6h. */
	ttlMs?: number;
	/**
	 * The `<uid>/<encodeCwd(cwd)>` parent directory whose session subdirectories
	 * are candidates for sweeping. Defaults to the real per-cwd directory under
	 * the OS temp dir. Injectable so tests can drive a temporary tree.
	 */
	baseDir?: string;
}

/**
 * Returns the per-cwd parent directory that holds this process's session roots:
 * `<tmpdir>/pi-harness-agents-<uid>/<encodeCwd(cwd)>`.
 */
function cwdSessionsBaseDir(): string {
	const uid = process.getuid?.() ?? 0;
	return join(tmpdir(), `pi-harness-agents-${uid}`, encodeCwd(process.cwd()));
}

/**
 * Removes a single absolute session-root directory recursively.
 *
 * Best-effort: any error (missing dir, permission, race with another reader) is
 * swallowed so this can run safely from shutdown/exit handlers without throwing.
 */
export function removeSessionRoot(root: string): void {
	try {
		rmSync(root, { recursive: true, force: true });
	} catch {
		// best-effort cleanup; never throw on shutdown
	}
}

/**
 * Sweeps stale session directories for the current cwd, recovering disk left by
 * crashed sessions that never ran their own exit cleanup.
 *
 * Only the direct subdirectories of the `<uid>/<encodeCwd(cwd)>` base are
 * considered: a subdirectory is removed when its mtime is older than `ttlMs`
 * relative to `now`. The base directory itself, the `pi-harness-agents-<uid>`
 * prefix, and anything outside this subtree are NEVER removed. Per-entry errors
 * are swallowed so one bad directory does not abort the sweep.
 */
export function sweepStaleSessions(opts: SweepOptions = {}): void {
	const now = opts.now ?? Date.now();
	const ttlMs = opts.ttlMs ?? DEFAULT_SESSION_TTL_MS;
	const baseDir = opts.baseDir ?? cwdSessionsBaseDir();

	let entries: Dirent[];
	try {
		entries = readdirSync(baseDir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;

		const sessionDir = join(baseDir, entry.name);
		try {
			const { mtimeMs } = statSync(sessionDir);
			if (now - mtimeMs > ttlMs) {
				rmSync(sessionDir, { recursive: true, force: true });
			}
		} catch {
			// skip per-entry transient fs errors
		}
	}
}

/**
 * True only for the top-level pi-harness process (subagent depth 0). Nested
 * processes inherit a non-zero `PI_HARNESS_SUBAGENT_DEPTH` and must never clean
 * the shared session tree the top-level process owns and may still be reading.
 */
export function isTopLevelProcess(): boolean {
	return currentDepth() === 0;
}
