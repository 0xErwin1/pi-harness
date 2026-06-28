import type { TaskState } from "./state.ts";
import type { Task } from "./types.ts";

export interface TodoCounts {
	total: number;
	pending: number;
	inProgress: number;
	completed: number;
}

export interface TasksByStatus {
	pending: Task[];
	inProgress: Task[];
	completed: Task[];
}

export interface OverlayLayout {
	tasks: Task[];
	overflowCount: number;
	overflowCompleted: number;
	overflowPending: number;
}

/**
 * Returns all non-deleted tasks. Deleted tasks are tombstones and must not
 * appear in any rendered view unless explicitly requested via includeDeleted.
 */
export function selectVisibleTasks(state: TaskState): Task[] {
	return state.tasks.filter((t) => t.status !== "deleted");
}

/**
 * Returns task counts for the heading display. Deleted tasks are excluded
 * from all counts.
 */
export function selectTodoCounts(state: TaskState): TodoCounts {
	const visible = selectVisibleTasks(state);
	return {
		total: visible.length,
		pending: visible.filter((t) => t.status === "pending").length,
		inProgress: visible.filter((t) => t.status === "in_progress").length,
		completed: visible.filter((t) => t.status === "completed").length,
	};
}

/**
 * Groups visible tasks by status. Deleted tasks are excluded.
 */
export function selectTasksByStatus(state: TaskState): TasksByStatus {
	const visible = selectVisibleTasks(state);
	return {
		pending: visible.filter((t) => t.status === "pending"),
		inProgress: visible.filter((t) => t.status === "in_progress"),
		completed: visible.filter((t) => t.status === "completed"),
	};
}

/**
 * Computes the subset of visible tasks that fits within the given line budget,
 * reserving one slot for an overflow summary line when tasks must be truncated.
 *
 * Strategy: completed tasks are dropped first so that active (pending /
 * in_progress) work remains visible even in tight budgets. When truncation is
 * still needed after dropping completed tasks, non-completed tasks are
 * trimmed from the end.
 */
export function selectOverlayLayout(state: TaskState, budget: number): OverlayLayout {
	const visible = selectVisibleTasks(state);

	if (visible.length <= budget) {
		return { tasks: visible, overflowCount: 0, overflowCompleted: 0, overflowPending: 0 };
	}

	const nonCompleted = visible.filter((t) => t.status !== "completed");
	const completedTasks = visible.filter((t) => t.status === "completed");

	const slotsForTasks = budget - 1;
	const ordered = [...nonCompleted, ...completedTasks];
	const tasksToShow = ordered.slice(0, slotsForTasks);

	const shownCompleted = tasksToShow.filter((t) => t.status === "completed").length;
	const hiddenCompleted = completedTasks.length - shownCompleted;
	const hiddenCount = visible.length - tasksToShow.length;
	const hiddenPending = hiddenCount - hiddenCompleted;

	return {
		tasks: tasksToShow,
		overflowCount: hiddenCount,
		overflowCompleted: hiddenCompleted,
		overflowPending: hiddenPending,
	};
}

/**
 * Returns true when any visible task has a non-empty blockedBy list. Used by
 * the renderer to decide whether to prefix each task row with its numeric id
 * so dependency references have a visible anchor.
 */
export function selectHasActive(state: TaskState): boolean {
	return selectVisibleTasks(state).some(
		(t) => t.status === "pending" || t.status === "in_progress",
	);
}

/**
 * Returns true when any visible task has at least one blocked-by dependency.
 * Controls whether task id prefixes are shown in the widget and overlay.
 */
export function selectShowTaskIds(state: TaskState): boolean {
	return selectVisibleTasks(state).some(
		(t) => t.blockedBy !== undefined && t.blockedBy.length > 0,
	);
}

/**
 * Returns the subject string for a given task id, or undefined when the task
 * does not exist. Used by renderCall to display the task being operated on.
 */
export function selectTaskSubjectById(state: TaskState, id: number): string | undefined {
	return state.tasks.find((t) => t.id === id)?.subject;
}
