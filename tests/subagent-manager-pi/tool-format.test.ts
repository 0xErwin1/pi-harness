import test from "node:test";
import assert from "node:assert/strict";
import {
	diffBlockLines,
	formatToolArgs,
	parseDiffStat,
	summarizeToolResult,
} from "../../packages/subagent-manager-pi/tool-format/index.ts";

// ── formatToolArgs ──────────────────────────────────────────────────────────

test("formatToolArgs: read shows just the path when no range", () => {
	assert.equal(formatToolArgs("read", { path: "src/a.ts" }), "src/a.ts");
});

test("formatToolArgs: read shows path:start-end from offset+limit", () => {
	assert.equal(formatToolArgs("read", { path: "src/a.ts", offset: 10, limit: 20 }), "src/a.ts:10-29");
});

test("formatToolArgs: read shows path:offset when only offset is present", () => {
	assert.equal(formatToolArgs("read", { path: "src/a.ts", offset: 10 }), "src/a.ts:10");
});

test("formatToolArgs: bash prefixes the command with a $ prompt", () => {
	assert.equal(formatToolArgs("bash", { command: "ls -la" }), "$ ls -la");
});

test("formatToolArgs: grep shows the pattern", () => {
	assert.equal(formatToolArgs("grep", { pattern: "TODO", path: "src" }), "TODO");
});

test("formatToolArgs: find shows the pattern", () => {
	assert.equal(formatToolArgs("find", { pattern: "*.ts" }), "*.ts");
});

test("formatToolArgs: ls shows the path, defaulting to '.'", () => {
	assert.equal(formatToolArgs("ls", { path: "src" }), "src");
	assert.equal(formatToolArgs("ls", {}), ".");
});

test("formatToolArgs: edit and write show the path", () => {
	assert.equal(formatToolArgs("edit", { path: "src/a.ts" }), "src/a.ts");
	assert.equal(formatToolArgs("write", { path: "src/a.ts", content: "x" }), "src/a.ts");
});

test("formatToolArgs: case-insensitive on the tool name", () => {
	assert.equal(formatToolArgs("READ", { path: "p" }), "p");
	assert.equal(formatToolArgs("Bash", { command: "echo" }), "$ echo");
});

test("formatToolArgs: unknown tool yields an empty string", () => {
	assert.equal(formatToolArgs("frobnicate", { path: "x" }), "");
});

test("formatToolArgs: tolerates missing/malformed args without throwing", () => {
	assert.equal(formatToolArgs("read", undefined), "");
	assert.equal(formatToolArgs("bash", {}), "$ ");
	assert.equal(formatToolArgs("read", { path: 42 }), "");
});

// ── summarizeToolResult ─────────────────────────────────────────────────────

test("summarizeToolResult: read counts lines from output when no details", () => {
	assert.deepEqual(summarizeToolResult("read", { path: "a" }, "l1\nl2\nl3\n", undefined), {
		text: "3 lines",
		status: "neutral",
	});
});

test("summarizeToolResult: read shows out/total when truncated", () => {
	const details = { truncation: { truncated: true, outputLines: 50, totalLines: 200 } };
	assert.deepEqual(summarizeToolResult("read", { path: "a" }, "ignored", details), {
		text: "50/200 lines",
		status: "neutral",
	});
});

test("summarizeToolResult: read uses outputLines when present and not truncated", () => {
	const details = { truncation: { truncated: false, outputLines: 5 } };
	assert.deepEqual(summarizeToolResult("read", { path: "a" }, "ignored", details), {
		text: "5 lines",
		status: "neutral",
	});
});

test("summarizeToolResult: bash exit 0 is ok-status", () => {
	assert.deepEqual(summarizeToolResult("bash", { command: "x" }, "line1\nline2\nexit code: 0", undefined), {
		text: "exit 0 · 3 lines",
		status: "ok",
	});
});

test("summarizeToolResult: bash nonzero exit is error-status", () => {
	assert.deepEqual(summarizeToolResult("bash", { command: "x" }, "boom\nexit code: 2", undefined), {
		text: "exit 2 · 2 lines",
		status: "error",
	});
});

test("summarizeToolResult: bash without an exit trailer falls back to a line count", () => {
	assert.deepEqual(summarizeToolResult("bash", { command: "x" }, "a\nb", undefined), {
		text: "2 lines",
		status: "neutral",
	});
});

test("summarizeToolResult: grep pluralizes matches", () => {
	assert.deepEqual(summarizeToolResult("grep", { pattern: "x" }, "one hit", undefined), {
		text: "1 match",
		status: "neutral",
	});
	assert.deepEqual(summarizeToolResult("grep", { pattern: "x" }, "a\nb\nc", undefined), {
		text: "3 matches",
		status: "neutral",
	});
});

test("summarizeToolResult: find and ls pluralize results", () => {
	assert.deepEqual(summarizeToolResult("find", { pattern: "x" }, "a\nb", undefined).text, "2 results");
	assert.deepEqual(summarizeToolResult("ls", { path: "x" }, "only", undefined).text, "1 result");
});

test("summarizeToolResult: edit reports +adds -removals from the diff", () => {
	const diff = "--- a/x\n+++ b/x\n@@ -1,2 +1,3 @@\n ctx\n-old\n+new1\n+new2";
	assert.deepEqual(summarizeToolResult("edit", { path: "x" }, "", { diff }), {
		text: "+2 -1",
		status: "neutral",
	});
});

test("summarizeToolResult: edit without a diff yields an empty summary", () => {
	assert.deepEqual(summarizeToolResult("edit", { path: "x" }, "", undefined), {
		text: "",
		status: "neutral",
	});
});

test("summarizeToolResult: write counts lines from args.content (details is undefined)", () => {
	assert.deepEqual(summarizeToolResult("write", { path: "x", content: "a\nb\nc" }, "Wrote file", undefined), {
		text: "3 lines",
		status: "neutral",
	});
});

test("summarizeToolResult: unknown tool yields a neutral empty summary", () => {
	assert.deepEqual(summarizeToolResult("frobnicate", {}, "whatever", undefined), {
		text: "",
		status: "neutral",
	});
});

// ── parseDiffStat ───────────────────────────────────────────────────────────

test("parseDiffStat: counts +/- excluding +++/--- headers and @@ hunks", () => {
	const diff = "--- a/x\n+++ b/x\n@@ -1,4 +1,5 @@\n ctx\n-removed\n+added1\n+added2\n+added3";
	assert.deepEqual(parseDiffStat(diff), { additions: 3, removals: 1 });
});

test("parseDiffStat: empty deletions/additions are counted, headers are not", () => {
	const diff = "--- a\n+++ b\n@@ @@\n-\n+\n+x";
	assert.deepEqual(parseDiffStat(diff), { additions: 2, removals: 1 });
});

test("parseDiffStat: a diff with no changes is zero", () => {
	assert.deepEqual(parseDiffStat("@@ -1 +1 @@\n ctx only"), { additions: 0, removals: 0 });
});

// ── diffBlockLines ──────────────────────────────────────────────────────────

test("diffBlockLines: classifies add/del/context and drops file headers", () => {
	const diff = "--- a/x\n+++ b/x\n@@ -1,2 +1,3 @@\n ctx\n-old\n+new";
	assert.deepEqual(diffBlockLines(diff), [
		{ kind: "context", text: "@@ -1,2 +1,3 @@" },
		{ kind: "context", text: " ctx" },
		{ kind: "del", text: "-old" },
		{ kind: "add", text: "+new" },
	]);
});

test("diffBlockLines: caps the block and appends a '… +N more' line", () => {
	const body = Array.from({ length: 25 }, (_, i) => ` ctx${i}`).join("\n");
	const diff = `--- a\n+++ b\n${body}`;
	const lines = diffBlockLines(diff, 20);

	assert.equal(lines.length, 21);
	assert.deepEqual(lines[20], { kind: "more", text: "… +5 more" });
	assert.ok(lines.slice(0, 20).every((l) => l.kind === "context"));
});

test("diffBlockLines: respects a custom cap", () => {
	const body = Array.from({ length: 10 }, (_, i) => `+a${i}`).join("\n");
	const lines = diffBlockLines(`--- a\n+++ b\n${body}`, 3);

	assert.equal(lines.length, 4);
	assert.deepEqual(lines[3], { kind: "more", text: "… +7 more" });
	assert.ok(lines.slice(0, 3).every((l) => l.kind === "add"));
});

test("diffBlockLines: no continuation when within the cap", () => {
	const lines = diffBlockLines("--- a\n+++ b\n+one\n-two", 20);
	assert.equal(lines.length, 2);
	assert.ok(!lines.some((l) => l.kind === "more"));
});
