import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { LAZY_FILES, type LazyFileKey } from "./lazy-files.ts";

const PLACEHOLDER_PATTERN = /\{\{([A-Z0-9_]+)\}\}/g;

const renderedByAssetsDir = new Map<string, string>();

function isLazyFileKey(key: string): key is LazyFileKey {
	return Object.hasOwn(LAZY_FILES, key);
}

function resolveLazyFilePath(assetsDir: string, key: string): string {
	if (!isLazyFileKey(key)) {
		throw new Error(`renderOrchestratorPrompt: unknown placeholder {{${key}}}`);
	}

	const absolutePath = join(assetsDir, LAZY_FILES[key]);
	let isFile = false;
	try {
		isFile = statSync(absolutePath).isFile();
	} catch {
		isFile = false;
	}

	if (!isFile) {
		throw new Error(`renderOrchestratorPrompt: lazy file for {{${key}}} not found at ${absolutePath}`);
	}

	return absolutePath;
}

/**
 * Renders the orchestrator core prompt for injection: reads
 * `<assetsDir>/orchestrator.md` and replaces every `{{PLACEHOLDER}}` token with
 * the absolute on-disk path of its registered lazy file.
 *
 * Absolute paths (never relative) are the whole point: under the Nix install
 * the assets do not sit under the session cwd, so a relative pointer would be
 * unreadable there even though it resolves fine under `scripts/link.sh`.
 *
 * An unknown placeholder, or a known one whose target does not exist as a
 * file, throws naming the placeholder rather than injecting a broken prompt —
 * a packaging defect should fail the build, not ship silently to a session.
 *
 * Memoized per `assetsDir`: the core prompt is immutable for the lifetime of
 * a process, so repeated calls (e.g. multiple sessions in one runtime) avoid
 * re-reading and re-substituting the file.
 */
export function renderOrchestratorPrompt(assetsDir: string): string {
	const cached = renderedByAssetsDir.get(assetsDir);
	if (cached !== undefined) return cached;

	const corePath = join(assetsDir, "orchestrator.md");
	const raw = readFileSync(corePath, "utf8");
	const rendered = raw.replace(PLACEHOLDER_PATTERN, (_match, key: string) => resolveLazyFilePath(assetsDir, key));

	renderedByAssetsDir.set(assetsDir, rendered);
	return rendered;
}
