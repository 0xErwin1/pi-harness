import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LAZY_FILES, type LazyFileKey } from "../../packages/orchestrator-prompt/lazy-files.ts";
import { FROZEN_FIXTURE_LINE_COUNT, dispositionForLine } from "../../tests/fixtures/orchestrator-disposition.ts";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const FIXTURE_PATH = resolve(repoRoot, "tests/fixtures/orchestrator.pre-diet.md");
const CORE_PATH = resolve(repoRoot, "assets/orchestrator.md");

const fixtureLines = readFileSync(FIXTURE_PATH, "utf8").split("\n");
const coreContent = readFileSync(CORE_PATH, "utf8");

// PI_HARNESS_ATLAS_CONTRACT_PATH is a pointer-only entry (see lazy-files.ts):
// it targets a pre-existing asset, not a fixture-sourced relocation, so it is
// excluded from the fixture-driven verbatim sweep below.
const RELOCATABLE_LAZY_FILES = (Object.keys(LAZY_FILES) as LazyFileKey[]).filter(
	(key) => key !== "PI_HARNESS_ATLAS_CONTRACT_PATH",
);

const lazyFileContent = new Map<LazyFileKey, string>(
	RELOCATABLE_LAZY_FILES.map((key) => [key, readFileSync(join(repoRoot, "assets", LAZY_FILES[key]), "utf8")]),
);

// The official pi-subagents-j0k3r contract supersedes the fixture's former
// harness-owned runtime wording. Keep the frozen fixture intact while treating
// only those replaced policy lines as seams in the verbatim assertions.
const NATIVE_RUNTIME_POLICY_REPLACEMENTS = new Set([87, 89, 157]);

function isNativeRuntimePolicyReplacement(line: number): boolean {
	return NATIVE_RUNTIME_POLICY_REPLACEMENTS.has(line) || (line >= 331 && line <= 372);
}

/** First non-empty header line of each lazy file, used as its double-delivery marker. */
const SECTION_MARKER: Record<(typeof RELOCATABLE_LAZY_FILES)[number], string> = {
	PI_HARNESS_SDD_WORKFLOW_PATH: "## SDD Workflow (Spec-Driven Development)",
	PI_HARNESS_SDD_TESTING_PATH: "## SDD Testing Workflow (Independent QA Flow)",
	PI_HARNESS_SUBAGENT_RUNTIME_PATH: "## Harness Subagent Manager Runtime",
	PI_HARNESS_PERSISTENCE_PATH: "## Artifact Store Policy",
	PI_HARNESS_SKILLS_PATH: "## Skill Registry Protocol",
	PI_HARNESS_REVIEW_PATH: "## 4R Review",
	PI_HARNESS_LANGUAGE_CODEGRAPH_PATH: "## Language-specific Rules",
};

test("every normative fixture line has exactly one disposition (total sweep, no silent gaps)", () => {
	for (let line = 1; line <= FROZEN_FIXTURE_LINE_COUNT; line++) {
		const content = fixtureLines[line - 1];
		if (content === undefined || content.trim().length === 0) continue;

		assert.doesNotThrow(() => dispositionForLine(line), `fixture line ${line} ("${content}") has no disposition`);
	}
});

test("every core-verbatim fixture line is present verbatim in the rendered core", () => {
	for (let line = 1; line <= FROZEN_FIXTURE_LINE_COUNT; line++) {
		const content = fixtureLines[line - 1];
		if (content === undefined || content.trim().length === 0) continue;
		if (dispositionForLine(line).kind !== "core-verbatim") continue;
		if (isNativeRuntimePolicyReplacement(line)) continue;

		assert.ok(coreContent.includes(content), `core-verbatim fixture line ${line} ("${content}") missing from the rendered core`);
	}
});

test("every lazy-verbatim fixture line is present verbatim in its named lazy file", () => {
	for (let line = 1; line <= FROZEN_FIXTURE_LINE_COUNT; line++) {
		const content = fixtureLines[line - 1];
		if (content === undefined || content.trim().length === 0) continue;

		const disposition = dispositionForLine(line);
		if (disposition.kind !== "lazy-verbatim") continue;
		if (isNativeRuntimePolicyReplacement(line)) continue;

		const target = lazyFileContent.get(disposition.file);
		assert.ok(target !== undefined, `no lazy file content loaded for ${disposition.file}`);
		assert.ok(
			target!.includes(content),
			`lazy-verbatim fixture line ${line} ("${content}") missing from ${LAZY_FILES[disposition.file]}`,
		);
	}
});

// Every dropped pre-diet line is enumerated here with the policy that replaced
// it. Dropping another line is a deliberate edit to this map, never a silent
// erosion of the fixture.
const EXPECTED_OBSOLETE: Record<number, string> = {
	85: "superseded-by-opt-in-review-policy",
	94: "superseded-by-opt-in-review-policy",
	103: "superseded-by-demand-driven-execution-policy",
	110: "superseded-by-demand-driven-execution-policy",
	129: "superseded-by-opt-in-review-policy",
	130: "superseded-by-opt-in-review-policy",
	134: "superseded-by-opt-in-review-policy",
	137: "superseded-by-opt-in-review-policy",
	138: "superseded-by-opt-in-review-policy",
	139: "superseded-by-opt-in-review-policy",
	140: "superseded-by-opt-in-review-policy",
	141: "superseded-by-opt-in-review-policy",
	150: "superseded-by-opt-in-review-policy",
	323: "superseded-by-demand-driven-execution-policy",
	325: "superseded-by-demand-driven-execution-policy",
	384: "superseded-by-demand-driven-execution-policy",
	386: "superseded-by-demand-driven-execution-policy",
	388: "superseded-by-demand-driven-execution-policy",
	390: "superseded-by-batch-remediation-policy",
	392: "superseded-by-demand-driven-execution-policy",
	426: "superseded-by-pointer-map",
	551: "superseded-by-opt-in-review-policy",
	553: "superseded-by-demand-driven-execution-policy",
	660: "superseded-by-demand-driven-execution-policy",
	662: "superseded-by-demand-driven-execution-policy",
	664: "superseded-by-demand-driven-execution-policy",
	666: "superseded-by-demand-driven-execution-policy",
	668: "superseded-by-demand-driven-execution-policy",
	669: "superseded-by-demand-driven-execution-policy",
	671: "superseded-by-demand-driven-execution-policy",
	683: "superseded-by-opt-in-review-policy",
	685: "superseded-by-opt-in-review-policy",
	686: "superseded-by-opt-in-review-policy",
	688: "superseded-by-opt-in-review-policy",
	690: "superseded-by-opt-in-review-policy",
	707: "superseded-by-opt-in-review-policy",
};

test("every obsolete fixture line is enumerated with the policy that superseded it (no silent drop)", () => {
	const found: Record<number, string> = {};

	for (let line = 1; line <= FROZEN_FIXTURE_LINE_COUNT; line++) {
		const disposition = dispositionForLine(line);
		if (disposition.kind === "obsolete") {
			found[line] = disposition.reason;
		}
	}

	assert.deepEqual(found, EXPECTED_OBSOLETE);
});

test("no double delivery: a relocated section's own header does not also appear in the core", () => {
	// Exact-line comparison, not substring: the core's Lazy Reference Map
	// legitimately mentions each section's name in prose (e.g. as a "###"
	// sub-heading), which would false-positive a naive substring check
	// against a "##" marker.
	const coreLines = new Set(coreContent.split("\n"));

	for (const key of RELOCATABLE_LAZY_FILES) {
		const marker = SECTION_MARKER[key];
		const target = lazyFileContent.get(key)!;

		assert.ok(target.includes(marker), `test setup check: expected marker "${marker}" in the lazy file for ${key}`);
		assert.ok(!coreLines.has(marker), `lazy body for ${key} was double-delivered: its marker "${marker}" also appears in the core as a whole line`);
	}
});

/**
 * Splits a fixture range into the maximal runs of consecutive lines that a
 * policy change has not obsoleted. Each run must still land in the core whole
 * and contiguous; obsoleted lines are the only permitted seams.
 */
function survivingRuns(startLine: number, endLine: number): string[] {
	const runs: string[] = [];
	let current: string[] = [];

	for (let line = startLine; line <= endLine; line++) {
		if (dispositionForLine(line).kind === "obsolete" || isNativeRuntimePolicyReplacement(line)) {
			if (current.length > 0) runs.push(current.join("\n"));
			current = [];
			continue;
		}

		current.push(fixtureLines[line - 1]);
	}

	if (current.length > 0) runs.push(current.join("\n"));

	return runs;
}

test("protected sections (Work Routing Ladder, Delegation Rules) appear whole, verbatim, and contiguous in the rendered core", () => {
	const protectedSections: Array<{ name: string; startLine: number; endLine: number }> = [
		{ name: "Work Routing Ladder", startLine: 57, endLine: 115 },
		{ name: "Delegation Rules", startLine: 116, endLine: 169 },
	];

	for (const section of protectedSections) {
		const runs = survivingRuns(section.startLine, section.endLine);

		assert.ok(runs.length > 0, `test setup check: ${section.name} has no surviving lines`);

		for (const run of runs) {
			assert.ok(
				coreContent.includes(run),
				`${section.name} must appear whole, verbatim, and contiguous — not split or summarized (missing run starting "${run.split("\n")[0]}")`,
			);
		}
	}
});
