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

		assert.ok(coreContent.includes(content), `core-verbatim fixture line ${line} ("${content}") missing from the rendered core`);
	}
});

test("every lazy-verbatim fixture line is present verbatim in its named lazy file", () => {
	for (let line = 1; line <= FROZEN_FIXTURE_LINE_COUNT; line++) {
		const content = fixtureLines[line - 1];
		if (content === undefined || content.trim().length === 0) continue;

		const disposition = dispositionForLine(line);
		if (disposition.kind !== "lazy-verbatim") continue;

		const target = lazyFileContent.get(disposition.file);
		assert.ok(target !== undefined, `no lazy file content loaded for ${disposition.file}`);
		assert.ok(
			target!.includes(content),
			`lazy-verbatim fixture line ${line} ("${content}") missing from ${LAZY_FILES[disposition.file]}`,
		);
	}
});

test("exactly one fixture line is obsolete, and it is accounted for (no silent drop)", () => {
	let obsoleteCount = 0;
	for (let line = 1; line <= FROZEN_FIXTURE_LINE_COUNT; line++) {
		const disposition = dispositionForLine(line);
		if (disposition.kind === "obsolete") {
			obsoleteCount++;
			assert.equal(line, 426, "the only obsolete fixture line is expected to be line 426");
			assert.equal(disposition.reason, "superseded-by-pointer-map");
		}
	}
	assert.equal(obsoleteCount, 1);
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

test("protected sections (Work Routing Ladder, Delegation Rules) appear whole, verbatim, and contiguous in the rendered core", () => {
	const workRoutingLadder = fixtureLines.slice(56, 115).join("\n");
	const delegationRules = fixtureLines.slice(115, 169).join("\n");

	assert.ok(coreContent.includes(workRoutingLadder), "Work Routing Ladder must appear whole, verbatim, and contiguous — not split or summarized");
	assert.ok(coreContent.includes(delegationRules), "Delegation Rules must appear whole, verbatim, and contiguous — not split or summarized");
});
