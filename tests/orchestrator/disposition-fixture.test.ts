import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LAZY_FILES, type LazyFileKey } from "../../packages/orchestrator-prompt/lazy-files.ts";
import {
	DISPOSITION_RANGES,
	FROZEN_FIXTURE_LINE_COUNT,
	dispositionForLine,
} from "../../tests/fixtures/orchestrator-disposition.ts";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const FIXTURE_PATH = resolve(repoRoot, "tests/fixtures/orchestrator.pre-diet.md");
const fixtureLines = readFileSync(FIXTURE_PATH, "utf8").split("\n");

test("the frozen fixture's line count matches FROZEN_FIXTURE_LINE_COUNT", () => {
	// A trailing newline produces one trailing empty element after split("\n").
	const lineCount = fixtureLines[fixtureLines.length - 1] === "" ? fixtureLines.length - 1 : fixtureLines.length;

	assert.equal(lineCount, FROZEN_FIXTURE_LINE_COUNT);
});

test("disposition ranges are sorted, contiguous, and total across the whole fixture", () => {
	const sorted = [...DISPOSITION_RANGES].sort((a, b) => a.startLine - b.startLine);
	assert.deepEqual(sorted, DISPOSITION_RANGES, "ranges must already be listed in line order");

	assert.equal(DISPOSITION_RANGES[0].startLine, 1);
	assert.equal(DISPOSITION_RANGES[DISPOSITION_RANGES.length - 1].endLine, FROZEN_FIXTURE_LINE_COUNT);

	for (let i = 1; i < DISPOSITION_RANGES.length; i++) {
		const previous = DISPOSITION_RANGES[i - 1];
		const current = DISPOSITION_RANGES[i];
		assert.equal(current.startLine, previous.endLine + 1, `gap or overlap between ranges ending at ${previous.endLine} and starting at ${current.startLine}`);
	}

	for (const range of DISPOSITION_RANGES) {
		assert.ok(range.startLine <= range.endLine, `range ${range.startLine}-${range.endLine} is inverted`);
	}
});

test("every normative (non-blank) line resolves to exactly one disposition", () => {
	for (let line = 1; line <= FROZEN_FIXTURE_LINE_COUNT; line++) {
		const content = fixtureLines[line - 1];
		if (content === undefined || content.trim().length === 0) continue;

		assert.doesNotThrow(() => dispositionForLine(line), `line ${line} ("${content}") has no disposition`);
	}
});

test("every lazy-file key referenced by a disposition is registered in LAZY_FILES", () => {
	const registeredKeys = new Set(Object.keys(LAZY_FILES));
	const referencedKeys = new Set<LazyFileKey>();

	for (const range of DISPOSITION_RANGES) {
		if (range.disposition.kind === "lazy-verbatim") referencedKeys.add(range.disposition.file);
	}

	for (const key of referencedKeys) {
		assert.ok(registeredKeys.has(key), `disposition references unregistered lazy file key ${key}`);
	}
});

// PI_HARNESS_ATLAS_CONTRACT_PATH is a pointer-only entry: it targets the
// pre-existing `assets/support/atlas-persistence-contract.md`, which is not
// sourced from any fixture line (the fixture line it replaces, 426, is
// `obsolete`, not `lazy-verbatim`). It is intentionally exempt from the
// "every registered lazy file is a disposition target" invariant below.
const POINTER_ONLY_KEYS: ReadonlySet<LazyFileKey> = new Set(["PI_HARNESS_ATLAS_CONTRACT_PATH"]);

test("every registered lazy file sourced from the fixture is the target of at least one disposition", () => {
	const referencedKeys = new Set<LazyFileKey>();
	for (const range of DISPOSITION_RANGES) {
		if (range.disposition.kind === "lazy-verbatim") referencedKeys.add(range.disposition.file);
	}

	for (const key of Object.keys(LAZY_FILES) as LazyFileKey[]) {
		if (POINTER_ONLY_KEYS.has(key)) continue;
		assert.ok(referencedKeys.has(key), `lazy file ${key} is registered but no disposition relocates content to it`);
	}
});

test("the pointer-only atlas-contract key is registered and targets the pre-existing support file", () => {
	assert.equal(LAZY_FILES.PI_HARNESS_ATLAS_CONTRACT_PATH, "support/atlas-persistence-contract.md");
});

test("the protected sections (Work Routing Ladder, Delegation Rules) are anchored on the right lines and stay core-verbatim", () => {
	assert.equal(fixtureLines[56], "## Work Routing Ladder");
	assert.equal(fixtureLines[115], "## Delegation Rules");
	assert.deepEqual(dispositionForLine(57), { kind: "core-verbatim" });
	assert.deepEqual(dispositionForLine(115), { kind: "core-verbatim" });
	assert.deepEqual(dispositionForLine(169), { kind: "core-verbatim" });
});

test("the line-426 relative-path clause is obsoleted by the core pointer map", () => {
	assert.match(fixtureLines[425], /assets\/support\/atlas-persistence-contract\.md/);
	assert.deepEqual(dispositionForLine(426), { kind: "obsolete", reason: "superseded-by-pointer-map" });
});
