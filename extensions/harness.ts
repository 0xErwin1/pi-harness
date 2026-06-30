/**
 * Pi harness extension.
 *
 * Minimal core extension for the pi-harness repo. Its only responsibility is to
 * inject the orchestrator contract (from `assets/orchestrator.md`) as an addition
 * to the ROOT session's system prompt on every agent start.
 *
 * Subagent orchestration is delegated to the vendored `pi-subagents` extension
 * (tool name `Agent`), so the custom subagent manager that previously lived here
 * has been removed.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ASSETS_DIR = join(PACKAGE_ROOT, "assets");
const ORCHESTRATOR_PROMPT_PATH = join(ASSETS_DIR, "orchestrator.md");

/**
 * Reads the orchestrator contract from `assets/orchestrator.md` at runtime.
 *
 * The asset may be absent (it can be created by a separate process), so a
 * missing file degrades gracefully to `undefined` rather than throwing. Any
 * other read failure is also treated as "no contract available" so a transient
 * filesystem error never crashes agent startup.
 */
function readOrchestratorPrompt(): string | undefined {
	if (!existsSync(ORCHESTRATOR_PROMPT_PATH)) return undefined;

	try {
		const content = readFileSync(ORCHESTRATOR_PROMPT_PATH, "utf8").trim();
		return content.length > 0 ? content : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Whether this process is the orchestrator root rather than a spawned subagent.
 *
 * pi-subagents runs subagents with replace-mode prompts in isolated contexts, and
 * this harness `before_agent_start` hook only shapes the root interactive session,
 * so the harness always treats itself as the orchestrator root.
 */
export function isOrchestratorRoot(): boolean {
	return true;
}

export default function harness(pi: ExtensionAPI): void {
	// Append the orchestrator contract to the system prompt of the ROOT session
	// only. The asset is read at runtime so a not-yet-created or unreadable file
	// simply skips injection.
	pi.on("before_agent_start", (event, _ctx) => {
		if (!isOrchestratorRoot()) return undefined;

		const orchestratorPrompt = readOrchestratorPrompt();
		if (!orchestratorPrompt) return undefined;

		return {
			systemPrompt: `${event.systemPrompt}\n\n${orchestratorPrompt}`,
		};
	});
}
