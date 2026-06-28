/** Added/removed line counts parsed from `git diff --shortstat`. */
export interface DiffCounts {
	added: number;
	removed: number;
}

/**
 * Parses a `git diff --shortstat` line into added/removed line counts.
 *
 * Example inputs:
 *   " 3 files changed, 391 insertions(+), 37 deletions(-)"
 *   " 1 file changed, 5 insertions(+)"
 *   " 1 file changed, 2 deletions(-)"
 *   ""  /  " 0 files changed"
 *
 * Either the insertions or the deletions clause may be absent; a missing clause
 * counts as zero. Empty or non-matching input yields `{ added: 0, removed: 0 }`.
 */
export function parseShortstat(stdout: string): DiffCounts {
	const insertions = stdout.match(/(\d+)\s+insertions?\(\+\)/);
	const deletions = stdout.match(/(\d+)\s+deletions?\(-\)/);

	const added = insertions ? Number.parseInt(insertions[1]!, 10) : 0;
	const removed = deletions ? Number.parseInt(deletions[1]!, 10) : 0;

	return { added, removed };
}

/** Sums any number of diff-count pairs (e.g. unstaged + staged). */
export function sumDiffs(...counts: DiffCounts[]): DiffCounts {
	return counts.reduce<DiffCounts>(
		(acc, { added, removed }) => ({
			added: acc.added + added,
			removed: acc.removed + removed,
		}),
		{ added: 0, removed: 0 },
	);
}
