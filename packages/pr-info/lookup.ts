import type { PrInfoPayload } from "../events/index.ts";

/** The subset of `pi.exec` this lookup needs, injectable for tests. */
export interface PrExec {
	(command: string, args: string[]): Promise<{ code: number; stdout: string }>;
}

export interface PrLookupDeps {
	cwd: string;
	exec: PrExec;
}

const GH_JSON_FIELDS = "number,url,state,isDraft";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Parses `gh pr view --json number,url,state,isDraft` output into a PR payload.
 * Only an OPEN PR with a numeric id and a url is accepted; anything else — a
 * closed/merged PR, missing fields, or non-JSON — yields `null`.
 */
export function parsePrView(stdout: string): PrInfoPayload | null {
	let value: unknown;
	try {
		value = JSON.parse(stdout);
	} catch {
		return null;
	}

	if (!isRecord(value)) return null;
	if (typeof value.number !== "number") return null;
	if (typeof value.url !== "string") return null;
	if (value.state !== "OPEN") return null;

	return {
		number: value.number,
		url: value.url,
		isDraft: value.isDraft === true,
	};
}

/**
 * Runs `gh pr view` for the current branch and returns the open PR, or `null`
 * when there is none, `gh` is absent/unauthenticated, or the lookup fails. Every
 * failure is swallowed: no error, stderr, or stack trace escapes.
 */
export async function lookupPr(deps: PrLookupDeps): Promise<PrInfoPayload | null> {
	try {
		const result = await deps.exec("gh", ["pr", "view", "--json", GH_JSON_FIELDS]);
		if (result.code !== 0) return null;

		return parsePrView(result.stdout);
	} catch {
		return null;
	}
}
