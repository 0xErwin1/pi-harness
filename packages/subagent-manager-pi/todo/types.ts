import { Type } from "typebox";

export type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";
export type TaskAction = "create" | "update" | "list" | "get" | "delete" | "clear";

export interface Task {
	id: number;
	subject: string;
	description?: string;
	activeForm?: string;
	status: TaskStatus;
	blockedBy?: number[];
	owner?: string;
	metadata?: Record<string, unknown>;
}

export const TodoParams = Type.Object({
	action: Type.Union([
		Type.Literal("create"),
		Type.Literal("update"),
		Type.Literal("list"),
		Type.Literal("get"),
		Type.Literal("delete"),
		Type.Literal("clear"),
	]),
	subject: Type.Optional(Type.String({ description: "Task subject. Required for create." })),
	description: Type.Optional(Type.String({ description: "Longer description of the task." })),
	activeForm: Type.Optional(Type.String({ description: "Present-continuous label shown while in_progress, e.g. 'writing tests'." })),
	status: Type.Optional(
		Type.Union([
			Type.Literal("pending"),
			Type.Literal("in_progress"),
			Type.Literal("completed"),
			Type.Literal("deleted"),
		], { description: "New status for update." }),
	),
	blockedBy: Type.Optional(
		Type.Array(Type.Number(), { description: "Initial set of blocking task ids (create only)." }),
	),
	addBlockedBy: Type.Optional(
		Type.Array(Type.Number(), { description: "Task ids to add to blockedBy (update only, additive merge)." }),
	),
	removeBlockedBy: Type.Optional(
		Type.Array(Type.Number(), { description: "Task ids to remove from blockedBy (update only)." }),
	),
	owner: Type.Optional(Type.String({ description: "Agent or user that owns this task." })),
	metadata: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), { description: "Arbitrary extension data." }),
	),
	id: Type.Optional(Type.Number({ description: "Task id. Required for update, get, delete." })),
	includeDeleted: Type.Optional(
		Type.Boolean({ description: "When true, list includes deleted tombstones. Default false." }),
	),
});
