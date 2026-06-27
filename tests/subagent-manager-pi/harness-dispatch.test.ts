import test from "node:test";
import assert from "node:assert/strict";
import { mapWithConcurrencyLimit } from "../../extensions/harness.ts";
import { TOOL_PROGRESS_PREFIX } from "../../packages/subagent-manager-core/index.ts";

test("TOOL_PROGRESS_PREFIX value is 'tool:'", () => {
	assert.equal(TOOL_PROGRESS_PREFIX, "tool:");
});

test("mapWithConcurrencyLimit: preserves input-to-output order", async () => {
	const input = [1, 2, 3, 4, 5];

	const results = await mapWithConcurrencyLimit(input, 2, async (n) => n * 10);

	assert.deepEqual(results, [10, 20, 30, 40, 50]);
});

test("mapWithConcurrencyLimit: never exceeds the concurrency cap", async () => {
	let inFlight = 0;
	let maxInFlight = 0;
	const cap = 3;
	const input = Array.from({ length: 10 }, (_, i) => i);

	await mapWithConcurrencyLimit(input, cap, async () => {
		inFlight += 1;
		maxInFlight = Math.max(maxInFlight, inFlight);
		await new Promise<void>((resolve) => setImmediate(resolve));
		inFlight -= 1;
	});

	assert.ok(
		maxInFlight <= cap,
		`max in-flight was ${maxInFlight}, expected <= ${cap}`,
	);
});

test("mapWithConcurrencyLimit: propagates the first rejection", async () => {
	const input = [1, 2, 3];

	await assert.rejects(
		() =>
			mapWithConcurrencyLimit(input, 2, async (n) => {
				if (n === 2) throw new Error("task 2 failed");
				return n;
			}),
		(err: unknown) => {
			assert.ok(err instanceof Error);
			assert.match(err.message, /task 2 failed/);
			return true;
		},
	);
});

test("mapWithConcurrencyLimit: effective cap is min(limit, items.length)", async () => {
	let maxInFlight = 0;
	let inFlight = 0;

	await mapWithConcurrencyLimit([1, 2], 100, async () => {
		inFlight += 1;
		maxInFlight = Math.max(maxInFlight, inFlight);
		await new Promise<void>((resolve) => setImmediate(resolve));
		inFlight -= 1;
	});

	assert.ok(
		maxInFlight <= 2,
		`cap clamped to items.length: max in-flight was ${maxInFlight}`,
	);
});

test("mapWithConcurrencyLimit: empty input returns empty array", async () => {
	const results = await mapWithConcurrencyLimit([], 4, async (n: number) => n);
	assert.deepEqual(results, []);
});
