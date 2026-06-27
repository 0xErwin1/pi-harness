import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentMeta } from "./meta.ts";
import { readMeta } from "./meta.ts";

export interface AgentNode extends AgentMeta {
	children: AgentNode[];
	staleRunning?: boolean;
}

/**
 * Returns true when the process with `pid` is alive in the current OS session.
 * Uses signal 0 — a no-op that only probes process existence. Returns false
 * for any error (ESRCH = not found, EPERM = permission denied but alive →
 * returns true).
 */
export function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		return code === "EPERM";
	}
}

/** mtime-keyed parse cache — avoids re-parsing unchanged files on each poll cycle. */
const mtimeCache = new Map<string, { mtime: number; meta: AgentMeta }>();

/**
 * Scans `root` for `*.meta.json` files and reconstructs the agent tree.
 *
 * Uses an mtime-gated cache so unchanged files are not re-parsed on every
 * poll. Nodes whose `status` is "running" but whose `pid` is no longer alive
 * are marked `staleRunning: true`. Returns an array of root nodes (those with
 * no parent in the current scan) sorted by `startedAt` ascending; children at
 * each level are sorted the same way.
 */
export function scanTree(root: string): AgentNode[] {
	let entries: string[];
	try {
		entries = readdirSync(root);
	} catch {
		return [];
	}

	const metas: AgentMeta[] = [];

	for (const name of entries.filter((n) => n.endsWith(".meta.json"))) {
		const filePath = join(root, name);
		try {
			const { mtimeMs } = statSync(filePath);
			const cached = mtimeCache.get(filePath);

			if (cached && cached.mtime === mtimeMs) {
				metas.push(cached.meta);
			} else {
				const meta = readMeta(filePath);
				if (meta) {
					mtimeCache.set(filePath, { mtime: mtimeMs, meta });
					metas.push(meta);
				}
			}
		} catch {
			// skip files with transient fs errors
		}
	}

	const nodes = new Map<string, AgentNode>();
	for (const meta of metas) {
		nodes.set(meta.agentId, {
			...meta,
			children: [],
			staleRunning: meta.status === "running" && !pidAlive(meta.pid) ? true : undefined,
		});
	}

	const roots: AgentNode[] = [];
	for (const node of nodes.values()) {
		const parentId = node.parentAgentId;
		if (parentId && nodes.has(parentId)) {
			nodes.get(parentId)!.children.push(node);
		} else {
			roots.push(node);
		}
	}

	const sortByStartedAt = (a: AgentNode, b: AgentNode) =>
		a.startedAt.localeCompare(b.startedAt);

	function sortChildren(node: AgentNode): void {
		node.children.sort(sortByStartedAt);
		for (const child of node.children) sortChildren(child);
	}

	roots.sort(sortByStartedAt);
	for (const root of roots) sortChildren(root);

	return roots;
}
