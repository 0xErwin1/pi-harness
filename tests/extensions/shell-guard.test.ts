import test from "node:test";
import assert from "node:assert/strict";
import { __testing } from "../../extensions/shell-guard.ts";

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
