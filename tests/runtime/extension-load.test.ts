import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { basename } from "node:path";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Commands the real `extensions/` directory registers today. This is the
 * single source of truth the load test checks the runtime surface against.
 * The `header`, `throughput`, and `pr-info` extensions load here but register
 * no command (they own chrome), so they are absent from this list by design.
 */
const EXPECTED_COMMANDS = [
	"stash",
	"history",
	"btw",
	"harness:doctor",
	"pi-harness:status",
	"sdd-init",
	"sdd-onboard",
	"sdd-test",
	"sdd-test-status",
	"sdd-explore-testing",
	"sdd-plan-testing",
	"sdd-run-testing",
	"sdd-report-testing",
	"sdd-new",
	"sdd-continue",
	"sdd-ff",
	"sdd-apply",
	"sdd-verify",
	"sdd-sync",
	"sdd-archive",
	"sdd-status",
	"skill-registry:refresh",
	"mcp",
	"transcript",
	"log",
];

/**
 * Tools the real `extensions/` directory registers today at LOAD time (i.e.
 * synchronously, inside the extension's default export). This deliberately
 * excludes `mcp.ts`'s per-server tools: those are registered dynamically
 * inside a `session_start` handler once a real `~/.pi/agent/mcp.json` is
 * read, which this hermetic load never triggers. Future work units that
 * register tools statically MUST extend this list.
 */
const EXPECTED_TOOLS = [
	"mem_save",
	"mem_search",
	"mem_get_observation",
	"mem_context",
	"mem_timeline",
	"mem_session_summary",
	"mem_stats",
	"mem_delete",
	"mem_suggest_topic_key",
	"mem_session_start",
	"mem_save_prompt",
];

/**
 * Shell safety remains active while the review compatibility module loads
 * without observing tool calls.
 */
const TOOL_CALL_OWNER = "shell-guard.ts";
const REVIEW_COMPATIBILITY_MODULE = "review-gate.ts";

test("the real extension set loads cleanly and registers the expected commands and tools", async (t) => {
	// `discoverAndLoadExtensions` also globs `<agentDir>/extensions/`; pointing
	// agentDir at an empty temp dir keeps this load hermetic and independent of
	// whatever the developer's real ~/.pi/agent happens to have installed.
	const agentDir = mkdtempSync(resolve(tmpdir(), "pi-harness-runtime-load-"));
	t.after(() => rmSync(agentDir, { recursive: true, force: true }));

	const result = await discoverAndLoadExtensions(["./extensions"], REPO_ROOT, agentDir);

	assert.deepEqual(result.errors, []);

	const commandNames = new Set<string>();
	const toolNames = new Set<string>();
	const toolCallOwners = new Set<string>();

	for (const extension of result.extensions) {
		for (const name of extension.commands.keys()) commandNames.add(name);
		for (const name of extension.tools.keys()) toolNames.add(name);
		if (extension.handlers.has("tool_call")) toolCallOwners.add(basename(extension.path));
	}

	assert.deepEqual([...commandNames].sort(), [...EXPECTED_COMMANDS].sort());
	assert.deepEqual([...toolNames].sort(), [...EXPECTED_TOOLS].sort());

	assert.ok(toolCallOwners.has(TOOL_CALL_OWNER), `expected ${TOOL_CALL_OWNER} to register a tool_call handler`);
	assert.ok(
		result.extensions.some((extension) => basename(extension.path) === REVIEW_COMPATIBILITY_MODULE),
		`expected ${REVIEW_COMPATIBILITY_MODULE} to load as a compatibility module`,
	);
	assert.ok(
		!toolCallOwners.has(REVIEW_COMPATIBILITY_MODULE),
		`expected ${REVIEW_COMPATIBILITY_MODULE} not to register a tool_call handler`,
	);
});
