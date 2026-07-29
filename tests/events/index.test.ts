import test from "node:test";
import assert from "node:assert/strict";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { publish, subscribe, type EventBusHost } from "../../packages/events/index.ts";

function makeHost(): EventBusHost {
	return { events: createEventBus() };
}

test("harness:throughput round trip delivers the published payload", () => {
	const host = makeHost();
	const received: unknown[] = [];

	subscribe(host, "harness:throughput", (payload) => {
		received.push(payload);
	});

	publish(host, "harness:throughput", { tokensPerSecond: 42, turnId: "turn-1" });

	assert.deepEqual(received, [{ tokensPerSecond: 42, turnId: "turn-1" }]);
});

test("harness:throughput accepts a null tokensPerSecond (no observable cadence)", () => {
	const host = makeHost();
	const received: unknown[] = [];

	subscribe(host, "harness:throughput", (payload) => {
		received.push(payload);
	});

	publish(host, "harness:throughput", { tokensPerSecond: null, turnId: "turn-2" });

	assert.deepEqual(received, [{ tokensPerSecond: null, turnId: "turn-2" }]);
});

test("harness:pr round trip delivers an open PR payload", () => {
	const host = makeHost();
	const received: unknown[] = [];

	subscribe(host, "harness:pr", (payload) => {
		received.push(payload);
	});

	publish(host, "harness:pr", { number: 7, url: "https://example.com/pr/7", isDraft: false });

	assert.deepEqual(received, [{ number: 7, url: "https://example.com/pr/7", isDraft: false }]);
});

test("harness:pr round trip delivers null (no open PR)", () => {
	const host = makeHost();
	const received: unknown[] = [];

	subscribe(host, "harness:pr", (payload) => {
		received.push(payload);
	});

	publish(host, "harness:pr", null);

	assert.deepEqual(received, [null]);
});

test("a malformed harness:throughput payload is dropped without throwing", () => {
	const host = makeHost();
	const received: unknown[] = [];

	subscribe(host, "harness:throughput", (payload) => {
		received.push(payload);
	});

	assert.doesNotThrow(() => {
		host.events.emit("harness:throughput", { tokensPerSecond: "fast", turnId: "turn-3" });
	});

	assert.deepEqual(received, []);
});

test("a malformed harness:pr payload (wrong shape, not null) is dropped without throwing", () => {
	const host = makeHost();
	const received: unknown[] = [];

	subscribe(host, "harness:pr", (payload) => {
		received.push(payload);
	});

	assert.doesNotThrow(() => {
		host.events.emit("harness:pr", { number: "seven", url: "https://example.com" });
	});

	assert.deepEqual(received, []);
});

test("subscribe returns an unsubscribe function that stops delivery", () => {
	const host = makeHost();
	const received: unknown[] = [];

	const unsubscribe = subscribe(host, "harness:throughput", (payload) => {
		received.push(payload);
	});

	publish(host, "harness:throughput", { tokensPerSecond: 10, turnId: "turn-4" });
	unsubscribe();
	publish(host, "harness:throughput", { tokensPerSecond: 20, turnId: "turn-5" });

	assert.deepEqual(received, [{ tokensPerSecond: 10, turnId: "turn-4" }]);
});
