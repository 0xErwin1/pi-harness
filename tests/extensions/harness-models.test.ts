import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	resolveAgentRouting,
	readModelConfig,
	ModelPanel,
	type AgentModelConfig,
	type ModelPanelResult,
} from "../../extensions/harness.ts";

function withModelConfig(config: Record<string, unknown>): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-harness-models-"));
	const path = join(dir, ".pi", "harness");
	mkdirSync(path, { recursive: true });
	writeFileSync(join(path, "models.json"), JSON.stringify(config), "utf8");
	return dir;
}

const ESCAPE = "\x1b";
const CTRL_C = "\x03";
const RETURN = "\r";

// ── Issue 1: configured models are honored ───────────────────────────────────

test("resolveAgentRouting: returns the configured model when present", () => {
	const config: AgentModelConfig = { "sdd-apply": { model: "anthropic/opus" } };

	assert.deepEqual(resolveAgentRouting(config, "sdd-apply", "anthropic/sonnet"), {
		model: "anthropic/opus",
		thinking: undefined,
	});
});

test("resolveAgentRouting: falls back to the default model when unconfigured", () => {
	const config: AgentModelConfig = { "sdd-apply": { model: "anthropic/opus" } };

	assert.deepEqual(resolveAgentRouting(config, "sdd-verify", "anthropic/sonnet"), {
		model: "anthropic/sonnet",
		thinking: undefined,
	});
});

test("resolveAgentRouting: carries the configured thinking level", () => {
	const config: AgentModelConfig = {
		"sdd-design": { model: "anthropic/opus", thinking: "high" },
	};

	assert.deepEqual(resolveAgentRouting(config, "sdd-design", "anthropic/sonnet"), {
		model: "anthropic/opus",
		thinking: "high",
	});
});

test("resolveAgentRouting: undefined default stays undefined when unconfigured", () => {
	assert.deepEqual(resolveAgentRouting({}, "sdd-apply", undefined), {
		model: undefined,
		thinking: undefined,
	});
});

test("readModelConfig + resolveAgentRouting: a saved models.json overrides the default", () => {
	const cwd = withModelConfig({ "sdd-apply": { model: "anthropic/opus" } });

	const config = readModelConfig(cwd);

	assert.equal(
		resolveAgentRouting(config, "sdd-apply", "anthropic/sonnet").model,
		"anthropic/opus",
	);
	assert.equal(
		resolveAgentRouting(config, "sdd-verify", "anthropic/sonnet").model,
		"anthropic/sonnet",
	);
});

// ── Issue 2: selections persist on a normal (Esc) close ──────────────────────

function makePanel(
	initial: AgentModelConfig,
	agents: string[],
	modelOptions: string[],
): { panel: ModelPanel; result: () => ModelPanelResult | undefined } {
	let captured: ModelPanelResult | undefined;
	const panel = new ModelPanel(initial, modelOptions, agents, (r) => {
		captured = r;
	});
	return { panel, result: () => captured };
}

test("ModelPanel: Esc saves the current draft instead of discarding", () => {
	const { panel, result } = makePanel({ alpha: { model: "m1" } }, ["alpha"], ["m1", "m2"]);

	panel.handleInput(ESCAPE);

	const out = result();
	assert.ok(out && out.type === "save");
	assert.deepEqual(out.config, { alpha: { model: "m1" } });
});

test("ModelPanel: ctrl+c discards (cancel)", () => {
	const { panel, result } = makePanel({ alpha: { model: "m1" } }, ["alpha"], ["m1", "m2"]);

	panel.handleInput(CTRL_C);

	const out = result();
	assert.ok(out && out.type === "cancel");
});

test("ModelPanel: an edit followed by Esc persists the edit", () => {
	const { panel, result } = makePanel({}, ["alpha", "beta"], ["m1", "m2"]);

	panel.handleInput("j"); // move from "Set all agents" onto the "alpha" row
	panel.handleInput(RETURN); // open the model picker for alpha
	panel.handleInput(RETURN); // pick the first model option ("m1")
	panel.handleInput(ESCAPE); // normal close -> save

	const out = result();
	assert.ok(out && out.type === "save");
	assert.deepEqual(out.config, { alpha: { model: "m1" } });
});

test("ModelPanel: Enter on the Continue row still saves", () => {
	const { panel, result } = makePanel({ alpha: { model: "m1" } }, ["alpha"], ["m1"]);

	// rows = [Set all agents, alpha]; the "Continue" row is at index rows.length.
	panel.handleInput("j"); // -> alpha
	panel.handleInput("j"); // -> Continue
	panel.handleInput(RETURN);

	const out = result();
	assert.ok(out && out.type === "save");
});

// ── Issue 3: the panel advertises its keymap ─────────────────────────────────

test("ModelPanel: the agent-list footer lists the real keys", () => {
	const { panel } = makePanel({}, ["alpha"], ["m1"]);

	const rendered = panel.render(120).join("\n");

	assert.match(rendered, /esc\/ctrl\+s save/);
	assert.match(rendered, /ctrl\+c discard/);
	assert.match(rendered, /e effort/);
	assert.match(rendered, /Continue \(save\)/);
	assert.match(rendered, /Cancel \(discard\)/);
});

test("ModelPanel: rendered output contains no emoji", () => {
	const { panel } = makePanel({ alpha: { model: "m1" } }, ["alpha"], ["m1"]);

	const rendered = panel.render(120).join("\n");

	assert.doesNotMatch(rendered, /️/);
	assert.doesNotMatch(rendered, /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
});
