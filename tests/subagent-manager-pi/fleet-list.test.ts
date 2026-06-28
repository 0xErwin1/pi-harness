import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	FleetList,
	type FleetRuntime,
	reduceFleetNav,
	resolveRestoreIndex,
	rowIndicator,
	shouldFleetHandleKey,
} from "../../packages/subagent-manager-pi/tui/fleet-list.ts";
import type { FleetRow } from "../../packages/subagent-manager-pi/tui/fleet-model.ts";
import type { RunEvent, RunSnapshot } from "../../packages/subagent-manager-core/events.ts";
import type { RunStoreListener } from "../../packages/subagent-manager-core/store.ts";
import { ICON_CATALOG } from "../../packages/subagent-manager-pi/icons/catalog.ts";
import { getIcons, resetIconsCache, setIconMode } from "../../packages/subagent-manager-pi/icons/config.ts";

const ROWS = 3;

test("shouldFleetHandleKey: acts only at an empty prompt with no overlay open", () => {
	assert.equal(shouldFleetHandleKey(true, false), true, "empty prompt, no overlay → act");
});

test("shouldFleetHandleKey: stays inert while a conversation overlay is open", () => {
	assert.equal(shouldFleetHandleKey(true, true), false, "overlay open → must not consume keys (Esc must reach the overlay)");
});

test("shouldFleetHandleKey: never acts when the editor has text", () => {
	assert.equal(shouldFleetHandleKey(false, false), false, "typing must never be swallowed");
	assert.equal(shouldFleetHandleKey(false, true), false);
});

test("reduceFleetNav: down at the inactive prompt no longer activates and passes through", () => {
	assert.deepEqual(reduceFleetNav("down", -1, ROWS), {
		selectedIndex: -1,
		consume: false,
		open: null,
	});
});

test("reduceFleetNav: down still advances and clamps the selection once the fleet is active", () => {
	assert.deepEqual(reduceFleetNav("down", 0, ROWS).selectedIndex, 1);
	assert.deepEqual(reduceFleetNav("down", ROWS - 1, ROWS), {
		selectedIndex: ROWS - 1,
		consume: true,
		open: null,
	});
});

test("reduceFleetNav: up at the inactive prompt passes through to the editor", () => {
	assert.deepEqual(reduceFleetNav("up", -1, ROWS), {
		selectedIndex: -1,
		consume: false,
		open: null,
	});
});

test("reduceFleetNav: up from the first row clears selection and consumes", () => {
	assert.deepEqual(reduceFleetNav("up", 0, ROWS), {
		selectedIndex: -1,
		consume: true,
		open: null,
	});
});

test("reduceFleetNav: up moves the selection up within the list", () => {
	assert.deepEqual(reduceFleetNav("up", 2, ROWS), {
		selectedIndex: 1,
		consume: true,
		open: null,
	});
});

test("reduceFleetNav: enter opens the selected row", () => {
	assert.deepEqual(reduceFleetNav("enter", 1, ROWS), {
		selectedIndex: 1,
		consume: true,
		open: 1,
	});
});

test("reduceFleetNav: enter at the inactive prompt passes through", () => {
	assert.deepEqual(reduceFleetNav("enter", -1, ROWS), {
		selectedIndex: -1,
		consume: false,
		open: null,
	});
});

test("reduceFleetNav: escape clears an active selection, passes through when inactive", () => {
	assert.deepEqual(reduceFleetNav("escape", 2, ROWS), {
		selectedIndex: -1,
		consume: true,
		open: null,
	});
	assert.deepEqual(reduceFleetNav("escape", -1, ROWS), {
		selectedIndex: -1,
		consume: false,
		open: null,
	});
});

test("reduceFleetNav: no rows means nothing is consumed", () => {
	for (const key of ["up", "down", "left", "enter", "escape"] as const) {
		assert.deepEqual(reduceFleetNav(key, -1, 0), {
			selectedIndex: -1,
			consume: false,
			open: null,
		});
	}
});

test("reduceFleetNav: left activates the inactive fleet (P6, now the sole activator)", () => {
	assert.deepEqual(reduceFleetNav("left", -1, ROWS), {
		selectedIndex: 0,
		consume: true,
		open: null,
	});
});

test("reduceFleetNav: left is not consumed once the fleet is already active (P6)", () => {
	assert.deepEqual(reduceFleetNav("left", 1, ROWS), {
		selectedIndex: 1,
		consume: false,
		open: null,
	});
});

test("resolveRestoreIndex: returns the row index when the viewed run is still in the roster (P3)", () => {
	assert.equal(resolveRestoreIndex(["a", "b", "c"], "b"), 1);
});

test("resolveRestoreIndex: returns -1 (inactive) when the viewed run has left the roster (P3)", () => {
	assert.equal(resolveRestoreIndex(["a", "c"], "b"), -1);
});

function makeRow(over: Partial<FleetRow> = {}): FleetRow {
	return {
		id: "a",
		agentId: "a",
		parentAgentId: null,
		depth: 1,
		local: true,
		runId: "a",
		agent: "Explore",
		status: "running",
		task: "do work",
		activity: "thinking",
		elapsedMs: 0,
		tools: 0,
		tokens: 0,
		staleRunning: false,
		selected: false,
		...over,
	};
}

test("rowIndicator: a running row shows a spinner frame from the icon registry", () => {
	const icons = ICON_CATALOG.unicode;

	assert.equal(rowIndicator(makeRow({ status: "running", elapsedMs: 0 }), icons), icons.spinner[0]);

	const later = rowIndicator(makeRow({ status: "running", elapsedMs: 100_000 }), icons);
	assert.ok(icons.spinner.includes(later), `spinner frame must come from the registry, got: ${later}`);

	// The ascii fallback set is a different array, so the frame differs by mode.
	assert.notEqual(
		rowIndicator(makeRow({ status: "running", elapsedMs: 0 }), ICON_CATALOG.ascii),
		icons.spinner[0],
	);
});

test("rowIndicator: a needs-attention row keeps the static attention marker (no icon role)", () => {
	assert.equal(rowIndicator(makeRow({ status: "needs-attention" }), ICON_CATALOG.unicode), "!");
});

test("rowIndicator: terminal statuses map to the agent terminal icons", () => {
	const icons = ICON_CATALOG.unicode;
	assert.equal(rowIndicator(makeRow({ status: "completed" }), icons), icons.agentDone);
	assert.equal(rowIndicator(makeRow({ status: "failed" }), icons), icons.agentFailed);
	assert.equal(rowIndicator(makeRow({ status: "interrupted" }), icons), icons.agentInterrupted);
});

test("rowIndicator: a stale running row shows the stale icon", () => {
	const icons = ICON_CATALOG.unicode;
	assert.equal(rowIndicator(makeRow({ status: "running", staleRunning: true }), icons), icons.agentStale);
});

test("rowIndicator: terminal markers stay words in unicode/ascii but become glyphs in nerdfont", () => {
	assert.equal(rowIndicator(makeRow({ status: "completed" }), ICON_CATALOG.unicode), "done");
	assert.equal(rowIndicator(makeRow({ status: "completed" }), ICON_CATALOG.ascii), "done");
	assert.notEqual(rowIndicator(makeRow({ status: "completed" }), ICON_CATALOG.nerdfont), "done");
});

function identityTheme(): Theme {
	const identity = (text: string): string => text;
	return {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: identity,
		italic: identity,
		underline: identity,
		inverse: identity,
		strikethrough: identity,
	} as unknown as Theme;
}

function fakeTui(): TUI {
	return { requestRender() {} } as unknown as TUI;
}

interface RuntimeHarness {
	runtime: FleetRuntime;
	push(snap: RunSnapshot): void;
}

function fakeRuntime(): RuntimeHarness {
	let listener: RunStoreListener | undefined;
	return {
		runtime: {
			subscribe(l: RunStoreListener) {
				listener = l;
				return () => {
					listener = undefined;
				};
			},
		},
		push(snap: RunSnapshot) {
			const event = {
				id: `e-${snap.id}`,
				runId: snap.id,
				type: "run.started",
				at: snap.startedAt,
				agent: snap.agent,
			} as RunEvent;
			listener?.(event, snap);
		},
	};
}

function makeSnapshot(id: string, over: Partial<RunSnapshot> = {}): RunSnapshot {
	const at = new Date().toISOString();
	return {
		id,
		agent: "Explore",
		status: "running",
		requestedExecutionMode: "auto",
		policyMode: "default",
		startedAt: at,
		updatedAt: at,
		task: "do work",
		...over,
	};
}

/**
 * Runs `fn` with `PI_HARNESS_RUN_ROOT` pointed at a fresh empty directory so the
 * fleet's file-tree scan returns no nested agents and the roster is built purely
 * from the injected in-memory snapshots. Restores the previous env afterward.
 */
function withEmptyRoot<T>(fn: () => T): T {
	const previous = process.env.PI_HARNESS_RUN_ROOT;
	const dir = mkdtempSync(join(tmpdir(), "pi-fleet-test-"));
	process.env.PI_HARNESS_RUN_ROOT = dir;

	try {
		return fn();
	} finally {
		if (previous === undefined) delete process.env.PI_HARNESS_RUN_ROOT;
		else process.env.PI_HARNESS_RUN_ROOT = previous;
		rmSync(dir, { recursive: true, force: true });
	}
}

test("FleetList.render: tree connectors and gutters come from the active icon registry", () => {
	setIconMode("unicode");
	try {
		withEmptyRoot(() => {
			const harness = fakeRuntime();
			const fleet = new FleetList(fakeTui(), identityTheme(), harness.runtime, async () => {}, () => {});

			harness.push(makeSnapshot("r1", { startedAt: new Date(Date.now() - 1000).toISOString() }));
			harness.push(makeSnapshot("r2", { startedAt: new Date(Date.now() - 500).toISOString() }));

			const icons = getIcons();
			const out = fleet.render(80);
			fleet.dispose();
			const joined = out.join("\n");

			assert.ok(out.some((l) => l.includes(icons.treeBranch)), `expected treeBranch in:\n${joined}`);
			assert.ok(out.some((l) => l.includes(icons.treeLast)), `expected treeLast in:\n${joined}`);
			assert.ok(out.some((l) => l.includes(icons.treeVertical)), `expected treeVertical gutter in:\n${joined}`);
			assert.ok(out.some((l) => l.includes(icons.treeSub)), `expected treeSub in:\n${joined}`);
		});
	} finally {
		resetIconsCache();
	}
});

test("FleetList.render: switching to ascii mode swaps the connectors for the fallback glyphs", () => {
	setIconMode("ascii");
	try {
		withEmptyRoot(() => {
			const harness = fakeRuntime();
			const fleet = new FleetList(fakeTui(), identityTheme(), harness.runtime, async () => {}, () => {});

			harness.push(makeSnapshot("r1", { startedAt: new Date(Date.now() - 1000).toISOString() }));
			harness.push(makeSnapshot("r2", { startedAt: new Date(Date.now() - 500).toISOString() }));

			const icons = getIcons();
			const out = fleet.render(80);
			fleet.dispose();
			const joined = out.join("\n");

			assert.equal(icons.treeLast, "`-", "ascii catalog should be active");
			assert.ok(out.some((l) => l.includes(icons.treeLast)), `expected ascii treeLast in:\n${joined}`);
			assert.ok(out.some((l) => l.includes(icons.treeBranch)), `expected ascii treeBranch in:\n${joined}`);
			assert.ok(!joined.includes("└─"), "unicode connectors must not appear in ascii mode");
		});
	} finally {
		resetIconsCache();
	}
});

test("FleetList.render: the selection marker comes from the icon registry", () => {
	setIconMode("unicode");
	try {
		withEmptyRoot(() => {
			const harness = fakeRuntime();
			const fleet = new FleetList(fakeTui(), identityTheme(), harness.runtime, async () => {}, () => {});

			harness.push(makeSnapshot("r1"));
			fleet.handleKey("\x1b[D", true, false);

			const icons = getIcons();
			const out = fleet.render(80);
			fleet.dispose();

			assert.ok(
				out.some((l) => l.startsWith(`${icons.selection} `)),
				`expected the selection marker to lead the selected row:\n${out.join("\n")}`,
			);
		});
	} finally {
		resetIconsCache();
	}
});
