import { mkdirSync } from "node:fs";
import { basename } from "node:path";
import type { RunEvent, RunSnapshot } from "../events.ts";
import type { InMemoryRunStore } from "../store.ts";
import { writeMeta } from "./meta.ts";
import { appendEventLine, writePromptLine } from "./jsonl.ts";
import { agentIdFor, currentDepth, jsonlPath } from "./paths.ts";

/**
 * Subscribes to all events on `store` and mirrors each run's state to the
 * shared session root directory as a pair of files:
 *   - `<agentId>.meta.json`  — current AgentMeta (atomically replaced on every event)
 *   - `<agentId>.jsonl`      — prompt line (line 0) + one RunEvent line per event
 *
 * Returns the unsubscribe function. All filesystem errors are swallowed so a
 * write failure never interrupts the execution path.
 */
export function attachFileSink(
	store: InMemoryRunStore,
	options: { root: string },
): () => void {
	const { root } = options;
	const initialized = new Set<string>();

	return store.subscribe((event: RunEvent, snapshot: RunSnapshot) => {
		try {
			const agentId = agentIdFor(snapshot.id);
			const jPath = jsonlPath(root, agentId);
			const parentAgentId = process.env.PI_HARNESS_PARENT_AGENT_ID ?? null;
			const rootSessionId = basename(root);
			const depth = currentDepth() + 1;
			const cwd = process.cwd();
			const pid = process.pid;

			if (!initialized.has(snapshot.id)) {
				initialized.add(snapshot.id);
				mkdirSync(root, { recursive: true });

				writePromptLine(jPath, {
					agentId,
					prompt: snapshot.prompt ?? "",
					cwd,
					at: snapshot.startedAt,
				});
			}

			appendEventLine(jPath, event);

			writeMeta(root, {
				agentId,
				parentAgentId,
				rootSessionId,
				depth,
				agentType: snapshot.agent,
				task: snapshot.task,
				prompt: snapshot.prompt,
				status: snapshot.status,
				startedAt: snapshot.startedAt,
				endedAt: snapshot.endedAt,
				tokens: snapshot.tokens,
				tools: snapshot.toolCount,
				cwd,
				pid,
				updatedAt: snapshot.updatedAt,
			});
		} catch {
			// swallow all fs faults — never break the execution path
		}
	});
}
