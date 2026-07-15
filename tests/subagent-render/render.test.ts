import test from "node:test";
import assert from "node:assert/strict";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";

import { ICON_CATALOG } from "../../packages/icons/catalog.ts";
import { resolveIconSet } from "../../packages/icons/resolve.ts";
import { resetIconsCache, setIconMode } from "../../packages/icons/config.ts";
import type { IconMode, IconSet } from "../../packages/icons/types.ts";
import {
	type AgentCardDetails,
	type AgentCardStatus,
	type AgentResult,
	type CardTheme,
	renderAgentCall,
	renderAgentResult,
} from "../../packages/subagent-render/index.ts";

const TRUECOLOR_SGR = "\x1b[38;2;";
const FORBIDDEN_SIGILS = ["■", "❯"];

/** A theme stub that returns text unchanged so assertions ignore ANSI coloring. */
const plainTheme: CardTheme = {
	fg: (_role: ThemeColor, text: string) => text,
	bold: (text: string) => text,
};

const MODES: IconMode[] = ["nerdfont", "ascii"];
const STATUSES: AgentCardStatus[] = ["running", "background", "completed", "steered", "stopped", "error", "aborted"];

function baseDetails(status: AgentCardStatus): AgentCardDetails {
	return {
		status,
		toolUses: 3,
		tokens: "33.8k token",
		durationMs: 4200,
		modelName: "haiku",
		tags: ["thinking: high"],
		turnCount: 5,
		maxTurns: 30,
		spinnerFrame: 0,
		activity: "reading files",
		agentId: "abc123",
		error: "boom",
	};
}

function resultFor(status: AgentCardStatus, text = "line one\nline two"): AgentResult {
	return { content: [{ type: "text", text }], details: baseDetails(status) };
}

/** The status-glyph a given status must surface, sourced from the active icon set. */
function expectedGlyph(status: AgentCardStatus, icons: IconSet): string {
	switch (status) {
		case "running":
			return icons.spinner[0] ?? "";
		case "background":
			return icons.treeSub;
		case "completed":
		case "steered":
			return icons.agentDone;
		case "stopped":
			return icons.agentInterrupted;
		case "error":
		case "aborted":
		case "queued":
			return icons.agentFailed;
	}
}

function renderToString(status: AgentCardStatus, icons: IconSet): string {
	const component = renderAgentResult(resultFor(status), { expanded: false, isPartial: false }, plainTheme, icons);
	return component.render(80).join("\n");
}

test("status matrix: every status renders its icon-set glyph, no monochrome sigils, no gradient", () => {
	for (const mode of MODES) {
		const icons = resolveIconSet(mode);

		for (const status of STATUSES) {
			const out = renderToString(status, icons);

			assert.ok(
				out.includes(expectedGlyph(status, icons)),
				`[${mode}/${status}] expected glyph ${JSON.stringify(expectedGlyph(status, icons))} in output`,
			);

			for (const sigil of FORBIDDEN_SIGILS) {
				assert.ok(!out.includes(sigil), `[${mode}/${status}] must not emit the monochrome sigil ${sigil}`);
			}

			assert.ok(!out.includes(TRUECOLOR_SGR), `[${mode}/${status}] must not emit a truecolor gradient escape`);
			assert.ok(out.length > 0, `[${mode}/${status}] output must be non-empty`);
		}
	}
});

test("ascii mode never leaks a hardcoded nerdfont literal", () => {
	const asciiIcons = resolveIconSet("ascii");
	const nf = ICON_CATALOG.nerdfont;

	for (const status of STATUSES) {
		const out = renderToString(status, asciiIcons);

		for (const glyph of [nf.agentDone, nf.agentFailed, nf.agentInterrupted, nf.chevron]) {
			assert.ok(!out.includes(glyph), `[ascii/${status}] must not emit nerdfont literal ${JSON.stringify(glyph)}`);
		}
	}
});

test("running status renders a two-line streaming card (status line + activity)", () => {
	const icons = resolveIconSet("nerdfont");
	const component = renderAgentResult(resultFor("running"), { expanded: false, isPartial: false }, plainTheme, icons);
	const lines = component.render(80);

	assert.ok(lines.length >= 2, "running card must render at least two lines");
	assert.ok(lines.join("\n").includes(icons.spinner[0] ?? ""), "spinner frame present on the status line");
	assert.ok(lines.join("\n").includes("reading files"), "activity text present on the detail line");
	assert.ok(lines.join("\n").includes(icons.treeSub), "the tree connector glyph precedes the activity");
});

test("isPartial forces the streaming card regardless of the reported status", () => {
	const icons = resolveIconSet("nerdfont");
	const component = renderAgentResult(resultFor("completed"), { expanded: false, isPartial: true }, plainTheme, icons);
	const out = component.render(80).join("\n");

	assert.ok(out.includes(icons.spinner[0] ?? ""), "a partial result renders as the streaming spinner card");
});

test("completed status shows stats and a formatted duration", () => {
	const icons = resolveIconSet("nerdfont");
	const out = renderToString("completed", icons);

	assert.ok(out.includes(icons.agentDone), "completed glyph present");
	assert.ok(out.includes("4.2s"), "duration is formatted from durationMs");
	assert.ok(out.includes("haiku"), "model name appears in the stats cluster");
	assert.ok(out.includes("↻5≤30"), "turn count is formatted with the max-turns cap");
	assert.ok(out.includes("Done"), "the collapsed completion shows the Done detail line");
});

test("expanded completed result inlines the transcript body", () => {
	const icons = resolveIconSet("nerdfont");
	const component = renderAgentResult(resultFor("completed"), { expanded: true, isPartial: false }, plainTheme, icons);
	const out = component.render(80).join("\n");

	assert.ok(out.includes("line one"), "expanded output inlines the first body line");
	assert.ok(out.includes("line two"), "expanded output inlines subsequent body lines");
	assert.ok(!out.includes("Done"), "expanded output replaces the Done placeholder with the body");
});

test("background status shows the agent id on the tree line and no status glyph", () => {
	const icons = resolveIconSet("nerdfont");
	const out = renderToString("background", icons);

	assert.ok(out.includes("Running in background"), "background label present");
	assert.ok(out.includes("abc123"), "agent id present");
	assert.ok(out.includes(icons.treeSub), "tree connector present");
});

test("error status surfaces the error message; aborted shows the max-turns note", () => {
	const icons = resolveIconSet("nerdfont");

	const errorOut = renderToString("error", icons);
	assert.ok(errorOut.includes(icons.agentFailed), "error glyph present");
	assert.ok(errorOut.includes("Error: boom"), "error message surfaced");

	const abortedOut = renderToString("aborted", icons);
	assert.ok(abortedOut.includes(icons.agentFailed), "aborted glyph present");
	assert.ok(abortedOut.includes("Aborted (max turns exceeded)"), "aborted note surfaced");
});

test("a result without details renders the plain text body", () => {
	const icons = resolveIconSet("nerdfont");
	const result: AgentResult = { content: [{ type: "text", text: "plain summary" }] };
	const out = renderAgentResult(result, { expanded: false, isPartial: false }, plainTheme, icons).render(80).join("\n");

	assert.equal(out.trim(), "plain summary");
});

test("renderAgentCall shows the icon-set chevron, bold title, and muted description", () => {
	for (const mode of MODES) {
		const icons = resolveIconSet(mode);
		const out = renderAgentCall({ displayName: "Worker", description: "do the thing" }, plainTheme, icons)
			.render(80)
			.join("\n");

		assert.ok(out.includes(icons.chevron), `[${mode}] chevron glyph present`);
		assert.ok(out.includes("Worker"), `[${mode}] display name present`);
		assert.ok(out.includes("do the thing"), `[${mode}] description present`);

		for (const sigil of FORBIDDEN_SIGILS) {
			assert.ok(!out.includes(sigil), `[${mode}] call card must not emit ${sigil}`);
		}
	}
});

test("renderAgentCall omits the description cleanly when absent", () => {
	const icons = resolveIconSet("nerdfont");
	const out = renderAgentCall({ displayName: "Agent" }, plainTheme, icons).render(80).join("\n");

	assert.ok(out.includes("Agent"), "display name present");
	assert.ok(out.includes(icons.chevron), "chevron present with no description");
});

test("the default icon set is resolved from config when no set is injected", () => {
	try {
		setIconMode("ascii");
		const out = renderAgentResult(resultFor("completed"), { expanded: false, isPartial: false }, plainTheme).render(80).join("\n");
		assert.ok(out.includes("done"), "ascii agentDone token surfaces via the config default");
		assert.ok(!out.includes(ICON_CATALOG.nerdfont.agentDone), "no nerdfont literal when config selects ascii");
	} finally {
		resetIconsCache();
	}
});
