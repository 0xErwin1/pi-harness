import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderOrchestratorPrompt } from "../../packages/orchestrator-prompt/render.ts";
import { LAZY_FILES, type LazyFileKey } from "../../packages/orchestrator-prompt/lazy-files.ts";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const REAL_ASSETS_DIR = join(repoRoot, "assets");
const RENDER_MODULE_PATH = join(repoRoot, "packages", "orchestrator-prompt", "render.ts");
const TSX_BIN = join(repoRoot, "node_modules", ".bin", "tsx");

// A functional pointer instructs the model to open a relative path directly
// (e.g. "Follow `assets/support/x.md`"). Prose that merely *mentions* an
// `assets/...` string as an anti-pattern warning (preserved verbatim from the
// pre-diet fixture) is not a broken pointer and must not trip this check.
const FUNCTIONAL_RELATIVE_POINTER = /\b(?:Follow|follow|read|Read)\s+`[^`]*assets\/[^`]*\.md`/;

test("every real emitted lazy-file pointer is absolute and opens successfully", () => {
	const rendered = renderOrchestratorPrompt(REAL_ASSETS_DIR);
	assert.ok(!rendered.includes("{{"), "no raw placeholder may reach the model");

	for (const key of Object.keys(LAZY_FILES) as LazyFileKey[]) {
		const absolutePath = join(REAL_ASSETS_DIR, LAZY_FILES[key]);
		if (!rendered.includes(absolutePath)) continue;
		assert.ok(absolutePath.startsWith("/"), `${key} must resolve to an absolute path`);
		assert.ok(statSync(absolutePath).isFile(), `${key} must resolve to an existing file`);
	}
});

test("no lazy file contains a `{{` token (D2: lazy files are terminal)", () => {
	for (const key of Object.keys(LAZY_FILES) as LazyFileKey[]) {
		const absolutePath = join(REAL_ASSETS_DIR, LAZY_FILES[key]);
		const content = readFileSync(absolutePath, "utf8");
		assert.ok(!content.includes("{{"), `lazy file for ${key} must not contain a {{ placeholder`);
	}
});

test("no lazy file contains a functional relative assets/ pointer (D2 invariant)", () => {
	for (const key of Object.keys(LAZY_FILES) as LazyFileKey[]) {
		const absolutePath = join(REAL_ASSETS_DIR, LAZY_FILES[key]);
		const content = readFileSync(absolutePath, "utf8");
		assert.ok(
			!FUNCTIONAL_RELATIVE_POINTER.test(content),
			`lazy file for ${key} must not contain a functional relative assets/ pointer`,
		);
	}
});

test("rendering from a process cwd unrelated to the harness install still resolves every real lazy path to an existing absolute file", async () => {
	const unrelatedCwd = await mkdtemp(join(tmpdir(), "unrelated-cwd-"));
	const script = `
		import { renderOrchestratorPrompt } from ${JSON.stringify(RENDER_MODULE_PATH)};
		const rendered = renderOrchestratorPrompt(${JSON.stringify(REAL_ASSETS_DIR)});
		process.stdout.write(JSON.stringify({ rendered }));
	`;
	const scriptPath = join(unrelatedCwd, "render-probe.mts");
	await writeFile(scriptPath, script, "utf8");

	try {
		const result = spawnSync(TSX_BIN, [scriptPath], {
			cwd: unrelatedCwd,
			encoding: "utf8",
		});

		assert.equal(result.status, 0, `render probe failed: ${result.stderr}`);
		const { rendered } = JSON.parse(result.stdout) as { rendered: string };

		assert.ok(!rendered.includes("{{"), "rendered output must contain no raw placeholder");

		for (const key of Object.keys(LAZY_FILES) as LazyFileKey[]) {
			const absolutePath = join(REAL_ASSETS_DIR, LAZY_FILES[key]);
			if (!rendered.includes(absolutePath)) continue;
			assert.ok(absolutePath.startsWith("/"), `${key} must resolve to an absolute path`);
			assert.ok(statSync(absolutePath).isFile(), `${key} must resolve to an existing file`);
		}
	} finally {
		await rm(unrelatedCwd, { recursive: true, force: true });
	}
});

test("an unknown placeholder throws naming it, even under a freshly seeded assets dir", async () => {
	const unrelatedCwd = await mkdtemp(join(tmpdir(), "unrelated-cwd-"));
	const fakeAssetsDir = join(unrelatedCwd, "assets");
	const script = `
		import { mkdirSync, writeFileSync } from "node:fs";
		import { renderOrchestratorPrompt } from ${JSON.stringify(RENDER_MODULE_PATH)};
		mkdirSync(${JSON.stringify(fakeAssetsDir)}, { recursive: true });
		writeFileSync(${JSON.stringify(join(fakeAssetsDir, "orchestrator.md"))}, "{{NOT_A_REGISTERED_KEY}}\\n", "utf8");
		try {
			renderOrchestratorPrompt(${JSON.stringify(fakeAssetsDir)});
			process.stdout.write("NO_THROW");
		} catch (error) {
			process.stdout.write(String(error instanceof Error ? error.message : error));
		}
	`;
	const scriptPath = join(unrelatedCwd, "render-probe-unknown.mts");
	await writeFile(scriptPath, script, "utf8");

	try {
		const result = spawnSync(TSX_BIN, [scriptPath], {
			cwd: unrelatedCwd,
			encoding: "utf8",
		});

		assert.equal(result.status, 0, `probe process failed: ${result.stderr}`);
		assert.match(result.stdout, /NOT_A_REGISTERED_KEY/);
	} finally {
		await rm(unrelatedCwd, { recursive: true, force: true });
	}
});
