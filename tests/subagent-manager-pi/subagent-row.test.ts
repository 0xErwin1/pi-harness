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
		activity: "thinking",
		elapsedMs: 5000,
		turns: 2,
		tools: 3,
		lastLine: "looking at the store",
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

test("buildCollapsedLine: composes agent, activity, elapsed, counts, lastLine", () => {
	const line = buildCollapsedLine(makeModel(), { turns: 2, tools: 3 });
	assert.equal(line, "Explore · thinking · 5s · 2t/3 tools · looking at the store");
});

test("buildCollapsedLine: omits empty agent, activity, and lastLine segments", () => {
	const model = makeModel({ agent: "", activity: "", lastLine: "" });
	const line = buildCollapsedLine(model, { turns: 0, tools: 0 });
	assert.equal(line, "5s · 0t/0 tools");
});

test("buildCollapsedLine: formats sub-second and multi-minute elapsed", () => {
	const subSecond = buildCollapsedLine(
		makeModel({ agent: "", activity: "", lastLine: "", elapsedMs: 250 }),
		{ turns: 0, tools: 0 },
	);
	assert.ok(subSecond.startsWith("250ms · "), subSecond);

	const multiMinute = buildCollapsedLine(
		makeModel({ agent: "", activity: "", lastLine: "", elapsedMs: 125000 }),
		{ turns: 0, tools: 0 },
	);
	assert.ok(multiMinute.startsWith("2m5s · "), multiMinute);
});
