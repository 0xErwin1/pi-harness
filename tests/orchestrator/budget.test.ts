import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderOrchestratorPrompt } from "../../packages/orchestrator-prompt/render.ts";
import { BUDGET_BYTES } from "../../packages/orchestrator-prompt/budget.ts";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const REAL_ASSETS_DIR = join(repoRoot, "assets");
const CORE_PATH = join(REAL_ASSETS_DIR, "orchestrator.md");

test("the raw core (placeholder tokens in place) is at or under BUDGET_BYTES", () => {
	const raw = readFileSync(CORE_PATH, "utf8");
	const rawBytes = Buffer.byteLength(raw, "utf8");

	assert.ok(
		rawBytes <= BUDGET_BYTES,
		`raw assets/orchestrator.md is ${rawBytes} B, exceeding BUDGET_BYTES (${BUDGET_BYTES} B) by ${rawBytes - BUDGET_BYTES} B`,
	);
});

test("BUDGET_BYTES does not exceed the ~18 KB ceiling ruled in decision-orchestrator-budget (18,432 B)", () => {
	assert.ok(BUDGET_BYTES <= 18_432, `BUDGET_BYTES (${BUDGET_BYTES} B) exceeds the ruled 18,432 B ceiling`);
});

test("a regression that pushes the raw core over BUDGET_BYTES fails and names the overage", () => {
	const raw = readFileSync(CORE_PATH, "utf8");
	const inflated = `${raw}\n${"x".repeat(BUDGET_BYTES)}`;
	const inflatedBytes = Buffer.byteLength(inflated, "utf8");

	assert.ok(inflatedBytes > BUDGET_BYTES, "test setup check: the inflated fixture must exceed the budget");

	assert.throws(() => {
		assert.ok(
			inflatedBytes <= BUDGET_BYTES,
			`raw assets/orchestrator.md is ${inflatedBytes} B, exceeding BUDGET_BYTES (${BUDGET_BYTES} B) by ${inflatedBytes - BUDGET_BYTES} B`,
		);
	}, /exceeding BUDGET_BYTES/);
});

test("informational: the resolved (rendered) output size, for comparison against the raw budget", () => {
	const resolved = renderOrchestratorPrompt(REAL_ASSETS_DIR);
	const resolvedBytes = Buffer.byteLength(resolved, "utf8");

	// Resolved size is install-path dependent (absolute paths vary with where
	// assets live on disk) and is NOT the enforced budget quantity — see
	// packages/orchestrator-prompt/budget.ts. This assertion only guards
	// against a gross sanity failure (e.g. rendering returning nothing).
	assert.ok(resolvedBytes > 0);
});
