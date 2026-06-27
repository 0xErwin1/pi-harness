import { readFileSync, renameSync, writeFileSync } from "node:fs";
import type { RunStatus } from "../events.ts";
import { metaPath } from "./paths.ts";

export interface AgentMeta {
	agentId: string;
	parentAgentId: string | null;
	rootSessionId: string;
	depth: number;
	agentType: string;
	task?: string;
	prompt?: string;
	status: RunStatus;
	startedAt: string;
	endedAt?: string;
	tokens?: number;
	tools?: number;
	cwd: string;
	pid: number;
	updatedAt: string;
}

/**
 * Atomically writes an AgentMeta to disk. Writes to a `.tmp` sibling first,
 * then renames to the final path so concurrent readers never observe a partial
 * file.
 */
export function writeMeta(root: string, meta: AgentMeta): void {
	const finalPath = metaPath(root, meta.agentId);
	const tmpPath = `${finalPath}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(meta), "utf-8");
	renameSync(tmpPath, finalPath);
}

/**
 * Parses a meta file at `path`. Returns `undefined` instead of throwing when
 * the file is missing or contains invalid JSON — both transient conditions
 * that arise during an atomic rename mid-poll.
 */
export function readMeta(path: string): AgentMeta | undefined {
	try {
		const raw = readFileSync(path, "utf-8");
		return JSON.parse(raw) as AgentMeta;
	} catch {
		return undefined;
	}
}
