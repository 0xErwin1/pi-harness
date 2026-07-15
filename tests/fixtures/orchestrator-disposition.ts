import type { LazyFileKey } from "../../packages/orchestrator-prompt/lazy-files.ts";

export type Disposition =
	| { kind: "core-verbatim" }
	| { kind: "lazy-verbatim"; file: LazyFileKey }
	| { kind: "obsolete"; reason: string };

export interface DispositionRange {
	/** 1-based, inclusive start line of `orchestrator.pre-diet.md`. */
	startLine: number;
	/** 1-based, inclusive end line of `orchestrator.pre-diet.md`. */
	endLine: number;
	disposition: Disposition;
}

const CORE: Disposition = { kind: "core-verbatim" };

function lazy(file: LazyFileKey): Disposition {
	return { kind: "lazy-verbatim", file };
}

export const FROZEN_FIXTURE_LINE_COUNT = 752;

/**
 * Maps every line of the frozen `orchestrator.pre-diet.md` (752 lines) to
 * exactly one disposition, per the relocation plan the design and the ~18 KB
 * budget ruling (engram sdd/harness-ux-and-hardening/decision-orchestrator-budget)
 * settled on:
 *
 * - `core-verbatim`: stays in the rendered core — the always-on floor named
 *   in that ruling (Role, Core Rules, Working Contract, Language Boundary,
 *   Work Routing Ladder, Delegation Rules, Init Guard, Result Contract,
 *   Sub-Agent Dedup, Review Workload Guard, Safety). Work Routing Ladder and
 *   Delegation Rules are additionally PROTECTED: they must land whole, never
 *   split at a normative/rationale seam.
 * - `lazy-verbatim`: relocates verbatim to the named file under
 *   `assets/orchestrator/` (see `packages/orchestrator-prompt/lazy-files.ts`).
 * - `obsolete`: dropped rather than relocated, because a newly-authored core
 *   pointer-map row supersedes it. The only instance is the line-426 clause
 *   hardcoding the relative `assets/support/atlas-persistence-contract.md`
 *   path (spec scenario "The existing relative reference is fixed").
 *
 * Ranges are contiguous and total across the whole fixture — a line is never
 * covered by zero or by more than one range — verified by
 * `tests/orchestrator/disposition-fixture.test.ts`. `LINE_OVERRIDES` refines
 * individual lines inside a range without breaking that contiguity.
 */
export const DISPOSITION_RANGES: DispositionRange[] = [
	{ startLine: 1, endLine: 4, disposition: CORE }, // title + intro
	{ startLine: 5, endLine: 20, disposition: CORE }, // ## You are the Orchestrator
	{ startLine: 21, endLine: 31, disposition: CORE }, // ## Core Rules
	{ startLine: 32, endLine: 40, disposition: CORE }, // ## Working Contract
	{ startLine: 41, endLine: 56, disposition: CORE }, // ## Language Boundary
	{ startLine: 57, endLine: 115, disposition: CORE }, // ## Work Routing Ladder (protected)
	{ startLine: 116, endLine: 169, disposition: CORE }, // ## Delegation Rules (protected)
	{ startLine: 170, endLine: 255, disposition: lazy("PI_HARNESS_SDD_WORKFLOW_PATH") }, // ## SDD Workflow
	{ startLine: 256, endLine: 318, disposition: lazy("PI_HARNESS_SDD_TESTING_PATH") }, // ## SDD Testing Workflow
	{ startLine: 319, endLine: 328, disposition: lazy("PI_HARNESS_SDD_WORKFLOW_PATH") }, // ### Apply Scope Contract
	{ startLine: 329, endLine: 373, disposition: lazy("PI_HARNESS_SUBAGENT_RUNTIME_PATH") }, // ## Harness Subagent Manager Runtime
	{ startLine: 374, endLine: 381, disposition: lazy("PI_HARNESS_SDD_WORKFLOW_PATH") }, // ### Visual-Aware Apply Split
	{ startLine: 382, endLine: 393, disposition: lazy("PI_HARNESS_SDD_WORKFLOW_PATH") }, // ### Batched Apply-Verify Cycles
	{ startLine: 394, endLine: 404, disposition: lazy("PI_HARNESS_SDD_WORKFLOW_PATH") }, // ## SDD Status Contract
	{ startLine: 405, endLine: 412, disposition: CORE }, // ## Init Guard
	{ startLine: 413, endLine: 423, disposition: lazy("PI_HARNESS_PERSISTENCE_PATH") }, // ## Artifact Store Policy
	{ startLine: 424, endLine: 436, disposition: lazy("PI_HARNESS_PERSISTENCE_PATH") }, // ## Atlas Persistence Contract (line 426 overridden below)
	{ startLine: 437, endLine: 521, disposition: lazy("PI_HARNESS_PERSISTENCE_PATH") }, // ## Engram Persistent Memory — Protocol
	{ startLine: 522, endLine: 554, disposition: lazy("PI_HARNESS_SDD_WORKFLOW_PATH") }, // ## Execution Mode (+ Automatic Mode Gatekeeper)
	{ startLine: 555, endLine: 569, disposition: CORE }, // ## Result Contract
	{ startLine: 570, endLine: 580, disposition: CORE }, // ## Sub-Agent Launch Deduplication
	{ startLine: 581, endLine: 624, disposition: lazy("PI_HARNESS_SKILLS_PATH") }, // ## Skill Registry Protocol
	{ startLine: 625, endLine: 647, disposition: lazy("PI_HARNESS_SKILLS_PATH") }, // ## Intent-Driven Skill Discovery
	{ startLine: 648, endLine: 659, disposition: lazy("PI_HARNESS_SDD_WORKFLOW_PATH") }, // ## Strict TDD Forwarding
	{ startLine: 660, endLine: 672, disposition: CORE }, // ## Review Workload Guard
	{ startLine: 673, endLine: 708, disposition: lazy("PI_HARNESS_REVIEW_PATH") }, // ## 4R Review
	{ startLine: 709, endLine: 715, disposition: CORE }, // ## Safety
	{ startLine: 716, endLine: 737, disposition: lazy("PI_HARNESS_LANGUAGE_CODEGRAPH_PATH") }, // ## Language-specific Rules
	{ startLine: 738, endLine: 752, disposition: lazy("PI_HARNESS_LANGUAGE_CODEGRAPH_PATH") }, // ## CodeGraph
];

export const LINE_OVERRIDES: Record<number, Disposition> = {
	426: { kind: "obsolete", reason: "superseded-by-pointer-map" },
};

export function dispositionForLine(line: number): Disposition {
	const override = LINE_OVERRIDES[line];
	if (override !== undefined) return override;

	const range = DISPOSITION_RANGES.find((candidate) => line >= candidate.startLine && line <= candidate.endLine);
	if (range === undefined) {
		throw new Error(`orchestrator-disposition: line ${line} is not covered by any range`);
	}

	return range.disposition;
}
