import test from "node:test";
import assert from "node:assert/strict";
import { PromptDb } from "../../packages/prompt-stash/db.ts";

/** A monotonic clock so `createdAt` values are deterministic and strictly ordered. */
function fakeClock(): () => string {
	let n = 0;
	return () => `2024-01-01T00:00:${String(n++).padStart(2, "0")}.000Z`;
}

function freshDb(): PromptDb {
	return new PromptDb(":memory:", { now: fakeClock() });
}

// ── stash ─────────────────────────────────────────────────────────────────────

test("saveStash + listStash: entries come back newest-first, scoped by session", () => {
	const db = freshDb();
	db.saveStash("s1", "first");
	db.saveStash("s1", "second");
	db.saveStash("s2", "other-session");

	const s1 = db.listStash("s1");
	assert.deepEqual(s1.map((e) => e.text), ["second", "first"]);
	assert.deepEqual(db.listStash("s2").map((e) => e.text), ["other-session"]);
	db.close();
});

test("saveStash: dedup (default) removes a prior identical entry so the freshest wins", () => {
	const db = freshDb();
	db.saveStash("s1", "dup");
	db.saveStash("s1", "keep");
	db.saveStash("s1", "dup");

	assert.deepEqual(db.listStash("s1").map((e) => e.text), ["dup", "keep"], "only one 'dup', now newest");
	db.close();
});

test("countStash: counts a session's entries, scoped and live after removal", () => {
	const db = freshDb();
	assert.equal(db.countStash("s1"), 0, "empty session counts zero");

	db.saveStash("s1", "a");
	db.saveStash("s1", "b");
	db.saveStash("s2", "other");

	assert.equal(db.countStash("s1"), 2);
	assert.equal(db.countStash("s2"), 1, "count is per-session");

	db.popLast("s1");
	assert.equal(db.countStash("s1"), 1, "count drops after a pop");
	db.close();
});

test("saveStash: dedup can be disabled to keep identical copies", () => {
	const db = freshDb();
	db.saveStash("s1", "dup", { dedup: false });
	db.saveStash("s1", "dup", { dedup: false });
	assert.equal(db.listStash("s1").length, 2);
	db.close();
});

test("popLast: removes and returns the newest entry; undefined when empty", () => {
	const db = freshDb();
	db.saveStash("s1", "old");
	db.saveStash("s1", "new");

	assert.equal(db.popLast("s1")?.text, "new");
	assert.deepEqual(db.listStash("s1").map((e) => e.text), ["old"]);
	assert.equal(db.popLast("s1")?.text, "old");
	assert.equal(db.popLast("s1"), undefined);
	db.close();
});

test("removeStash and clearStash", () => {
	const db = freshDb();
	const a = db.saveStash("s1", "a");
	db.saveStash("s1", "b");

	assert.equal(db.removeStash(a.id), true);
	assert.equal(db.removeStash(a.id), false, "already gone");
	assert.deepEqual(db.listStash("s1").map((e) => e.text), ["b"]);

	db.saveStash("s1", "c");
	assert.equal(db.clearStash("s1"), 2);
	assert.deepEqual(db.listStash("s1"), []);
	db.close();
});

test("searchStash: case-insensitive substring, treats wildcards literally", () => {
	const db = freshDb();
	db.saveStash("s1", "Fix the LOGIN bug");
	db.saveStash("s1", "refactor parser");
	db.saveStash("s1", "100% done");

	assert.deepEqual(db.searchStash("s1", "login").map((e) => e.text), ["Fix the LOGIN bug"]);
	assert.deepEqual(db.searchStash("s1", "100%").map((e) => e.text), ["100% done"], "% is literal, not a wildcard");
	assert.deepEqual(db.searchStash("s1", "  ").map((e) => e.text).length, 3, "blank query lists all");
	db.close();
});

// ── history ───────────────────────────────────────────────────────────────────

test("addHistory: records prompts, newest-first, with project/cwd", () => {
	const db = freshDb();
	db.addHistory({ sessionId: "s1", project: "pi-harness", cwd: "/repo", text: "do a thing" });
	db.addHistory({ sessionId: "s1", project: "pi-harness", cwd: "/repo", text: "then another" });

	const all = db.listHistory();
	assert.deepEqual(all.map((e) => e.text), ["then another", "do a thing"]);
	assert.equal(all[0].project, "pi-harness");
	assert.equal(all[0].cwd, "/repo");
	db.close();
});

test("addHistory: skips a prompt identical to the immediately previous one, and blank text", () => {
	const db = freshDb();
	assert.ok(db.addHistory({ sessionId: "s1", text: "same" }));
	assert.equal(db.addHistory({ sessionId: "s1", text: "same" }), undefined, "consecutive duplicate skipped");
	assert.ok(db.addHistory({ sessionId: "s1", text: "different" }));
	assert.ok(db.addHistory({ sessionId: "s1", text: "same" }), "non-consecutive duplicate is allowed");
	assert.equal(db.addHistory({ sessionId: "s1", text: "   " }), undefined, "blank skipped");

	assert.deepEqual(db.listHistory().map((e) => e.text), ["same", "different", "same"]);
	db.close();
});

test("addHistory: consecutive-dedup can be disabled", () => {
	const db = freshDb();
	db.addHistory({ sessionId: "s1", text: "x" }, { dedupConsecutive: false });
	db.addHistory({ sessionId: "s1", text: "x" }, { dedupConsecutive: false });
	assert.equal(db.listHistory().length, 2);
	db.close();
});

test("listHistory: query filter and limit", () => {
	const db = freshDb();
	for (let i = 0; i < 5; i++) db.addHistory({ sessionId: "s1", text: `entry ${i}` });
	db.addHistory({ sessionId: "s1", text: "special token" });

	assert.deepEqual(db.listHistory({ query: "special" }).map((e) => e.text), ["special token"]);
	assert.equal(db.listHistory({ limit: 2 }).length, 2);
	assert.equal(db.listHistory({ limit: 2 })[0].text, "special token", "limit keeps the newest");
	db.close();
});

test("history is permanent across sessions; stash is per-session", () => {
	const db = freshDb();
	db.saveStash("s1", "draft-a");
	db.addHistory({ sessionId: "s1", text: "p1" });
	db.addHistory({ sessionId: "s2", text: "p2" });

	assert.deepEqual(db.listStash("s2"), [], "stash does not leak across sessions");
	assert.deepEqual(db.listHistory().map((e) => e.text), ["p2", "p1"], "history spans every session");
	db.close();
});
