import test from "node:test";
import assert from "node:assert/strict";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	discoverAndLoadExtensions,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PACKAGE_ROOT = resolve(REPO_ROOT, "node_modules/pi-subagents-j0k3r");
const RETAINED_AGENTS_DIR = resolve(REPO_ROOT, "assets/agents");
const RETAINED_AGENT_FILES = [
	"jd-fix-agent.md",
	"jd-judge-a.md",
	"jd-judge-b.md",
	"researcher.md",
	"review-readability.md",
	"review-reliability.md",
	"review-resilience.md",
	"review-risk.md",
	"reviewer.md",
	"scout.md",
	"sdd-apply.md",
	"sdd-archive.md",
	"sdd-design.md",
	"sdd-explore-testing.md",
	"sdd-explore.md",
	"sdd-init.md",
	"sdd-onboard.md",
	"sdd-plan-testing.md",
	"sdd-propose.md",
	"sdd-report-testing.md",
	"sdd-run-testing.md",
	"sdd-spec.md",
	"sdd-sync.md",
	"sdd-tasks.md",
	"sdd-verify.md",
	"worker.md",
];

const NATIVE_COMMANDS = ["subagents", "subagent-models"];
const NATIVE_TOOLS = [
	"subagent_list_agents",
	"subagent_run",
	"subagent_continue",
	"subagent_status",
	"subagent_result",
	"subagent_list_tasks",
	"subagent_cancel",
];
const LEGACY_SURFACES = ["Agent", "get_subagent_result", "steer_subagent", "agents"];

test("pi-subagents-j0k3r exposes only its native command and tool registrations through Pi's extension loader", async (t) => {
	// Loading the installed package directory exercises its public `pi.extensions`
	// manifest and normal Pi registration boundary without importing internals.
	const agentDir = mkdtempSync(resolve(tmpdir(), "pi-subagents-public-boundary-"));
	t.after(() => rmSync(agentDir, { recursive: true, force: true }));

	const result = await discoverAndLoadExtensions([PACKAGE_ROOT], REPO_ROOT, agentDir);
	assert.deepEqual(result.errors, []);
	assert.equal(result.extensions.length, 1);

	const extension = result.extensions[0];
	assert.ok(extension);

	assert.deepEqual([...extension.commands.keys()].sort(), [...NATIVE_COMMANDS].sort());
	assert.deepEqual([...extension.tools.keys()].sort(), [...NATIVE_TOOLS].sort());

	for (const legacyName of LEGACY_SURFACES) {
		assert.equal(extension.commands.has(legacyName), false);
		assert.equal(extension.tools.has(legacyName), false);
	}
});

test("pi-subagents-j0k3r discovers every retained agent through its public tool boundary without assignments", async (t) => {
	const root = mkdtempSync(resolve(tmpdir(), "pi-subagents-retained-discovery-"));
	const projectDir = join(root, "project");
	const projectAgentDir = join(projectDir, ".pi", "subagents");
	const globalAgentDir = join(root, "global-agent-dir");
	const loaderAgentDir = join(root, "loader-agent-dir");
	mkdirSync(projectAgentDir, { recursive: true });
	mkdirSync(join(globalAgentDir, "agents"), { recursive: true });
	mkdirSync(loaderAgentDir, { recursive: true });
	t.after(() => rmSync(root, { recursive: true, force: true }));

	const retainedFiles = readdirSync(RETAINED_AGENTS_DIR)
		.filter((fileName) => fileName.endsWith(".md"))
		.sort();
	assert.deepEqual(retainedFiles, RETAINED_AGENT_FILES);
	const expectedAgents = retainedFiles.map((fileName) => {
		const source = join(RETAINED_AGENTS_DIR, fileName);
		const contents = readFileSync(source, "utf8");
		const frontmatter = contents.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
		assert.ok(frontmatter, `${fileName} must have YAML frontmatter`);
		assert.doesNotMatch(
			frontmatter,
			/^(?:model|thinking|thinking_level|thinkingLevel|effort):/m,
			`${fileName} must not pin a model or effort in frontmatter`,
		);
		const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim();
		assert.ok(name, `${fileName} must declare an agent name`);
		copyFileSync(source, join(projectAgentDir, fileName));
		return { fileName, name };
	});

	writeFileSync(join(globalAgentDir, "subagents.json"), JSON.stringify({ model_profiles: {} }));
	writeFileSync(join(projectDir, ".pi", "subagents.json"), JSON.stringify({ model_profiles: {} }));

	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const previousHistoryHome = process.env.PI_SUBAGENTS_HISTORY_HOME;
	process.env.PI_CODING_AGENT_DIR = globalAgentDir;
	process.env.PI_SUBAGENTS_HISTORY_HOME = join(root, "history");
	t.after(() => {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		if (previousHistoryHome === undefined) delete process.env.PI_SUBAGENTS_HISTORY_HOME;
		else process.env.PI_SUBAGENTS_HISTORY_HOME = previousHistoryHome;
	});

	// Loading the package root uses its public `pi.extensions` manifest. This test
	// deliberately does not import any of the package's private discovery modules.
	const result = await discoverAndLoadExtensions([PACKAGE_ROOT], projectDir, loaderAgentDir);
	assert.deepEqual(result.errors, []);
	assert.equal(result.extensions.length, 1);
	const listAgents = result.extensions[0]?.tools.get("subagent_list_agents")?.definition;
	assert.ok(listAgents);

	const toolResult = await listAgents.execute(
		"retained-public-boundary-proof",
		{},
		undefined,
		undefined,
		{ cwd: projectDir } as ExtensionContext,
	);
	const details = toolResult.details as {
		agents: Array<{
			name: string;
			filePath: string;
			model?: { provider: string; id: string };
			effort?: string;
		}>;
	};
	const expectedNames = expectedAgents.map(({ name }) => name).sort();
	const actualNames = details.agents.map(({ name }) => name).sort();

	assert.equal(details.agents.length, expectedAgents.length);
	assert.equal(new Set(actualNames).size, actualNames.length, "agent identities must be unique");
	assert.deepEqual(actualNames, expectedNames);
	for (const expected of expectedAgents) {
		const matchingAgents = details.agents.filter(({ name }) => name === expected.name);
		assert.equal(matchingAgents.length, 1, `${expected.name} must be discovered exactly once`);
		assert.equal(matchingAgents[0]?.filePath, join(projectAgentDir, expected.fileName));
		assert.equal(matchingAgents[0]?.model, undefined, `${expected.name} must not resolve a model`);
		assert.equal(matchingAgents[0]?.effort, undefined, `${expected.name} must not resolve effort`);
	}
});

test("pi-subagents-j0k3r discovers isolated global/project Markdown agents and applies scoped model_profiles", async (t) => {
	const root = mkdtempSync(resolve(tmpdir(), "pi-subagents-public-discovery-"));
	const projectDir = join(root, "project");
	const globalAgentDir = join(root, "global-agent-dir");
	const loaderAgentDir = join(root, "loader-agent-dir");
	mkdirSync(join(globalAgentDir, "agents"), { recursive: true });
	mkdirSync(join(projectDir, ".pi", "subagents"), { recursive: true });
	mkdirSync(loaderAgentDir, { recursive: true });
	t.after(() => rmSync(root, { recursive: true, force: true }));

	writeFileSync(
		join(globalAgentDir, "agents", "global-proof.md"),
		"---\nname: global-proof\ndescription: isolated global agent\n---\nGlobal proof instructions.\n",
	);
	writeFileSync(
		join(projectDir, ".pi", "subagents", "project-proof.md"),
		"---\nname: project-proof\ndescription: isolated project agent\n---\nProject proof instructions.\n",
	);
	writeFileSync(
		join(globalAgentDir, "subagents.json"),
		JSON.stringify({
			model_profiles: {
				"global-proof": { model: "anthropic/global-proof-model", effort: "low" },
			},
		}),
	);
	writeFileSync(
		join(projectDir, ".pi", "subagents.json"),
		JSON.stringify({
			model_profiles: {
				"project-proof": { model: "openai/project-proof-model", effort: "high" },
			},
		}),
	);

	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const previousHistoryHome = process.env.PI_SUBAGENTS_HISTORY_HOME;
	process.env.PI_CODING_AGENT_DIR = globalAgentDir;
	process.env.PI_SUBAGENTS_HISTORY_HOME = join(root, "history");
	t.after(() => {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		if (previousHistoryHome === undefined) delete process.env.PI_SUBAGENTS_HISTORY_HOME;
		else process.env.PI_SUBAGENTS_HISTORY_HOME = previousHistoryHome;
	});

	const result = await discoverAndLoadExtensions([PACKAGE_ROOT], projectDir, loaderAgentDir);
	assert.deepEqual(result.errors, []);
	const listAgents = result.extensions[0]?.tools.get("subagent_list_agents")?.definition;
	assert.ok(listAgents);

	// `subagent_list_agents` performs discovery/config resolution without calling a model.
	// Its registered public tool boundary only needs cwd for this operation.
	const toolResult = await listAgents.execute(
		"public-boundary-proof",
		{},
		undefined,
		undefined,
		{ cwd: projectDir } as ExtensionContext,
	);
	const details = toolResult.details as {
		agents: Array<{
			name: string;
			filePath: string;
			model?: { provider: string; id: string };
			effort?: string;
		}>;
	};
	const agents = new Map(details.agents.map((agent) => [agent.name, agent]));

	assert.deepEqual([...agents.keys()].sort(), ["global-proof", "project-proof"]);
	assert.deepEqual(agents.get("global-proof")?.model, {
		provider: "anthropic",
		id: "global-proof-model",
	});
	assert.equal(agents.get("global-proof")?.effort, "low");
	assert.equal(agents.get("global-proof")?.filePath, join(globalAgentDir, "agents", "global-proof.md"));
	assert.deepEqual(agents.get("project-proof")?.model, {
		provider: "openai",
		id: "project-proof-model",
	});
	assert.equal(agents.get("project-proof")?.effort, "high");
	assert.equal(
		agents.get("project-proof")?.filePath,
		join(projectDir, ".pi", "subagents", "project-proof.md"),
	);
});
