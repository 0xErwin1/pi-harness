import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { createFileBackedViewerRuntime } from "../../packages/subagent-manager-pi/tui/file-backed-viewer.ts";
import { jsonlPath } from "../../packages/subagent-manager-core/file-tree/paths.ts";
import { writeMeta, type AgentMeta } from "../../packages/subagent-manager-core/file-tree/meta.ts";
import { writePromptLine, appendEventLine } from "../../packages/subagent-manager-core/file-tree/jsonl.ts";
import type { RunEvent } from "../../packages/subagent-manager-core/events.ts";

function tempDir(): string {
	const dir = join(tmpdir(), `pht-fbv-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function progress(runId: string, message: string): RunEvent {
	return { id: randomUUID(), runId, type: "run.progress", at: "2024-01-01T00:00:00.000Z", message };
}

test("createFileBackedViewerRuntime: events() returns the parsed transcript events", () => {
	const root = tempDir();
	const agentId = "proc-1-run-7";
	try {
		const path = jsonlPath(root, agentId);
		writePromptLine(path, { agentId, prompt: "do the thing", cwd: "/x", at: "2024-01-01T00:00:00.000Z" });
		appendEventLine(path, progress(agentId, "tool: read"));
		appendEventLine(path, progress(agentId, "tool: bash"));

		const runtime = createFileBackedViewerRuntime(root, agentId);
		const events = runtime.events(agentId);

		assert.equal(events.length, 2);
		assert.equal(events[0].type, "run.progress");
		assert.equal((events[1] as { message: string }).message, "tool: bash");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("createFileBackedViewerRuntime: snapshot() maps AgentMeta fields onto RunSnapshot", () => {
	const root = tempDir();
	const agentId = "proc-2-run-3";
	try {
		const meta: AgentMeta = {
			agentId,
			parentAgentId: "proc-1-run-1",
			rootSessionId: "sess",
			depth: 2,
			agentType: "explore",
			task: "scan the repo",
			prompt: "explore everything",
			status: "running",
			startedAt: "2024-01-01T00:00:00.000Z",
			endedAt: undefined,
			tokens: 1234,
			tools: 5,
			cwd: "/repo",
			pid: 999,
			updatedAt: "2024-01-01T00:01:00.000Z",
		};
		writeMeta(root, meta);

		const snapshot = createFileBackedViewerRuntime(root, agentId).snapshot(agentId);

		assert.ok(snapshot);
		assert.equal(snapshot.id, agentId);
		assert.equal(snapshot.agent, "explore");
		assert.equal(snapshot.task, "scan the repo");
		assert.equal(snapshot.prompt, "explore everything");
		assert.equal(snapshot.status, "running");
		assert.equal(snapshot.startedAt, "2024-01-01T00:00:00.000Z");
		assert.equal(snapshot.updatedAt, "2024-01-01T00:01:00.000Z");
		assert.equal(snapshot.tokens, 1234);
		assert.equal(snapshot.toolCount, 5);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("createFileBackedViewerRuntime: missing files yield empty events and undefined snapshot without throwing", () => {
	const root = tempDir();
	try {
		const runtime = createFileBackedViewerRuntime(root, "nope-1-run-1");

		assert.deepEqual(runtime.events("nope-1-run-1"), []);
		assert.equal(runtime.snapshot("nope-1-run-1"), undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("createFileBackedViewerRuntime: subscribe returns an unsubscribe that clears the poll timer without leaking", () => {
	const root = tempDir();
	const agentId = "proc-3-run-1";
	try {
		const runtime = createFileBackedViewerRuntime(root, agentId);
		const unsubscribe = runtime.subscribe(() => {});

		assert.equal(typeof unsubscribe, "function");
		unsubscribe();
		unsubscribe();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
