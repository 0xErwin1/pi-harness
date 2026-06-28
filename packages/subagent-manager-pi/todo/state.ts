import type { Task } from "./types.ts";

export interface TaskState {
	tasks: Task[];
	nextId: number;
}

export const EMPTY_STATE: TaskState = {
	tasks: [],
	nextId: 1,
};
