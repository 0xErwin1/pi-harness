/**
 * 4R review gate for Pi.
 *
 * Intercepts `bash` tool calls that look like git/gh workflow events and applies
 * the trigger rules in `../lib/review-triggers.ts`:
 *
 *   - pre-commit / pre-push  → advisory: notify a single cheap review lens, never block.
 *   - pre-pr (`gh pr create`) → strong: block when the diff touches hot paths
 *                               (auth/update/security/payments) or exceeds the
 *                               large-diff threshold, naming the 4R lenses to run first.
 *
 * The gate is fail-open: any error gathering the diff returns `undefined` so a
 * git/gh command is never broken by this guard. It composes with `shell-guard`
 * (each extension registers its own `tool_call` handler; the first block wins).
 */
import { execFileSync } from "node:child_process";

import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEventResult,
} from "@mariozechner/pi-coding-agent";

import { evaluateEvent } from "../lib/review-triggers.ts";
import type { ChangedDiff, TriggerEvent } from "../lib/review-triggers.ts";

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
