import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = resolve(repoRoot, "scripts/verify-runtime-surface.mjs");

test("verify-runtime-surface script passes for the checked-in repo surface", () => {
	const output = execFileSync("node", [scriptPath], {
		cwd: repoRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});

	assert.match(output, /pi-harness runtime surface verified \([0-9]+ entries\)\./);
});
