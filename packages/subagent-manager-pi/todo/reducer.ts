import type { Static } from "typebox";
import { EMPTY_STATE } from "./state.ts";
import type { TaskState } from "./state.ts";
import type { Task, TaskAction, TaskStatus } from "./types.ts";
import { TodoParams } from "./types.ts";

type TodoParamsType = Static<typeof TodoParams>;

export type ReducerOp =
	| { type: "created"; task: Task }
	| { type: "updated"; task: Task }
	| { type: "listed"; tasks: Task[] }
	| { type: "got"; task: Task | undefined }
	| { type: "deleted"; task: Task }
	| { type: "cleared" }
	| { type: "error"; message: string };

/**
 * Pure reducer for todo state mutations.
 *
 * Returns a new state and a discriminated op describing what happened.
 * Errors are returned as op.type === "error" — never thrown — so the tool
 * can surface them cleanly without aborting the agent turn.
 *
 * Invariants:
 * - On error the original state is returned unchanged.
 * - No mutation is performed for "list" and "get" actions.
 * - "delete" uses a tombstone (status: "deleted") rather than removal.
 * - "clear" resets to EMPTY_STATE.
 * - Cycle detection via BFS rejects any addBlockedBy that would introduce
 *   a cycle in the dependency graph.
 */
export function applyTaskMutation(
	state: TaskState,
	action: TaskAction,
	params: Partial<TodoParamsType>,
): { state: TaskState; op: ReducerOp } {
	switch (action) {
		case "create":
			return applyCreate(state, params);
		case "update":
			return applyUpdate(state, params);
		case "list":
			return applyList(state, params);
		case "get":
			return applyGet(state, params);
		case "delete":
			return applyDelete(state, params);
		case "clear":
			return { state: { ...EMPTY_STATE, tasks: [] }, op: { type: "cleared" } };
	}
}

function err(state: TaskState, message: string): { state: TaskState; op: ReducerOp } {
	return { state, op: { type: "error", message } };
}

function applyCreate(
	state: TaskState,
	params: Partial<TodoParamsType>,
): { state: TaskState; op: ReducerOp } {
	if (!params.subject?.trim()) {
		return err(state, "create requires a non-empty subject");
	}

	const task: Task = {
		id: state.nextId,
		subject: params.subject.trim(),
		status: (params.status as TaskStatus | undefined) ?? "pending",
	};

	if (params.description !== undefined) task.description = params.description;
	if (params.activeForm !== undefined) task.activeForm = params.activeForm;
	if (params.owner !== undefined) task.owner = params.owner;
	if (params.metadata !== undefined) task.metadata = params.metadata;
	if (params.blockedBy !== undefined && params.blockedBy.length > 0) {
		task.blockedBy = [...params.blockedBy];
	}

	const next: TaskState = {
		tasks: [...state.tasks, task],
		nextId: state.nextId + 1,
	};

	return { state: next, op: { type: "created", task } };
}

function applyUpdate(
	state: TaskState,
	params: Partial<TodoParamsType>,
): { state: TaskState; op: ReducerOp } {
	if (params.id === undefined) {
		return err(state, "update requires an id");
	}

	const index = state.tasks.findIndex((t) => t.id === params.id);
	if (index === -1) {
		return err(state, `task id ${params.id} not found`);
	}

	const existing = state.tasks[index]!;

	const addIds = params.addBlockedBy ?? [];
	if (addIds.length > 0) {
		const currentBlocked = existing.blockedBy ?? [];
		for (const newDep of addIds) {
			const tentativeBlocked = [...new Set([...currentBlocked, newDep])];

			const wouldCycle = bfsReaches(
				{ ...state, tasks: state.tasks.map((t, i) => (i === index ? { ...existing, blockedBy: tentativeBlocked } : t)) },
				newDep,
				params.id!,
			);

			if (wouldCycle) {
				return err(state, `adding blockedBy ${newDep} to task ${params.id} would create a dependency cycle`);
			}
		}
	}

	const updated: Task = { ...existing };

	if (params.subject !== undefined) updated.subject = params.subject;
	if (params.description !== undefined) updated.description = params.description;
	if (params.activeForm !== undefined) updated.activeForm = params.activeForm;
	if (params.owner !== undefined) updated.owner = params.owner;
	if (params.metadata !== undefined) updated.metadata = params.metadata;
	if (params.status !== undefined) updated.status = params.status as TaskStatus;

	if (addIds.length > 0) {
		const base = updated.blockedBy ?? [];
		updated.blockedBy = [...new Set([...base, ...addIds])];
	}

	const removeIds = params.removeBlockedBy ?? [];
	if (removeIds.length > 0) {
		const base = updated.blockedBy ?? [];
		updated.blockedBy = base.filter((id) => !removeIds.includes(id));
	}

	const nextTasks = [...state.tasks];
	nextTasks[index] = updated;

	return { state: { ...state, tasks: nextTasks }, op: { type: "updated", task: updated } };
}

function applyList(
	state: TaskState,
	params: Partial<TodoParamsType>,
): { state: TaskState; op: ReducerOp } {
	const includeDeleted = params.includeDeleted === true;
	const tasks = includeDeleted ? state.tasks : state.tasks.filter((t) => t.status !== "deleted");
	return { state, op: { type: "listed", tasks } };
}

function applyGet(
	state: TaskState,
	params: Partial<TodoParamsType>,
): { state: TaskState; op: ReducerOp } {
	if (params.id === undefined) {
		return err(state, "get requires an id");
	}

	const task = state.tasks.find((t) => t.id === params.id);
	if (!task) {
		return err(state, `task id ${params.id} not found`);
	}

	return { state, op: { type: "got", task } };
}

function applyDelete(
	state: TaskState,
	params: Partial<TodoParamsType>,
): { state: TaskState; op: ReducerOp } {
	if (params.id === undefined) {
		return err(state, "delete requires an id");
	}

	const index = state.tasks.findIndex((t) => t.id === params.id);
	if (index === -1) {
		return err(state, `task id ${params.id} not found`);
	}

	const deleted: Task = { ...state.tasks[index]!, status: "deleted" };
	const nextTasks = [...state.tasks];
	nextTasks[index] = deleted;

	return { state: { ...state, tasks: nextTasks }, op: { type: "deleted", task: deleted } };
}

/**
 * BFS: returns true if `targetId` is reachable from `startId` by following
 * blockedBy edges in the given state. Used to detect cycles before committing
 * a new dependency edge.
 */
function bfsReaches(state: TaskState, startId: number, targetId: number): boolean {
	const visited = new Set<number>();
	const queue: number[] = [startId];

	while (queue.length > 0) {
		const current = queue.shift()!;

		if (current === targetId) return true;
		if (visited.has(current)) continue;
		visited.add(current);

		const task = state.tasks.find((t) => t.id === current);
		if (task?.blockedBy) {
			queue.push(...task.blockedBy);
		}
	}

	return false;
}
