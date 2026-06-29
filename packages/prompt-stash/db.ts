import { DatabaseSync } from "node:sqlite";
import type { HistoryEntry, StashEntry } from "./types.ts";

/** Returns the current timestamp as an ISO string. Injected so tests are deterministic. */
export type Clock = () => string;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS stash (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id TEXT NOT NULL,
	text TEXT NOT NULL,
	created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS history (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id TEXT NOT NULL,
	project TEXT,
	cwd TEXT,
	text TEXT NOT NULL,
	created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stash_session ON stash (session_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_history_id ON history (id DESC);
`;

interface StashRow {
	id: number | bigint;
	session_id: string;
	text: string;
	created_at: string;
}

interface HistoryRow {
	id: number | bigint;
	session_id: string;
	project: string | null;
	cwd: string | null;
	text: string;
	created_at: string;
}

function toStash(row: StashRow): StashEntry {
	return { id: Number(row.id), sessionId: row.session_id, text: row.text, createdAt: row.created_at };
}

function toHistory(row: HistoryRow): HistoryEntry {
	return {
		id: Number(row.id),
		sessionId: row.session_id,
		project: row.project,
		cwd: row.cwd,
		text: row.text,
		createdAt: row.created_at,
	};
}

/** Escapes the LIKE wildcards in a free-text query so a literal `%` or `_` matches itself. */
function escapeLike(query: string): string {
	return query.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * SQLite-backed persistence for the prompt stash and the prompt history, built on
 * the Node built-in `node:sqlite` (no third-party dependency). The STASH is a
 * per-session scratch space (save a draft, restore it later); the HISTORY is a
 * permanent, cross-session log of every submitted prompt. The schema is created on
 * open, so a fresh database file is usable immediately. All timestamps come from an
 * injected clock so behaviour is deterministic under test (open with `:memory:`).
 */
export class PromptDb {
	private readonly db: DatabaseSync;
	private readonly now: Clock;

	constructor(path: string, options: { now?: Clock } = {}) {
		this.db = new DatabaseSync(path);

		// Concurrency hardening: several pi processes (multiple interactive
		// sessions, helper processes) can open this same file at once. busy_timeout
		// makes a contended statement wait instead of failing immediately with
		// SQLITE_BUSY ("database is locked"); WAL lets readers proceed during a
		// write so a render-time read never collides with a write. busy_timeout is
		// set first so switching to WAL itself waits out any lock. Both are
		// best-effort — an in-memory database ignores WAL and stays in memory mode.
		this.db.exec("PRAGMA busy_timeout = 5000");
		this.db.exec("PRAGMA journal_mode = WAL");

		this.db.exec(SCHEMA);
		this.now = options.now ?? (() => new Date().toISOString());
	}

	/**
	 * Saves `text` as the newest stash entry for `sessionId`. When `dedup` is set
	 * (the default), any existing entry in the same session with identical text is
	 * removed first so the restored draft is always the freshest copy.
	 */
	saveStash(sessionId: string, text: string, options: { dedup?: boolean } = {}): StashEntry {
		const dedup = options.dedup ?? true;
		if (dedup) {
			this.db.prepare("DELETE FROM stash WHERE session_id = ? AND text = ?").run(sessionId, text);
		}

		const createdAt = this.now();
		const result = this.db
			.prepare("INSERT INTO stash (session_id, text, created_at) VALUES (?, ?, ?)")
			.run(sessionId, text, createdAt);

		return { id: Number(result.lastInsertRowid), sessionId, text, createdAt };
	}

	/** Number of stash entries currently held for a session. */
	countStash(sessionId: string): number {
		const row = this.db
			.prepare("SELECT COUNT(*) AS n FROM stash WHERE session_id = ?")
			.get(sessionId) as { n: number | bigint } | undefined;
		return row ? Number(row.n) : 0;
	}

	/** Lists a session's stash entries, newest first. */
	listStash(sessionId: string): StashEntry[] {
		const rows = this.db
			.prepare("SELECT * FROM stash WHERE session_id = ? ORDER BY id DESC")
			.all(sessionId) as unknown as StashRow[];
		return rows.map(toStash);
	}

	/** Lists a session's stash entries matching `query` (case-insensitive substring), newest first. */
	searchStash(sessionId: string, query: string): StashEntry[] {
		const trimmed = query.trim();
		if (trimmed.length === 0) return this.listStash(sessionId);

		const rows = this.db
			.prepare("SELECT * FROM stash WHERE session_id = ? AND text LIKE ? ESCAPE '\\' ORDER BY id DESC")
			.all(sessionId, `%${escapeLike(trimmed)}%`) as unknown as StashRow[];
		return rows.map(toStash);
	}

	/** Removes and returns the newest stash entry for `sessionId`, or `undefined` when empty. */
	popLast(sessionId: string): StashEntry | undefined {
		const row = this.db
			.prepare("SELECT * FROM stash WHERE session_id = ? ORDER BY id DESC LIMIT 1")
			.get(sessionId) as StashRow | undefined;
		if (!row) return undefined;

		this.db.prepare("DELETE FROM stash WHERE id = ?").run(row.id);
		return toStash(row);
	}

	/** Removes a single stash entry by id. Returns true when a row was deleted. */
	removeStash(id: number): boolean {
		return this.db.prepare("DELETE FROM stash WHERE id = ?").run(id).changes > 0;
	}

	/** Removes every stash entry for `sessionId`. Returns how many were deleted. */
	clearStash(sessionId: string): number {
		return Number(this.db.prepare("DELETE FROM stash WHERE session_id = ?").run(sessionId).changes);
	}

	/**
	 * Appends a submitted prompt to the permanent history. When `dedupConsecutive`
	 * is set (the default), a prompt identical to the most recent history entry is
	 * skipped so re-sending the same text does not pile up duplicates. Returns the
	 * inserted entry, or `undefined` when it was skipped or the text was blank.
	 */
	addHistory(
		entry: { sessionId: string; project?: string | null; cwd?: string | null; text: string },
		options: { dedupConsecutive?: boolean } = {},
	): HistoryEntry | undefined {
		const text = entry.text;
		if (text.trim().length === 0) return undefined;

		const dedupConsecutive = options.dedupConsecutive ?? true;
		if (dedupConsecutive) {
			const last = this.db.prepare("SELECT text FROM history ORDER BY id DESC LIMIT 1").get() as
				| { text: string }
				| undefined;
			if (last?.text === text) return undefined;
		}

		const project = entry.project ?? null;
		const cwd = entry.cwd ?? null;
		const createdAt = this.now();
		const result = this.db
			.prepare("INSERT INTO history (session_id, project, cwd, text, created_at) VALUES (?, ?, ?, ?, ?)")
			.run(entry.sessionId, project, cwd, text, createdAt);

		return { id: Number(result.lastInsertRowid), sessionId: entry.sessionId, project, cwd, text, createdAt };
	}

	/**
	 * Lists history entries newest first, optionally filtered by a case-insensitive
	 * substring `query` and capped at `limit` (default 200).
	 */
	listHistory(options: { query?: string; limit?: number } = {}): HistoryEntry[] {
		const limit = options.limit ?? 200;
		const query = options.query?.trim() ?? "";

		const rows = (
			query.length === 0
				? this.db.prepare("SELECT * FROM history ORDER BY id DESC LIMIT ?").all(limit)
				: this.db
						.prepare("SELECT * FROM history WHERE text LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ?")
						.all(`%${escapeLike(query)}%`, limit)
		) as unknown as HistoryRow[];

		return rows.map(toHistory);
	}

	/** Removes a single history entry by id. Returns true when a row was deleted. */
	removeHistory(id: number): boolean {
		return this.db.prepare("DELETE FROM history WHERE id = ?").run(id).changes > 0;
	}

	close(): void {
		this.db.close();
	}
}
