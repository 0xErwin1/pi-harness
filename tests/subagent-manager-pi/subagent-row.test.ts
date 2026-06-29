import test from "node:test";
import assert from "node:assert/strict";
import {
	buildCollapsedRowParts,
	buildExpandedBody,
	collapsedSpinnerFrame,
	resolveRowCounts,
} from "../../packages/subagent-manager-pi/tui/subagent-row.ts";
import type {
	SubagentRowAccess,
	SubagentRowModel,
} from "../../packages/subagent-manager-pi/tui/subagent-row-model.ts";
import { eventsToBodyLines } from "../../packages/subagent-manager-pi/tui/conversation-viewer-model.ts";
import type { RunEvent } from "../../packages/subagent-manager-core/events.ts";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { ICON_CATALOG } from "../../packages/subagent-manager-pi/icons/catalog.ts";

function makeModel(overrides: Partial<SubagentRowModel> = {}): SubagentRowModel {
	return {
		agent: "Explore",
		status: "running",
		activity: "tool: bash",
		elapsedMs: 5000,
		turns: 2,
		tools: 3,
		tokens: 0,
		currentActivity: "looking at the store",
		...overrides,
	};
}

test("resolveRowCounts: prefers details counts when present", () => {
	const model = makeModel({ turns: 2, tools: 3 });
	const counts = resolveRowCounts({ runIds: ["r1"], turns: 9, tools: 7 }, model);
	assert.deepEqual(counts, { turns: 9, tools: 7 });
});

test("resolveRowCounts: falls back to model counts when details missing", () => {
	const model = makeModel({ turns: 2, tools: 3 });
	assert.deepEqual(resolveRowCounts(undefined, model), { turns: 2, tools: 3 });
	assert.deepEqual(resolveRowCounts({ runIds: ["r1"] }, model), { turns: 2, tools: 3 });
});

test("resolveRowCounts: a zero count in details is honored over the model", () => {
	const model = makeModel({ turns: 5, tools: 5 });
	const counts = resolveRowCounts({ runIds: [], turns: 0, tools: 0 }, model);
	assert.deepEqual(counts, { turns: 0, tools: 0 });
});

test("buildCollapsedRowParts: header carries agent/status/elapsed, meta carries usage, activity is separate", () => {
	const parts = buildCollapsedRowParts(makeModel({ tokens: 1234 }), { turns: 2, tools: 3 });
	assert.equal(parts.header, "Explore · running · 5s");
	assert.equal(parts.meta, "1.2k tok · 3 tools");
	assert.equal(parts.activity, "looking at the store");
});

test("buildCollapsedRowParts: meta leads with a labeled `model: <model> · thinking: <level>` when known", () => {
	const parts = buildCollapsedRowParts(
		makeModel({ model: "anthropic/claude-haiku-4-5", thinking: "high", tokens: 0 }),
		{ turns: 0, tools: 3 },
	);
	assert.ok(
		parts.meta.startsWith("model: claude-haiku-4-5 · thinking: high · "),
		`meta must lead with the labeled model/effort, got: ${parts.meta}`,
	);
	assert.equal(parts.header, "Explore · running · 5s", "routing data never bleeds into the header");
});

test("buildCollapsedRowParts: omits the model/effort prefix when unknown", () => {
	const parts = buildCollapsedRowParts(makeModel(), { turns: 0, tools: 3 });
	assert.ok(!parts.meta.includes("thinking:"), `no model/effort prefix when unknown, got: ${parts.meta}`);
	assert.ok(!parts.meta.startsWith("model:"), `meta must not show an empty model label, got: ${parts.meta}`);
	assert.equal(parts.header, "Explore · running · 5s", `header must start with the agent, got: ${parts.header}`);
});

test("buildCollapsedRowParts: drops turns and never shows the old Nt/M counts", () => {
	const parts = buildCollapsedRowParts(makeModel(), { turns: 9, tools: 3 });
	const joined = `${parts.header} ${parts.meta}`;
	assert.ok(!joined.includes("9t"), `turns count must not appear, got: ${joined}`);
	assert.ok(!/\dt\//.test(joined), `the old Nt/M shape must be gone, got: ${joined}`);
});

test("buildCollapsedRowParts: shows tokens compactly and a bare count under 1k", () => {
	const small = buildCollapsedRowParts(makeModel({ tokens: 850 }), { turns: 0, tools: 0 });
	assert.ok(small.meta.includes("850 tok"), small.meta);

	const large = buildCollapsedRowParts(makeModel({ tokens: 42_000 }), { turns: 0, tools: 0 });
	assert.ok(large.meta.includes("42.0k tok"), large.meta);
});

test("buildCollapsedRowParts: omits an empty agent and activity but keeps status", () => {
	const parts = buildCollapsedRowParts(makeModel({ agent: "", currentActivity: "" }), { turns: 0, tools: 0 });
	assert.equal(parts.header, "running · 5s");
	assert.equal(parts.meta, "0 tok · 0 tools");
	assert.equal(parts.activity, undefined);
});

test("buildCollapsedRowParts: an unresolved row reads 'starting', never a frozen 'queued'", () => {
	const parts = buildCollapsedRowParts(
		makeModel({ agent: "", status: "starting", currentActivity: "starting…", elapsedMs: 0, tokens: 0 }),
		{ turns: 0, tools: 0 },
	);

	assert.equal(parts.header, "starting · 0ms");
	assert.equal(parts.activity, "starting…");
	assert.ok(!parts.header.startsWith("queued"), "an in-flight row must not present as a frozen queued run");
});

test("collapsedSpinnerFrame: draws the active frame from the icon registry spinner", () => {
	const unicode = ICON_CATALOG.unicode.spinner;
	assert.equal(collapsedSpinnerFrame(unicode, 0), unicode[0]);

	const frame = collapsedSpinnerFrame(unicode, 12_345);
	assert.ok(unicode.includes(frame), `frame must come from the registry spinner, got: ${frame}`);

	// The ascii fallback set is a distinct array, so the same clock yields a different glyph.
	assert.notEqual(collapsedSpinnerFrame(ICON_CATALOG.ascii.spinner, 0), unicode[0]);
});

test("buildCollapsedRowParts: formats sub-second and multi-minute elapsed", () => {
	const subSecond = buildCollapsedRowParts(
		makeModel({ agent: "", currentActivity: "", elapsedMs: 250 }),
		{ turns: 0, tools: 0 },
	);
	assert.ok(subSecond.header.endsWith("250ms"), subSecond.header);

	const multiMinute = buildCollapsedRowParts(
		makeModel({ agent: "", currentActivity: "", elapsedMs: 125000 }),
		{ turns: 0, tools: 0 },
	);
	assert.ok(multiMinute.header.endsWith("2m5s"), multiMinute.header);
});

// ── inline EXPANDED transcript: deferred draw-time wrapping (matches overlay) ──

/**
 * Identity theme double: `fg`/`bold` return the text unchanged, so the styled
 * output of a body line is its visible text and can be substring/width-asserted
 * without an ANSI parser. Cast to Theme — only `fg`/`bold` are exercised here.
 */
const IDENTITY_THEME = {
	fg: (_color: string, text: string): string => text,
	bold: (text: string): string => text,
} as unknown as Theme;

let rowEventSeq = 0;

function rowToolWithCall(name: string, toolCall: string): RunEvent {
	return {
		id: `re${rowEventSeq++}`,
		runId: "r1",
		type: "run.progress",
		message: `tool: ${name}`,
		toolCall,
		at: new Date().toISOString(),
	};
}

function rowThinking(text: string): RunEvent {
	return {
		id: `re${rowEventSeq++}`,
		runId: "r1",
		type: "run.output",
		chunk: text,
		kind: "thinking",
		text,
		turn: 1,
		at: new Date().toISOString(),
	};
}

/** Access double whose `events` accessor returns a fixed event stream for run `r1`. */
function makeAccess(events: RunEvent[]): SubagentRowAccess {
	return {
		snapshot: () => undefined,
		messages: () => [],
		events: () => events,
	};
}

/** Strips the transcript control-char markers so a rendered line's visible width is measurable. */
function stripBodyMarkers(line: string): string {
	return line.replace(/[-]/g, "");
}

test("buildExpandedBody: a long tool call wraps into MULTIPLE lines at a narrow width, no ellipsis", () => {
	const longArgs = Array.from({ length: 16 }, (_, i) => `seg${i}`).join(" ");
	const access = makeAccess([rowToolWithCall("read", `read ${longArgs}`)]);

	const lines = buildExpandedBody(access, ["r1"], IDENTITY_THEME).render(24);

	const contentLines = lines.filter((l) => l.trim().length > 0);
	assert.ok(contentLines.length > 1, `a wide tool call must wrap at draw time, got ${contentLines.length}`);

	for (const l of contentLines) {
		const visible = stripBodyMarkers(l);
		assert.ok(!visible.includes("…"), `wrapped lines must never be truncated: ${JSON.stringify(visible)}`);
		assert.ok(visible.length <= 24, `each wrapped line must fit the width, got ${visible.length}`);
	}

	const recovered = contentLines.map(stripBodyMarkers).join(" ");
	for (let i = 0; i < 16; i++) {
		assert.ok(recovered.includes(`seg${i}`), `arg fragment seg${i} must survive wrapping, got: ${recovered}`);
	}
});

test("buildExpandedBody: a long thinking body wraps into MULTIPLE lines at a narrow width, full text recoverable", () => {
	const longThought = "reasoning ".repeat(30).trim();
	const access = makeAccess([rowThinking(longThought)]);

	const lines = buildExpandedBody(access, ["r1"], IDENTITY_THEME).render(40);

	const bodyLines = lines.filter((l) => l.startsWith("│ "));
	assert.ok(bodyLines.length > 1, `a long thought must wrap into multiple body lines, got ${bodyLines.length}`);
	for (const l of bodyLines) {
		assert.ok(!l.includes("…"), `thinking body must never be truncated: ${JSON.stringify(l)}`);
		assert.ok(l.length <= 40, `each wrapped body line must fit the width, got ${l.length}`);
	}
	assert.ok(bodyLines.some((l) => l.includes("reasoning")), "the reasoning text must survive wrapping");
});

test("buildExpandedBody: defers to draw width — narrow render yields more lines than wide render", () => {
	const longArgs = Array.from({ length: 16 }, (_, i) => `seg${i}`).join(" ");
	const access = makeAccess([rowToolWithCall("read", `read ${longArgs}`)]);
	const body = buildExpandedBody(access, ["r1"], IDENTITY_THEME);

	const narrow = body.render(24).filter((l) => l.trim().length > 0);
	const wide = body.render(200).filter((l) => l.trim().length > 0);

	assert.ok(narrow.length > wide.length, `narrow width must produce more wrapped lines (${narrow.length}) than wide (${wide.length})`);
});

test("buildExpandedBody: at the real width the body matches the overlay's eventsToBodyLines output", () => {
	const longArgs = Array.from({ length: 16 }, (_, i) => `seg${i}`).join(" ");
	const events = [rowToolWithCall("read", `read ${longArgs}`), rowThinking("reasoning ".repeat(20).trim())];
	const access = makeAccess(events);

	const width = 30;
	const rtrim = (l: string): string => l.replace(/\s+$/, "");
	const bodyLines = buildExpandedBody(access, ["r1"], IDENTITY_THEME)
		.render(width)
		.map(rtrim)
		.filter((l) => l.length > 0);

	const overlayLines = eventsToBodyLines(events, width)
		.map(stripBodyMarkers)
		.map(rtrim)
		.filter((l) => l.length > 0);

	assert.deepEqual(bodyLines, overlayLines, "the inline expanded body must wrap exactly like the overlay viewer (padding aside)");
});

test("buildExpandedBody: no activity yields a '(no activity yet)' line, never a crash", () => {
	const access = makeAccess([]);

	const lines = buildExpandedBody(access, ["r1"], IDENTITY_THEME).render(40);

	assert.ok(lines.some((l) => l.includes("(no activity yet)")), `empty transcript must render the placeholder, got: ${JSON.stringify(lines)}`);
});

test("buildExpandedBody: a non-positive width degrades to unwrapped lines without crashing", () => {
	const longArgs = Array.from({ length: 16 }, (_, i) => `seg${i}`).join(" ");
	const access = makeAccess([rowToolWithCall("read", `read ${longArgs}`)]);

	assert.doesNotThrow(() => {
		const lines = buildExpandedBody(access, ["r1"], IDENTITY_THEME).render(0);
		const recovered = lines.map(stripBodyMarkers).join(" ");
		assert.ok(recovered.includes("seg0") && recovered.includes("seg15"), "full args must survive at width 0");
	});
});
