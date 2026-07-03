export type ExecutionMode = "interactive" | "auto";
export type DetailedArtifactBackend = "atlas" | "obsidian" | "file-backed";
export type ApprovalState = "approved" | "needs-approval" | "blocked" | "not-requested";
export type PreflightSource = "session" | "prompt" | "defaulted";
export type ArtifactStore = "atlas+engram" | "obsidian+engram" | "file+engram";

export interface AtlasTargetState {
	workspaceSlug?: string;
	projectId?: string;
	projectSlug?: string;
	docsFolderId?: string;
	boardId?: string;
	defaultColumnId?: string;
	discovered: boolean;
	creationApproved: boolean;
	documentWritesApproved: boolean;
	taskWritesApproved: boolean;
}

export interface SddPreflightState {
	project: string;
	cwd: string;
	executionMode: ExecutionMode;
	detailedBackend: DetailedArtifactBackend;
	engramRequired: true;
	atlas: AtlasTargetState;
	fileBackedExplicit: boolean;
	initializedAt: string;
	updatedAt: string;
	source: PreflightSource;
}

export interface PhasePersistenceContract {
	artifactStore: ArtifactStore;
	phase: string;
	project: string;
	change?: string;
	engram: {
		required: true;
		topicKey: string;
		project: string;
		write: "summary-and-pointer" | "full-artifact-when-human-backend-unavailable";
	};
	humanArtifact: {
		backend: DetailedArtifactBackend;
		logicalPath: string;
		required: boolean;
		approvalState: ApprovalState;
		mutationPermitted: boolean;
		role: "full-human-readable-artifact";
		status: "target-approved" | "target-unresolved" | "legacy-selected" | "file-backed-selected";
		atlas?: AtlasTargetState;
		filePath?: string;
	};
	commands: {
		blockIfEngramUnavailable: true;
		blockIfHumanBackendUnavailable: boolean;
		allowEngramOnlyPartial: boolean;
	};
}

export interface SddTasksEngramPointers {
	topicKey: string;
	logicalPath: string;
	documentLogicalPaths: string[];
	epicReadableId?: string;
	epicTaskId?: string;
	taskReadableIds: string[];
}

export interface SddTasksAtlasContract extends PhasePersistenceContract {
	phase: "tasks";
	taskTracking: {
		enabled: boolean;
		approvalState: ApprovalState;
		mutationPermitted: boolean;
		workspaceSlug?: string;
		projectId?: string;
		projectSlug?: string;
		boardId?: string;
		defaultColumnId?: string;
		changeEpic: {
			title: string;
			readableId?: string;
			taskId?: string;
			approvalState: ApprovalState;
			mutationPermitted: boolean;
		};
		representation: "epic-with-subtasks" | "linked-tasks";
		requireFullHydration: true;
		hydrateBeforeMutation: true;
		noMutationBeforeApproval: true;
		engramPointers: SddTasksEngramPointers;
	};
}

export type PreflightInput = Partial<
	Omit<SddPreflightState, "engramRequired" | "initializedAt" | "updatedAt" | "atlas">
> & {
	atlas?: Partial<AtlasTargetState>;
	now?: () => Date;
};

const preflightCache = new Map<string, SddPreflightState>();

function isoNow(now?: () => Date): string {
	return (now ?? (() => new Date()))().toISOString();
}

function defaultAtlasTarget(): AtlasTargetState {
	return {
		discovered: false,
		creationApproved: false,
		documentWritesApproved: false,
		taskWritesApproved: false,
	};
}

export function defaultPreflightState(options: {
	project: string;
	cwd: string;
	now?: () => Date;
}): SddPreflightState {
	const timestamp = isoNow(options.now);
	return {
		project: options.project,
		cwd: options.cwd,
		executionMode: "interactive",
		detailedBackend: "atlas",
		engramRequired: true,
		atlas: defaultAtlasTarget(),
		fileBackedExplicit: false,
		initializedAt: timestamp,
		updatedAt: timestamp,
		source: "defaulted",
	};
}

function validateExecutionMode(value: ExecutionMode | undefined): ExecutionMode | undefined {
	if (value === undefined || value === "interactive" || value === "auto") return value;
	throw new Error(`Invalid execution mode: ${String(value)}`);
}

function validateBackend(value: DetailedArtifactBackend | undefined): DetailedArtifactBackend | undefined {
	if (
		value === undefined ||
		value === "atlas" ||
		value === "obsidian" ||
		value === "file-backed"
	) {
		return value;
	}
	throw new Error(`Invalid detailed artifact backend: ${String(value)}`);
}

export function normalizePreflightState(
	input: PreflightInput,
	defaults: SddPreflightState,
): SddPreflightState {
	const detailedBackend = validateBackend(input.detailedBackend) ?? defaults.detailedBackend;
	const fileBackedExplicit = input.fileBackedExplicit ?? defaults.fileBackedExplicit;
	if (detailedBackend === "file-backed" && !fileBackedExplicit) {
		throw new Error("file-backed backend requires explicit opt-in");
	}

	const timestamp = isoNow(input.now);
	return {
		project: input.project ?? defaults.project,
		cwd: input.cwd ?? defaults.cwd,
		executionMode: validateExecutionMode(input.executionMode) ?? defaults.executionMode,
		detailedBackend,
		engramRequired: true,
		atlas: { ...defaults.atlas, ...input.atlas },
		fileBackedExplicit,
		initializedAt: defaults.initializedAt,
		updatedAt: timestamp,
		source: input.source ?? "prompt",
	};
}

function cacheKey(options: { project: string; cwd: string }): string {
	return `${options.cwd}\u0000${options.project}`;
}

function asSessionState(state: SddPreflightState): SddPreflightState {
	return { ...state, atlas: { ...state.atlas }, source: "session" };
}

export function setCachedPreflightState(state: SddPreflightState): void {
	preflightCache.set(cacheKey(state), asSessionState(state));
}

export function getCachedPreflightState(options: {
	project: string;
	cwd: string;
}): SddPreflightState | undefined {
	const cached = preflightCache.get(cacheKey(options));
	return cached ? asSessionState(cached) : undefined;
}

export function clearPreflightCache(): void {
	preflightCache.clear();
}

function artifactStoreFor(backend: DetailedArtifactBackend): ArtifactStore {
	if (backend === "atlas") return "atlas+engram";
	if (backend === "obsidian") return "obsidian+engram";
	return "file+engram";
}

function atlasApproved(atlas: AtlasTargetState): boolean {
	const projectResolved = typeof atlas.projectId === "string" || typeof atlas.projectSlug === "string";
	return atlas.discovered && projectResolved && atlas.creationApproved && atlas.documentWritesApproved;
}

function atlasTaskTrackingApproved(atlas: AtlasTargetState): boolean {
	const projectResolved = typeof atlas.projectId === "string" || typeof atlas.projectSlug === "string";
	return (
		atlas.discovered &&
		projectResolved &&
		typeof atlas.boardId === "string" &&
		typeof atlas.defaultColumnId === "string" &&
		atlas.creationApproved &&
		atlas.taskWritesApproved
	);
}

function approvalFor(state: SddPreflightState): ApprovalState {
	if (state.detailedBackend !== "atlas") return "approved";
	return atlasApproved(state.atlas) ? "approved" : "needs-approval";
}

function humanStatus(state: SddPreflightState): PhasePersistenceContract["humanArtifact"]["status"] {
	if (state.detailedBackend === "obsidian") return "legacy-selected";
	if (state.detailedBackend === "file-backed") return "file-backed-selected";
	return atlasApproved(state.atlas) ? "target-approved" : "target-unresolved";
}

function mutationPermitted(state: SddPreflightState): boolean {
	if (state.detailedBackend === "atlas") return atlasApproved(state.atlas);
	if (state.detailedBackend === "file-backed") return state.fileBackedExplicit;
	return true;
}

function filePathFor(state: SddPreflightState, logicalPath: string): string | undefined {
	if (state.detailedBackend !== "file-backed") return undefined;
	return `openspec/changes/${logicalPath}`;
}

function buildContract(
	state: SddPreflightState,
	input: { phase: string; topicKey: string; logicalPath: string; change?: string },
): PhasePersistenceContract {
	const approvalState = approvalFor(state);
	return {
		artifactStore: artifactStoreFor(state.detailedBackend),
		phase: input.phase,
		project: state.project,
		change: input.change,
		engram: {
			required: true,
			topicKey: input.topicKey,
			project: state.project,
			write: approvalState === "approved" ? "summary-and-pointer" : "full-artifact-when-human-backend-unavailable",
		},
		humanArtifact: {
			backend: state.detailedBackend,
			logicalPath: input.logicalPath,
			required: true,
			approvalState,
			mutationPermitted: mutationPermitted(state),
			role: "full-human-readable-artifact",
			status: humanStatus(state),
			atlas: state.detailedBackend === "atlas" ? { ...state.atlas } : undefined,
			filePath: filePathFor(state, input.logicalPath),
		},
		commands: {
			blockIfEngramUnavailable: true,
			blockIfHumanBackendUnavailable: state.detailedBackend !== "file-backed" || !state.fileBackedExplicit,
			allowEngramOnlyPartial: approvalState !== "approved",
		},
	};
}

export function buildPhasePersistenceContract(
	state: SddPreflightState,
	input: { change: string; phase: string },
): PhasePersistenceContract {
	return buildContract(state, {
		phase: input.phase,
		change: input.change,
		topicKey: `sdd/${input.change}/${input.phase}`,
		logicalPath: `sdd/${input.change}/${input.phase}.md`,
	});
}

export function buildInitPersistenceContract(
	state: SddPreflightState,
	project: string,
): PhasePersistenceContract {
	return buildContract(state, {
		phase: "init",
		topicKey: `sdd-init/${project}`,
		logicalPath: `sdd-init/${project}.md`,
	});
}

export function buildSddTasksAtlasContract(
	state: SddPreflightState,
	input: {
		change: string;
		taskTrackingRequested?: boolean;
		engramPointers?: Partial<Pick<SddTasksEngramPointers, "epicReadableId" | "epicTaskId" | "taskReadableIds">>;
	},
): SddTasksAtlasContract {
	const base = buildPhasePersistenceContract(state, { change: input.change, phase: "tasks" });
	const enabled = input.taskTrackingRequested === true;
	const approved = enabled && state.detailedBackend === "atlas" && atlasTaskTrackingApproved(state.atlas);
	const approvalState: ApprovalState = enabled ? (approved ? "approved" : "needs-approval") : "not-requested";
	const mutationAllowed = approvalState === "approved";
	const pointers: SddTasksEngramPointers = {
		topicKey: base.engram.topicKey,
		logicalPath: base.humanArtifact.logicalPath,
		documentLogicalPaths: [
			`sdd/${input.change}/spec.md`,
			`sdd/${input.change}/design.md`,
			base.humanArtifact.logicalPath,
		],
		taskReadableIds: [...(input.engramPointers?.taskReadableIds ?? [])],
	};
	if (input.engramPointers?.epicReadableId !== undefined) pointers.epicReadableId = input.engramPointers.epicReadableId;
	if (input.engramPointers?.epicTaskId !== undefined) pointers.epicTaskId = input.engramPointers.epicTaskId;

	return {
		...base,
		phase: "tasks",
		taskTracking: {
			enabled,
			approvalState,
			mutationPermitted: mutationAllowed,
			workspaceSlug: state.atlas.workspaceSlug,
			projectId: state.atlas.projectId,
			projectSlug: state.atlas.projectSlug,
			boardId: state.atlas.boardId,
			defaultColumnId: state.atlas.defaultColumnId,
			changeEpic: {
				title: input.change,
				readableId: pointers.epicReadableId,
				taskId: pointers.epicTaskId,
				approvalState,
				mutationPermitted: mutationAllowed,
			},
			representation: "epic-with-subtasks",
			requireFullHydration: true,
			hydrateBeforeMutation: true,
			noMutationBeforeApproval: true,
			engramPointers: pointers,
		},
	};
}
