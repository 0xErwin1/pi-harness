import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const orchestrator = readFileSync(join(repoRoot, "assets", "orchestrator.md"), "utf8");
const reviewPolicy = readFileSync(join(repoRoot, "assets", "orchestrator", "review.md"), "utf8");
const sddWorkflow = readFileSync(join(repoRoot, "assets", "orchestrator", "sdd-workflow.md"), "utf8");
const skillsPolicy = readFileSync(join(repoRoot, "assets", "orchestrator", "skills.md"), "utf8");

function sectionBetween(content: string, start: string, end: string): string {
	const startIndex = content.indexOf(start);
	const endIndex = content.indexOf(end, startIndex + start.length);

	assert.notEqual(startIndex, -1, `missing section start: ${start}`);
	assert.notEqual(endIndex, -1, `missing section end: ${end}`);
	return content.slice(startIndex, endIndex);
}

test("normal parent orchestration does not activate review or delivery policy", () => {
	assert.doesNotMatch(orchestrator, /fresh-context review/i);
	assert.doesNotMatch(orchestrator, /high-review-risk|reviewer burden/i);
	assert.doesNotMatch(orchestrator, /^## Review Workload Guard$/m);
	assert.doesNotMatch(orchestrator, /\bdelivery_strategy\b|\bchain_strategy\b/);
});

test("the review compatibility surface stays silent until the user requests review", () => {
	assert.match(reviewPolicy, /Only the user starts one\./);
	assert.match(reviewPolicy, /compatibility module loads without registering handlers/i);
	assert.doesNotMatch(reviewPolicy, /one-line optional offer/i);
	assert.doesNotMatch(reviewPolicy, /watches `bash` calls|notifies the user to consider/i);
});

test("explicit review protocols retain their bounded ledger and re-review behavior", () => {
	assert.match(reviewPolicy, /^### Judgment Day$/m);
	assert.match(reviewPolicy, /^### 4R$/m);
	assert.match(reviewPolicy, /^### Review Ledger$/m);
	assert.match(reviewPolicy, /Maximum 2 fix rounds per review/);
	assert.match(reviewPolicy, /^\*\*Scoped re-review\.\*\*/m);
	assert.match(reviewPolicy, /`4r-review` chain/);
	assert.match(skillsPolicy, /\| Split\/stack\/large PR\s+\| `chained-pr`/);
});

test("SDD scope validation uses working-tree and artifact evidence", () => {
	const scopePolicy = sectionBetween(sddWorkflow, "### Apply Scope Contract", "### Visual-Aware Apply Split");

	assert.match(scopePolicy, /git status and git diff/);
	assert.match(scopePolicy, /changed files/);
	assert.match(scopePolicy, /tasks artifact/);
	assert.match(scopePolicy, /apply-progress/);
	assert.doesNotMatch(scopePolicy, /\bcommits?\b|delivery\/chain decision/i);
});

test("SDD batching exists only for executor context and dependency safety", () => {
	const batchingPolicy = sectionBetween(sddWorkflow, "### Batched Apply-Verify Cycles", "## SDD Status Contract");

	assert.match(batchingPolicy, /executor context/i);
	assert.match(batchingPolicy, /task dependencies/i);
	assert.doesNotMatch(
		batchingPolicy,
		/changed-line|400|commit per batch|feature\/work branch|default branch|do not push|open a PR|delivery\/chained-PR|PR slices/i,
	);
});

test("automatic SDD gatekeeping validates inline without launching a fresh review", () => {
	const gatekeeperPolicy = sectionBetween(sddWorkflow, "### Automatic Mode Gatekeeper", "## Strict TDD Forwarding");

	assert.match(gatekeeperPolicy, /does not launch review/i);
	assert.doesNotMatch(gatekeeperPolicy, /fresh-context review|Review Workload Guard/i);
});
