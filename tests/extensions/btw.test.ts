import test from "node:test";
import assert from "node:assert/strict";
import { BTW_COMMAND_NAME, buildBtwRequest, createBtwExtension } from "../../extensions/btw.ts";

function createPi() {
	const commands = new Map<string, { handler: (args: string, ctx: unknown) => unknown }>();
	return {
		commands,
		pi: {
			registerCommand(name: string, command: { handler: (args: string, ctx: unknown) => unknown }) {
				commands.set(name, command);
			},
		},
	};
}

function createCtx() {
	const notifications: Array<{ message: string; type?: string }> = [];
	return {
		ctx: {
			hasUI: true,
			ui: {
				notify(message: string, type?: string) {
					notifications.push({ message, type });
				},
			},
		},
		notifications,
	};
}

test("/btw registers without loading side-question runtime", () => {
	let loadCount = 0;
	const { commands, pi } = createPi();
	createBtwExtension({
		loadRuntime: async () => {
			loadCount += 1;
			throw new Error("runtime should be lazy");
		},
	})(pi as any);

	assert.equal(commands.has(BTW_COMMAND_NAME), true);
	assert.equal(loadCount, 0);
});

test("/btw validates the question before lazy-loading runtime", async () => {
	let loadCount = 0;
	const { commands, pi } = createPi();
	const { ctx, notifications } = createCtx();
	createBtwExtension({
		loadRuntime: async () => {
			loadCount += 1;
			throw new Error("empty question should not load runtime");
		},
	})(pi as any);

	await commands.get(BTW_COMMAND_NAME)?.handler("   ", ctx);

	assert.equal(loadCount, 0);
	assert.deepEqual(notifications, [{ message: "Usage: /btw <question>", type: "warning" }]);
});

test("/btw invocation uses a tool-less isolated side-question request", async () => {
	const { commands, pi } = createPi();
	const { ctx, notifications } = createCtx();
	let capturedRequest: ReturnType<typeof buildBtwRequest> | undefined;
	createBtwExtension({
		loadRuntime: async () => ({
			async askSideQuestion(request: ReturnType<typeof buildBtwRequest>) {
				capturedRequest = request;
				return { ok: true as const, answer: "Use the narrow adapter.", transcriptIsolated: true };
			},
		}),
	})(pi as any);

	await commands.get(BTW_COMMAND_NAME)?.handler("How should this work?", ctx);

	assert.equal(capturedRequest?.question, "How should this work?");
	assert.equal(capturedRequest?.transcript, "isolated");
	assert.deepEqual(capturedRequest?.tools, []);
	assert.deepEqual(capturedRequest?.messages, [
		{ role: "user", content: [{ type: "text", text: "How should this work?" }] },
	]);
	assert.deepEqual(notifications, [{ message: "Use the narrow adapter.", type: "info" }]);
});

test("buildBtwRequest trims input and preserves transcript isolation boundaries", () => {
	const request = buildBtwRequest("  Is this safe?  ");

	assert.equal(request.question, "Is this safe?");
	assert.match(request.systemPrompt, /side question/i);
	assert.equal(request.transcript, "isolated");
	assert.deepEqual(request.tools, []);
	assert.deepEqual(request.messages, [{ role: "user", content: [{ type: "text", text: "Is this safe?" }] }]);
});
