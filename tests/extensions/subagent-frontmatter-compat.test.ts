import test from "node:test";
import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	existsSync,
	lstatSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	writeAgentFrontmatterProfile,
} from "../../vendor/pi-subagents/j0k3r/src/agent-frontmatter.ts";
import { loadSubagents, readSubagentsConfig } from "../../vendor/pi-subagents/j0k3r/src/config.ts";
import { buildModelProfileRows, commitStagedModelProfiles } from "../../vendor/pi-subagents/j0k3r/src/model-profiles-ui.ts";
import { resolveEffectiveSubagentProfile } from "../../vendor/pi-subagents/j0k3r/src/profile-resolver.ts";

function withTempDir(run: (dir: string) => void | Promise<void>) {
	const dir = mkdtempSync(join(tmpdir(), "pi-harness-frontmatter-"));
	return Promise.resolve(run(dir)).finally(() => {
		rmSync(dir, { recursive: true, force: true });
	});
}

test("writeAgentFrontmatterProfile upserts model and thinking without touching the body", async () => {
	await withTempDir((dir) => {
		const file = join(dir, "auditor.md");
		writeFileSync(
			file,
			"---\ndescription: Security Auditor\nmodel: anthropic/claude-sonnet-4\n---\n\nAudit the change.\n",
		);

		writeAgentFrontmatterProfile({
			filePath: file,
			model: { provider: "openai", id: "gpt-5" },
			thinking: "high",
		});

		const updated = readFileSync(file, "utf8");
		assert.match(updated, /^---\ndescription: Security Auditor\nmodel: openai\/gpt-5\nthinking: high\n---\n\nAudit the change\.\n$/);
	});
});

test("writeAgentFrontmatterProfile removes inherited model and thinking fields", async () => {
	await withTempDir((dir) => {
		const file = join(dir, "auditor.md");
		writeFileSync(
			file,
			"---\nmodel: openai/gpt-5\nthinking: high\n---\n\nAudit the change.\n",
		);

		writeAgentFrontmatterProfile({ filePath: file });

		assert.equal(readFileSync(file, "utf8"), "Audit the change.\n");
	});
});

test("writeAgentFrontmatterProfile writes through symlinks to the backing markdown file", async () => {
	await withTempDir((dir) => {
		const targetDir = join(dir, "repo", "assets", "agents");
		const linkDir = join(dir, "home", ".pi", "agent", "agents");
		mkdirSync(targetDir, { recursive: true });
		mkdirSync(linkDir, { recursive: true });
		const target = join(targetDir, "reviewer.md");
		const link = join(linkDir, "reviewer.md");
		writeFileSync(target, "---\ndescription: Reviewer\n---\n\nReview the patch.\n");
		symlinkSync(target, link);

		writeAgentFrontmatterProfile({
			filePath: link,
			model: { provider: "anthropic", id: "claude-sonnet-4" },
			thinking: "medium",
		});

		assert.equal(lstatSync(link).isSymbolicLink(), true);
		const updatedTarget = readFileSync(target, "utf8");
		assert.match(updatedTarget, /model: anthropic\/claude-sonnet-4/);
		assert.match(updatedTarget, /thinking: medium/);
	});
});

test("commitStagedModelProfiles keeps global file-backed saves out of project-local subagents.json", async () => {
	await withTempDir((dir) => {
		const agentDir = join(dir, "agent-home");
		const cwd = join(dir, "workspace");
		const globalAgentsDir = join(agentDir, "agents");
		mkdirSync(globalAgentsDir, { recursive: true });
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		const file = join(globalAgentsDir, "researcher.md");
		const projectConfig = join(cwd, ".pi", "subagents.json");
		writeFileSync(file, "---\ndescription: Researcher\n---\n\nResearch the topic.\n");
		writeFileSync(
			projectConfig,
			JSON.stringify({ model_profiles: { researcher: { model: "anthropic/claude-haiku-4", effort: "low" } } }, null, 2),
		);

		const message = commitStagedModelProfiles({
			stagedProfiles: { researcher: { model: { provider: "openai", id: "gpt-5" }, effort: "high" } },
			save: true,
			agentDir,
			cwd,
			persistenceTargets: {
				researcher: { mode: "frontmatter", filePath: file, scope: "global" },
			},
		});

		assert.match(message, /researcher\.md/);
		assert.match(readFileSync(file, "utf8"), /model: openai\/gpt-5/);
		assert.match(readFileSync(file, "utf8"), /thinking: high/);
		assert.match(readFileSync(projectConfig, "utf8"), /anthropic\/claude-haiku-4/);
		assert.match(readFileSync(projectConfig, "utf8"), /"low"/);
	});
});

test("commitStagedModelProfiles reports writeback failures without clearing existing JSON overrides", async () => {
	await withTempDir((dir) => {
		const agentDir = join(dir, "agent-home");
		const cwd = join(dir, "workspace");
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		const projectConfig = join(cwd, ".pi", "subagents.json");
		writeFileSync(
			projectConfig,
			JSON.stringify({ model_profiles: { reviewer: { model: "anthropic/claude-haiku-4", effort: "low" } } }, null, 2),
		);

		assert.throws(
			() =>
				commitStagedModelProfiles({
					stagedProfiles: { reviewer: { model: { provider: "openai", id: "gpt-5" }, effort: "high" } },
					save: true,
					agentDir,
					cwd,
					persistenceTargets: {
						reviewer: {
							mode: "frontmatter",
							filePath: join(agentDir, "agents", "missing.md"),
							scope: "global",
						},
					},
				}),
			/error saving model\/thinking assignment for reviewer/i,
		);
		assert.match(readFileSync(projectConfig, "utf8"), /anthropic\/claude-haiku-4/);
		assert.match(readFileSync(projectConfig, "utf8"), /"low"/);
	});
});

test("frontmatter assignments stay authoritative for global file-backed agents on subsequent launches", async () => {
	await withTempDir((dir) => {
		const agentDir = join(dir, "agent-home");
		const cwd = join(dir, "workspace");
		const globalAgentsDir = join(agentDir, "agents");
		mkdirSync(globalAgentsDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });
		const file = join(globalAgentsDir, "sdd-apply.md");
		writeFileSync(file, "---\ndescription: Apply agent\n---\n\nImplement the change.\n");
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "subagents.json"),
			JSON.stringify(
				{
					model_profiles: {
						"sdd-apply": {
							model: "anthropic/claude-haiku-4",
							effort: "low",
						},
					},
				},
				null,
				2,
			),
		);
		const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		try {
			writeAgentFrontmatterProfile({
				filePath: file,
				model: { provider: "openai", id: "gpt-5" },
				thinking: "xhigh",
			});

			const definition = loadSubagents(cwd).find((entry) => entry.name === "sdd-apply");
			assert.ok(definition);
			assert.deepEqual(definition.model, { provider: "openai", id: "gpt-5" });
			assert.equal(definition.effort, "xhigh");

			const resolved = resolveEffectiveSubagentProfile({
				agentName: definition.name,
				definition,
				config: readSubagentsConfig(cwd),
				ctx: {},
			});
			assert.deepEqual(resolved.model.value, { provider: "openai", id: "gpt-5" });
			assert.equal(resolved.model.source, "definition");
			assert.equal(resolved.effort.value, "xhigh");
			assert.equal(resolved.effort.source, "definition");
		} finally {
			if (previousAgentDir == null) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		}
	});
});

test("synthetic SDD rows use canonical phase names without proposal/task duplicates", () => {
	const rows = buildModelProfileRows({ definitions: [], config: readSubagentsConfig("/tmp/nonexistent-pi-harness"), ctx: {} });
	const names = rows.map((row) => row.name);

	assert.ok(names.includes("sdd-propose"));
	assert.ok(names.includes("sdd-tasks"));
	assert.equal(names.includes("sdd-proposal"), false);
	assert.equal(names.includes("sdd-task"), false);
});

test("project-backed agent assignments persist globally and resolve across projects", async () => {
	await withTempDir((dir) => {
		const agentDir = join(dir, "agent-home");
		const workspaceA = join(dir, "workspace-a");
		const workspaceB = join(dir, "workspace-b");
		const projectAgentA = join(workspaceA, ".pi", "agents", "reviewer.md");
		const projectAgentB = join(workspaceB, ".pi", "agents", "reviewer.md");
		mkdirSync(join(workspaceA, ".pi", "agents"), { recursive: true });
		mkdirSync(join(workspaceB, ".pi", "agents"), { recursive: true });
		writeFileSync(projectAgentA, "---\ndescription: Reviewer\nmodel: anthropic/claude-sonnet-4\nthinking: low\n---\n\nReview the patch.\n");
		writeFileSync(projectAgentB, "---\ndescription: Reviewer\n---\n\nReview the patch.\n");
		const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		try {
			const message = commitStagedModelProfiles({
				stagedProfiles: { reviewer: { model: { provider: "openai", id: "gpt-5" }, effort: "high" } },
				save: true,
				agentDir,
				cwd: workspaceA,
				persistenceTargets: {
					reviewer: { mode: "frontmatter", filePath: projectAgentA, scope: "project" },
				},
			});

			assert.match(message, /subagents\.json/);
			assert.equal(readFileSync(projectAgentA, "utf8").includes("openai/gpt-5"), false);
			assert.equal(existsSync(join(workspaceA, ".pi", "subagents.json")), false);
			assert.match(readFileSync(join(agentDir, "subagents.json"), "utf8"), /openai\/gpt-5/);
			assert.match(readFileSync(join(agentDir, "subagents.json"), "utf8"), /"high"/);

			const definitionA = loadSubagents(workspaceA).find((entry) => entry.name === "reviewer");
			const definitionB = loadSubagents(workspaceB).find((entry) => entry.name === "reviewer");
			assert.ok(definitionA);
			assert.ok(definitionB);

			const resolvedA = resolveEffectiveSubagentProfile({
				agentName: definitionA.name,
				definition: definitionA,
				config: readSubagentsConfig(workspaceA),
				ctx: {},
			});
			const resolvedB = resolveEffectiveSubagentProfile({
				agentName: definitionB.name,
				definition: definitionB,
				config: readSubagentsConfig(workspaceB),
				ctx: {},
			});
			assert.deepEqual(resolvedA.model.value, { provider: "openai", id: "gpt-5" });
			assert.equal(resolvedA.model.source, "profile");
			assert.equal(resolvedA.effort.value, "high");
			assert.equal(resolvedA.effort.source, "profile");
			assert.deepEqual(resolvedB.model.value, { provider: "openai", id: "gpt-5" });
			assert.equal(resolvedB.model.source, "profile");
			assert.equal(resolvedB.effort.value, "high");
			assert.equal(resolvedB.effort.source, "profile");
		} finally {
			if (previousAgentDir == null) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		}
	});
});
