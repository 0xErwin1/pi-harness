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
 *   Sub-Agent Dedup, Safety). Work Routing Ladder and
 *   Delegation Rules are additionally PROTECTED: they must land whole, never
 *   split at a normative/rationale seam.
 * - `lazy-verbatim`: relocates verbatim to the named file under
 *   `assets/orchestrator/` (see `packages/orchestrator-prompt/lazy-files.ts`).
 * - `obsolete`: dropped rather than relocated, because later policy supersedes
 *   it. Every instance names the policy that replaced it, so a drop is always a
 *   decision on the record rather than silent erosion of the fixture.
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

/**
 * Reviews became opt-in: the orchestrator no longer auto-launches a reviewer
 * after implementation, before a PR, or after an incident, and the review gate
 * no longer blocks. These pre-diet lines encoded that withdrawn ceremony.
 */
const OPT_IN_REVIEW: Disposition = { kind: "obsolete", reason: "superseded-by-opt-in-review-policy" };
const DEMAND_DRIVEN_EXECUTION: Disposition = {
	kind: "obsolete",
	reason: "superseded-by-demand-driven-execution-policy",
};

export const LINE_OVERRIDES: Record<number, Disposition> = {
	85: OPT_IN_REVIEW, // simple-delegation review suggestion
	94: OPT_IN_REVIEW, // default pattern ending in an unconditional fresh-reviewer audit
	103: DEMAND_DRIVEN_EXECUTION, // SDD routing based on review risk
	110: DEMAND_DRIVEN_EXECUTION, // SDD routing based on reviewer burden
	129: OPT_IN_REVIEW, // delegation row: commit/push/PR requires fresh review first
	130: OPT_IN_REVIEW, // delegation row: incident recovery requires fresh audit first
	134: OPT_IN_REVIEW, // triggers preamble, before it was scoped to work delegation only
	137: OPT_IN_REVIEW, // multi-file write rule, with its inline fresh-reviewer escape hatch
	138: OPT_IN_REVIEW, // PR rule
	139: OPT_IN_REVIEW, // incident rule, when it still ended in a fresh audit reviewer
	140: OPT_IN_REVIEW, // long-session rule, when `reviewer` was one of its outcomes
	141: OPT_IN_REVIEW, // fresh review rule
	150: OPT_IN_REVIEW, // cost/context bullet mandating fresh reviewers after implementation
	323: DEMAND_DRIVEN_EXECUTION, // apply prompt required a delivery/chain decision
	325: DEMAND_DRIVEN_EXECUTION, // apply scope was checked against commits
	384: DEMAND_DRIVEN_EXECUTION, // batching rationale replaced by context/dependency-only policy
	386: DEMAND_DRIVEN_EXECUTION, // changed-line and task-count batching trigger
	388: DEMAND_DRIVEN_EXECUTION, // qualification-based batch planning

	// Batched apply-verify gained a severity floor: a WARNING/SUGGESTION nit no
	// longer stops the cycle, and a cross-batch design gap is surfaced as a scope
	// decision instead of looping back through an upstream planning phase.
	390: { kind: "obsolete", reason: "superseded-by-batch-remediation-policy" },
	392: DEMAND_DRIVEN_EXECUTION, // batching composed with delivery and PR strategy
	426: { kind: "obsolete", reason: "superseded-by-pointer-map" },
	551: OPT_IN_REVIEW, // automatic gatekeeper delegated fresh review
	553: DEMAND_DRIVEN_EXECUTION, // automatic gatekeeper depended on review workload policy
	660: DEMAND_DRIVEN_EXECUTION, // review workload guard heading
	662: DEMAND_DRIVEN_EXECUTION, // review workload inspection before apply
	664: DEMAND_DRIVEN_EXECUTION, // size and delivery-strategy gate
	666: DEMAND_DRIVEN_EXECUTION, // chain-strategy question
	668: DEMAND_DRIVEN_EXECUTION, // stacked-to-main delivery choice
	669: DEMAND_DRIVEN_EXECUTION, // feature-branch-chain delivery choice
	671: DEMAND_DRIVEN_EXECUTION, // delivery decisions forwarded to apply
	683: OPT_IN_REVIEW, // review-gate described as a gate, citing a `lib/` module that does not exist
	685: OPT_IN_REVIEW, // pre-commit and pre-push review suggestion
	686: OPT_IN_REVIEW, // pre-PR strong gate that BLOCKS `gh pr create`
	688: OPT_IN_REVIEW, // orchestrator obligation to run 4R to clear a block
	690: OPT_IN_REVIEW, // judgment-day by inference after a high-risk SDD phase
	707: OPT_IN_REVIEW, // lens-selection closer instructing the reader to satisfy the pre-PR block
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
