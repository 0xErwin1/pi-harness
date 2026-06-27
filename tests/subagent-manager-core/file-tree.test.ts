import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
	encodeCwd,
	agentIdFor,
	metaPath,
	jsonlPath,
} from "../../packages/subagent-manager-core/file-tree/paths.ts";
import {
	writeMeta,
	readMeta,
	type AgentMeta,
} from "../../packages/subagent-manager-core/file-tree/meta.ts";
import {
	writePromptLine,
	appendEventLine,
	readTranscript,
} from "../../packages/subagent-manager-core/file-tree/jsonl.ts";
import {
	attachFileSink,
} from "../../packages/subagent-manager-core/file-tree/sink.ts";
import {
	scanTree,
	pidAlive,
} from "../../packages/subagent-manager-core/file-tree/reader.ts";
import { InMemoryRunStore } from "../../packages/subagent-manager-core/store.ts";
import type { RunEvent } from "../../packages/subagent-manager-core/events.ts";

function tempDir(): string {
	const dir = join(tmpdir(), `pht-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

// ---------------------------------------------------------------------------
// encodeCwd
// ---------------------------------------------------------------------------

test("encodeCwd: POSIX absolute path", () => {
	assert.equal(encodeCwd("/home/user/project"), "home-user-project");
});

test("encodeCwd: Windows drive path", () => {
	assert.equal(encodeCwd("C:\\Users\\foo\\project"), "Users-foo-project");
});

test("encodeCwd: UNC path", () => {
	assert.equal(encodeCwd("\\\\server\\share\\project"), "server-share-project");
});

test("encodeCwd: POSIX path with nested dirs", () => {
	assert.equal(encodeCwd("/a/b/c"), "a-b-c");
});

// ---------------------------------------------------------------------------
// writeMeta / readMeta
// ---------------------------------------------------------------------------

test("writeMeta + readMeta: round-trip", () => {
	const root = tempDir();
	try {
		const meta: AgentMeta = {
			agentId: "test-agent-01",
			parentAgentId: null,
			rootSessionId: "sess1",
			depth: 1,
			agentType: "alpha",
			task: "do something",
			prompt: "full prompt text",
			status: "running",
			startedAt: "2024-01-01T00:00:00.000Z",
			cwd: "/home/user/project",
			pid: 12345,
			updatedAt: "2024-01-01T00:00:01.000Z",
		};

		writeMeta(root, meta);
		const retrieved = readMeta(metaPath(root, meta.agentId));

		assert.deepEqual(retrieved, meta);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("writeMeta: atomic — no .tmp file left after write", () => {
	const root = tempDir();
	try {
		const meta: AgentMeta = {
			agentId: "agent-atomic",
			parentAgentId: null,
			rootSessionId: "s",
			depth: 1,
			agentType: "a",
			status: "running",
			startedAt: "2024-01-01T00:00:00.000Z",
			cwd: "/",
			pid: 1,
			updatedAt: "2024-01-01T00:00:00.000Z",
		};

		writeMeta(root, meta);

		const finalPath = metaPath(root, meta.agentId);
		assert.ok(existsSync(finalPath), "final meta file should exist");
		assert.ok(!existsSync(`${finalPath}.tmp`), "tmp file should not remain after rename");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("readMeta: returns undefined for missing file", () => {
	assert.equal(readMeta("/tmp/definitely-missing-file-pht.meta.json"), undefined);
});

test("readMeta: returns undefined for invalid JSON", () => {
	const root = tempDir();
	try {
		const badPath = join(root, "bad.meta.json");
		writeFileSync(badPath, "{ not valid json", "utf-8");
		assert.equal(readMeta(badPath), undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// writePromptLine / appendEventLine / readTranscript
// ---------------------------------------------------------------------------

test("readTranscript: prompt + events round-trip", () => {
	const root = tempDir();
	try {
		const jPath = join(root, "test.jsonl");
		const at = "2024-01-01T00:00:00.000Z";

		writePromptLine(jPath, { agentId: "a1", prompt: "hello world", cwd: "/", at });

		const event: RunEvent = { id: "e1", runId: "r1", type: "run.started", agent: "alpha", at };
		appendEventLine(jPath, event);

		const result = readTranscript(jPath);
		assert.equal(result.prompt, "hello world");
		assert.equal(result.events.length, 1);
		assert.equal(result.events[0].type, "run.started");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("readTranscript: torn-tail tolerance — last line truncated", () => {
	const root = tempDir();
	try {
		const jPath = join(root, "torn.jsonl");
		const at = "2024-01-01T00:00:00.000Z";

		const promptLine = JSON.stringify({ kind: "prompt", agentId: "a1", prompt: "prompt text", cwd: "/", at });
		const eventLine = JSON.stringify({
			kind: "event",
			event: { id: "e1", runId: "r1", type: "run.started", agent: "alpha", at },
		});
		const tornLine = '{"kind":"event","event":{"id":"e2';

		writeFileSync(jPath, [promptLine, eventLine, tornLine].join("\n"), "utf-8");

		const result = readTranscript(jPath);
		assert.equal(result.prompt, "prompt text");
		assert.equal(result.events.length, 1);
		assert.equal(result.events[0].type, "run.started");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("readTranscript: missing file returns empty result", () => {
	const result = readTranscript("/tmp/pht-nonexistent-transcript.jsonl");
	assert.equal(result.prompt, undefined);
	assert.deepEqual(result.events, []);
});

test("readTranscript: multiple events in order", () => {
	const root = tempDir();
	try {
		const jPath = join(root, "multi.jsonl");
		const at = "2024-01-01T00:00:00.000Z";

		writePromptLine(jPath, { agentId: "a1", prompt: "p", cwd: "/", at });

		const e1: RunEvent = { id: "e1", runId: "r1", type: "run.started", agent: "a", at };
		const e2: RunEvent = { id: "e2", runId: "r1", type: "run.progress", message: "working", at };
		const e3: RunEvent = {
			id: "e3",
			runId: "r1",
			type: "run.completed",
			summary: { text: "ok", executionMode: "subprocess", routedBy: "test" },
			at,
		};

		appendEventLine(jPath, e1);
		appendEventLine(jPath, e2);
		appendEventLine(jPath, e3);

		const result = readTranscript(jPath);
		assert.equal(result.events.length, 3);
		assert.equal(result.events[0].type, "run.started");
		assert.equal(result.events[1].type, "run.progress");
		assert.equal(result.events[2].type, "run.completed");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// attachFileSink
// ---------------------------------------------------------------------------

test("attachFileSink: creates meta and jsonl on first event", () => {
	const root = tempDir();
	try {
		const store = new InMemoryRunStore();
		store.create({
			id: "run1",
			agent: "alpha",
			policyMode: "normal",
			requestedExecutionMode: "auto",
			prompt: "test prompt",
		});

		attachFileSink(store, { root });

		const at = "2024-01-01T00:00:00.000Z";
		store.append({ id: "e1", runId: "run1", type: "run.started", agent: "alpha", at });

		const agentId = agentIdFor("run1");
		const mPath = metaPath(root, agentId);
		const jPath = jsonlPath(root, agentId);

		assert.ok(existsSync(mPath), "meta file must exist after first event");
		assert.ok(existsSync(jPath), "jsonl file must exist after first event");

		const meta = readMeta(mPath);
		assert.ok(meta);
		assert.equal(meta.status, "running");
		assert.equal(meta.agentId, agentId);
		assert.equal(meta.agentType, "alpha");
		assert.equal(meta.endedAt, undefined);

		const transcript = readTranscript(jPath);
		assert.equal(transcript.prompt, "test prompt");
		assert.equal(transcript.events.length, 1);
		assert.equal(transcript.events[0].type, "run.started");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("attachFileSink: finalizes meta with endedAt on terminal event", () => {
	const root = tempDir();
	try {
		const store = new InMemoryRunStore();
		store.create({
			id: "run2",
			agent: "beta",
			policyMode: "normal",
			requestedExecutionMode: "auto",
			prompt: "run prompt",
		});

		attachFileSink(store, { root });

		const at1 = "2024-01-01T00:00:00.000Z";
		const at2 = "2024-01-01T00:01:00.000Z";

		store.append({ id: "e1", runId: "run2", type: "run.started", agent: "beta", at: at1 });

		const agentId = agentIdFor("run2");
		const mPath = metaPath(root, agentId);

		// Not terminal yet
		const meta1 = readMeta(mPath);
		assert.ok(meta1);
		assert.equal(meta1.endedAt, undefined);

		// Terminal event
		store.append({
			id: "e2",
			runId: "run2",
			type: "run.completed",
			summary: { text: "done", executionMode: "subprocess", routedBy: "test" },
			at: at2,
		});

		const meta2 = readMeta(mPath);
		assert.ok(meta2);
		assert.equal(meta2.status, "completed");
		assert.equal(meta2.endedAt, at2);

		// Transcript has both events
		const transcript = readTranscript(jsonlPath(root, agentId));
		assert.equal(transcript.events.length, 2);
		assert.equal(transcript.events[1].type, "run.completed");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("attachFileSink: tracks tokens and tool count from snapshot", () => {
	const root = tempDir();
	try {
		const store = new InMemoryRunStore();
		store.create({ id: "run3", agent: "gamma", policyMode: "normal", requestedExecutionMode: "auto" });

		attachFileSink(store, { root });

		const at = "2024-01-01T00:00:00.000Z";
		store.append({ id: "e1", runId: "run3", type: "run.started", agent: "gamma", at });
		store.append({ id: "e2", runId: "run3", type: "run.progress", message: "tool: Read", at });
		store.append({ id: "e3", runId: "run3", type: "run.output", chunk: "x", tokens: 200, at });

		const agentId = agentIdFor("run3");
		const meta = readMeta(metaPath(root, agentId));
		assert.ok(meta);
		assert.equal(meta.tokens, 200);
		assert.equal(meta.tools, 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("attachFileSink: unsubscribe stops writing", () => {
	const root = tempDir();
	try {
		const store = new InMemoryRunStore();
		store.create({ id: "run4", agent: "delta", policyMode: "normal", requestedExecutionMode: "auto" });

		const unsub = attachFileSink(store, { root });

		const at = "2024-01-01T00:00:00.000Z";
		store.append({ id: "e1", runId: "run4", type: "run.started", agent: "delta", at });

		const jPath = jsonlPath(root, agentIdFor("run4"));
		const t1 = readTranscript(jPath);
		assert.equal(t1.events.length, 1);

		unsub();

		store.append({ id: "e2", runId: "run4", type: "run.failed", error: "boom", at });

		const t2 = readTranscript(jPath);
		assert.equal(t2.events.length, 1, "no new event written after unsub");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// scanTree
// ---------------------------------------------------------------------------

const BASE_META: Omit<AgentMeta, "agentId" | "parentAgentId" | "startedAt"> = {
	rootSessionId: "sess1",
	depth: 1,
	agentType: "alpha",
	status: "completed",
	cwd: "/home/test",
	pid: process.pid,
	updatedAt: "2024-01-01T00:00:01.000Z",
};

test("scanTree: builds multi-level forest by parentAgentId", () => {
	const root = tempDir();
	try {
		writeMeta(root, { ...BASE_META, agentId: "root-agent", parentAgentId: null, startedAt: "2024-01-01T00:00:00.000Z" });
		writeMeta(root, { ...BASE_META, agentId: "child-agent", parentAgentId: "root-agent", startedAt: "2024-01-01T00:01:00.000Z" });
		writeMeta(root, { ...BASE_META, agentId: "gc-agent", parentAgentId: "child-agent", startedAt: "2024-01-01T00:02:00.000Z" });

		const forest = scanTree(root);

		assert.equal(forest.length, 1);
		assert.equal(forest[0].agentId, "root-agent");
		assert.equal(forest[0].children.length, 1);
		assert.equal(forest[0].children[0].agentId, "child-agent");
		assert.equal(forest[0].children[0].children.length, 1);
		assert.equal(forest[0].children[0].children[0].agentId, "gc-agent");
		assert.equal(forest[0].children[0].children[0].children.length, 0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scanTree: orphan node (parent not in scan) becomes root", () => {
	const root = tempDir();
	try {
		writeMeta(root, { ...BASE_META, agentId: "orphan-agent", parentAgentId: "missing-parent", startedAt: "2024-01-01T00:00:00.000Z" });

		const forest = scanTree(root);
		assert.equal(forest.length, 1);
		assert.equal(forest[0].agentId, "orphan-agent");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scanTree: orders roots by startedAt ascending", () => {
	const root = tempDir();
	try {
		writeMeta(root, { ...BASE_META, agentId: "b-agent", parentAgentId: null, startedAt: "2024-01-01T00:02:00.000Z" });
		writeMeta(root, { ...BASE_META, agentId: "a-agent", parentAgentId: null, startedAt: "2024-01-01T00:01:00.000Z" });

		const forest = scanTree(root);
		assert.equal(forest.length, 2);
		assert.equal(forest[0].agentId, "a-agent");
		assert.equal(forest[1].agentId, "b-agent");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scanTree: orders children by startedAt ascending", () => {
	const root = tempDir();
	try {
		writeMeta(root, { ...BASE_META, agentId: "parent", parentAgentId: null, startedAt: "2024-01-01T00:00:00.000Z" });
		writeMeta(root, { ...BASE_META, agentId: "child-b", parentAgentId: "parent", startedAt: "2024-01-01T00:02:00.000Z" });
		writeMeta(root, { ...BASE_META, agentId: "child-a", parentAgentId: "parent", startedAt: "2024-01-01T00:01:00.000Z" });

		const forest = scanTree(root);
		assert.equal(forest.length, 1);
		const children = forest[0].children;
		assert.equal(children.length, 2);
		assert.equal(children[0].agentId, "child-a");
		assert.equal(children[1].agentId, "child-b");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scanTree: empty directory returns empty array", () => {
	const root = tempDir();
	try {
		assert.deepEqual(scanTree(root), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scanTree: non-existent root returns empty array", () => {
	assert.deepEqual(scanTree("/tmp/pht-definitely-missing-root-dir"), []);
});

// ---------------------------------------------------------------------------
// pidAlive and staleRunning
// ---------------------------------------------------------------------------

test("pidAlive: returns true for the current process pid", () => {
	assert.equal(pidAlive(process.pid), true);
});

test("pidAlive: returns false for a dead pid", () => {
	// 9999999 is above the typical Linux max PID (32768 or 4194303 with large-pids)
	// and will always fail the kill(0) probe on a normal development machine.
	assert.equal(pidAlive(9999999), false);
});

test("scanTree: marks stale running node whose pid is not alive", () => {
	const root = tempDir();
	try {
		const at = "2024-01-01T00:00:00.000Z";

		writeMeta(root, {
			...BASE_META,
			agentId: "alive-agent",
			parentAgentId: null,
			startedAt: at,
			status: "running",
			pid: process.pid,
		});
		writeMeta(root, {
			...BASE_META,
			agentId: "stale-agent",
			parentAgentId: null,
			startedAt: at,
			status: "running",
			pid: 9999999,
		});

		const forest = scanTree(root);
		const alive = forest.find((n) => n.agentId === "alive-agent");
		const stale = forest.find((n) => n.agentId === "stale-agent");

		assert.ok(alive, "alive-agent should be in forest");
		assert.ok(stale, "stale-agent should be in forest");
		assert.equal(alive.staleRunning, undefined, "alive node must not be stale");
		assert.equal(stale.staleRunning, true, "dead-pid node must be stale");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("scanTree: completed node is never stale regardless of pid", () => {
	const root = tempDir();
	try {
		const at = "2024-01-01T00:00:00.000Z";
		writeMeta(root, {
			...BASE_META,
			agentId: "completed-dead-pid",
			parentAgentId: null,
			startedAt: at,
			status: "completed",
			pid: 9999999,
		});

		const forest = scanTree(root);
		assert.equal(forest.length, 1);
		assert.equal(forest[0].staleRunning, undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
