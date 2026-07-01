import test from "node:test";
import assert from "node:assert/strict";
import toolDocs, {
	TOOL_DESCRIPTION_ADDENDA,
	enrichToolDescriptionsInPayload,
} from "../../extensions/tool-docs.ts";

const READ_ADDENDUM = TOOL_DESCRIPTION_ADDENDA.get("read")!;
const BASH_ADDENDUM = TOOL_DESCRIPTION_ADDENDA.get("bash")!;

test("enriches flat tool entries (anthropic/responses shape) without touching schemas", () => {
	const schema = { type: "object", properties: { path: { type: "string" } }, required: ["path"] };
	const payload = {
		model: "claude-x",
		tools: [
			{ name: "read", description: "Read the contents of a file.", input_schema: schema },
			{ name: "subagent_run", description: "Run a subagent.", input_schema: {} },
		],
	};

	enrichToolDescriptionsInPayload(payload);

	assert.equal(
		payload.tools[0].description,
		`Read the contents of a file.\n\n${READ_ADDENDUM}`,
	);
	assert.equal(payload.tools[0].input_schema, schema);
	assert.equal(payload.tools[1].description, "Run a subagent.");
});

test("enriches nested function entries (openai completions shape)", () => {
	const payload = {
		tools: [
			{
				type: "function",
				function: { name: "bash", description: "Execute a bash command.", parameters: {} },
			},
		],
	};

	enrichToolDescriptionsInPayload(payload);

	assert.equal(
		payload.tools[0].function.description,
		`Execute a bash command.\n\n${BASH_ADDENDUM}`,
	);
});

test("enriches bedrock toolConfig entries and google functionDeclarations", () => {
	const payload = {
		toolConfig: {
			tools: [{ toolSpec: { name: "ls", description: "List directory contents.", inputSchema: { json: {} } } }],
		},
		tools: [
			{
				functionDeclarations: [
					{ name: "grep", description: "Search file contents.", parametersJsonSchema: {} },
				],
			},
		],
	};

	enrichToolDescriptionsInPayload(payload);

	assert.match(payload.toolConfig.tools[0].toolSpec.description, /single directory only/);
	assert.match(payload.tools[0].functionDeclarations[0].description, /backed by ripgrep/);
});

test("matches Claude Code canonical casing case-insensitively", () => {
	const payload = {
		tools: [{ name: "Read", description: "Read the contents of a file.", input_schema: {} }],
	};

	enrichToolDescriptionsInPayload(payload);

	assert.match(payload.tools[0].description, /offset is a 1-indexed line number/);
});

test("is idempotent and ignores objects that only look like tool entries", () => {
	const payload = {
		tools: [
			{ name: "write", description: "Write content to a file.", parameters: {} },
			// name/description without a schema sibling must not be rewritten.
			{ name: "edit", description: "not a tool entry" },
		],
	};

	enrichToolDescriptionsInPayload(payload);
	const once = payload.tools[0].description;
	enrichToolDescriptionsInPayload(payload);

	assert.equal(payload.tools[0].description, once);
	assert.equal(payload.tools[1].description, "not a tool entry");
});

test("leaves unknown payload shapes untouched", () => {
	const payload = { messages: [{ role: "user", content: "hi" }] };
	const snapshot = JSON.stringify(payload);

	enrichToolDescriptionsInPayload(payload);

	assert.equal(JSON.stringify(payload), snapshot);
	enrichToolDescriptionsInPayload(undefined);
	enrichToolDescriptionsInPayload("tools");
});

test("extension registers a before_provider_request handler that returns the same payload", async () => {
	const handlers = new Map<string, (event: any, ctx: unknown) => unknown>();
	const pi = {
		on(event: string, handler: (event: any, ctx: unknown) => unknown) {
			handlers.set(event, handler);
		},
	};

	toolDocs(pi as any);

	const handler = handlers.get("before_provider_request");
	assert.ok(handler);

	const payload = {
		tools: [{ name: "find", description: "Search for files by glob pattern.", parameters: {} }],
	};
	const result = await handler({ type: "before_provider_request", payload }, {});

	assert.equal(result, payload);
	assert.match(payload.tools[0].description, /matched by fd/);
});
