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
 * no command (they own chrome / publish on the event bus), so they are absent
 * from this list by design. A future subagent panel (subagent-ui) that adds a
 * command MUST extend this list alongside its `pi.registerCommand()` call.
 */
const EXPECTED_COMMANDS = [
	"stash",
	"history",
	"btw",
	"harness:doctor",
	"pi-harness:status",
	"sdd-init",
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
	"sdd-archive",
	"sdd-status",
	"skill-registry:refresh",
	"mcp",
	"transcript",
	"log",
	"fleet",
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
 * Extensions whose `tool_call` handler MUST be present. Both intercept the
 * same hook; ordering between them is load-order dependent and MUST NOT be
 * assumed, so this is checked as set membership, not sequence.
 */
const TOOL_CALL_OWNERS = ["shell-guard.ts", "review-gate.ts"];

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

	for (const owner of TOOL_CALL_OWNERS) {
		assert.ok(toolCallOwners.has(owner), `expected ${owner} to register a tool_call handler`);
	}
});
