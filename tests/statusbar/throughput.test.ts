import test from "node:test";
import assert from "node:assert/strict";

import {
	emptyStream,
	finalizeTokensPerSecond,
	markToolCall,
	recordContentDelta,
} from "../../packages/statusbar/throughput.ts";

test("a tool-call-only turn (no content deltas) yields no throughput figure", () => {
	const stream = markToolCall(emptyStream());

	assert.equal(finalizeTokensPerSecond(stream, 0), null);
});

test("a streamed reply yields a positive tokens/sec figure", () => {
	let stream = emptyStream();
	stream = recordContentDelta(stream, 10, 1000);
	stream = recordContentDelta(stream, 40, 1100);
	stream = recordContentDelta(stream, 40, 1200);

	const tps = finalizeTokensPerSecond(stream, 20);

	assert.ok(tps !== null && tps > 0, `expected a positive rate, got ${tps}`);
});

test("throughput excludes the first delta so an initial burst is not counted at t=0", () => {
	let stream = emptyStream();
	stream = recordContentDelta(stream, 12, 1000); // first delta: 12 chars => 3 est tokens, excluded
	stream = recordContentDelta(stream, 40, 1200); // +200ms

	// usage.output = 23 tokens; minus the 3 first-delta tokens => 20 tokens over 0.2s = 100 tok/s
	assert.equal(finalizeTokensPerSecond(stream, 23), 100);
});

test("a single delta has no observable cadence", () => {
	const stream = recordContentDelta(emptyStream(), 100, 1000);

	assert.equal(finalizeTokensPerSecond(stream, 50), null);
});

test("a sub-threshold burst (under 50ms) yields no figure", () => {
	let stream = emptyStream();
	stream = recordContentDelta(stream, 20, 1000);
	stream = recordContentDelta(stream, 20, 1030); // only 30ms elapsed

	assert.equal(finalizeTokensPerSecond(stream, 40), null);
});

test("a turn mixing text and a tool call still reports the text cadence", () => {
	let stream = emptyStream();
	stream = recordContentDelta(stream, 12, 1000);
	stream = recordContentDelta(stream, 40, 1200);
	stream = markToolCall(stream);

	const tps = finalizeTokensPerSecond(stream, 999);

	// sawToolCall => usage.output is untrusted; falls back to the char estimate.
	assert.ok(tps !== null && tps > 0);
});

test("recordContentDelta accumulates chars, delta count and the timing window", () => {
	let stream = emptyStream();
	stream = recordContentDelta(stream, 10, 1000);
	stream = recordContentDelta(stream, 5, 1050);

	assert.equal(stream.totalChars, 15);
	assert.equal(stream.deltaCount, 2);
	assert.equal(stream.firstDeltaChars, 10);
	assert.equal(stream.streamStartMs, 1000);
	assert.equal(stream.lastDeltaMs, 1050);
});
