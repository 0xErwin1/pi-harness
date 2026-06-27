import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryRunStore } from "../../packages/subagent-manager-core/store.ts";
import type { RunEvent, RunSnapshot } from "../../packages/subagent-manager-core/events.ts";

function makeStore() {
	const store = new InMemoryRunStore();
	store.create({ id: "r1", agent: "alpha", policyMode: "normal", requestedExecutionMode: "auto" });
	return store;
}

function startedEvent(runId = "r1"): RunEvent {
	return { id: "e1", runId, type: "run.started", agent: "alpha", at: new Date().toISOString() };
}

function outputEvent(runId = "r1", extra?: { role?: "assistant"; text?: string; turn?: number }): RunEvent {
	const base = {
		id: "e2",
		runId,
		type: "run.output" as const,
		chunk: extra?.text ?? "chunk",
		at: new Date().toISOString(),
	};
	return (extra ? { ...base, ...extra } : base) as RunEvent;
}

test("subscribe: listener receives event and snapshot on append", () => {
	const store = makeStore();
	const received: Array<{ event: RunEvent; snapshot: RunSnapshot }> = [];

	store.subscribe((event, snapshot) => {
		received.push({ event, snapshot });
	});

	const ev = startedEvent();
	store.append(ev);

	assert.equal(received.length, 1);
	assert.equal(received[0].event.type, "run.started");
	assert.equal(received[0].snapshot.id, "r1");
});

test("subscribe: unsubscribe stops delivery", () => {
	const store = makeStore();
	const received: RunEvent[] = [];

	const unsub = store.subscribe((event) => {
		received.push(event);
	});

	store.append(startedEvent());
	assert.equal(received.length, 1);

	unsub();
	store.append(startedEvent());
	assert.equal(received.length, 1);
});

test("subscribe: multiple listeners all receive the same event", () => {
	const store = makeStore();
	const a: RunEvent[] = [];
	const b: RunEvent[] = [];

	store.subscribe((e) => a.push(e));
	store.subscribe((e) => b.push(e));

	store.append(startedEvent());

	assert.equal(a.length, 1);
	assert.equal(b.length, 1);
});

test("subscribe: throwing listener does not break append or subsequent listeners", () => {
	const store = makeStore();
	const received: RunEvent[] = [];

	store.subscribe(() => {
		throw new Error("UI fault");
	});
	store.subscribe((e) => received.push(e));

	assert.doesNotThrow(() => store.append(startedEvent()));

	assert.equal(received.length, 1);
	const snapshot = store.get("r1");
	assert.ok(snapshot, "snapshot must still be accessible after a throwing listener");
});

test("subscribe: throwing listener on first call does not poison further appends", () => {
	const store = makeStore();
	const received: RunEvent[] = [];
	let callCount = 0;

	store.subscribe(() => {
		callCount++;
		throw new Error("always throws");
	});
	store.subscribe((e) => received.push(e));

	store.append(startedEvent());
	store.append(outputEvent());

	assert.equal(callCount, 2);
	assert.equal(received.length, 2);
});

test("messagesFor: accumulates assistant run.output in turn order", () => {
	const store = makeStore();

	store.append(outputEvent("r1", { role: "assistant", text: "hello", turn: 1 }));
	store.append(outputEvent("r1", { role: "assistant", text: "world", turn: 2 }));

	const msgs = store.messagesFor("r1");
	assert.equal(msgs.length, 2);
	assert.equal(msgs[0].text, "hello");
	assert.equal(msgs[0].turn, 1);
	assert.equal(msgs[1].text, "world");
	assert.equal(msgs[1].turn, 2);
});

test("messagesFor: non-assistant run.output is not accumulated", () => {
	const store = makeStore();

	store.append(outputEvent("r1"));

	const msgs = store.messagesFor("r1");
	assert.equal(msgs.length, 0);
});

test("messagesFor: run.output without text is not accumulated even with assistant role", () => {
	const store = makeStore();

	store.append({ id: "e1", runId: "r1", type: "run.output" as const, chunk: "x", role: "assistant", at: new Date().toISOString() } as RunEvent);

	const msgs = store.messagesFor("r1");
	assert.equal(msgs.length, 0);
});

test("messagesFor: returns a snapshot copy (mutation does not affect store state)", () => {
	const store = makeStore();
	store.append(outputEvent("r1", { role: "assistant", text: "msg", turn: 1 }));

	const msgs = store.messagesFor("r1");
	msgs.push({ role: "assistant", text: "injected", turn: 99, at: new Date().toISOString() });

	assert.equal(store.messagesFor("r1").length, 1);
});

test("messagesFor: returns empty array for unknown runId", () => {
	const store = makeStore();
	assert.deepEqual(store.messagesFor("no-such-run"), []);
});

test("applyEvent: run.output tokens accumulate additively onto the snapshot", () => {
	const store = makeStore();

	store.append({ id: "e1", runId: "r1", type: "run.output", chunk: "a", tokens: 150, at: new Date().toISOString() } as RunEvent);
	store.append({ id: "e2", runId: "r1", type: "run.output", chunk: "b", tokens: 225, at: new Date().toISOString() } as RunEvent);

	assert.equal(store.get("r1")?.tokens, 375, "token totals must accumulate across outputs");
});

test("applyEvent: a run.output without tokens leaves the running total untouched", () => {
	const store = makeStore();

	store.append({ id: "e1", runId: "r1", type: "run.output", chunk: "a", tokens: 100, at: new Date().toISOString() } as RunEvent);
	store.append(outputEvent("r1", { role: "assistant", text: "no usage here", turn: 1 }));

	assert.equal(store.get("r1")?.tokens, 100);
});

test("applyEvent: tool progress increments the snapshot tool count; non-tool progress does not", () => {
	const store = makeStore();

	store.append({ id: "e1", runId: "r1", type: "run.progress", message: "tool: Read", at: new Date().toISOString() } as RunEvent);
	store.append({ id: "e2", runId: "r1", type: "run.progress", message: "tool: Bash", at: new Date().toISOString() } as RunEvent);
	store.append({ id: "e3", runId: "r1", type: "run.progress", message: "starting subprocess", at: new Date().toISOString() } as RunEvent);

	assert.equal(store.get("r1")?.toolCount, 2, "only 'tool:' progress events count");
});

test("existing eventsFor behavior unchanged after subscribe wiring", () => {
	const store = makeStore();
	const ev = startedEvent();
	store.append(ev);

	const events = store.eventsFor("r1");
	assert.equal(events.length, 1);
	assert.equal(events[0].type, "run.started");
});

test("existing get behavior unchanged after subscribe wiring", () => {
	const store = makeStore();
	store.append(startedEvent());

	const snapshot = store.get("r1");
	assert.ok(snapshot);
	assert.equal(snapshot.status, "running");
});

test("existing list behavior unchanged after subscribe wiring", () => {
	const store = makeStore();
	store.create({ id: "r2", agent: "beta", policyMode: "normal", requestedExecutionMode: "auto" });

	const list = store.list();
	assert.equal(list.length, 2);
});
