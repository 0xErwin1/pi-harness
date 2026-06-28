import { EMPTY_STATE } from "./state.ts";
import type { TaskState } from "./state.ts";
import type { Task } from "./types.ts";

let _state: TaskState = { ...EMPTY_STATE, tasks: [] };

/**
 * Returns the current in-memory todo state.
 */
export function getState(): TaskState {
	return _state;
}

/**
 * Replaces the in-memory state. Used by the branch replay on session lifecycle events
 * to restore state from the last todo tool call recorded in the session history.
 */
export function replaceState(state: TaskState): void {
	_state = state;
}

/**
 * Persists the result of a reducer mutation into the in-memory store.
 * Called by the tool execute function after every successful mutation.
 */
export function commitState(state: TaskState): void {
	_state = state;
}

/**
 * Returns the current task array. Convenience accessor for rendering.
 */
export function getTodos(): Task[] {
	return _state.tasks;
}

/**
 * Resets the store to the empty initial state. Used only in tests.
 */
export function __resetState(): void {
	_state = { ...EMPTY_STATE, tasks: [] };
}
