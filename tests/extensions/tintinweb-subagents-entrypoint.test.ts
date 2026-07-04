import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolveAgentInvocationConfig } from "../../vendor/pi-subagents/src/invocation-config.ts";

const entrypointUrl = new URL("../../vendor/pi-subagents/src/index.ts", import.meta.url);
const scheduleUrl = new URL("../../vendor/pi-subagents/src/schedule.ts", import.meta.url);
const linkScriptUrl = new URL("../../scripts/link.sh", import.meta.url);
const devPiScriptUrl = new URL("../../scripts/dev-pi.sh", import.meta.url);
const legacyPreflightHelperUrl = new URL("../../extensions/sdd-preflight.ts", import.meta.url);
const legacyProjectDetectorHelperUrl = new URL("../../extensions/sdd-project-detector.ts", import.meta.url);

async function exists(url: URL): Promise<boolean> {
	try {
		await access(url);
		return true;
	} catch {
		return false;
	}
}

async function entrypointSource() {
	return readFile(entrypointUrl, "utf8");
}

test("active pi-subagents entrypoint is native tintinweb, not the inactive j0k3r bridge", async () => {
	const source = await entrypointSource();

	assert.doesNotMatch(source, /\.\.\/j0k3r\/index\.ts/);
	assert.doesNotMatch(source, /packages\/subagents-compat/);
	assert.match(source, /registerMessageRenderer<NotificationDetails>\(\s*\n\s*["']subagent-notification["']/);
	assert.match(source, /name:\s*SUBAGENT_TOOL_NAMES\.AGENT/);
	assert.match(source, /name:\s*SUBAGENT_TOOL_NAMES\.GET_RESULT/);
	assert.match(source, /name:\s*SUBAGENT_TOOL_NAMES\.STEER/);
	assert.match(source, /registerCommand\(["']agents["']/);
});

test("native Agent schema source exposes passthrough fields without unsupported bridge wording", async () => {
	const source = await entrypointSource();

	for (const field of ["model", "thinking", "max_turns", "run_in_background", "inherit_context", "isolated", "isolation", "resume"]) {
		assert.match(source, new RegExp(`${field}:\\s*Type\\.Optional`), `Agent schema should expose ${field}`);
	}
	assert.doesNotMatch(source, /NOT supported on this runtime|compatibility bridge|j0k3r/i);
	assert.match(source, /Send a steering message to a running agent/);
});

test("native scheduler does not require optional runtime dependencies at extension import time", async () => {
	const source = await readFile(scheduleUrl, "utf8");

	assert.doesNotMatch(source, /import\s+\{\s*Cron\s*\}\s+from\s+["']croner["']/);
	assert.doesNotMatch(source, /from\s+["']nanoid["']/);
	assert.match(source, /function loadCron\(\)/);
	assert.match(source, /randomUUID\(\)/);
});

test("link, dev-pi, and Home Manager can load every top-level extension without helper filters", async () => {
	const linkSource = await readFile(linkScriptUrl, "utf8");
	const devPiSource = await readFile(devPiScriptUrl, "utf8");

	assert.equal(await exists(legacyPreflightHelperUrl), false);
	assert.equal(await exists(legacyProjectDetectorHelperUrl), false);
	assert.match(linkSource, /write_vendor_loader "\$f"/);
	assert.match(devPiSource, /write_extension_loader "\$f"/);
	assert.doesNotMatch(linkSource, /helper module; no default extension export/);
	assert.doesNotMatch(devPiSource, /skipped helper extension module/);
});

test("invocation config passes through native execution controls and lets agent config take precedence", () => {
	const fromParams = resolveAgentInvocationConfig(undefined, {
		model: "anthropic/claude-sonnet-4-5",
		thinking: "high",
		max_turns: 8,
		run_in_background: true,
		inherit_context: true,
		isolated: true,
		isolation: "worktree",
	});

	assert.deepEqual(fromParams, {
		modelInput: "anthropic/claude-sonnet-4-5",
		modelFromParams: true,
		thinking: "high",
		maxTurns: 8,
		inheritContext: true,
		runInBackground: true,
		isolated: true,
		isolation: "worktree",
	});

	const fromConfig = resolveAgentInvocationConfig(
		{
			name: "worker",
			description: "Worker",
			extensions: true,
			skills: true,
			systemPrompt: "Do work",
			promptMode: "append",
			model: "openai/gpt-5",
			thinking: "medium",
			maxTurns: 3,
			runInBackground: false,
			inheritContext: false,
			isolated: false,
			isolation: undefined,
		},
		{
			model: "anthropic/claude-haiku-4-5",
			thinking: "high",
			max_turns: 9,
			run_in_background: true,
			inherit_context: true,
			isolated: true,
			isolation: "worktree",
		},
	);

	assert.equal(fromConfig.modelInput, "openai/gpt-5");
	assert.equal(fromConfig.modelFromParams, false);
	assert.equal(fromConfig.thinking, "medium");
	assert.equal(fromConfig.maxTurns, 3);
	assert.equal(fromConfig.runInBackground, false);
	assert.equal(fromConfig.inheritContext, false);
	assert.equal(fromConfig.isolated, false);
});
