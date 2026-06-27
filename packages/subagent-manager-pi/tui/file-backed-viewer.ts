import { statSync } from "node:fs";
import type { RunEvent, RunSnapshot } from "../../subagent-manager-core/events.ts";
import type { RunStoreListener } from "../../subagent-manager-core/store.ts";
import {
	jsonlPath,
	metaPath,
	readMeta,
	readTranscript,
	type AgentMeta,
} from "../../subagent-manager-core/index.ts";
import type { ViewerRuntime } from "./conversation-viewer.ts";

/** Poll cadence for re-reading a file-backed transcript while it is still live. */
const POLL_INTERVAL_MS = 450;

/**
 * Maps an `AgentMeta` (written by another process's file sink) onto the
 * `RunSnapshot` shape the viewer and its model consume. The viewer only reads a
 * subset (agent, status, startedAt, tokens, prompt, task), so the remaining
 * required fields are filled with neutral placeholders. Returns `undefined` when
 * the meta is absent, mirroring the in-memory store's `snapshot` contract.
 */
function metaToSnapshot(agentId: string, meta: AgentMeta | undefined): RunSnapshot | undefined {
	if (!meta) return undefined;

	return {
		id: agentId,
		agent: meta.agentType,
		task: meta.task,
		status: meta.status,
		requestedExecutionMode: "auto",
		policyMode: "",
		startedAt: meta.startedAt,
		updatedAt: meta.updatedAt,
		endedAt: meta.endedAt,
		prompt: meta.prompt,
		tokens: meta.tokens,
		toolCount: meta.tools,
	};
}

/**
 * A minimal placeholder snapshot used only to satisfy the listener signature
 * when a poll observes a transcript change before its meta is readable. The
 * viewer ignores the snapshot passed to its subscriber (it re-reads via
 * `snapshot()` on render); only the event's `runId` matters for the re-render.
 */
function placeholderSnapshot(agentId: string): RunSnapshot {
	const now = new Date().toISOString();
	return {
		id: agentId,
		agent: "",
		status: "running",
		requestedExecutionMode: "auto",
		policyMode: "",
		startedAt: now,
		updatedAt: now,
	};
}

function pollEvent(agentId: string, at: string): RunEvent {
	return {
		id: `${agentId}-poll`,
		runId: agentId,
		type: "run.progress",
		at,
		message: "",
	};
}

function mtimeOf(path: string): number {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return 0;
	}
}

/**
 * Builds a `ViewerRuntime` backed by a node's transcript files on disk rather
 * than the live in-memory store. Used to open a NESTED subagent's conversation:
 * that agent runs in a different pi process, so its state is only reachable
 * through the shared session-root files (`<agentId>.jsonl` + `<agentId>.meta.json`).
 *
 * The runtime is bound to a single `agentId`; `events` and `snapshot` ignore the
 * id argument and always resolve the bound agent's files. `subscribe` polls the
 * file mtimes on a fixed cadence and fires the listener when either file changes,
 * so a still-running nested agent live-updates in the viewer. Missing or partial
 * files are tolerated: empty events and an undefined snapshot, never a throw.
 */
export function createFileBackedViewerRuntime(root: string, agentId: string): ViewerRuntime {
	const transcriptPath = jsonlPath(root, agentId);
	const metaFilePath = metaPath(root, agentId);

	return {
		events(): RunEvent[] {
			return readTranscript(transcriptPath).events;
		},

		snapshot(): RunSnapshot | undefined {
			return metaToSnapshot(agentId, readMeta(metaFilePath));
		},

		subscribe(listener: RunStoreListener): () => void {
			let lastTranscriptMtime = mtimeOf(transcriptPath);
			let lastMetaMtime = mtimeOf(metaFilePath);

			const timer = setInterval(() => {
				const transcriptMtime = mtimeOf(transcriptPath);
				const metaMtime = mtimeOf(metaFilePath);
				if (transcriptMtime === lastTranscriptMtime && metaMtime === lastMetaMtime) return;

				lastTranscriptMtime = transcriptMtime;
				lastMetaMtime = metaMtime;

				const snapshot = metaToSnapshot(agentId, readMeta(metaFilePath)) ?? placeholderSnapshot(agentId);
				listener(pollEvent(agentId, snapshot.updatedAt), snapshot);
			}, POLL_INTERVAL_MS);

			return () => clearInterval(timer);
		},
	};
}
