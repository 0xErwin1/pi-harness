import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDepthExceeded } from "../../extensions/harness.ts";
import {
	parseAgentDescription,
	buildAgentMenu,
	type AgentMenuEntry,
} from "../../extensions/harness.ts";

function withAgentFile(content: string): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-harness-routing-"));
	const filePath = join(dir, "agent.md");
	writeFileSync(filePath, content, "utf8");
	return filePath;
}

// ── parseAgentDescription ────────────────────────────────────────────────────

test("parseAgentDescription: reads unquoted description from frontmatter", () => {
	const filePath = withAgentFile(
		"---\nname: scout\ndescription: Fast codebase recon that returns compressed context for handoff\n---\n\nBody text.",
	);
	assert.equal(
		parseAgentDescription(filePath),
		"Fast codebase recon that returns compressed context for handoff",
	);
});

test("parseAgentDescription: reads double-quoted description from frontmatter", () => {
	const filePath = withAgentFile(
		'---\nname: researcher\ndescription: "Autonomous web researcher — searches and synthesizes"\n---\n',
	);
	assert.equal(
		parseAgentDescription(filePath),
		"Autonomous web researcher — searches and synthesizes",
	);
});

test("parseAgentDescription: returns undefined when description field is absent", () => {
	const filePath = withAgentFile("---\nname: worker\ntools: read, edit\n---\n\nBody.");
	assert.equal(parseAgentDescription(filePath), undefined);
});

test("parseAgentDescription: returns undefined when the file does not exist", () => {
	assert.equal(parseAgentDescription("/nonexistent/path/agent.md"), undefined);
});

test("parseAgentDescription: returns undefined when there is no frontmatter", () => {
	const filePath = withAgentFile("This is a plain text file without frontmatter.");
	assert.equal(parseAgentDescription(filePath), undefined);
});

// ── buildAgentMenu ───────────────────────────────────────────────────────────

const BUILTIN_GENERICS: AgentMenuEntry[] = [
	{ name: "general-purpose", description: "Generic subagent controlled by the parent prompt" },
	{ name: "Explore", description: "Read-only exploration subagent" },
	{ name: "Plan", description: "Read-only planning subagent" },
];

test("buildAgentMenu: includes builtin generics with their descriptions", () => {
	const menu = buildAgentMenu(BUILTIN_GENERICS, []);

	assert.ok(menu.includes("general-purpose — Generic subagent controlled by the parent prompt"));
	assert.ok(menu.includes("Explore — Read-only exploration subagent"));
	assert.ok(menu.includes("Plan — Read-only planning subagent"));
});

test("buildAgentMenu: includes scout, researcher, worker, and reviewer with their descriptions", () => {
	const discovered: AgentMenuEntry[] = [
		{ name: "scout", description: "Fast codebase recon that returns compressed context for handoff" },
		{ name: "researcher", description: "Autonomous web researcher — searches, evaluates, and synthesizes a focused research brief" },
		{ name: "worker", description: "Implementation agent for normal tasks and approved oracle handoffs" },
		{ name: "reviewer", description: "Versatile review specialist for code diffs, plans, proposed solutions, codebase health, and PR/issue validation" },
	];

	const menu = buildAgentMenu(BUILTIN_GENERICS, discovered);

	assert.ok(menu.includes("scout — Fast codebase recon that returns compressed context for handoff"));
	assert.ok(menu.includes("researcher — Autonomous web researcher"));
	assert.ok(menu.includes("worker — Implementation agent for normal tasks and approved oracle handoffs"));
	assert.ok(menu.includes("reviewer — Versatile review specialist"));
});

test("buildAgentMenu: excludes sdd-* pipeline agents", () => {
	const discovered: AgentMenuEntry[] = [
		{ name: "sdd-apply", description: "SDD apply phase" },
		{ name: "sdd-verify", description: "SDD verify phase" },
		{ name: "worker", description: "Implementation agent" },
	];

	const menu = buildAgentMenu(BUILTIN_GENERICS, discovered);

	assert.ok(!menu.includes("sdd-apply"));
	assert.ok(!menu.includes("sdd-verify"));
	assert.ok(menu.includes("worker — Implementation agent"));
});

test("buildAgentMenu: excludes review-* dimension agents", () => {
	const discovered: AgentMenuEntry[] = [
		{ name: "review-risk", description: "Risk lens" },
		{ name: "review-readability", description: "Readability lens" },
		{ name: "scout", description: "Fast codebase recon" },
	];

	const menu = buildAgentMenu(BUILTIN_GENERICS, discovered);

	assert.ok(!menu.includes("review-risk"));
	assert.ok(!menu.includes("review-readability"));
	assert.ok(menu.includes("scout — Fast codebase recon"));
});

test("buildAgentMenu: excludes jd-* judgment-day agents", () => {
	const discovered: AgentMenuEntry[] = [
		{ name: "jd-prime", description: "Adversarial dual review" },
		{ name: "researcher", description: "Web researcher" },
	];

	const menu = buildAgentMenu(BUILTIN_GENERICS, discovered);

	assert.ok(!menu.includes("jd-prime"));
	assert.ok(menu.includes("researcher — Web researcher"));
});

test("buildAgentMenu: includes routing hint", () => {
	const menu = buildAgentMenu(BUILTIN_GENERICS, []);

	assert.ok(
		menu.includes("Pick the most specific agent for the task"),
		"routing hint must appear in the menu",
	);
});

test("buildAgentMenu: generics appear before discovered agents", () => {
	const discovered: AgentMenuEntry[] = [
		{ name: "scout", description: "Fast codebase recon" },
	];

	const menu = buildAgentMenu(BUILTIN_GENERICS, discovered);

	const generalPurposePos = menu.indexOf("general-purpose");
	const scoutPos = menu.indexOf("scout");

	assert.ok(
		generalPurposePos < scoutPos,
		"builtin generics must precede discovered agents in the menu",
	);
});

test("buildAgentMenu: falls back to agent name when description is absent", () => {
	const discovered: AgentMenuEntry[] = [
		{ name: "custom-agent" },
	];

	const menu = buildAgentMenu(BUILTIN_GENERICS, discovered);

	assert.ok(menu.includes("custom-agent — custom-agent"));
});

// ── isDepthExceeded (depth-cap guard) ────────────────────────────────────────

function withDepthEnv(depth: string | undefined, max: string | undefined, fn: () => void): void {
	const savedDepth = process.env.PI_HARNESS_SUBAGENT_DEPTH;
	const savedMax = process.env.PI_HARNESS_MAX_SUBAGENT_DEPTH;
	try {
		if (depth === undefined) delete process.env.PI_HARNESS_SUBAGENT_DEPTH;
		else process.env.PI_HARNESS_SUBAGENT_DEPTH = depth;
		if (max === undefined) delete process.env.PI_HARNESS_MAX_SUBAGENT_DEPTH;
		else process.env.PI_HARNESS_MAX_SUBAGENT_DEPTH = max;
		fn();
	} finally {
		if (savedDepth === undefined) delete process.env.PI_HARNESS_SUBAGENT_DEPTH;
		else process.env.PI_HARNESS_SUBAGENT_DEPTH = savedDepth;
		if (savedMax === undefined) delete process.env.PI_HARNESS_MAX_SUBAGENT_DEPTH;
		else process.env.PI_HARNESS_MAX_SUBAGENT_DEPTH = savedMax;
	}
}

test("isDepthExceeded: returns false at depth 0 (default max 5)", () => {
	withDepthEnv("0", undefined, () => {
		assert.equal(isDepthExceeded(), false);
	});
});

test("isDepthExceeded: returns false at depth 4 with max 5", () => {
	withDepthEnv("4", "5", () => {
		assert.equal(isDepthExceeded(), false);
	});
});

test("isDepthExceeded: returns true at depth equal to max (5 >= 5)", () => {
	withDepthEnv("5", "5", () => {
		assert.equal(isDepthExceeded(), true);
	});
});

test("isDepthExceeded: returns true at depth above max (6 >= 5)", () => {
	withDepthEnv("6", "5", () => {
		assert.equal(isDepthExceeded(), true);
	});
});

test("isDepthExceeded: respects PI_HARNESS_MAX_SUBAGENT_DEPTH override", () => {
	withDepthEnv("3", "3", () => {
		assert.equal(isDepthExceeded(), true, "depth 3 >= max 3 must be exceeded");
	});
	withDepthEnv("2", "3", () => {
		assert.equal(isDepthExceeded(), false, "depth 2 < max 3 must not be exceeded");
	});
});
