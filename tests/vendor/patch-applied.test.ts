import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const VENDOR_ENTRY = resolve(REPO_ROOT, "vendor/pi-subagents/src/index.ts");
const PATCH_FILE = resolve(REPO_ROOT, "vendor/pi-subagents/PATCHES/0001-agent-render-adapter.patch");
const VENDORED_DOC = resolve(REPO_ROOT, "vendor/pi-subagents/VENDORED.md");

/**
 * The Agent tool-call card render fork is the ONLY guard on un-type-checked
 * vendor code: `tsconfig` excludes `vendor/**`, so nothing else would notice a
 * re-vendor of upstream tintinweb/pi-subagents that silently drops the fork.
 * These assertions fail `pnpm test` in exactly that case, forcing a reapply.
 */

test("the vendor entry delegates the Agent card render to packages/subagent-render", () => {
	const source = readFileSync(VENDOR_ENTRY, "utf8");

	assert.match(
		source,
		/from\s+["']\.\.\/\.\.\/\.\.\/packages\/subagent-render\/index\.ts["']/,
		"vendor index.ts must import the render adapter from packages/subagent-render",
	);
	assert.match(source, /renderAgentCall\s*\(/, "renderCall must delegate to renderAgentCall");
	assert.match(source, /renderAgentResult\s*\(/, "renderResult must delegate to renderAgentResult");
});

test("the inline Agent render body has been removed from the vendor entry", () => {
	const source = readFileSync(VENDOR_ENTRY, "utf8");

	assert.doesNotMatch(
		source,
		/Running in background \(ID:/,
		"the inline renderResult block (marker string) must be gone — its logic now lives in packages/subagent-render",
	);
});

test("the tracked patch file and its VENDORED.md reapplication note both exist", () => {
	const patch = readFileSync(PATCH_FILE, "utf8");
	assert.match(patch, /vendor\/pi-subagents\/src\/index\.ts/, "the patch targets the vendor entry");
	assert.match(patch, /subagent-render/, "the patch introduces the render adapter delegation");

	const doc = readFileSync(VENDORED_DOC, "utf8");
	assert.match(doc, /## Local patches/, "VENDORED.md must document the local patch");
	assert.match(doc, /0001-agent-render-adapter\.patch/, "VENDORED.md names the patch file");
	assert.match(doc, /reappl/i, "VENDORED.md states the patch must be reapplied after a re-vendor");
});
