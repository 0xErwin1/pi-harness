import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	detectSddProject,
	renderSddInitMarkdown,
} from "../../extensions/sdd/project-detector.ts";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function fixtureDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "sdd-detector-"));
}

test("detectSddProject reports deterministic pi-harness facts from repository evidence", async () => {
	const detection = await detectSddProject({
		cwd: repoRoot,
		now: () => new Date("2026-07-03T00:00:00.000Z"),
	});

	assert.equal(detection.projectName, "pi-harness");
	assert.deepEqual(detection.packageManagers[0], {
		name: "pnpm",
		version: "10.33.4",
		source: "package.json#packageManager",
	});
	assert.equal(detection.commands.test?.command, "pnpm test");
	assert.equal(detection.commands.check?.command, "pnpm run check");
	assert.equal(detection.commands.typecheck?.command, "pnpm run check");
	assert.equal(detection.commands.runtimeVerify?.command, "pnpm run verify:runtime");
	assert.equal(detection.strictTdd, true);
	assert.ok(
		detection.stack.some(
			(item) => item.name === "Node.js" && item.confidence === "high",
		),
	);
	assert.ok(
		detection.stack.some(
			(item) => item.name === "TypeScript" && item.confidence === "high",
		),
	);
	assert.ok(
		detection.stack.some(
			(item) => item.name === "ESM" && item.evidence.includes("package.json#type=module"),
		),
	);
	assert.ok(detection.evidence.includes("package.json"));
	assert.equal(detection.detectedAt, "2026-07-03T00:00:00.000Z");

	const markdown = renderSddInitMarkdown(detection);
	assert.match(markdown, /# SDD Project Detection: pi-harness/);
	assert.match(markdown, /Primary test command: `pnpm test`/);
	assert.match(markdown, /Strict TDD: `true`/);
});

test("package manager detection prefers packageManager over lockfiles", async () => {
	const cwd = await fixtureDir();
	await writeFile(
		join(cwd, "package.json"),
		JSON.stringify({ name: "lock-precedence", packageManager: "npm@11.0.0", scripts: { test: "node --test" } }),
	);
	await writeFile(join(cwd, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

	const detection = await detectSddProject({ cwd, now: () => new Date("2026-07-03T00:00:00.000Z") });

	assert.deepEqual(detection.packageManagers[0], {
		name: "npm",
		version: "11.0.0",
		source: "package.json#packageManager",
	});
	assert.equal(detection.commands.test?.command, "npm test");
	assert.equal(detection.strictTdd, true);
});

test("missing reliable test script leaves strict TDD disabled", async () => {
	const cwd = await fixtureDir();
	await writeFile(
		join(cwd, "package.json"),
		JSON.stringify({ name: "no-tests", packageManager: "pnpm@10.0.0", scripts: { check: "tsc --noEmit" } }),
	);

	const detection = await detectSddProject({ cwd });

	assert.equal(detection.commands.test, undefined);
	assert.equal(detection.commands.check?.command, "pnpm run check");
	assert.equal(detection.strictTdd, false);
});

test("legacy openspec config is compatibility evidence and is not modified", async () => {
	const cwd = await fixtureDir();
	await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "legacy", scripts: { test: "node --test" } }));
	await mkdir(join(cwd, "openspec"));
	const configPath = join(cwd, "openspec", "config.yaml");
	const config = "rules:\n  apply:\n    test_command: pnpm test\n";
	await writeFile(configPath, config);

	const detection = await detectSddProject({ cwd });
	const after = await readFile(configPath, "utf8");

	assert.equal(detection.legacy?.openspecConfigFound, true);
	assert.match(detection.legacy?.summary ?? "", /test_command: pnpm test/);
	assert.equal(after, config);
});
