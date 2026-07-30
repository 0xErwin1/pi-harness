import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const assetRoot = new URL("../../assets/", import.meta.url);
const agentsDir = join(assetRoot.pathname, "agents");
const chainsDir = join(assetRoot.pathname, "chains");

function readAsset(relativePath: string): string {
	return readFileSync(join(assetRoot.pathname, relativePath), "utf8");
}

function sddAgentAssets(): Array<{ path: string; content: string }> {
	return readdirSync(agentsDir)
		.filter((name) => /^sdd-.*\.md$/.test(name))
		.map((name) => ({ path: `agents/${name}`, content: readFileSync(join(agentsDir, name), "utf8") }));
}

function sddChainAssets(): Array<{ path: string; content: string }> {
	return readdirSync(chainsDir)
		.filter((name) => /^sdd-.*\.chain\.md$/.test(name))
		.map((name) => ({ path: `chains/${name}`, content: readFileSync(join(chainsDir, name), "utf8") }));
}

function readFrontmatter(path: string): string {
	const text = readFileSync(path, "utf8");
	const match = text.match(/^---\n([\s\S]*?)\n---/);
	assert.ok(match, `${path} must have YAML frontmatter`);
	return match[1];
}

function readTools(path: string): string[] {
	const frontmatter = readFrontmatter(path);
	const lines = frontmatter.split("\n");
	const toolsIndex = lines.findIndex((line) => line === "tools:");
	assert.notEqual(toolsIndex, -1, `${path} must declare tools as a YAML array`);
	assert.equal(lines.find((line) => /^tools:\s+/.test(line)), undefined, `${path} must not declare scalar tools`);

	const tools: string[] = [];
	for (const line of lines.slice(toolsIndex + 1)) {
		if (!line.startsWith("  - ")) break;
		tools.push(line.slice(4).trim());
	}
	assert.ok(tools.length > 0, `${path} must declare at least one tool`);
	return tools;
}

const atlasDocumentTools = [
	"atlas_search",
	"atlas_list_workspaces",
	"atlas_list_projects",
	"atlas_list_folders",
	"atlas_list_documents",
	"atlas_get_document",
	"atlas_create_folder",
	"atlas_create_document",
	"atlas_update_document_content",
];

const requiredSddToolsByAgent: Record<string, string[]> = {
	"sdd-apply.md": ["read", "grep", "glob", "edit", "write", "bash", "mem_search", "mem_get_observation", "mem_save", "mem_update"],
	"sdd-archive.md": ["read", "grep", "glob", "edit", "write", "bash", "mem_search", "mem_get_observation", "mem_save"],
	"sdd-design.md": ["read", "grep", "glob", "edit", "write", "mem_search", "mem_get_observation", "mem_save"],
	"sdd-explore.md": ["read", "grep", "glob", "webfetch", "mem_save"],
	"sdd-explore-testing.md": ["read", "grep", "glob", "webfetch", "mem_search", "mem_get_observation", "mem_save"],
	"sdd-init.md": ["read", "grep", "glob", "write", "bash", "mem_search", "mem_get_observation", "mem_save", "mem_update"],
	"sdd-onboard.md": ["read", "grep", "glob", "edit", "write", "bash", "mem_search", "mem_get_observation", "mem_save", "mem_update"],
	"sdd-plan-testing.md": ["read", "grep", "glob", "mem_search", "mem_get_observation", "mem_save"],
	"sdd-propose.md": ["read", "grep", "glob", "edit", "write", "mem_search", "mem_get_observation", "mem_save"],
	"sdd-report-testing.md": ["read", "mem_search", "mem_get_observation", "mem_save"],
	"sdd-run-testing.md": ["read", "grep", "glob", "bash", "edit", "write", "webfetch", "mem_search", "mem_get_observation", "mem_save"],
	"sdd-spec.md": ["read", "grep", "glob", "edit", "write", "mem_search", "mem_get_observation", "mem_save"],
	"sdd-sync.md": ["read", "grep", "glob", "edit", "write", "bash", "mem_search", "mem_get_observation", "mem_save", "mem_update"],
	"sdd-tasks.md": ["read", "grep", "glob", "edit", "write", "mem_search", "mem_get_observation", "mem_save"],
	"sdd-verify.md": ["read", "grep", "glob", "bash", "edit", "write", "mem_search", "mem_get_observation", "mem_save"],
};

test("SDD agent assets use Atlas as the new human artifact default and Engram as memory", () => {
	for (const asset of sddAgentAssets()) {
		assert.match(
			asset.content,
			/Atlas is the default\/new human-facing detailed artifact workspace for new SDD flows\./,
			`${asset.path} must name the Atlas default human workspace`,
		);
		assert.match(
			asset.content,
			/Engram is the mandatory agent memory and pointer store/i,
			`${asset.path} must name Engram's memory role`,
		);
		assert.match(
			asset.content,
			/logical path `sdd\/<change>\/<phase>\.md`/,
			`${asset.path} must state the phase logical path contract`,
		);
	}
});

test("SDD assets do not describe Obsidian or OpenSpec files as the default store", () => {
	const assets = [
		{ path: "orchestrator.md", content: readAsset("orchestrator.md") },
		// The Artifact Store Policy section relocated to the persistence lazy
		// file (see disposition #10033 WU8: lines 413-423).
		{ path: "orchestrator/persistence.md", content: readAsset("orchestrator/persistence.md") },
		{ path: "support/atlas-persistence-contract.md", content: readAsset("support/atlas-persistence-contract.md") },
		...sddAgentAssets(),
		...sddChainAssets(),
	];

	for (const asset of assets) {
		assert.doesNotMatch(
			asset.content,
			/Use Engram and Obsidian as the normal persistence backends\.|Engram \+ Obsidian native|default Obsidian SDD artifact store|between Obsidian and Engram|in Obsidian and Engram|write OpenSpec files/i,
			`${asset.path} must frame Obsidian and OpenSpec files only as explicit fallback/opt-in, not default`,
		);
	}

	assert.match(
		readAsset("orchestrator/persistence.md"),
		/Atlas is the default\/new human-facing detailed artifact workspace for new SDD flows/i,
	);
	assert.match(
		readAsset("support/atlas-persistence-contract.md"),
		/For new SDD flows, Atlas is the default human-facing detailed artifact workspace/i,
	);
});

test("sdd-tasks leaves explicitly approved human Atlas task tracking to the parent", () => {
	const content = readAsset("agents/sdd-tasks.md");

	assert.match(content, /SddTasksAtlasContract/);
	assert.match(content, /Human Atlas task tracking remains explicit and parent-owned/i);
	assert.match(content, /MUST NOT create, update, move, label, hydrate, or otherwise mutate human Atlas tasks/i);
	assert.match(content, /even when task tracking is approved/i);
	assert.match(content, /Engram pointer fields/i);
	assert.doesNotMatch(content, /atlas_get_task/);
});

test("SDD-testing agents define the concrete TestingPersistenceContract authority model", () => {
	const testingAgents = sddAgentAssets().filter((asset) => /sdd-(explore|plan|run|report)-testing\.md$/.test(asset.path));

	assert.equal(testingAgents.length, 4);
	for (const asset of testingAgents) {
		assert.match(asset.content, /"contractName": "TestingPersistenceContract"/, `${asset.path} must include the concrete contract JSON`);
		assert.match(asset.content, /"agentOrchestratorSourceOfTruth": "engram"/, `${asset.path} must make Engram the agent\/orchestrator source of truth`);
		assert.match(asset.content, /"humanReadableDocumentationMirror": "atlas"/, `${asset.path} must make Atlas the human-readable mirror`);
		assert.match(asset.content, /"ifEngramUnavailable": "blocked"/, `${asset.path} must block when Engram is unavailable`);
		assert.match(asset.content, /"ifAtlasUnavailableOrUnapproved": "save-allowed-engram-artifact-or-pointer-and-return-partial"/, `${asset.path} must define Atlas fallback behavior`);
	}
});

test("SDD-testing assets and support docs use provider-neutral Pi tool names", () => {
	const testingAssets = [
		...sddAgentAssets().filter((asset) => /sdd-(explore|plan|run|report)-testing\.md$/.test(asset.path)),
		{ path: "support/setup-testing.md", content: readAsset("support/setup-testing.md") },
		{ path: "support/sdd-testing-context.md", content: readAsset("support/sdd-testing-context.md") },
		{ path: "support/visual-diff.md", content: readAsset("support/visual-diff.md") },
	];

	assert.equal(testingAssets.length, 7);
	for (const asset of testingAssets) {
		assert.doesNotMatch(
			asset.content,
			/\bmcp__[A-Za-z0-9_]+/,
			`${asset.path} must not reference provider-specific MCP tool names`,
		);
	}
});

test("review assets require findings ledgers instead of No findings wording", () => {
	const assets = [
		"agents/review-risk.md",
		"agents/review-readability.md",
		"agents/review-reliability.md",
		"agents/review-resilience.md",
		"chains/4r-review.chain.md",
		// The 4R Review section relocated to the review lazy file (see
		// disposition #10033 WU8: lines 673-708).
		"orchestrator/review.md",
	];
	const schemaFields = [
		"`severity`",
		"`status`",
		"`finding_id`",
		"`source`",
		"`summary`",
		"`evidence`",
		"`affected_files`",
		"`owner`",
		"`created_at`",
		"`resolved_at`",
	];

	for (const assetPath of assets) {
		const content = readAsset(assetPath);
		assert.doesNotMatch(content, /If clean, say exactly: `?No findings\.`?/i, `${assetPath} must not use old clean-output wording`);
		assert.match(content, /empty ledger record with zero rows|zero rows rather than skip ledger output/i, `${assetPath} must require empty ledger output when clean`);
		for (const field of schemaFields) {
			assert.match(content, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${assetPath} missing ledger field ${field}`);
		}
	}
});

test("SDD package agents declare role-appropriate tools as YAML arrays", () => {
	for (const [fileName, requiredTools] of Object.entries(requiredSddToolsByAgent)) {
		const path = join(agentsDir, fileName);
		assert.ok(existsSync(path), `${fileName} must exist`);
		const tools = readTools(path);
		for (const tool of requiredTools) {
			assert.ok(tools.includes(tool), `${fileName} must include ${tool}`);
		}
		for (const tool of tools) {
			assert.ok(!tool.startsWith("subagent_"), `${fileName} must not allow child subagent tool ${tool}`);
		}
	}
});

test("directly persisting SDD agents grant exactly the Atlas document CAS allowlist", () => {
	for (const fileName of Object.keys(requiredSddToolsByAgent)) {
		const tools = readTools(join(agentsDir, fileName));
		const atlasTools = tools.filter((tool) => tool.startsWith("atlas_"));
		assert.deepEqual(atlasTools, atlasDocumentTools, `${fileName} must receive document persistence tools only`);
	}
});

test("SDD Atlas persistence contracts use the public document CAS API and fail closed", () => {
	const contractAssets = [
		...sddAgentAssets(),
		{ path: "support/atlas-persistence-contract.md", content: readAsset("support/atlas-persistence-contract.md") },
		{ path: "orchestrator/persistence.md", content: readAsset("orchestrator/persistence.md") },
	];

	for (const asset of contractAssets) {
		assert.match(
			asset.content,
			/atlas_get_document[\s\S]*head_revision_id[\s\S]*atlas_update_document_content[\s\S]*base_revision_id/,
			`${asset.path} must spell out the document CAS sequence`,
		);
		assert.match(
			asset.content,
			/conflict[\s\S]*(?:partial|blocked)[\s\S]*never overwrite/i,
			`${asset.path} must fail closed on an Atlas conflict`,
		);
		assert.match(
			asset.content,
			/Engram (?:Atlas )?pointer only after (?:a )?successful Atlas (?:creation or update|write)/i,
			`${asset.path} must order the Engram pointer after Atlas success`,
		);
		assert.doesNotMatch(asset.content, /\batlas_update_document\b/, `${asset.path} must not name a nonexistent Atlas tool`);
	}
});

test("Atlas support publishes the exact normal SDD document tool surface", () => {
	const support = readAsset("support/atlas-persistence-contract.md");
	const match = support.match(/## Normal SDD Phase Document Allowlist\n([\s\S]*?)(?=\n## )/);
	assert.ok(match, "Atlas support must define the normal SDD phase document allowlist");
	const tools = [...match[1].matchAll(/`(atlas_[a-z_]+)`/g)].map((entry) => entry[1]);

	assert.deepEqual([...new Set(tools)], atlasDocumentTools);
});

test("project does not ship local SDD agent overrides", () => {
	const repoRoot = new URL("../../", import.meta.url).pathname;
	for (const relativeDir of [join(".pi", "agents"), join(".pi", "subagents")]) {
		const dir = join(repoRoot, relativeDir);
		if (!existsSync(dir)) continue;
		const overrides = readdirSync(dir).filter((entry) => /^sdd-.*\.md$/i.test(entry));
		assert.deepEqual(overrides, [], `${relativeDir} must not shadow package SDD agents`);
	}
});

const normalSddExecutionAssets = [
	"agents/sdd-tasks.md",
	"agents/sdd-apply.md",
	"agents/sdd-verify.md",
	"chains/sdd-plan.chain.md",
	"chains/sdd-full.chain.md",
	"chains/sdd-verify.chain.md",
];

const deliveryAndAutomaticReviewPolicy =
	/Review Workload Forecast|Decision needed before apply|Chained PRs recommended|Chain strategy|400-line|delivery strategy|PR boundary|PR split recommendation|review workload|review\/judgment blockers|fresh reviewer|automatic review/i;

test("normal SDD phase agents and chains stay demand-driven", () => {
	for (const assetPath of normalSddExecutionAssets) {
		assert.doesNotMatch(
			readAsset(assetPath),
			deliveryAndAutomaticReviewPolicy,
			`${assetPath} must not impose delivery policy or automatic review on normal SDD execution`,
		);
	}

	assert.match(readAsset("agents/sdd-tasks.md"), /RED → GREEN → TRIANGULATE → REFACTOR/);
	assert.match(readAsset("agents/sdd-apply.md"), /TDD Cycle Evidence/);
	assert.match(readAsset("chains/sdd-full.chain.md"), /strict TDD/i);
});

test("standard SDD verification is conformance-only with anchored lifecycle output", () => {
	const agent = readAsset("agents/sdd-verify.md");
	const chains = [readAsset("chains/sdd-full.chain.md"), readAsset("chains/sdd-verify.chain.md")];

	assert.match(agent, /standard SDD verification is conformance-only/i);
	assert.match(agent, /^lifecycle_status: passed\|failed\|blocked\|partial$/m);
	assert.match(agent, /exactly one `lifecycle_status` line at column 1/i);
	for (const chain of chains) {
		assert.match(chain, /conformance-only/i);
	}
});

test("explicit review protocols and chained planning remain available outside normal SDD", () => {
	const reviewPolicy = readAsset("orchestrator/review.md");
	const reviewChain = readAsset("chains/4r-review.chain.md");

	assert.match(reviewPolicy, /Judgment Day/);
	assert.match(reviewPolicy, /`4r-review` chain/);
	assert.match(reviewPolicy, /Maximum 2 fix rounds per review/);
	assert.match(reviewPolicy, /Scoped re-review/);
	assert.match(reviewChain, /findings ledger rows/i);
	assert.match(readAsset("agents/jd-fix-agent.md"), /confirmed Judgment Day findings only/);
	assert.match(readAsset("orchestrator/skills.md"), /\| Split\/stack\/large PR\s+\| `chained-pr`/);
});

test("repository does not embed a machine-specific SDD skill root", () => {
	const repoRoot = new URL("../../", import.meta.url).pathname;
	const machineSpecificRoot = ["", "home", "iperez", ".tabularium", "AI", "skills"].join("/") + "/";
	const trackedFiles = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
		.split("\0")
		.filter(Boolean);
	const offenders = trackedFiles.filter((relativePath) =>
		readFileSync(join(repoRoot, relativePath), "utf8").includes(machineSpecificRoot),
	);

	assert.deepEqual(offenders, []);
});
