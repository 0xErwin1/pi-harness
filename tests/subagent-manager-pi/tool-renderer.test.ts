import test from "node:test";
import assert from "node:assert/strict";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import {
	buildToolCallLine,
	buildToolDiffLines,
	buildToolResultLines,
	overrideToolRendering,
	registerToolRenderer,
	safeBuildToolResultLines,
	toolVerb,
	type ToolDefinitionFactories,
	type ToolLineStyler,
	type ToolRegistrar,
} from "../../extensions/tool-renderer.ts";

/**
 * Deterministic styler double: `fg` wraps text as `<color>…</color>` and `bold`
 * as `<b>…</b>`, so a styled line is fully assertable without a real theme.
 */
const STYLER: ToolLineStyler = {
	fg: (color, text) => `<${color}>${text}</${color}>`,
	bold: (text) => `<b>${text}</b>`,
};

/** A styler that throws on any colouring, to exercise the defensive fallback. */
const THROWING_STYLER: ToolLineStyler = {
	fg: () => {
		throw new Error("boom");
	},
	bold: () => {
		throw new Error("boom");
	},
};

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

function textResult(text: string, details?: unknown): { content: unknown; details?: unknown } {
	return { content: [{ type: "text", text }], details };
}

// ── toolVerb ────────────────────────────────────────────────────────────────

test("toolVerb: capitalizes the built-in tool names", () => {
	assert.equal(toolVerb("read"), "Read");
	assert.equal(toolVerb("bash"), "Bash");
	assert.equal(toolVerb("edit"), "Edit");
	assert.equal(toolVerb("write"), "Write");
	assert.equal(toolVerb("grep"), "Grep");
	assert.equal(toolVerb("find"), "Find");
	assert.equal(toolVerb("ls"), "Ls");
});

// ── buildToolCallLine ───────────────────────────────────────────────────────

test("buildToolCallLine: verb bold + args accent", () => {
	assert.equal(buildToolCallLine("read", { path: "a.ts" }, STYLER), "<b>Read</b> <accent>a.ts</accent>");
});

test("buildToolCallLine: bash renders 'Bash $ <cmd>'", () => {
	assert.equal(buildToolCallLine("bash", { command: "ls -la" }, STYLER), "<b>Bash</b> <accent>$ ls -la</accent>");
});

test("buildToolCallLine: verb only when there are no display args", () => {
	assert.equal(buildToolCallLine("frobnicate", { path: "x" }, STYLER), "<b>Frobnicate</b>");
});

// ── buildToolResultLines ────────────────────────────────────────────────────

test("buildToolResultLines: read yields '<Verb> <args> · <summary>' with a dim summary", () => {
	const lines = buildToolResultLines("read", { path: "a.ts" }, textResult("l1\nl2\n"), false, false, STYLER);
	assert.deepEqual(lines, ["<b>Read</b> <accent>a.ts</accent> · <dim>2 lines</dim>"]);
});

test("buildToolResultLines: bash exit 0 colours the summary success", () => {
	const lines = buildToolResultLines("bash", { command: "x" }, textResult("a\nb\nexit code: 0"), false, false, STYLER);
	assert.deepEqual(lines, ["<b>Bash</b> <accent>$ x</accent> · <success>exit 0 · 3 lines</success>"]);
});

test("buildToolResultLines: bash nonzero exit colours the summary error", () => {
	const lines = buildToolResultLines("bash", { command: "x" }, textResult("boom\nexit code: 1"), false, false, STYLER);
	assert.deepEqual(lines, ["<b>Bash</b> <accent>$ x</accent> · <error>exit 1 · 2 lines</error>"]);
});

test("buildToolResultLines: isError overrides the summary colour to error", () => {
	const lines = buildToolResultLines("read", { path: "a.ts" }, textResult("l1\n"), true, false, STYLER);
	assert.deepEqual(lines, ["<b>Read</b> <accent>a.ts</accent> · <error>1 lines</error>"]);
});

test("buildToolResultLines: isError with no summary text shows a bare 'error'", () => {
	const lines = buildToolResultLines("frobnicate", { path: "x" }, textResult(""), true, false, STYLER);
	assert.deepEqual(lines, ["<b>Frobnicate</b> · <error>error</error>"]);
});

test("buildToolResultLines: edit appends the coloured diff block under the summary line", () => {
	const diff = "--- a/x\n+++ b/x\n@@ -1,2 +1,3 @@\n ctx\n-old\n+new";
	const lines = buildToolResultLines("edit", { path: "x" }, textResult("", { diff }), false, false, STYLER);
	assert.deepEqual(lines, [
		"<b>Edit</b> <accent>x</accent> · <dim>+1 -1</dim>",
		"<dim>@@ -1,2 +1,3 @@</dim>",
		"<dim> ctx</dim>",
		"<error>-old</error>",
		"<success>+new</success>",
	]);
});

test("buildToolResultLines: no output contains emoji or U+FE0F", () => {
	for (const tool of ["read", "bash", "edit", "write", "grep", "find", "ls"]) {
		const lines = buildToolResultLines(tool, { path: "p", command: "c", pattern: "x", content: "a" }, textResult("a\nb"), false, false, STYLER);
		for (const line of lines) assert.ok(!EMOJI_RE.test(line), `unexpected emoji in ${tool}: ${line}`);
	}
});

// ── buildToolDiffLines ──────────────────────────────────────────────────────

test("buildToolDiffLines: colours add/del/context and dims the continuation", () => {
	const body = Array.from({ length: 25 }, (_, i) => `+a${i}`).join("\n");
	const lines = buildToolDiffLines({ diff: `--- a\n+++ b\n${body}` }, false, STYLER);
	assert.equal(lines.length, 21);
	assert.equal(lines[0], "<success>+a0</success>");
	assert.equal(lines[20], "<dim>… +5 more</dim>");
});

test("buildToolDiffLines: expanded shows the full diff with no continuation", () => {
	const body = Array.from({ length: 25 }, (_, i) => `+a${i}`).join("\n");
	const lines = buildToolDiffLines({ diff: `--- a\n+++ b\n${body}` }, true, STYLER);
	assert.equal(lines.length, 25);
	assert.ok(!lines.some((l) => l.includes("more")));
});

test("buildToolDiffLines: no diff yields no lines", () => {
	assert.deepEqual(buildToolDiffLines(undefined, false, STYLER), []);
	assert.deepEqual(buildToolDiffLines({}, false, STYLER), []);
});

// ── defensive fallback ──────────────────────────────────────────────────────

test("safeBuildToolResultLines: a throwing styler falls back to a minimal plain line", () => {
	const lines = safeBuildToolResultLines("read", { path: "a.ts" }, textResult("l1\nl2"), false, false, THROWING_STYLER);
	assert.deepEqual(lines, ["Read a.ts"]);
});

test("safeBuildToolResultLines: fallback for an edit still produces a single plain line", () => {
	const diff = "--- a\n+++ b\n+new";
	const lines = safeBuildToolResultLines("edit", { path: "x" }, textResult("", { diff }), false, false, THROWING_STYLER);
	assert.deepEqual(lines, ["Edit x"]);
});

test("safeBuildToolResultLines: returns the normal styled lines when nothing throws", () => {
	const lines = safeBuildToolResultLines("read", { path: "a.ts" }, textResult("l1"), false, false, STYLER);
	assert.deepEqual(lines, ["<b>Read</b> <accent>a.ts</accent> · <dim>1 lines</dim>"]);
});

// ── registration / execute delegation ───────────────────────────────────────

function makeRegistrar(): { registrar: ToolRegistrar; tools: ToolDefinition[] } {
	const tools: ToolDefinition[] = [];
	const registrar: ToolRegistrar = {
		// Generic to satisfy ExtensionAPI["registerTool"]; the capture cast is local to the test double.
		registerTool: (tool) => {
			tools.push(tool as unknown as ToolDefinition);
		},
	};
	return { registrar, tools };
}

test("overrideToolRendering: keeps name/execute, only adds the renderer fields", () => {
	const { registrar, tools } = makeRegistrar();
	const execute = async () => ({ content: [{ type: "text" as const, text: "x" }], details: undefined });
	const original = {
		name: "read",
		label: "read",
		description: "original description",
		parameters: Type.Object({ path: Type.String() }),
		execute,
	};

	overrideToolRendering(registrar, original);

	assert.equal(tools.length, 1);
	const registered = tools[0];
	assert.equal(registered.name, "read");
	assert.equal(registered.description, "original description");
	assert.equal(registered.execute, execute, "execute must be delegated to the original by reference");
	assert.equal(registered.renderShell, "self");
	assert.equal(typeof registered.renderCall, "function");
	assert.equal(typeof registered.renderResult, "function");
});

test("registerToolRenderer: overrides all 7 built-ins with self-rendered shells", () => {
	const { registrar, tools } = makeRegistrar();

	registerToolRenderer(registrar, { cwd: process.cwd() });

	assert.deepEqual(
		tools.map((t) => t.name).sort(),
		["bash", "edit", "find", "grep", "ls", "read", "write"],
	);
	assert.ok(tools.every((t) => t.renderShell === "self"), "every overridden tool must render its own shell");
	assert.ok(tools.every((t) => typeof t.execute === "function"), "every override must keep a delegating execute");
});

// ── configured-options reconstruction (W1/W2) ────────────────────────────────

interface FactoryCall {
	cwd: string;
	options: unknown;
}

const TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

/**
 * Spyable factory bundle: each factory records the `(cwd, options)` it was called
 * with and returns a minimal spreadable ToolDefinition double, so the test can
 * assert exactly what `registerToolRenderer` forwards without the real SDK.
 */
function makeSpyFactories(): { factories: ToolDefinitionFactories; calls: Map<string, FactoryCall> } {
	const calls = new Map<string, FactoryCall>();
	const make = (name: string) =>
		(cwd: string, options?: unknown) => {
			calls.set(name, { cwd, options });
			return {
				name,
				label: name,
				description: `${name} description`,
				parameters: Type.Object({}),
				execute: async () => ({ content: [{ type: "text" as const, text: "" }], details: undefined }),
			} as unknown as ToolDefinition;
		};

	const factories = {
		read: make("read"),
		bash: make("bash"),
		edit: make("edit"),
		write: make("write"),
		grep: make("grep"),
		find: make("find"),
		ls: make("ls"),
	} as unknown as ToolDefinitionFactories;

	return { factories, calls };
}

test("registerToolRenderer: threads the session cwd into every factory (not process.cwd)", () => {
	const { registrar } = makeRegistrar();
	const { factories, calls } = makeSpyFactories();

	registerToolRenderer(registrar, { cwd: "/session/dir", factories, readSettings: () => ({}) });

	for (const name of TOOL_NAMES) {
		assert.equal(calls.get(name)?.cwd, "/session/dir", `${name} must bind the session cwd`);
	}
});

test("registerToolRenderer: bash receives the configured commandPrefix from settings", () => {
	const { registrar } = makeRegistrar();
	const { factories, calls } = makeSpyFactories();

	registerToolRenderer(registrar, {
		cwd: "/d",
		factories,
		readSettings: () => ({ shellCommandPrefix: "sandbox-exec --" }),
	});

	assert.deepEqual(calls.get("bash")?.options, { commandPrefix: "sandbox-exec --" });
});

test("registerToolRenderer: bash receives no commandPrefix when settings omit it", () => {
	const { registrar } = makeRegistrar();
	const { factories, calls } = makeSpyFactories();

	registerToolRenderer(registrar, { cwd: "/d", factories, readSettings: () => ({}) });

	assert.equal(calls.get("bash")?.options, undefined);
});

test("registerToolRenderer: read receives autoResizeImages from settings", () => {
	const { registrar } = makeRegistrar();
	const { factories, calls } = makeSpyFactories();

	registerToolRenderer(registrar, {
		cwd: "/d",
		factories,
		readSettings: () => ({ images: { autoResize: false } }),
	});

	assert.deepEqual(calls.get("read")?.options, { autoResizeImages: false });
});

test("registerToolRenderer: read defaults autoResizeImages to true when settings omit it", () => {
	const { registrar } = makeRegistrar();
	const { factories, calls } = makeSpyFactories();

	registerToolRenderer(registrar, { cwd: "/d", factories, readSettings: () => ({}) });

	assert.deepEqual(calls.get("read")?.options, { autoResizeImages: true });
});

test("registerToolRenderer: edit/write/grep/find/ls are created cwd-only", () => {
	const { registrar } = makeRegistrar();
	const { factories, calls } = makeSpyFactories();

	registerToolRenderer(registrar, {
		cwd: "/d",
		factories,
		readSettings: () => ({ shellCommandPrefix: "x", images: { autoResize: false } }),
	});

	for (const name of ["edit", "write", "grep", "find", "ls"]) {
		assert.equal(calls.get(name)?.options, undefined, `${name} must be created with cwd only`);
	}
});

test("registerToolRenderer: a throwing settings reader degrades to defaults without throwing", () => {
	const { registrar, tools } = makeRegistrar();
	const { factories, calls } = makeSpyFactories();

	assert.doesNotThrow(() =>
		registerToolRenderer(registrar, {
			cwd: "/d",
			factories,
			readSettings: () => {
				throw new Error("unreadable settings");
			},
		}),
	);

	assert.equal(calls.get("bash")?.options, undefined);
	assert.deepEqual(calls.get("read")?.options, { autoResizeImages: true });
	assert.equal(tools.length, 7);
});

test("registerToolRenderer: configured overrides still self-render and delegate execute", () => {
	const { registrar, tools } = makeRegistrar();
	const { factories } = makeSpyFactories();

	registerToolRenderer(registrar, {
		cwd: "/d",
		factories,
		readSettings: () => ({ shellCommandPrefix: "x" }),
	});

	assert.equal(tools.length, 7);
	assert.ok(tools.every((t) => t.renderShell === "self"), "every override must render its own shell");
	assert.ok(tools.every((t) => typeof t.execute === "function"), "every override must keep a delegating execute");
});
