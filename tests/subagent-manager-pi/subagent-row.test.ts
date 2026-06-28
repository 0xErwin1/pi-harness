import test from "node:test";
import assert from "node:assert/strict";
import {
	buildCollapsedLine,
	collapsedSpinnerFrame,
	resolveRowCounts,
} from "../../packages/subagent-manager-pi/tui/subagent-row.ts";
import type { SubagentRowModel } from "../../packages/subagent-manager-pi/tui/subagent-row-model.ts";
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

test("buildCollapsedLine: composes agent, status, elapsed, tokens, tools, current activity", () => {
	const line = buildCollapsedLine(makeModel({ tokens: 1234 }), { turns: 2, tools: 3 });
	assert.equal(line, "Explore · running · 5s · 1.2k tok · 3 tools · looking at the store");
});

test("buildCollapsedLine: prepends a dim-eligible `<model> · thinking: <level>` segment when known", () => {
	const line = buildCollapsedLine(
		makeModel({ model: "anthropic/claude-haiku-4-5", thinking: "high", tokens: 0 }),
		{ turns: 0, tools: 3 },
	);
	assert.ok(
		line.startsWith("claude-haiku-4-5 · thinking: high · Explore · running"),
		`model/effort segment must lead the row, got: ${line}`,
	);
});

test("buildCollapsedLine: omits the model/effort segment when unknown", () => {
	const line = buildCollapsedLine(makeModel(), { turns: 0, tools: 3 });
	assert.ok(!line.includes("thinking:"), `no model/effort segment when unknown, got: ${line}`);
	assert.ok(line.startsWith("Explore · running"), `row must start with the agent, got: ${line}`);
});

test("buildCollapsedLine: drops turns and never shows the old Nt/M counts", () => {
	const line = buildCollapsedLine(makeModel(), { turns: 9, tools: 3 });
	assert.ok(!line.includes("9t"), `turns count must not appear, got: ${line}`);
	assert.ok(!/\dt\//.test(line), `the old Nt/M shape must be gone, got: ${line}`);
});

test("buildCollapsedLine: shows tokens compactly and a bare count under 1k", () => {
	const small = buildCollapsedLine(makeModel({ tokens: 850 }), { turns: 0, tools: 0 });
	assert.ok(small.includes("850 tok"), small);

	const large = buildCollapsedLine(makeModel({ tokens: 42_000 }), { turns: 0, tools: 0 });
	assert.ok(large.includes("42.0k tok"), large);
});

test("buildCollapsedLine: omits an empty agent and current-activity segment but keeps status", () => {
	const model = makeModel({ agent: "", currentActivity: "" });
	const line = buildCollapsedLine(model, { turns: 0, tools: 0 });
	assert.equal(line, "running · 5s · 0 tok · 0 tools");
});

test("buildCollapsedLine: an unresolved row reads 'starting', never a frozen 'queued'", () => {
	const model = makeModel({
		agent: "",
		status: "starting",
		currentActivity: "starting…",
		elapsedMs: 0,
		tokens: 0,
	});

	const line = buildCollapsedLine(model, { turns: 0, tools: 0 });

	assert.equal(line, "starting · 0ms · 0 tok · 0 tools · starting…");
	assert.ok(!line.startsWith("queued"), "an in-flight row must not present as a frozen queued run");
});

test("collapsedSpinnerFrame: draws the active frame from the icon registry spinner", () => {
	const unicode = ICON_CATALOG.unicode.spinner;
	assert.equal(collapsedSpinnerFrame(unicode, 0), unicode[0]);

	const frame = collapsedSpinnerFrame(unicode, 12_345);
	assert.ok(unicode.includes(frame), `frame must come from the registry spinner, got: ${frame}`);

	// The ascii fallback set is a distinct array, so the same clock yields a different glyph.
	assert.notEqual(collapsedSpinnerFrame(ICON_CATALOG.ascii.spinner, 0), unicode[0]);
});

test("buildCollapsedLine: formats sub-second and multi-minute elapsed", () => {
	const subSecond = buildCollapsedLine(
		makeModel({ agent: "", currentActivity: "", elapsedMs: 250 }),
		{ turns: 0, tools: 0 },
	);
	assert.ok(subSecond.includes("250ms · "), subSecond);

	const multiMinute = buildCollapsedLine(
		makeModel({ agent: "", currentActivity: "", elapsedMs: 125000 }),
		{ turns: 0, tools: 0 },
	);
	assert.ok(multiMinute.includes("2m5s · "), multiMinute);
});
