import assert from "node:assert/strict";
import test from "node:test";

import reasoningSummary, { preferDetailedReasoningSummary } from "../../extensions/reasoning-summary.ts";

test("requests detailed summaries for reasoning-capable Responses payloads", () => {
	const payload = {
		include: ["reasoning.encrypted_content"],
		input: [],
		model: "gpt-5.5",
		reasoning: { effort: "high", summary: "auto" },
	};

	assert.deepEqual(preferDetailedReasoningSummary(payload), {
		include: ["reasoning.encrypted_content"],
		input: [],
		model: "gpt-5.5",
		reasoning: { effort: "high", summary: "detailed" },
	});
	assert.equal(payload.reasoning.summary, "auto");
});

test("does not require an explicit reasoning effort", () => {
	assert.deepEqual(preferDetailedReasoningSummary({
		include: ["reasoning.encrypted_content"],
		reasoning: { summary: "auto" },
	}), {
		include: ["reasoning.encrypted_content"],
		reasoning: { summary: "detailed" },
	});
});

test("leaves non-reasoning and explicitly configured payloads unchanged", () => {
	assert.equal(preferDetailedReasoningSummary({ input: [] }), undefined);
	assert.equal(preferDetailedReasoningSummary({
		include: ["reasoning.encrypted_content"],
		reasoning: { effort: "high", summary: "concise" },
	}), undefined);
	assert.equal(preferDetailedReasoningSummary({
		include: [],
		reasoning: { effort: "high", summary: "auto" },
	}), undefined);
});

test("registers a before_provider_request payload rewrite", () => {
	let handler: ((event: { payload: unknown }) => unknown) | undefined;
	reasoningSummary({
		on(event: string, callback: (event: { payload: unknown }) => unknown) {
			if (event === "before_provider_request") handler = callback;
		},
	} as any);

	assert.ok(handler);
	assert.deepEqual(handler({
		payload: {
			include: ["reasoning.encrypted_content"],
			reasoning: { summary: "auto" },
		},
	}), {
		include: ["reasoning.encrypted_content"],
		reasoning: { summary: "detailed" },
	});
});
