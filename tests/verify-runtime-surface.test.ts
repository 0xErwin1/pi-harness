import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = resolve(repoRoot, "scripts/verify-runtime-surface.mjs");
const readRepoFile = (path: string): string => readFileSync(resolve(repoRoot, path), "utf8");

test("verify-runtime-surface script passes for the checked-in repo surface", () => {
	const output = execFileSync("node", [scriptPath], {
		cwd: repoRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});

	assert.match(output, /pi-harness runtime surface verified \([0-9]+ entries\)\./);
});

test("verify-runtime-surface tracks lazy command and vendored question files", () => {
	const script = readRepoFile("scripts/verify-runtime-surface.mjs");

	for (const runtimePath of [
		"extensions/btw.ts",
		"vendor/pi-subagents/src/index.ts",
		"vendor/rpiv-ask-user-question",
		"vendor/rpiv-ask-user-question/index.ts",
		"vendor/rpiv-ask-user-question/README.md",
	]) {
		assert.match(script, new RegExp(`path: "${runtimePath.replaceAll("/", "\\/")}"`));
	}
});

test("normal install paths expose the vendored question wrapper", () => {
	const linkScript = readRepoFile("scripts/link.sh");
	const defaultNix = readRepoFile("lib/default.nix");

	assert.match(linkScript, /vendor\/rpiv-ask-user-question\/index\.ts/);
	assert.match(linkScript, /rpiv-ask-user-question\.ts/);
	assert.match(defaultNix, /name = "rpiv-ask-user-question\.ts"/);
	assert.match(defaultNix, /entry = "vendor\/rpiv-ask-user-question\/index\.ts"/);
});

test("README documents the lazy runtime boundaries", () => {
	const readme = readRepoFile("README.md");

	assert.match(readme, /named subagents receive isolated prompts/i);
	assert.match(readme, /`\/btw` loads its model runtime only when invoked/i);
	assert.match(readme, /`ask_user_question` wrapper/i);
	assert.match(readme, /Atlas\+Engram remains the SDD persistence authority/i);
	assert.match(readme, /Atlas writes require approval/i);
});
