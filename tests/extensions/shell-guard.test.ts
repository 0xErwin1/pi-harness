import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { __testing } from "../../extensions/shell-guard.ts";

/**
 * guardCommand only reads ctx.cwd, ctx.hasUI, and ctx.ui.confirm; the cast
 * below scopes the ExtensionContext fixture to exactly that surface instead
 * of implementing the full interface.
 */
function createCtx(cwd: string, hasUI: boolean, confirm: () => Promise<boolean>): ExtensionContext {
	return {
		cwd,
		hasUI,
		ui: { confirm },
	} as unknown as ExtensionContext;
}

/**
 * guardCommand loads its config from PI_CODING_AGENT_DIR (defaulting to the
 * real ~/.pi/agent), so every guardCommand test pins that env var to an
 * empty temp dir to stay isolated from the developer's real configuration.
 */
async function withGuardCommandFixture(
	run: (cwd: string) => Promise<void>,
): Promise<void> {
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = mkdtempSync(join(tmpdir(), "pi-harness-guard-agent-"));
	const cwd = mkdtempSync(join(tmpdir(), "pi-harness-guard-cwd-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;

	try {
		await run(cwd);
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(agentDir, { recursive: true, force: true });
		rmSync(cwd, { recursive: true, force: true });
	}
}

test("sensitive path guard blocks explicit path fields for read/write/edit tools", () => {
	const envRead = __testing.evaluateSensitivePathTool("read", { path: ".env.local" });
	assert.equal(envRead?.block, true);
	assert.match(envRead?.reason ?? "", /\.env\.local/);

	const sshWrite = __testing.evaluateSensitivePathTool("write", {
		paths: ["src/index.ts", "~/.ssh/id_ed25519"],
	});
	assert.equal(sshWrite?.block, true);
	assert.match(sshWrite?.reason ?? "", /\.ssh\/id_ed25519/);

	const npmrcEdit = __testing.evaluateSensitivePathTool("edit", {
		confirmOldPath: "/tmp/.npmrc",
		confirmNewPath: "/tmp/.npmrc.backup",
	});
	assert.equal(npmrcEdit?.block, true);
	assert.match(npmrcEdit?.reason ?? "", /\.npmrc/);

	const pemRead = __testing.evaluateSensitivePathTool("read", {
		file_path: "certs/client.pem",
	});
	assert.equal(pemRead?.block, true);
	assert.match(pemRead?.reason ?? "", /client\.pem/);

	const fileArrayRead = __testing.evaluateSensitivePathTool("read", {
		files: ["src/index.ts", "secrets/prod.json"],
	});
	assert.equal(fileArrayRead?.block, true);
	assert.match(fileArrayRead?.reason ?? "", /secrets\/prod\.json/);

	assert.equal(
		__testing.evaluateSensitivePathTool("read", { file: ".config/gh/hosts.yml" })?.block,
		true,
	);
	assert.equal(
		__testing.evaluateSensitivePathTool("read", { path: ".credentials/service.json" })?.block,
		true,
	);
	assert.equal(
		__testing.evaluateSensitivePathTool("read", { path: "Library/Keychains/login.keychain-db" })?.block,
		true,
	);
	assert.equal(__testing.evaluateSensitivePathTool("read", { path: ".env-local" })?.block, true);
	assert.equal(__testing.evaluateSensitivePathTool("read", { path: ".env_local" })?.block, true);
});

test("sensitive path guard ignores non-path fields and normal project files", () => {
	assert.equal(
		__testing.evaluateSensitivePathTool("edit", {
			path: "src/keymap.ts",
			oldText: "copy ~/.ssh/id_ed25519 into docs",
			newText: "document .env usage",
		}),
		undefined,
	);

	assert.equal(
		__testing.evaluateSensitivePathTool("write", { path: "src/tokenizer.ts" }),
		undefined,
	);
	assert.equal(
		__testing.evaluateSensitivePathTool("read", { path: "src/secret.ts" }),
		undefined,
	);
	assert.equal(
		__testing.evaluateSensitivePathTool("read", { path: "src/access-token.ts" }),
		undefined,
	);

	assert.equal(
		__testing.evaluateSensitivePathTool("bash", { path: ".env" }),
		undefined,
	);

	assert.equal(
		__testing.evaluateSensitivePathTool("read", { path: "docs/monkey.ts" }),
		undefined,
	);
	assert.equal(
		__testing.evaluateSensitivePathTool("read", { path: "src/keyboard.ts" }),
		undefined,
	);
});

test("guardCommand blocks a hard-deny command without asking for confirmation", async () => {
	await withGuardCommandFixture(async (cwd) => {
		let confirmCalls = 0;
		const ctx = createCtx(cwd, true, async () => {
			confirmCalls += 1;
			return true;
		});
		const result = await __testing.guardCommand("rm -rf /", ctx);

		assert.equal(result?.block, true);
		assert.match(result?.reason ?? "", /destructive/);
		assert.equal(confirmCalls, 0);
	});
});

test("guardCommand degrades a confirm-required command to block when headless", async () => {
	await withGuardCommandFixture(async (cwd) => {
		let confirmCalls = 0;
		const ctx = createCtx(cwd, false, async () => {
			confirmCalls += 1;
			return true;
		});
		const result = await __testing.guardCommand("git push", ctx);

		assert.equal(result?.block, true);
		assert.match(result?.reason ?? "", /confirmation.*unavailable/);
		assert.equal(confirmCalls, 0);
	});
});

test("guardCommand asks for confirmation and allows the command once approved", async () => {
	await withGuardCommandFixture(async (cwd) => {
		const ctx = createCtx(cwd, true, async () => true);
		const result = await __testing.guardCommand("git push", ctx);

		assert.equal(result, undefined);
	});
});

test("guardCommand blocks a confirm-required command that the user rejects", async () => {
	await withGuardCommandFixture(async (cwd) => {
		const ctx = createCtx(cwd, true, async () => false);
		const result = await __testing.guardCommand("git push", ctx);

		assert.equal(result?.block, true);
		assert.match(result?.reason ?? "", /not confirmed/);
	});
});

test("guardCommand allows a plain command with no matching pattern", async () => {
	await withGuardCommandFixture(async (cwd) => {
		const ctx = createCtx(cwd, true, async () => {
			throw new Error("confirm should not be called for an unguarded command");
		});
		const result = await __testing.guardCommand("git status", ctx);

		assert.equal(result, undefined);
	});
});
