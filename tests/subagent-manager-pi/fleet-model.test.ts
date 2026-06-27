import test from "node:test";
import assert from "node:assert/strict";
import {
	buildFleetModel,
	type FleetRow,
	type FleetModel,
} from "../../packages/subagent-manager-pi/tui/fleet-model.ts";
import type { RunSnapshot } from "../../packages/subagent-manager-core/events.ts";

const BASE_STARTED_AT = "2024-01-01T12:00:00.000Z";
const BASE_NOW = Date.parse(BASE_STARTED_AT) + 5000;

function makeSnapshot(id: string, overrides: Partial<RunSnapshot> = {}): RunSnapshot {
	return {
		id,
		agent: `agent-${id}`,
		status: "running",
		requestedExecutionMode: "auto",
		policyMode: "normal",
		startedAt: BASE_STARTED_AT,
		updatedAt: BASE_STARTED_AT,
		...overrides,
	};
}

test("buildFleetModel: maps snapshots to FleetRow correctly", () => {
	const snapshots = [makeSnapshot("r1"), makeSnapshot("r2")];

	const model = buildFleetModel(snapshots, -1, BASE_NOW, 10);

	assert.equal(model.rows.length, 2);
	assert.equal(model.rows[0].id, "r1");
	assert.equal(model.rows[0].agent, "agent-r1");
	assert.equal(model.rows[0].status, "running");
	assert.equal(model.rows[0].elapsedMs, 5000);
});

test("buildFleetModel: selected=true on selectedIndex row", () => {
	const snapshots = [makeSnapshot("r1"), makeSnapshot("r2"), makeSnapshot("r3")];

	const model = buildFleetModel(snapshots, 1, BASE_NOW, 10);

	assert.equal(model.rows[0].selected, false);
	assert.equal(model.rows[1].selected, true);
	assert.equal(model.rows[2].selected, false);
});

test("buildFleetModel: no row selected when selectedIndex is -1", () => {
	const snapshots = [makeSnapshot("r1"), makeSnapshot("r2")];

	const model = buildFleetModel(snapshots, -1, BASE_NOW, 10);

	assert.ok(model.rows.every((r) => !r.selected), "no row should be selected with index -1");
});

test("buildFleetModel: rows capped at maxRows", () => {
	const snapshots = Array.from({ length: 8 }, (_, i) => makeSnapshot(`r${i}`));

	const model = buildFleetModel(snapshots, -1, BASE_NOW, 5);

	assert.equal(model.rows.length, 5, "rows must be capped at maxRows");
});

test("buildFleetModel: overflow = max(0, total - maxRows)", () => {
	const snapshots = Array.from({ length: 8 }, (_, i) => makeSnapshot(`r${i}`));

	const model = buildFleetModel(snapshots, -1, BASE_NOW, 5);

	assert.equal(model.overflow, 3, "overflow must count rows beyond maxRows cap");
});

test("buildFleetModel: overflow=0 when all rows fit", () => {
	const snapshots = [makeSnapshot("r1"), makeSnapshot("r2")];

	const model = buildFleetModel(snapshots, -1, BASE_NOW, 10);

	assert.equal(model.overflow, 0);
});

test("buildFleetModel: elapsedMs computed from startedAt to now", () => {
	const startedAt = "2024-01-01T12:00:00.000Z";
	const nowMs = Date.parse(startedAt) + 9876;
	const snapshots = [makeSnapshot("r1", { startedAt })];

	const model = buildFleetModel(snapshots, -1, nowMs, 10);

	assert.equal(model.rows[0].elapsedMs, 9876);
});

test("buildFleetModel: empty snapshots → empty rows and overflow=0", () => {
	const model = buildFleetModel([], -1, BASE_NOW, 10);

	assert.equal(model.rows.length, 0);
	assert.equal(model.overflow, 0);
});

test("buildFleetModel: status is reflected in each row", () => {
	const snapshots = [
		makeSnapshot("r1", { status: "completed" }),
		makeSnapshot("r2", { status: "failed" }),
	];

	const model = buildFleetModel(snapshots, -1, BASE_NOW, 10);

	assert.equal(model.rows[0].status, "completed");
	assert.equal(model.rows[1].status, "failed");
});

test("buildFleetModel: selectedIndex out of range does not crash and selects nothing", () => {
	const snapshots = [makeSnapshot("r1")];

	const model = buildFleetModel(snapshots, 99, BASE_NOW, 10);

	assert.ok(model.rows.every((r) => !r.selected), "out-of-range index selects no row");
});
