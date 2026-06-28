import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerTodoTool } from "../../packages/subagent-manager-pi/todo/tool.ts";
import { registerTodosCommand } from "../../packages/subagent-manager-pi/todo/command.ts";
import { __resetState, replaceState } from "../../packages/subagent-manager-pi/todo/store.ts";
import type { Task } from "../../packages/subagent-manager-pi/todo/types.ts";

const TOOL_NAME = "todo";

function makeTask(id: number, overrides: Partial<Task> = {}): Task {
	return { id, subject: `Task ${id}`, status: "pending", ...overrides };
}

function makeMockPi() {
	let capturedTool: { name: string; execute: (...args: any[]) => Promise<any> } | undefined;
	let capturedCommand: { name: string; handler: (...args: any[]) => Promise<void> } | undefined;

	const pi = {
		registerTool: (tool: any) => {
			capturedTool = tool;
		},
		registerCommand: (name: string, options: any) => {
			capturedCommand = { name, handler: options.handler };
		},
		getCapturedTool: () => capturedTool,
		getCapturedCommand: () => capturedCommand,
	};
	return pi;
}

const MOCK_CTX = {
	ui: { notify: () => {} },
	sessionManager: { getBranch: () => [] },
} as unknown as ExtensionContext;

test("registerTodoTool: registers a tool named 'todo'", () => {
	__resetState();
	const mock = makeMockPi();
	registerTodoTool(mock as any);

	assert.equal(mock.getCapturedTool()?.name, TOOL_NAME);
});

test("execute create: returns details envelope with correct shape", async () => {
	__resetState();
	const mock = makeMockPi();
	registerTodoTool(mock as any);
	const tool = mock.getCapturedTool()!;

	const result = await tool.execute("call-1", { action: "create", subject: "Write docs" }, undefined, undefined, MOCK_CTX);

	assert.ok(result.details, "details must be present");
	assert.equal(result.details.action, "create", "action must be in details");
	assert.ok(result.details.params, "params must be in details");
	assert.ok(Array.isArray(result.details.tasks), "tasks must be an array in details");
	assert.equal(typeof result.details.nextId, "number", "nextId must be a number in details");
});

test("execute create: details.tasks includes the created task", async () => {
	__resetState();
	const mock = makeMockPi();
	registerTodoTool(mock as any);

	const result = await mock.getCapturedTool()!.execute(
		"call-1",
		{ action: "create", subject: "Test me" },
		undefined,
		undefined,
		MOCK_CTX,
	);

	assert.equal(result.details.tasks.length, 1);
	assert.equal(result.details.tasks[0].subject, "Test me");
});

test("execute create: details.nextId is incremented after creation", async () => {
	__resetState();
	const mock = makeMockPi();
	registerTodoTool(mock as any);
	const tool = mock.getCapturedTool()!;

	await tool.execute("call-1", { action: "create", subject: "First" }, undefined, undefined, MOCK_CTX);
	const result2 = await tool.execute("call-2", { action: "create", subject: "Second" }, undefined, undefined, MOCK_CTX);

	assert.equal(result2.details.tasks.length, 2);
	assert.equal(result2.details.nextId, 3);
});

test("execute create: no error field when successful", async () => {
	__resetState();
	const mock = makeMockPi();
	registerTodoTool(mock as any);

	const result = await mock.getCapturedTool()!.execute(
		"call-1",
		{ action: "create", subject: "OK task" },
		undefined,
		undefined,
		MOCK_CTX,
	);

	assert.equal(result.details.error, undefined, "no error field on success");
});

test("execute create: error case sets details.error", async () => {
	__resetState();
	const mock = makeMockPi();
	registerTodoTool(mock as any);

	const result = await mock.getCapturedTool()!.execute(
		"call-1",
		{ action: "create" },
		undefined,
		undefined,
		MOCK_CTX,
	);

	assert.ok(result.details.error, "error field must be set on failure");
});

test("execute list: returns all current tasks in details", async () => {
	__resetState();
	replaceState({ tasks: [makeTask(1), makeTask(2)], nextId: 3 });
	const mock = makeMockPi();
	registerTodoTool(mock as any);

	const result = await mock.getCapturedTool()!.execute(
		"call-1",
		{ action: "list" },
		undefined,
		undefined,
		MOCK_CTX,
	);

	assert.equal(result.details.action, "list");
	assert.equal(result.details.tasks.length, 2);
	assert.equal(result.details.nextId, 3);
});

test("execute clear: resets store and reflects in details", async () => {
	__resetState();
	replaceState({ tasks: [makeTask(1)], nextId: 2 });
	const mock = makeMockPi();
	registerTodoTool(mock as any);

	const result = await mock.getCapturedTool()!.execute(
		"call-1",
		{ action: "clear" },
		undefined,
		undefined,
		MOCK_CTX,
	);

	assert.equal(result.details.tasks.length, 0);
	assert.equal(result.details.nextId, 1);
});

test("execute: content is a non-empty text array", async () => {
	__resetState();
	const mock = makeMockPi();
	registerTodoTool(mock as any);

	const result = await mock.getCapturedTool()!.execute(
		"call-1",
		{ action: "create", subject: "x" },
		undefined,
		undefined,
		MOCK_CTX,
	);

	assert.ok(Array.isArray(result.content), "content must be an array");
	assert.ok(result.content.length > 0, "content must be non-empty");
	assert.equal(result.content[0].type, "text");
	assert.equal(typeof result.content[0].text, "string");
	assert.ok(result.content[0].text.length > 0);
});

test("registerTodosCommand: registers command named 'todos'", () => {
	const mock = makeMockPi();
	registerTodosCommand(mock as any);

	assert.equal(mock.getCapturedCommand()?.name, "todos");
});

test("registerTodosCommand handler: notifies with task groups", async () => {
	__resetState();
	replaceState({
		tasks: [
			makeTask(1, { status: "pending" }),
			makeTask(2, { status: "in_progress" }),
			makeTask(3, { status: "completed" }),
		],
		nextId: 4,
	});

	const mock = makeMockPi();
	registerTodosCommand(mock as any);

	const notified: string[] = [];
	const mockCtx = {
		ui: {
			notify: (msg: string) => {
				notified.push(msg);
			},
		},
	} as any;

	await mock.getCapturedCommand()!.handler("", mockCtx);

	assert.ok(notified.length > 0, "must notify");
	const output = notified.join("\n");
	assert.ok(output.includes("-- Pending --"), "must have Pending section");
	assert.ok(output.includes("-- In Progress --") || output.includes("-- In progress --"), "must have In Progress section");
	assert.ok(output.includes("Task 1"), "must list task 1");
	assert.ok(output.includes("Task 2"), "must list task 2");
	assert.ok(output.includes("Task 3"), "must list task 3");
});

test("registerTodosCommand handler: notifies even when no tasks", async () => {
	__resetState();
	const mock = makeMockPi();
	registerTodosCommand(mock as any);

	const notified: string[] = [];
	const mockCtx = {
		ui: { notify: (msg: string) => { notified.push(msg); } },
	} as any;

	await mock.getCapturedCommand()!.handler("", mockCtx);

	assert.ok(notified.length > 0, "must notify even when empty");
});

test("registerTodosCommand handler: output contains no emoji characters", async () => {
	__resetState();
	replaceState({
		tasks: [makeTask(1, { status: "pending", blockedBy: [2] }), makeTask(2)],
		nextId: 3,
	});

	const mock = makeMockPi();
	registerTodosCommand(mock as any);

	const notified: string[] = [];
	const mockCtx = {
		ui: { notify: (msg: string) => { notified.push(msg); } },
	} as any;

	await mock.getCapturedCommand()!.handler("", mockCtx);

	const output = notified.join("\n");
	for (const char of output) {
		const code = char.codePointAt(0) ?? 0;
		assert.ok(code < 0x1f000 || code > 0x1fbff, `emoji found in output: ${char} (U+${code.toString(16).toUpperCase()})`);
	}
});
