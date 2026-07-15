export interface Debouncer {
	/** Requests a run. Repeated calls within the window collapse into one run. */
	schedule(): void;
	/** Cancels any pending run. */
	dispose(): void;
}

/**
 * A trailing debouncer that collapses a burst of `schedule()` calls into a
 * single `task` run per window. It mirrors the footer's git-diff debounce: once
 * a run is pending, further schedules are ignored until it fires, so a rapid
 * sequence of triggers never fans out into multiple `gh` subprocesses.
 */
export function createDebouncer(delayMs: number, task: () => void): Debouncer {
	let timer: ReturnType<typeof setTimeout> | undefined;

	return {
		schedule(): void {
			if (timer !== undefined) return;

			timer = setTimeout(() => {
				timer = undefined;
				task();
			}, delayMs);
		},
		dispose(): void {
			if (timer !== undefined) {
				clearTimeout(timer);
				timer = undefined;
			}
		},
	};
}
