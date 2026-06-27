import test from "node:test";
import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
	removeSessionRoot,
	sweepStaleSessions,
	isTopLevelProcess,
	DEFAULT_SESSION_TTL_MS,
} from "../../packages/subagent-manager-core/file-tree/cleanup.ts";

function tempDir(): string {
	const dir = join(tmpdir(), `pht-cleanup-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** Creates a session subdirectory under `base` and sets its mtime to `mtimeMs`. */
function makeSessionDir(base: string, name: string, mtimeMs: number): string {
	const dir = join(base, name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "marker.json"), "{}", "utf-8");

	const seconds = mtimeMs / 1000;
	utimesSync(dir, seconds, seconds);
	return dir;
}

// ---------------------------------------------------------------------------
// removeSessionRoot
// ---------------------------------------------------------------------------

test("removeSessionRoot: removes the given directory recursively", () => {
	const base = tempDir();
	try {
		const root = join(base, "session-1");
		mkdirSync(join(root, "nested"), { recursive: true });
		writeFileSync(join(root, "nested", "a.txt"), "hi", "utf-8");

		assert.ok(existsSync(root));
		removeSessionRoot(root);
		assert.ok(!existsSync(root), "session root must be gone");
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test("removeSessionRoot: no-op on a missing directory (does not throw)", () => {
	assert.doesNotThrow(() => {
		removeSessionRoot("/tmp/pht-cleanup-definitely-missing-root");
	});
});

// ---------------------------------------------------------------------------
// sweepStaleSessions
// ---------------------------------------------------------------------------

test("sweepStaleSessions: removes only session dirs older than the TTL", () => {
	const base = tempDir();
	try {
		const now = 10_000_000_000;
		const ttlMs = 6 * 60 * 60 * 1000;

		const staleDir = makeSessionDir(base, "stale", now - ttlMs - 60_000);
		const freshDir = makeSessionDir(base, "fresh", now - 60_000);

		sweepStaleSessions({ now, ttlMs, baseDir: base });

		assert.ok(!existsSync(staleDir), "stale session must be swept");
		assert.ok(existsSync(freshDir), "fresh session must survive");
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test("sweepStaleSessions: never removes the base dir itself", () => {
	const base = tempDir();
	try {
		const now = 10_000_000_000;
		const ttlMs = 6 * 60 * 60 * 1000;

		makeSessionDir(base, "stale-1", now - ttlMs - 1);
		makeSessionDir(base, "stale-2", now - ttlMs - 1);

		sweepStaleSessions({ now, ttlMs, baseDir: base });

		assert.ok(existsSync(base), "base directory must never be removed");
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test("sweepStaleSessions: ignores plain files in the base dir", () => {
	const base = tempDir();
	try {
		const now = 10_000_000_000;
		const ttlMs = 6 * 60 * 60 * 1000;

		const filePath = join(base, "loose.json");
		writeFileSync(filePath, "{}", "utf-8");
		const seconds = (now - ttlMs - 60_000) / 1000;
		utimesSync(filePath, seconds, seconds);

		sweepStaleSessions({ now, ttlMs, baseDir: base });

		assert.ok(existsSync(filePath), "non-directory entries must be left untouched");
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

test("sweepStaleSessions: missing base dir is a no-op (does not throw)", () => {
	assert.doesNotThrow(() => {
		sweepStaleSessions({ baseDir: "/tmp/pht-cleanup-missing-base-dir" });
	});
});

test("sweepStaleSessions: default TTL keeps a just-created session", () => {
	const base = tempDir();
	try {
		const sessionDir = makeSessionDir(base, "recent", Date.now());

		sweepStaleSessions({ baseDir: base });

		assert.ok(existsSync(sessionDir), "a session younger than the default TTL survives");
		assert.equal(DEFAULT_SESSION_TTL_MS, 6 * 60 * 60 * 1000);
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// isTopLevelProcess
// ---------------------------------------------------------------------------

test("isTopLevelProcess: true when depth is unset", () => {
	const prev = process.env.PI_HARNESS_SUBAGENT_DEPTH;
	delete process.env.PI_HARNESS_SUBAGENT_DEPTH;
	try {
		assert.equal(isTopLevelProcess(), true);
	} finally {
		if (prev === undefined) delete process.env.PI_HARNESS_SUBAGENT_DEPTH;
		else process.env.PI_HARNESS_SUBAGENT_DEPTH = prev;
	}
});

test("isTopLevelProcess: true at depth 0, false at depth > 0", () => {
	const prev = process.env.PI_HARNESS_SUBAGENT_DEPTH;
	try {
		process.env.PI_HARNESS_SUBAGENT_DEPTH = "0";
		assert.equal(isTopLevelProcess(), true);

		process.env.PI_HARNESS_SUBAGENT_DEPTH = "1";
		assert.equal(isTopLevelProcess(), false);

		process.env.PI_HARNESS_SUBAGENT_DEPTH = "3";
		assert.equal(isTopLevelProcess(), false);
	} finally {
		if (prev === undefined) delete process.env.PI_HARNESS_SUBAGENT_DEPTH;
		else process.env.PI_HARNESS_SUBAGENT_DEPTH = prev;
	}
});
