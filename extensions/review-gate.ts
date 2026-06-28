/**
 * 4R review gate for Pi.
 *
 * Intercepts `bash` tool calls that look like git/gh workflow events and applies
 * the trigger rules below:
 *
 *   - pre-commit / pre-push  → advisory: notify a single cheap review lens, never block.
 *   - pre-pr (`gh pr create`) → strong: block when the diff touches hot paths
 *                               (auth/update/security/payments) or exceeds the
 *                               large-diff threshold, naming the 4R lenses to run first.
 *
 * The gate is fail-open: any error gathering the diff returns `undefined` so a
 * git/gh command is never broken by this guard. It composes with `shell-guard`
 * (each extension registers its own `tool_call` handler; the first block wins).
 *
 * The trigger logic is inlined (not imported from a sibling `lib/` module) on
 * purpose: the harness links extensions into `~/.pi/agent/extensions/` per file,
 * so a relative `../lib/...` import would not resolve at the symlinked load path.
 * Keep this extension self-contained, like `shell-guard.ts`. The trigger logic
 * is ported from gentle-pi `lib/review-triggers.ts`.
 */
import { execFileSync } from "node:child_process";

import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Trigger logic (ported 1:1 from gentle-ai trigger catalog)
// ---------------------------------------------------------------------------

type TriggerEvent =
	| "pre-commit"
	| "pre-push"
	| "pre-pr"
	| "post-sdd-phase"
	| "on-ci"
	| "on-schedule";

type TriggerMode = "advisory" | "strong";

interface TriggerWhen {
	always?: boolean;
	pathGlobs?: string[];
	minDiffLines?: number;
	phases?: string[];
	combine?: "" | "or" | "and";
}

interface TriggerBinding {
	on: TriggerEvent;
	when: TriggerWhen;
	run: string[];
	mode: TriggerMode;
	reason: string;
}

interface TriggerRuleSet {
	bindings: TriggerBinding[];
}

interface ChangedDiff {
	changedPaths: string[];
	changedLines: number;
}

/**
 * Minimum number of changed lines in a diff that triggers the full 4R review
 * fan-out on pre-pr events.
 */
const LARGE_CHANGED_LINE_THRESHOLD = 400;

const SUPPORTED_EVENTS: ReadonlySet<TriggerEvent> = new Set([
	"pre-commit",
	"pre-push",
	"pre-pr",
	"post-sdd-phase",
	"on-ci",
	"on-schedule",
]);

const KNOWN_AGENTS: readonly string[] = [
	"review-risk",
	"review-readability",
	"review-reliability",
	"review-resilience",
	"judgment-day",
	"sdd-explore",
	"sdd-propose",
	"sdd-spec",
	"sdd-design",
	"sdd-tasks",
	"sdd-apply",
	"sdd-verify",
	"sdd-archive",
];

const VALID_SDD_PHASES: ReadonlySet<string> = new Set([
	"sdd-explore",
	"sdd-propose",
	"sdd-spec",
	"sdd-design",
	"sdd-tasks",
	"sdd-apply",
	"sdd-verify",
	"sdd-archive",
	"explore",
	"propose",
	"spec",
	"design",
	"tasks",
	"apply",
	"verify",
	"archive",
]);

const DEFAULT_RULE_SET: TriggerRuleSet = {
	bindings: [
		{
			on: "pre-commit",
			when: { always: true },
			run: ["review-readability"],
			mode: "advisory",
			reason:
				"everyday event -> ONE cheap advisory lens (~1x); full 4R fan-out reserved for pre-pr",
		},
		{
			on: "pre-push",
			when: { always: true },
			run: ["review-readability"],
			mode: "advisory",
			reason:
				"everyday event -> ONE cheap advisory lens (~1x); 4R fan-out reserved for pre-pr on hot paths / large diffs",
		},
		{
			on: "pre-pr",
			when: {
				pathGlobs: ["**/auth/**", "**/update/**", "**/security/**", "**/payments/**"],
				minDiffLines: LARGE_CHANGED_LINE_THRESHOLD,
				combine: "or",
			},
			run: ["review-risk", "review-resilience", "review-readability", "review-reliability"],
			mode: "strong",
			reason:
				"full 4R fan-out (~4x) only on hot paths (auth/update/security/payments) or diffs exceeding 400 changed lines",
		},
		{
			on: "post-sdd-phase",
			when: { phases: ["design", "apply"] },
			run: ["judgment-day"],
			mode: "strong",
			reason:
				"adversarial verification (~4 + 3*findings cost) only at high-stakes SDD phases (design and apply)",
		},
	],
};

/** Reports whether `run` contains all four 4R review agents. */
function has4RFanOut(run: readonly string[]): boolean {
	const found = new Set(run);
	return (
		found.has("review-risk") &&
		found.has("review-readability") &&
		found.has("review-reliability") &&
		found.has("review-resilience")
	);
}

/**
 * Validates each binding against the closed vocabularies. Throws on the first
 * violation. Run once at module load against DEFAULT_RULE_SET to prove it valid.
 */
function validateTriggerRuleSet(set: TriggerRuleSet): void {
	const knownAgentsSet = new Set(KNOWN_AGENTS);
	const validCombine: ReadonlySet<string> = new Set(["", "or", "and"]);

	for (let i = 0; i < set.bindings.length; i++) {
		const b = set.bindings[i];

		if (!SUPPORTED_EVENTS.has(b.on)) {
			throw new Error(`binding[${i}]: unknown event "${b.on}"`);
		}

		if (!b.run || b.run.length === 0) {
			throw new Error(`binding[${i}]: Run must not be empty`);
		}
		for (const agent of b.run) {
			if (!knownAgentsSet.has(agent)) {
				throw new Error(`binding[${i}]: unknown run agent "${agent}"`);
			}
		}

		if (b.mode !== "advisory" && b.mode !== "strong") {
			throw new Error(`binding[${i}]: unknown mode "${b.mode}"`);
		}

		const w = b.when;

		if (w.minDiffLines !== undefined && w.minDiffLines < 0) {
			throw new Error(`binding[${i}]: When.MinDiffLines must be a positive integer (> 0)`);
		}

		if (w.pathGlobs !== undefined && w.pathGlobs.length === 0) {
			throw new Error(`binding[${i}]: When.pathGlobs must not be an empty slice`);
		}

		const hasCondition =
			w.always === true ||
			(w.pathGlobs !== undefined && w.pathGlobs.length > 0) ||
			(w.minDiffLines !== undefined && w.minDiffLines > 0) ||
			(w.phases !== undefined && w.phases.length > 0);
		if (!hasCondition) {
			throw new Error(
				`binding[${i}]: When must have at least one condition (always, pathGlobs, minDiffLines, or phases)`,
			);
		}

		const combineVal: string = w.combine ?? "";
		if (!validCombine.has(combineVal)) {
			throw new Error(
				`binding[${i}]: When.combine "${combineVal}" is not in {"" "or" "and"}`,
			);
		}

		if (w.phases) {
			for (const p of w.phases) {
				if (!VALID_SDD_PHASES.has(p)) {
					throw new Error(
						`binding[${i}]: When.phases entry "${p}" is not a recognized SDD phase identifier`,
					);
				}
			}
		}

		if (w.phases && w.phases.length > 0 && b.on !== "post-sdd-phase") {
			throw new Error(
				`binding[${i}]: When.phases may only be used with the post-sdd-phase event (got "${b.on}")`,
			);
		}

		if ((b.on === "pre-commit" || b.on === "pre-push") && w.always === true) {
			if (has4RFanOut(b.run)) {
				throw new Error(
					`binding[${i}]: full 4R fan-out on "${b.on}" with when.always=true is prohibited — ` +
						`everyday events must use a single advisory lens (token-budget rule)`,
				);
			}
		}
	}
}

validateTriggerRuleSet(DEFAULT_RULE_SET);

/**
 * Converts a glob pattern (using `**` and `*`) to a RegExp. A leading
 * doublestar-slash means "zero or more leading path segments"; a non-leading
 * doublestar expands to `.*`; a single star expands to `[^/]*`.
 */
function globToRegExp(glob: string): RegExp {
	const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	const tokenized = escaped.replace(/\*\*/g, "__DS__");
	const withSingleStar = tokenized.replace(/\*/g, "[^/]*");
	const withLeading = withSingleStar.replace(/^__DS__\//, "(?:.*/)?");
	const withDoubleStar = withLeading.replace(/__DS__/g, ".*");

	return new RegExp(`^${withDoubleStar}$`);
}

/** Returns true if any path matches any glob. */
function matchPathGlobs(paths: readonly string[], globs: readonly string[]): boolean {
	if (paths.length === 0 || globs.length === 0) return false;
	const regexps = globs.map(globToRegExp);
	return paths.some((p) => regexps.some((re) => re.test(p)));
}

/**
 * Evaluates a trigger event against DEFAULT_RULE_SET and the provided diff.
 * Returns the first firing binding's `{ run, mode, reason }`, or null.
 */
function evaluateEvent(
	event: TriggerEvent,
	diff: ChangedDiff,
): { run: string[]; mode: TriggerMode; reason: string } | null {
	for (const binding of DEFAULT_RULE_SET.bindings) {
		if (binding.on !== event) continue;

		const w = binding.when;

		if (w.always === true) {
			return { run: binding.run, mode: binding.mode, reason: binding.reason };
		}

		if (event === "post-sdd-phase") {
			continue;
		}

		const combine = w.combine ?? "or";
		const pathMatches =
			w.pathGlobs && w.pathGlobs.length > 0
				? matchPathGlobs(diff.changedPaths, w.pathGlobs)
				: false;
		const lineMatches =
			w.minDiffLines !== undefined && w.minDiffLines > 0
				? diff.changedLines >= w.minDiffLines
				: false;

		const hasPathCondition = w.pathGlobs !== undefined && w.pathGlobs.length > 0;
		const hasLineCondition = w.minDiffLines !== undefined && w.minDiffLines > 0;

		let fires = false;
		if (combine === "and") {
			if (hasPathCondition && hasLineCondition) {
				fires = pathMatches && lineMatches;
			} else if (hasPathCondition) {
				fires = pathMatches;
			} else if (hasLineCondition) {
				fires = lineMatches;
			}
		} else {
			fires = pathMatches || lineMatches;
		}

		if (fires) {
			return { run: binding.run, mode: binding.mode, reason: binding.reason };
		}
	}

	return null;
}

// ---------------------------------------------------------------------------
// Gate wiring
// ---------------------------------------------------------------------------

/**
 * Classifies a bash command string as a TriggerEvent for the review gate, or
 * returns null when the command is not a recognized git/gh workflow trigger.
 *
 * `gh pr create` is checked before `git push` so a PR-creation command is never
 * misread as a plain push. Regexes tolerate flags between tokens.
 */
export function classifyReviewEvent(command: string): TriggerEvent | null {
	const trimmed = command.trim();

	if (/^gh\s+pr\s+create\b/.test(trimmed)) return "pre-pr";

	if (/^git(?:\s+(?:-C\s+\S+|--work-tree=\S+|--git-dir=\S+))?\s+commit\b/.test(trimmed))
		return "pre-commit";

	if (/^git(?:\s+(?:-C\s+\S+|--work-tree=\S+|--git-dir=\S+))?\s+push\b/.test(trimmed))
		return "pre-push";

	return null;
}

/**
 * Parses the output of `git diff --numstat` into a ChangedDiff. Binary files
 * appear as `-  -  path`; they contribute 0 to changedLines.
 */
export function parseNumstat(output: string): ChangedDiff {
	const changedPaths: string[] = [];
	let changedLines = 0;

	for (const line of output.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		const parts = trimmed.split("\t");
		if (parts.length < 3) continue;

		const added = parts[0];
		const deleted = parts[1];
		const filePath = parts.slice(2).join("\t");
		if (!filePath) continue;

		changedPaths.push(filePath);

		const addedNum = added === "-" ? 0 : parseInt(added, 10);
		const deletedNum = deleted === "-" ? 0 : parseInt(deleted, 10);
		if (!isNaN(addedNum)) changedLines += addedNum;
		if (!isNaN(deletedNum)) changedLines += deletedNum;
	}

	return { changedPaths, changedLines };
}

/**
 * Computes a ChangedDiff for the given event by running git numstat. Returns
 * null on any error (fail-open — never break the user's git command). The
 * synchronous git calls are bounded by a timeout so a slow/large repo cannot
 * freeze the extension process.
 */
function computeDiffForEvent(event: TriggerEvent, cwd: string): ChangedDiff | null {
	const gitOpts = {
		cwd,
		encoding: "utf8" as const,
		timeout: 2000,
	};

	try {
		let raw: string;

		if (event === "pre-commit") {
			raw = execFileSync("git", ["diff", "--cached", "--numstat"], gitOpts);
		} else {
			// pre-push or pre-pr: diff against the merge-base with the upstream tip.
			let base = "";
			for (const ref of ["origin/HEAD", "origin/main", "main"]) {
				try {
					base = execFileSync("git", ["merge-base", "HEAD", ref], gitOpts).trim();
					if (base) break;
				} catch {
					// try next ref
				}
			}

			if (!base) {
				// Final fallback: staged diff.
				try {
					raw = execFileSync("git", ["diff", "--cached", "--numstat"], gitOpts);
					return parseNumstat(raw);
				} catch {
					return null;
				}
			}

			raw = execFileSync("git", ["diff", "--numstat", `${base}...HEAD`], gitOpts);
		}

		return parseNumstat(raw);
	} catch {
		return null;
	}
}

/**
 * Runs the review gate for a bash command. Returns a block result for strong
 * mode, notifies for advisory mode, or returns undefined to fall through to the
 * next guard.
 */
export async function applyReviewGate(
	command: string,
	ctx: ExtensionContext,
): Promise<ToolCallEventResult | undefined> {
	const event = classifyReviewEvent(command);
	if (!event) return undefined;

	const diff = computeDiffForEvent(event, ctx.cwd);
	if (!diff) return undefined;

	const result = evaluateEvent(event, diff);
	if (!result) return undefined;

	if (result.mode === "advisory") {
		if (ctx.hasUI) {
			const commitOrPush = event === "pre-push" ? "this push" : "this commit";
			ctx.ui.notify(
				`Review suggestion: consider running agent "${result.run.join(", ")}" before ${commitOrPush}. ${result.reason}`,
				"info",
			);
		}
		return undefined;
	}

	return {
		block: true,
		reason:
			`4R review gate: run ${result.run.join(", ")} before this command. ` +
			result.reason,
	};
}

export default function reviewGate(pi: ExtensionAPI): void {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command: unknown = event.input.command;
		if (typeof command !== "string") return undefined;

		return applyReviewGate(command, ctx);
	});
}
