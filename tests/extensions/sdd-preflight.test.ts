import test from "node:test";
import assert from "node:assert/strict";
import {
	buildInitPersistenceContract,
	buildPhasePersistenceContract,
	buildSddTasksAtlasContract,
	clearPreflightCache,
	defaultPreflightState,
	getCachedPreflightState,
	normalizePreflightState,
	setCachedPreflightState,
} from "../../extensions/sdd-preflight.ts";

test("defaultPreflightState separates session preferences from project facts", () => {
	const state = defaultPreflightState({
		project: "pi-harness",
		cwd: "/tmp/pi-harness",
		now: () => new Date("2026-07-03T00:00:00.000Z"),
	});

	assert.equal(state.project, "pi-harness");
	assert.equal(state.executionMode, "interactive");
	assert.equal(state.detailedBackend, "atlas");
	assert.equal(state.engramRequired, true);
	assert.equal(state.fileBackedExplicit, false);
	assert.deepEqual(state.atlas, {
		discovered: false,
		creationApproved: false,
		documentWritesApproved: false,
		taskWritesApproved: false,
	});
	assert.equal("packageManagers" in state, false);
	assert.equal(state.source, "defaulted");
});

test("file-backed backend is rejected unless explicitly opted in", () => {
	const defaults = defaultPreflightState({ project: "pi-harness", cwd: "/tmp/pi-harness" });

	assert.throws(
		() => normalizePreflightState({ detailedBackend: "file-backed" }, defaults),
		/file-backed.*explicit/i,
	);

	const explicit = normalizePreflightState(
		{ detailedBackend: "file-backed", fileBackedExplicit: true, executionMode: "auto" },
		defaults,
	);
	assert.equal(explicit.detailedBackend, "file-backed");
	assert.equal(explicit.fileBackedExplicit, true);
	assert.equal(explicit.executionMode, "auto");
});

test("phase contract emits Atlas logical path, Engram topic key, and mutation block", () => {
	const state = defaultPreflightState({ project: "pi-harness", cwd: "/tmp/pi-harness" });

	const contract = buildPhasePersistenceContract(state, {
		change: "atlas-sdd-preflight-init",
		phase: "spec",
	});

	assert.equal(contract.artifactStore, "atlas+engram");
	assert.equal(contract.engram.topicKey, "sdd/atlas-sdd-preflight-init/spec");
	assert.equal(contract.humanArtifact.logicalPath, "sdd/atlas-sdd-preflight-init/spec.md");
	assert.equal(contract.humanArtifact.backend, "atlas");
	assert.equal(contract.humanArtifact.approvalState, "needs-approval");
	assert.equal(contract.humanArtifact.mutationPermitted, false);
	assert.equal(contract.commands.blockIfEngramUnavailable, true);
	assert.equal(contract.commands.blockIfHumanBackendUnavailable, true);
	assert.equal(contract.commands.allowEngramOnlyPartial, true);
});

test("approved Atlas target permits mutation in contract data", () => {
	const state = normalizePreflightState(
		{
			atlas: {
				discovered: true,
				workspaceSlug: "ai",
				projectSlug: "pi-harness",
				creationApproved: true,
				documentWritesApproved: true,
				taskWritesApproved: false,
			},
		},
		defaultPreflightState({ project: "pi-harness", cwd: "/tmp/pi-harness" }),
	);

	const contract = buildPhasePersistenceContract(state, {
		change: "atlas-sdd-preflight-init",
		phase: "design",
	});

	assert.equal(contract.humanArtifact.approvalState, "approved");
	assert.equal(contract.humanArtifact.mutationPermitted, true);
	assert.equal(contract.humanArtifact.atlas?.workspaceSlug, "ai");
});

test("preflight cache is keyed by cwd and project and stores preferences only", () => {
	clearPreflightCache();
	const state = normalizePreflightState(
		{ executionMode: "auto", detailedBackend: "obsidian" },
		defaultPreflightState({ project: "pi-harness", cwd: "/tmp/pi-harness" }),
	);

	setCachedPreflightState(state);
	const cached = getCachedPreflightState({ project: "pi-harness", cwd: "/tmp/pi-harness" });
	const otherProject = getCachedPreflightState({ project: "other", cwd: "/tmp/pi-harness" });

	assert.equal(cached?.executionMode, "auto");
	assert.equal(cached?.detailedBackend, "obsidian");
	assert.equal(cached?.source, "session");
	assert.equal(cached && "commands" in cached, false);
	assert.equal(otherProject, undefined);
});

test("init persistence contract uses stable sdd-init topic key", () => {
	const state = defaultPreflightState({ project: "pi-harness", cwd: "/tmp/pi-harness" });
	const contract = buildInitPersistenceContract(state, "pi-harness");

	assert.equal(contract.engram.topicKey, "sdd-init/pi-harness");
	assert.equal(contract.humanArtifact.logicalPath, "sdd-init/pi-harness.md");
	assert.equal(contract.humanArtifact.approvalState, "needs-approval");
	assert.equal(contract.humanArtifact.mutationPermitted, false);
});

test("tasks Atlas contract leaves human task tracking unrequested by default", () => {
	const state = defaultPreflightState({ project: "pi-harness", cwd: "/tmp/pi-harness" });
	const contract = buildSddTasksAtlasContract(state, {
		change: "atlas-sdd-preflight-init",
	});

	assert.equal(contract.engram.topicKey, "sdd/atlas-sdd-preflight-init/tasks");
	assert.equal(contract.humanArtifact.logicalPath, "sdd/atlas-sdd-preflight-init/tasks.md");
	assert.equal(contract.taskTracking.enabled, false);
	assert.equal(contract.taskTracking.approvalState, "not-requested");
	assert.equal(contract.taskTracking.mutationPermitted, false);
	assert.equal(contract.taskTracking.noMutationBeforeApproval, true);
	assert.equal(contract.taskTracking.requireFullHydration, true);
	assert.deepEqual(contract.taskTracking.engramPointers, {
		topicKey: "sdd/atlas-sdd-preflight-init/tasks",
		logicalPath: "sdd/atlas-sdd-preflight-init/tasks.md",
		documentLogicalPaths: [
			"sdd/atlas-sdd-preflight-init/spec.md",
			"sdd/atlas-sdd-preflight-init/design.md",
			"sdd/atlas-sdd-preflight-init/tasks.md",
		],
		taskReadableIds: [],
	});
});

test("requested Atlas task tracking needs approval and still carries recovery pointers", () => {
	const state = normalizePreflightState(
		{
			atlas: {
				discovered: true,
				workspaceSlug: "ai",
				projectSlug: "pi-harness",
				boardId: "board-1",
				defaultColumnId: "todo",
				creationApproved: true,
				documentWritesApproved: true,
				taskWritesApproved: false,
			},
		},
		defaultPreflightState({ project: "pi-harness", cwd: "/tmp/pi-harness" }),
	);

	const contract = buildSddTasksAtlasContract(state, {
		change: "atlas-sdd-preflight-init",
		taskTrackingRequested: true,
		engramPointers: {
			epicReadableId: "PIH-42",
			epicTaskId: "task-42",
			taskReadableIds: ["PIH-43", "PIH-44"],
		},
	});

	assert.equal(contract.taskTracking.enabled, true);
	assert.equal(contract.taskTracking.approvalState, "needs-approval");
	assert.equal(contract.taskTracking.mutationPermitted, false);
	assert.equal(contract.taskTracking.workspaceSlug, "ai");
	assert.equal(contract.taskTracking.projectSlug, "pi-harness");
	assert.equal(contract.taskTracking.boardId, "board-1");
	assert.equal(contract.taskTracking.defaultColumnId, "todo");
	assert.deepEqual(contract.taskTracking.changeEpic, {
		title: "atlas-sdd-preflight-init",
		readableId: "PIH-42",
		taskId: "task-42",
		approvalState: "needs-approval",
		mutationPermitted: false,
	});
	assert.equal(contract.taskTracking.engramPointers.epicReadableId, "PIH-42");
	assert.deepEqual(contract.taskTracking.engramPointers.taskReadableIds, ["PIH-43", "PIH-44"]);
});

test("approved Atlas task tracking permits only contract-declared mutation", () => {
	const state = normalizePreflightState(
		{
			atlas: {
				discovered: true,
				workspaceSlug: "ai",
				projectId: "project-1",
				boardId: "board-1",
				defaultColumnId: "todo",
				creationApproved: true,
				documentWritesApproved: true,
				taskWritesApproved: true,
			},
		},
		defaultPreflightState({ project: "pi-harness", cwd: "/tmp/pi-harness" }),
	);

	const contract = buildSddTasksAtlasContract(state, {
		change: "atlas-sdd-preflight-init",
		taskTrackingRequested: true,
	});

	assert.equal(contract.taskTracking.approvalState, "approved");
	assert.equal(contract.taskTracking.mutationPermitted, true);
	assert.equal(contract.taskTracking.changeEpic.approvalState, "approved");
	assert.equal(contract.taskTracking.changeEpic.mutationPermitted, true);
	assert.equal(contract.taskTracking.requireFullHydration, true);
});
