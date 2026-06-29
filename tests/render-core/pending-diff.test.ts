import test from "node:test";
import assert from "node:assert/strict";
import { projectPendingEdit } from "../../packages/render-core/formatters/pending-diff.ts";

// ── edit tool ────────────────────────────────────────────────────────────────

test("projectPendingEdit: edit — old_string found — includes a del row for old text", () => {
	const args = { path: "a.txt", old_string: "hello", new_string: "world" };
	const rows = projectPendingEdit(args, "before\nhello\nafter");
	assert.ok(
		rows.some((r) => r.kind === "del" && r.text.includes("hello")),
		`expected del row with 'hello': ${JSON.stringify(rows)}`,
	);
});

test("projectPendingEdit: edit — old_string found — includes an add row for new text", () => {
	const args = { path: "a.txt", old_string: "hello", new_string: "world" };
	const rows = projectPendingEdit(args, "before\nhello\nafter");
	assert.ok(
		rows.some((r) => r.kind === "add" && r.text.includes("world")),
		`expected add row with 'world': ${JSON.stringify(rows)}`,
	);
});

test("projectPendingEdit: edit — old_string found — includes context rows for surrounding lines", () => {
	const args = { path: "a.txt", old_string: "hello", new_string: "world" };
	const rows = projectPendingEdit(args, "before\nhello\nafter");
	assert.ok(
		rows.some((r) => r.kind === "context"),
		`expected at least one context row: ${JSON.stringify(rows)}`,
	);
});

test("projectPendingEdit: edit — old_string not in file — returns empty array", () => {
	const args = { path: "a.txt", old_string: "missing", new_string: "world" };
	const rows = projectPendingEdit(args, "line1\nline2\nline3");
	assert.deepEqual(rows, []);
});

test("projectPendingEdit: edit — currentFileContent undefined — returns empty array", () => {
	const args = { path: "a.txt", old_string: "hello", new_string: "world" };
	const rows = projectPendingEdit(args, undefined);
	assert.deepEqual(rows, []);
});

test("projectPendingEdit: edit — old_string arg missing — returns empty array", () => {
	const args = { path: "a.txt", new_string: "world" };
	const rows = projectPendingEdit(args, "hello");
	assert.deepEqual(rows, []);
});

test("projectPendingEdit: edit — new_string arg missing — returns empty array", () => {
	const args = { path: "a.txt", old_string: "hello" };
	const rows = projectPendingEdit(args, "hello");
	assert.deepEqual(rows, []);
});

// ── write tool ───────────────────────────────────────────────────────────────

test("projectPendingEdit: write — new file (no existing content) — returns only add rows", () => {
	const args = { path: "new.txt", content: "line1\nline2\n" };
	const rows = projectPendingEdit(args, undefined);
	assert.ok(rows.length > 0, "expected non-empty result for new file");
	assert.ok(
		rows.every((r) => r.kind === "add" || r.kind === "more"),
		`expected only add/more rows: ${JSON.stringify(rows)}`,
	);
});

test("projectPendingEdit: write — new file — add rows include content text", () => {
	const args = { path: "new.txt", content: "hello\nworld\n" };
	const rows = projectPendingEdit(args, undefined);
	assert.ok(
		rows.some((r) => r.text.includes("hello")),
		`expected 'hello' in rows: ${JSON.stringify(rows)}`,
	);
});

test("projectPendingEdit: write — existing file — returns non-empty array", () => {
	const args = { path: "a.txt", content: "new content\n" };
	const rows = projectPendingEdit(args, "old content\n");
	assert.ok(rows.length > 0, "expected non-empty diff");
});

test("projectPendingEdit: write — existing file — includes del rows for old content", () => {
	const args = { path: "a.txt", content: "new\n" };
	const rows = projectPendingEdit(args, "old\n");
	assert.ok(
		rows.some((r) => r.kind === "del" && r.text.includes("old")),
		`expected del row with 'old': ${JSON.stringify(rows)}`,
	);
});

test("projectPendingEdit: write — content arg missing — returns empty array", () => {
	const args = { path: "a.txt" };
	const rows = projectPendingEdit(args, undefined);
	assert.deepEqual(rows, []);
});

// ── general ──────────────────────────────────────────────────────────────────

test("projectPendingEdit: non-object args — returns empty array", () => {
	const rows = projectPendingEdit("not an object", undefined);
	assert.deepEqual(rows, []);
});

test("projectPendingEdit: null args — returns empty array", () => {
	const rows = projectPendingEdit(null, undefined);
	assert.deepEqual(rows, []);
});

test("projectPendingEdit: cap limits total rows — appends a more row when exceeded", () => {
	const longOld = Array.from({ length: 30 }, (_, i) => `old line ${i}`).join("\n");
	const longNew = Array.from({ length: 30 }, (_, i) => `new line ${i}`).join("\n");
	const args = { path: "a.txt", old_string: longOld, new_string: longNew };
	const rows = projectPendingEdit(args, longOld, 10);
	assert.equal(rows.length, 11, `expected 10 data rows + 1 more row, got ${rows.length}: ${JSON.stringify(rows.map((r) => r.kind))}`);
	assert.equal(rows[10].kind, "more");
});
