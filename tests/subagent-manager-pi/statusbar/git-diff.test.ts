import test from "node:test";
import assert from "node:assert/strict";

import { parseShortstat, sumDiffs } from "../../../packages/subagent-manager-pi/statusbar/git-diff.ts";

test("parseShortstat reads both insertions and deletions", () => {
	assert.deepEqual(
		parseShortstat(" 3 files changed, 391 insertions(+), 37 deletions(-)"),
		{ added: 391, removed: 37 },
	);
});

test("parseShortstat handles insertions only", () => {
	assert.deepEqual(parseShortstat(" 1 file changed, 5 insertions(+)"), { added: 5, removed: 0 });
});

test("parseShortstat handles deletions only", () => {
	assert.deepEqual(parseShortstat(" 1 file changed, 2 deletions(-)"), { added: 0, removed: 2 });
});

test("parseShortstat handles a single insertion (no plural)", () => {
	assert.deepEqual(parseShortstat(" 1 file changed, 1 insertion(+)"), { added: 1, removed: 0 });
});

test("parseShortstat returns zeros for empty or no-change input", () => {
	assert.deepEqual(parseShortstat(""), { added: 0, removed: 0 });
	assert.deepEqual(parseShortstat(" 0 files changed"), { added: 0, removed: 0 });
	assert.deepEqual(parseShortstat("garbage line"), { added: 0, removed: 0 });
});

test("sumDiffs adds unstaged and staged counts", () => {
	assert.deepEqual(
		sumDiffs({ added: 391, removed: 37 }, { added: 9, removed: 3 }),
		{ added: 400, removed: 40 },
	);
});

test("sumDiffs with no arguments yields zeros", () => {
	assert.deepEqual(sumDiffs(), { added: 0, removed: 0 });
});
