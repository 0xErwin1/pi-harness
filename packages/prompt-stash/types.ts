/** A stashed prompt draft. Scoped to a session; the newest has the highest id. */
export interface StashEntry {
	id: number;
	sessionId: string;
	text: string;
	createdAt: string;
}

/** A submitted prompt recorded in the permanent, cross-session history. */
export interface HistoryEntry {
	id: number;
	sessionId: string;
	project: string | null;
	cwd: string | null;
	text: string;
	createdAt: string;
}
