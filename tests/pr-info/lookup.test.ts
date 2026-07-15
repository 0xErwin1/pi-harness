import test from "node:test";
import assert from "node:assert/strict";

import { lookupPr, parsePrView } from "../../packages/pr-info/lookup.ts";

const OPEN_PR = JSON.stringify({
	number: 42,
	url: "https://github.com/acme/repo/pull/42",
	state: "OPEN",
	isDraft: false,
});

test("parsePrView returns the payload for an open PR", () => {
	assert.deepEqual(parsePrView(OPEN_PR), {
		number: 42,
		url: "https://github.com/acme/repo/pull/42",
		isDraft: false,
	});
});

test("parsePrView returns null for a non-open PR state", () => {
	const merged = JSON.stringify({ number: 1, url: "https://x/1", state: "MERGED", isDraft: false });
	assert.equal(parsePrView(merged), null);
});

test("parsePrView returns null for missing fields or invalid JSON", () => {
	assert.equal(parsePrView("{}"), null);
	assert.equal(parsePrView("not json"), null);
	assert.equal(parsePrView(""), null);
});

test("lookupPr returns the parsed PR when gh exits 0", async () => {
	const pr = await lookupPr({
		cwd: "/repo",
		exec: async () => ({ code: 0, stdout: OPEN_PR }),
	});

	assert.deepEqual(pr, {
		number: 42,
		url: "https://github.com/acme/repo/pull/42",
		isDraft: false,
	});
});

test("lookupPr returns null when gh exits non-zero (no PR / unauthenticated)", async () => {
	const pr = await lookupPr({
		cwd: "/repo",
		exec: async () => ({ code: 1, stdout: "" }),
	});

	assert.equal(pr, null);
});

test("lookupPr swallows a thrown exec error (gh missing) and returns null", async () => {
	const pr = await lookupPr({
		cwd: "/repo",
		exec: async () => {
			throw new Error("spawn gh ENOENT");
		},
	});

	assert.equal(pr, null);
});

test("lookupPr calls gh pr view with the JSON fields it parses", async () => {
	const calls: Array<{ command: string; args: string[] }> = [];
	await lookupPr({
		cwd: "/repo",
		exec: async (command, args) => {
			calls.push({ command, args });
			return { code: 1, stdout: "" };
		},
	});

	assert.equal(calls.length, 1);
	assert.equal(calls[0]!.command, "gh");
	assert.deepEqual(calls[0]!.args, ["pr", "view", "--json", "number,url,state,isDraft"]);
});
