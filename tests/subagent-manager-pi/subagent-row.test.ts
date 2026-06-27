import test from "node:test";
import assert from "node:assert/strict";
import {
	buildCollapsedLine,
	resolveRowCounts,
} from "../../packages/subagent-manager-pi/tui/subagent-row.ts";
import type { SubagentRowModel } from "../../packages/subagent-manager-pi/tui/subagent-row-model.ts";

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
