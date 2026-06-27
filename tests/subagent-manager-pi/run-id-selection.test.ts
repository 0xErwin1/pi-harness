import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectMostRecentRunId } from "../../packages/subagent-manager-pi/run-id-selection.ts";
import type { RunSnapshot } from "../../packages/subagent-manager-core/events.ts";

function makeSnapshot(id: string, status: RunSnapshot["status"], startedAt: string): RunSnapshot {
	return {
		id,
		agent: "test",
		status,
		requestedExecutionMode: "auto",
		policyMode: "writer",
		startedAt,
		updatedAt: startedAt,
	};
}

describe("selectMostRecentRunId", () => {
	it("returns undefined for empty snapshot array", () => {
		assert.strictEqual(selectMostRecentRunId([]), undefined);
	});

	it("picks the most recent run when all are completed", () => {
		const snapshots = [
			makeSnapshot("run-a", "completed", "2024-01-01T10:00:00.000Z"),
			makeSnapshot("run-b", "completed", "2024-01-01T11:00:00.000Z"),
			makeSnapshot("run-c", "completed", "2024-01-01T09:00:00.000Z"),
		];
		assert.strictEqual(selectMostRecentRunId(snapshots), "run-b");
	});

	it("prefers the most recently started running run over completed runs", () => {
		const snapshots = [
			makeSnapshot("run-a", "completed", "2024-01-01T11:30:00.000Z"),
			makeSnapshot("run-b", "running", "2024-01-01T11:00:00.000Z"),
			makeSnapshot("run-c", "running", "2024-01-01T11:15:00.000Z"),
		];
		assert.strictEqual(selectMostRecentRunId(snapshots), "run-c");
	});

	it("falls back to any run when none are running", () => {
		const snapshots = [
			makeSnapshot("run-x", "failed", "2024-01-01T09:00:00.000Z"),
			makeSnapshot("run-y", "interrupted", "2024-01-01T10:00:00.000Z"),
		];
		assert.strictEqual(selectMostRecentRunId(snapshots), "run-y");
	});
});
