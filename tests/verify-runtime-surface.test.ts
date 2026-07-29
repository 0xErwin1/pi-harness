import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = resolve(repoRoot, "scripts/verify-runtime-surface.mjs");
const readRepoFile = (path: string): string => readFileSync(resolve(repoRoot, path), "utf8");

function writeFixtureEntry(root: string, entry: { path: string; kind: "file" | "dir" }) {
	const target = resolve(root, entry.path);
	if (entry.kind === "dir") {
		mkdirSync(target, { recursive: true });
		return;
	}
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, "");
}

test("verify-runtime-surface script passes for the checked-in repo surface", () => {
	const output = execFileSync("node", [scriptPath], {
		cwd: repoRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});

	assert.match(output, /pi-harness runtime surface verified \([0-9]+ entries\)\./);
});

test("verify-runtime-surface tracks lazy command, testing flow, and vendored question files without old subagent paths", () => {
	const script = readRepoFile("scripts/verify-runtime-surface.mjs");

	for (const runtimePath of [
		"assets/agents/sdd-explore-testing.md",
		"assets/agents/sdd-plan-testing.md",
		"assets/agents/sdd-run-testing.md",
		"assets/agents/sdd-report-testing.md",
		"assets/support/setup-testing.md",
		"assets/support/sdd-testing-context.md",
		"assets/support/visual-diff.md",
		"extensions/btw.ts",
		"vendor/pi-ask-user",
		"vendor/pi-ask-user/index.ts",
		"vendor/pi-ask-user/upstream.ts",
		"vendor/pi-ask-user/single-select-layout.ts",
		"vendor/pi-ask-user/package.json",
		"vendor/pi-ask-user/LICENSE",
		"vendor/pi-ask-user/README.md",
		"vendor/pi-ask-user/skills/ask-user/SKILL.md",
	]) {
		assert.match(script, new RegExp(`path: "${runtimePath.replaceAll("/", "\\/")}"`));
	}

	assert.doesNotMatch(script, /path: "vendor\/pi-subagents/);
	assert.doesNotMatch(script, /path: "packages\/subagents-compat/);
});


test("verify-runtime-surface rejects provider-specific MCP names in testing assets", async () => {
	const runtimeSurface = await import(pathToFileURL(scriptPath).href) as {
		REQUIRED_RUNTIME_SURFACE: Array<{ path: string; kind: "file" | "dir" }>;
		verifyRuntimeSurface: (root: string) => {
			missing: Array<{ path: string; kind: "file" | "dir" }>;
			providerSpecificReferences: Array<{ path: string; match: string }>;
		};
	};
	const fixtureRoot = mkdtempSync(resolve(tmpdir(), "pi-runtime-surface-"));

	try {
		for (const entry of runtimeSurface.REQUIRED_RUNTIME_SURFACE) {
			writeFixtureEntry(fixtureRoot, entry);
		}

		writeFileSync(
			resolve(fixtureRoot, "assets/agents/sdd-run-testing.md"),
			"---\nname: sdd-run-testing\ntools:\n  - mcp__browser\n---\n",
		);

		const result = runtimeSurface.verifyRuntimeSurface(fixtureRoot);
		assert.deepEqual(result.missing, []);
		assert.deepEqual(result.providerSpecificReferences, [
			{ path: "assets/agents/sdd-run-testing.md", match: "mcp__browser" },
		]);
	} finally {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
});


test("normal install paths expose the vendored question wrapper", () => {
	const linkScript = readRepoFile("scripts/link.sh");
	const defaultNix = readRepoFile("lib/default.nix");

	assert.match(linkScript, /vendor\/pi-ask-user\/index\.ts/);
	assert.match(linkScript, /pi-ask-user\.ts/);
	assert.match(defaultNix, /name = "pi-ask-user\.ts"/);
	assert.match(defaultNix, /entry = "vendor\/pi-ask-user\/index\.ts"/);
});

test("README documents the native subagent quick path and package discovery", () => {
	const readme = readRepoFile("README.md");

	assert.match(readme, /official `pi-subagents-j0k3r@1\.4\.4` npm package/i);
	assert.match(readme, /`settings\.json` package discovery/i);
	assert.match(readme, /`pnpm run relink`[\s\S]{0,200}idempotently/i);
	assert.match(readme, /preserv(?:e|es|ing) other packages and settings/i);
	assert.match(readme, /Pi installs missing packages (?:on|at) startup/i);
	assert.match(readme, /Node\.js >=22\.19\.0/);
	assert.match(readme, /`\/subagent-models`[^\n]+model\/effort/i);
	assert.match(readme, /`\/subagents`[^\n]+running[^\n]+history/i);
	assert.match(readme, /`subagent_run`[^\n]+`mode: "task"`[^\n]+`mode: "background"`/i);

	for (const tool of [
		"subagent_list_agents",
		"subagent_run",
		"subagent_continue",
		"subagent_status",
		"subagent_result",
		"subagent_list_tasks",
		"subagent_cancel",
	]) {
		assert.match(readme, new RegExp("`" + tool + "`"), `README should name ${tool}`);
	}

	assert.match(readme, /`model_profiles`[\s\S]{0,80}`subagents\.json`/i);
	assert.match(readme, /(?:global and project|global\/project)[\s\S]{0,100}`\.pi\/(?:agents|subagents)`/i);
	assert.match(readme, /no `\/agents` command or compatibility alias/i);
	assert.match(readme, /`session_resources: lean`[\s\S]{0,80}isolat/i);
	assert.match(readme, /removes context\/prompt lifecycle hooks/i);
	assert.match(readme, /preserv(?:e|es|ing) allowlisted tools and safety hooks/i);

	assert.doesNotMatch(readme, /vendor\/pi-subagents/);
	assert.doesNotMatch(readme, /`(?:Agent|get_subagent_result|steer_subagent)`/);
});

test("README keeps unrelated runtime and testing boundaries", () => {
	const readme = readRepoFile("README.md");

	assert.match(readme, /`\/btw` loads its model runtime only when invoked/i);
	assert.match(readme, /upstream `ask_user` tool/i);
	assert.match(readme, /Atlas\+Engram remains the SDD persistence authority/i);
	assert.match(readme, /Atlas writes require approval/i);
	assert.match(readme, /`\/sdd-test` starts an independent SDD-testing\/QA flow/i);
	assert.match(readme, /development `\/sdd-verify` remains separate/i);
	assert.match(readme, /unsupported|blocked/i);
});
