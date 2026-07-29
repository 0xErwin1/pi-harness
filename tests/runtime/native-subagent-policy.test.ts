import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scoutAgentUrl = new URL("../../assets/agents/scout.md", import.meta.url);
const workerAgentUrl = new URL("../../assets/agents/worker.md", import.meta.url);
const researcherAgentUrl = new URL("../../assets/agents/researcher.md", import.meta.url);
const reviewerAgentUrl = new URL("../../assets/agents/reviewer.md", import.meta.url);
const orchestratorUrl = new URL("../../assets/orchestrator.md", import.meta.url);
const orchestratorSubagentRuntimeUrl = new URL("../../assets/orchestrator/subagent-runtime.md", import.meta.url);

test("generic agent prompts codify compact handoff and completion contracts", async () => {
	const scout = await readFile(scoutAgentUrl, "utf8");
	const worker = await readFile(workerAgentUrl, "utf8");
	const researcher = await readFile(researcherAgentUrl, "utf8");
	const reviewer = await readFile(reviewerAgentUrl, "utf8");
	const orchestrator = await readFile(orchestratorUrl, "utf8");
	const orchestratorSubagentRuntime = await readFile(orchestratorSubagentRuntimeUrl, "utf8");

	for (const heading of ["# Scout Report", "## Answer", "## Relevant Files", "## Change Map", "## Risks / Unknowns", "## Next Reads"]) {
		assert.match(scout, new RegExp(`^${heading.replace(/\//g, "\\/")}$`, "m"));
	}
	assert.match(scout, /under ~80 lines/i);
	assert.match(worker, /## Completion Contract/);
	assert.match(researcher, /## Completion Contract/);
	assert.match(reviewer, /## Completion Contract/);
	assert.match(orchestrator, /Expect `scout` to return `# Scout Report`/);
	assert.match(orchestratorSubagentRuntime, /Do not paste the full parent prompt into child agents/i);
});

test("orchestrator policy delegates only through the native pi-subagents-j0k3r contract", async () => {
	const orchestrator = await readFile(orchestratorUrl, "utf8");
	const runtime = await readFile(orchestratorSubagentRuntimeUrl, "utf8");
	const policy = `${orchestrator}\n${runtime}`;

	assert.match(orchestrator, /official `pi-subagents-j0k3r` package/);
	assert.match(orchestrator, /delegate through `subagent_run`/);
	assert.match(runtime, /^## Harness Subagent Manager Runtime$/m);
	assert.match(runtime, /`subagent_run`[^\n]+`agent`, `task`, and `mode`/);
	assert.match(runtime, /`mode: "task"`[^\n]+result[^\n]+continue routing/i);
	assert.match(runtime, /`mode: "background"`[^\n]+genuinely independent/i);

	for (const tool of [
		"subagent_list_agents",
		"subagent_run",
		"subagent_continue",
		"subagent_status",
		"subagent_result",
		"subagent_list_tasks",
		"subagent_cancel",
	]) {
		assert.match(runtime, new RegExp("`" + tool + "`"), `runtime policy should name ${tool}`);
	}
	assert.match(runtime, /`\/subagents`[^\n]+task\/history UI/i);
	assert.match(runtime, /`\/subagent-models`[^\n]+model\/effort profiles/i);
	assert.match(runtime, /`model_profiles`/);
	assert.match(runtime, /Do not invent launch-time model routing/i);

	assert.doesNotMatch(policy, /`(?:Agent|get_subagent_result|steer_subagent)`/);
	assert.doesNotMatch(policy, /harness-owned (?:`subagent`|subagent tool|manager)/i);
	assert.doesNotMatch(policy, /(?:use|route to|supports?) (?:a )?(?:package )?fallback/i);
});
