import test from "node:test";
import assert from "node:assert/strict";
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
		readAsset("orchestrator.md"),
		/Atlas is the default\/new human-facing detailed artifact workspace for new SDD flows/i,
	);
	assert.match(
		readAsset("support/atlas-persistence-contract.md"),
		/For new SDD flows, Atlas is the default human-facing detailed artifact workspace/i,
	);
});

test("sdd-tasks asset keeps Atlas human task mutation behind explicit approval", () => {
	const content = readAsset("agents/sdd-tasks.md");

	assert.match(content, /SddTasksAtlasContract/);
	assert.match(content, /MUST NOT create, update, move, label, hydrate, or otherwise mutate human Atlas tasks/i);
	assert.match(content, /taskTracking\.approvalState` is `approved`/);
	assert.match(content, /approved vs unapproved human task tracking/i);
	assert.match(content, /Engram pointer fields/i);
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
		"orchestrator.md",
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

test("project does not ship local SDD agent overrides", () => {
	const repoRoot = new URL("../../", import.meta.url).pathname;
	for (const relativeDir of [join(".pi", "agents"), join(".pi", "subagents")]) {
		const dir = join(repoRoot, relativeDir);
		if (!existsSync(dir)) continue;
		const overrides = readdirSync(dir).filter((entry) => /^sdd-.*\.md$/i.test(entry));
		assert.deepEqual(overrides, [], `${relativeDir} must not shadow package SDD agents`);
	}
});
