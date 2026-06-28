import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createSubprocessProvider } from "../../packages/subagent-manager-core/providers/subprocess.ts";
import type { ProviderRunContext } from "../../packages/subagent-manager-core/runtime.ts";

const FAKE_PI_PATH = fileURLToPath(new URL("../fixtures/fake-pi.mjs", import.meta.url));

function makeContext(overrides: Record<string, unknown> = {}): ProviderRunContext {
	return {
		runId: "test-run-123",
		agent: {
			name: "test-agent",
			description: "Test agent",
			promptRef: "You are a test agent.",
			policyMode: "writer",
			scope: "builtin",
			order: 0,
		},
		request: {
			agent: "test-agent",
			prompt: "test prompt",
		},
		emit: () => {},
		...overrides,
	} as unknown as ProviderRunContext;
}

test("subprocess provider passes --mode json and --no-session to pi", async () => {
	const argsFile = join(tmpdir(), `pi-args-mode-${Date.now()}.json`);
	const saved = process.env.PI_HARNESS_PI_BIN;
	const savedArgs = process.env.PI_ARGS_FILE;

	try {
		process.env.PI_HARNESS_PI_BIN = FAKE_PI_PATH;
		process.env.PI_ARGS_FILE = argsFile;

		const provider = createSubprocessProvider();
		await provider.run(makeContext());

		const capturedArgs = JSON.parse(
			new TextDecoder().decode(
				await import("node:fs/promises").then((m) => m.readFile(argsFile)),
			),
		) as string[];

		assert.ok(capturedArgs.includes("--mode"), "expected --mode flag");
		assert.ok(capturedArgs.includes("json"), "expected json mode value");
		assert.ok(capturedArgs.includes("--no-session"), "expected --no-session");
	} finally {
		if (existsSync(argsFile)) unlinkSync(argsFile);
		if (saved === undefined) delete process.env.PI_HARNESS_PI_BIN;
		else process.env.PI_HARNESS_PI_BIN = saved;
		if (savedArgs === undefined) delete process.env.PI_ARGS_FILE;
		else process.env.PI_ARGS_FILE = savedArgs;
	}
});

test("subprocess provider does NOT pass --no-extensions to pi", async () => {
	const argsFile = join(tmpdir(), `pi-args-noext-${Date.now()}.json`);
	const saved = process.env.PI_HARNESS_PI_BIN;
	const savedArgs = process.env.PI_ARGS_FILE;

	try {
		process.env.PI_HARNESS_PI_BIN = FAKE_PI_PATH;
		process.env.PI_ARGS_FILE = argsFile;

		const provider = createSubprocessProvider();
		await provider.run(makeContext());

		const capturedArgs = JSON.parse(
			new TextDecoder().decode(
				await import("node:fs/promises").then((m) => m.readFile(argsFile)),
			),
		) as string[];

		assert.ok(!capturedArgs.includes("--no-extensions"), "--no-extensions must NOT be in args");
	} finally {
		if (existsSync(argsFile)) unlinkSync(argsFile);
		if (saved === undefined) delete process.env.PI_HARNESS_PI_BIN;
		else process.env.PI_HARNESS_PI_BIN = saved;
		if (savedArgs === undefined) delete process.env.PI_ARGS_FILE;
		else process.env.PI_ARGS_FILE = savedArgs;
	}
});

test("subprocess provider passes --append-system-prompt with a temp file path", async () => {
	const argsFile = join(tmpdir(), `pi-args-sys-${Date.now()}.json`);
	const saved = process.env.PI_HARNESS_PI_BIN;
	const savedArgs = process.env.PI_ARGS_FILE;

	try {
		process.env.PI_HARNESS_PI_BIN = FAKE_PI_PATH;
		process.env.PI_ARGS_FILE = argsFile;

		const provider = createSubprocessProvider();
		await provider.run(makeContext());

		const capturedArgs = JSON.parse(
			new TextDecoder().decode(
				await import("node:fs/promises").then((m) => m.readFile(argsFile)),
			),
		) as string[];

		const idx = capturedArgs.indexOf("--append-system-prompt");
		assert.ok(idx !== -1, "expected --append-system-prompt flag");
		assert.ok(capturedArgs[idx + 1], "expected path after --append-system-prompt");
	} finally {
		if (existsSync(argsFile)) unlinkSync(argsFile);
		if (saved === undefined) delete process.env.PI_HARNESS_PI_BIN;
		else process.env.PI_HARNESS_PI_BIN = saved;
		if (savedArgs === undefined) delete process.env.PI_ARGS_FILE;
		else process.env.PI_ARGS_FILE = savedArgs;
	}
});

test("subprocess provider passes -p with the prompt", async () => {
	const argsFile = join(tmpdir(), `pi-args-prompt-${Date.now()}.json`);
	const saved = process.env.PI_HARNESS_PI_BIN;
	const savedArgs = process.env.PI_ARGS_FILE;

	try {
		process.env.PI_HARNESS_PI_BIN = FAKE_PI_PATH;
		process.env.PI_ARGS_FILE = argsFile;

		const provider = createSubprocessProvider();
		await provider.run(makeContext());

		const capturedArgs = JSON.parse(
			new TextDecoder().decode(
				await import("node:fs/promises").then((m) => m.readFile(argsFile)),
			),
		) as string[];

		const idx = capturedArgs.indexOf("-p");
		assert.ok(idx !== -1, "expected -p flag");
		assert.equal(capturedArgs[idx + 1], "test prompt");
	} finally {
		if (existsSync(argsFile)) unlinkSync(argsFile);
		if (saved === undefined) delete process.env.PI_HARNESS_PI_BIN;
		else process.env.PI_HARNESS_PI_BIN = saved;
		if (savedArgs === undefined) delete process.env.PI_ARGS_FILE;
		else process.env.PI_ARGS_FILE = savedArgs;
	}
});

test("subprocess provider returns final text from message_end event", async () => {
	const saved = process.env.PI_HARNESS_PI_BIN;

	try {
		process.env.PI_HARNESS_PI_BIN = FAKE_PI_PATH;

		const provider = createSubprocessProvider();
		const result = await provider.run(makeContext());

		assert.equal(result.summary.text, "fake-pi response");
	} finally {
		if (saved === undefined) delete process.env.PI_HARNESS_PI_BIN;
		else process.env.PI_HARNESS_PI_BIN = saved;
	}
});

test("subprocess provider throws clear error when pi binary is not found (ENOENT)", async () => {
	const saved = process.env.PI_HARNESS_PI_BIN;

	try {
		process.env.PI_HARNESS_PI_BIN = "/nonexistent/pi-binary-that-does-not-exist";

		const provider = createSubprocessProvider();

		await assert.rejects(
			() => provider.run(makeContext()),
			(err: Error) => {
				assert.match(err.message, /pi binary not found/);
				return true;
			},
		);
	} finally {
		if (saved === undefined) delete process.env.PI_HARNESS_PI_BIN;
		else process.env.PI_HARNESS_PI_BIN = saved;
	}
});

test("subprocess provider sends SIGKILL after grace period when child ignores SIGTERM", { timeout: 500 }, async () => {
	const saved = process.env.PI_HARNESS_PI_BIN;
	const savedIgnore = process.env.PI_IGNORE_SIGTERM;
	const savedGrace = process.env.PI_GRACE_MS;

	try {
		process.env.PI_HARNESS_PI_BIN = FAKE_PI_PATH;
		process.env.PI_IGNORE_SIGTERM = "1";
		process.env.PI_GRACE_MS = "100";

		const controller = new AbortController();
		const provider = createSubprocessProvider();

		const runPromise = provider.run(makeContext({ signal: controller.signal }));

		setTimeout(() => controller.abort(), 50);

		await assert.rejects(
			() => runPromise,
			(err: Error) => {
				assert.ok(
					err.message.includes("abort") || err.message.includes("signal"),
					`Expected abort-related error but got: ${err.message}`,
				);
				return true;
			},
		);
	} finally {
		if (saved === undefined) delete process.env.PI_HARNESS_PI_BIN;
		else process.env.PI_HARNESS_PI_BIN = saved;
		if (savedIgnore === undefined) delete process.env.PI_IGNORE_SIGTERM;
		else process.env.PI_IGNORE_SIGTERM = savedIgnore;
		if (savedGrace === undefined) delete process.env.PI_GRACE_MS;
		else process.env.PI_GRACE_MS = savedGrace;
	}
});

test("subprocess provider passes --thinking <level> when agent thinking is set", async () => {
	const argsFile = join(tmpdir(), `pi-args-thinking-${Date.now()}.json`);
	const saved = process.env.PI_HARNESS_PI_BIN;
	const savedArgs = process.env.PI_ARGS_FILE;

	try {
		process.env.PI_HARNESS_PI_BIN = FAKE_PI_PATH;
		process.env.PI_ARGS_FILE = argsFile;

		const provider = createSubprocessProvider();
		await provider.run(makeContext({ agent: { name: "test-agent", description: "Test agent", promptRef: "You are a test agent.", policyMode: "writer", scope: "builtin", order: 0, thinking: "high" } }));

		const capturedArgs = JSON.parse(
			new TextDecoder().decode(
				await import("node:fs/promises").then((m) => m.readFile(argsFile)),
			),
		) as string[];

		const idx = capturedArgs.indexOf("--thinking");
		assert.ok(idx !== -1, "--thinking flag must be in spawned args when agent.thinking is set");
		assert.equal(capturedArgs[idx + 1], "high", "thinking level must match agent.thinking");
	} finally {
		if (existsSync(argsFile)) unlinkSync(argsFile);
		if (saved === undefined) delete process.env.PI_HARNESS_PI_BIN;
		else process.env.PI_HARNESS_PI_BIN = saved;
		if (savedArgs === undefined) delete process.env.PI_ARGS_FILE;
		else process.env.PI_ARGS_FILE = savedArgs;
	}
});

test("subprocess provider omits --thinking when agent thinking is not set", async () => {
	const argsFile = join(tmpdir(), `pi-args-nothinking-${Date.now()}.json`);
	const saved = process.env.PI_HARNESS_PI_BIN;
	const savedArgs = process.env.PI_ARGS_FILE;

	try {
		process.env.PI_HARNESS_PI_BIN = FAKE_PI_PATH;
		process.env.PI_ARGS_FILE = argsFile;

		const provider = createSubprocessProvider();
		await provider.run(makeContext());

		const capturedArgs = JSON.parse(
			new TextDecoder().decode(
				await import("node:fs/promises").then((m) => m.readFile(argsFile)),
			),
		) as string[];

		assert.ok(!capturedArgs.includes("--thinking"), "--thinking must not be in args when agent.thinking is absent");
	} finally {
		if (existsSync(argsFile)) unlinkSync(argsFile);
		if (saved === undefined) delete process.env.PI_HARNESS_PI_BIN;
		else process.env.PI_HARNESS_PI_BIN = saved;
		if (savedArgs === undefined) delete process.env.PI_ARGS_FILE;
		else process.env.PI_ARGS_FILE = savedArgs;
	}
});

test("subprocess provider passes --thinking from request metadata when set, overriding agent spec", async () => {
	const argsFile = join(tmpdir(), `pi-args-meta-thinking-${Date.now()}.json`);
	const saved = process.env.PI_HARNESS_PI_BIN;
	const savedArgs = process.env.PI_ARGS_FILE;

	try {
		process.env.PI_HARNESS_PI_BIN = FAKE_PI_PATH;
		process.env.PI_ARGS_FILE = argsFile;

		const provider = createSubprocessProvider();
		await provider.run(makeContext({ request: { agent: "test-agent", prompt: "test prompt", metadata: { thinking: "medium" } } }));

		const capturedArgs = JSON.parse(
			new TextDecoder().decode(
				await import("node:fs/promises").then((m) => m.readFile(argsFile)),
			),
		) as string[];

		const idx = capturedArgs.indexOf("--thinking");
		assert.ok(idx !== -1, "--thinking must be in args when metadata.thinking is set");
		assert.equal(capturedArgs[idx + 1], "medium");
	} finally {
		if (existsSync(argsFile)) unlinkSync(argsFile);
		if (saved === undefined) delete process.env.PI_HARNESS_PI_BIN;
		else process.env.PI_HARNESS_PI_BIN = saved;
		if (savedArgs === undefined) delete process.env.PI_ARGS_FILE;
		else process.env.PI_ARGS_FILE = savedArgs;
	}
});

test("subprocess provider sends SIGTERM when AbortSignal fires", async () => {
	const saved = process.env.PI_HARNESS_PI_BIN;
	const savedSlow = process.env.PI_SLOW_MODE;

	try {
		process.env.PI_HARNESS_PI_BIN = FAKE_PI_PATH;
		process.env.PI_SLOW_MODE = "1";

		const controller = new AbortController();
		const provider = createSubprocessProvider();

		const runPromise = provider.run(makeContext({ signal: controller.signal }));

		setTimeout(() => controller.abort(), 50);

		await assert.rejects(() => runPromise, (err: Error) => {
			assert.ok(
				err.message.includes("abort") || err.message.includes("signal") || err.message.includes("SIGTERM") || err.message.includes("terminated"),
				`Expected abort-related error but got: ${err.message}`,
			);
			return true;
		});
	} finally {
		if (saved === undefined) delete process.env.PI_HARNESS_PI_BIN;
		else process.env.PI_HARNESS_PI_BIN = saved;
		if (savedSlow === undefined) delete process.env.PI_SLOW_MODE;
		else process.env.PI_SLOW_MODE = savedSlow;
	}
});
