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
		"vendor/pi-ask-user",
		"vendor/pi-ask-user/index.ts",
		"vendor/pi-ask-user/upstream.ts",
		"vendor/pi-ask-user/single-select-layout.ts",
		"vendor/pi-ask-user/package.json",
		"vendor/pi-ask-user/LICENSE",
		"vendor/pi-ask-user/README.md",
		"vendor/pi-ask-user/skills/ask-user/SKILL.md",
	]) {
		assert.match(script, new RegExp(`path: "${runtimePath.replaceAll("/", "\\/")}"`));
	}
});

test("normal install paths expose the vendored question wrapper", () => {
	const linkScript = readRepoFile("scripts/link.sh");
	const defaultNix = readRepoFile("lib/default.nix");

	assert.match(linkScript, /vendor\/pi-ask-user\/index\.ts/);
	assert.match(linkScript, /pi-ask-user\.ts/);
	assert.match(defaultNix, /name = "pi-ask-user\.ts"/);
	assert.match(defaultNix, /entry = "vendor\/pi-ask-user\/index\.ts"/);
});

test("README documents the lazy runtime boundaries", () => {
	const readme = readRepoFile("README.md");

	assert.match(readme, /named subagents receive isolated prompts/i);
	assert.match(readme, /`\/btw` loads its model runtime only when invoked/i);
	assert.match(readme, /upstream `ask_user` tool/i);	assert.match(readme, /Atlas\+Engram remains the SDD persistence authority/i);
	assert.match(readme, /Atlas writes require approval/i);
});
