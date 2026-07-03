import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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
