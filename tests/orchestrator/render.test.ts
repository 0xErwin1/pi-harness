import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderOrchestratorPrompt } from "../../packages/orchestrator-prompt/render.ts";
import { LAZY_FILES, type LazyFileKey } from "../../packages/orchestrator-prompt/lazy-files.ts";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const REAL_ASSETS_DIR = join(repoRoot, "assets");

async function syntheticAssetsDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "orchestrator-render-"));
}

test("renderOrchestratorPrompt resolves every real placeholder to an existing absolute path", async () => {
	const raw = readFileSync(join(REAL_ASSETS_DIR, "orchestrator.md"), "utf8");
	const rendered = renderOrchestratorPrompt(REAL_ASSETS_DIR);

	const rawPlaceholders = raw.match(/\{\{([A-Z0-9_]+)\}\}/g) ?? [];
	assert.ok(rawPlaceholders.length > 0, "the real core is expected to contain lazy-file placeholders");
	assert.ok(!rendered.includes("{{"), "no raw placeholder may reach the model");

	for (const token of new Set(rawPlaceholders)) {
		const key = token.slice(2, -2) as LazyFileKey;
		const absolutePath = join(REAL_ASSETS_DIR, LAZY_FILES[key]);
		assert.ok(absolutePath.startsWith("/"), `${key} must resolve to an absolute path`);
		assert.ok(rendered.includes(absolutePath), `rendered output must include the resolved path for ${key}`);
		await assert.doesNotReject(readFile(absolutePath, "utf8"));
	}
});

test("renderOrchestratorPrompt substitutes a known placeholder with an absolute lazy-file path", async () => {
	const assetsDir = await syntheticAssetsDir();
	await mkdir(join(assetsDir, "orchestrator"), { recursive: true });
	await writeFile(join(assetsDir, "orchestrator", "sdd-workflow.md"), "lazy body\n", "utf8");
	await writeFile(
		join(assetsDir, "orchestrator.md"),
		"Before X, read {{PI_HARNESS_SDD_WORKFLOW_PATH}}.\n",
		"utf8",
	);

	const rendered = renderOrchestratorPrompt(assetsDir);
	const expectedPath = join(assetsDir, "orchestrator", "sdd-workflow.md");

	assert.ok(!rendered.includes("{{"), "no raw placeholder may reach the model");
	assert.ok(rendered.includes(expectedPath));
});

test("every emitted lazy-file path is absolute, never relative", async () => {
	const assetsDir = await syntheticAssetsDir();
	await mkdir(join(assetsDir, "orchestrator"), { recursive: true });
	await writeFile(join(assetsDir, "orchestrator", "review.md"), "lazy body\n", "utf8");
	await writeFile(join(assetsDir, "orchestrator.md"), "See {{PI_HARNESS_REVIEW_PATH}}.\n", "utf8");

	const rendered = renderOrchestratorPrompt(assetsDir);
	const match = /See (\S+)\./.exec(rendered);

	assert.ok(match, "expected the substituted path to appear in the rendered output");
	assert.ok(match![1].startsWith("/"), "emitted path must be absolute");
	await assert.doesNotReject(readFile(match![1], "utf8"));
});

test("an unknown placeholder throws naming it", async () => {
	const assetsDir = await syntheticAssetsDir();
	await writeFile(join(assetsDir, "orchestrator.md"), "{{NOT_A_REGISTERED_KEY}}\n", "utf8");

	assert.throws(
		() => renderOrchestratorPrompt(assetsDir),
		/NOT_A_REGISTERED_KEY/,
	);
});

test("a known placeholder whose lazy file is missing throws naming it", async () => {
	const assetsDir = await syntheticAssetsDir();
	await writeFile(join(assetsDir, "orchestrator.md"), "{{PI_HARNESS_SKILLS_PATH}}\n", "utf8");

	assert.throws(
		() => renderOrchestratorPrompt(assetsDir),
		/PI_HARNESS_SKILLS_PATH/,
	);
});

test("rendering is memoized per assets directory", async () => {
	const assetsDir = await syntheticAssetsDir();
	await writeFile(join(assetsDir, "orchestrator.md"), "static content\n", "utf8");

	const first = renderOrchestratorPrompt(assetsDir);
	await writeFile(join(assetsDir, "orchestrator.md"), "changed after first render\n", "utf8");
	const second = renderOrchestratorPrompt(assetsDir);

	assert.equal(second, first, "a cached render must not re-read the file on a later call");
});
