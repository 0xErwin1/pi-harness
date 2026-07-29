import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	discoverAndLoadExtensions,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PACKAGE_ROOT = resolve(REPO_ROOT, "node_modules/pi-subagents-j0k3r");

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
