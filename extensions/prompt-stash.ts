/**
 * Prompt stash + history extension.
 *
 * Ctrl-S stashes the current editor draft and clears the prompt; pressing it
 * again on an empty prompt restores (pops) the most recent draft. `/stash` opens
 * a browser over the stash and the prompt history, and `/history` opens it on the
 * history tab. Every interactive prompt is also appended to a permanent,
 * cross-session history. All state lives in a single SQLite database under the
 * agent dir, so stashes and history survive restarts.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { enterOverlay, exitOverlay } from "../packages/shared/overlay-gate.ts";
import { getPromptDb } from "../packages/prompt-stash/connection.ts";
import { StashIndicator } from "../packages/prompt-stash/indicator.ts";
import { StashPopup } from "../packages/prompt-stash/stash-popup.ts";
import type { StashTab } from "../packages/prompt-stash/popup-model.ts";

/** cwds whose above-prompt stash indicator has already been registered. */
const registeredIndicatorCwds = new Set<string>();

/** Cached stash counts keyed by pi session id; read by render without touching SQLite. */
const stashCounts = new Map<string, number>();

function readStashCount(sessionId: string): number {
	try {
		return getPromptDb().countStash(sessionId);
	} catch {
		return stashCounts.get(sessionId) ?? 0;
	}
}

function refreshStashCount(sessionId: string): number {
	const count = readStashCount(sessionId);
	stashCounts.set(sessionId, count);
	return count;
}

function requestUiRender(ctx: ExtensionContext): void {
	(ctx.ui as { requestRender?: () => void }).requestRender?.();
}

/** Last path segment of `cwd`, used to tag a history entry with its project. */
function projectOf(cwd: string): string {
	return cwd.split("/").filter(Boolean).pop() ?? cwd;
}

/**
 * Whether this pi process is a spawned subagent rather than the user's session.
 * The subagent runner sets PI_HARNESS_PARENT_AGENT_ID and a non-zero
 * PI_HARNESS_SUBAGENT_DEPTH on every child. Subagents share the same prompt
 * database, so without this guard their delegation prompts would pollute the
 * user's history.
 */
function isSubagentProcess(): boolean {
	return (
		process.env.PI_HARNESS_PARENT_AGENT_ID !== undefined ||
		Number.parseInt(process.env.PI_HARNESS_SUBAGENT_DEPTH ?? "0", 10) > 0
	);
}

/**
 * Shows the stash browser as a focused overlay and, when the user picks an entry,
 * loads its text into the editor. No-op outside the TUI, where custom overlays
 * and the editor are unavailable.
 */
async function openPopup(ctx: ExtensionContext, initialTab: StashTab): Promise<void> {
	if (ctx.mode !== "tui") return;

	const sessionId = ctx.sessionManager.getSessionId();
	enterOverlay();
	const result = await ctx.ui
		.custom<string | undefined>(
			(tui, theme, _keybindings, done) => new StashPopup(tui, theme, done, getPromptDb, sessionId, initialTab),
			{
				overlay: true,
				overlayOptions: { anchor: "center", width: "80%", maxHeight: "80%" },
			},
		)
		.finally(exitOverlay);

	refreshStashCount(sessionId);
	requestUiRender(ctx);
	if (result && result.length > 0) ctx.ui.setEditorText(result);
}

export default function promptStash(pi: ExtensionAPI): void {
	pi.on("input", (event, ctx) => {
		if (event.source === "interactive" && !event.text.startsWith("/") && !isSubagentProcess()) {
			try {
				const cwd = ctx.sessionManager.getCwd();
				getPromptDb().addHistory({
					sessionId: ctx.sessionManager.getSessionId(),
					project: projectOf(cwd),
					cwd,
					text: event.text,
				});
			} catch {
				// History is best-effort; never let a DB hiccup disturb the prompt.
			}
		}

		return { action: "continue" };
	});

	pi.registerShortcut("ctrl+s", {
		description: "Stash the current prompt / restore the last stash",
		handler: (ctx) => {
			const text = ctx.ui.getEditorText();
			const sessionId = ctx.sessionManager.getSessionId();

			if (text.trim().length > 0) {
				getPromptDb().saveStash(sessionId, text);
				refreshStashCount(sessionId);
				ctx.ui.setEditorText("");
				requestUiRender(ctx);
				return;
			}

			const last = getPromptDb().popLast(sessionId);
			refreshStashCount(sessionId);
			if (last) ctx.ui.setEditorText(last.text);
			requestUiRender(ctx);
		},
	});

	pi.registerCommand("stash", {
		description: "Browse stashed prompt drafts and load one back into the editor.",
		handler: (_args, ctx) => openPopup(ctx, "stash"),
	});

	pi.registerCommand("history", {
		description: "Browse the prompt history and load a past prompt into the editor.",
		handler: (_args, ctx) => openPopup(ctx, "history"),
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui" || registeredIndicatorCwds.has(ctx.cwd)) return;
		registeredIndicatorCwds.add(ctx.cwd);

		refreshStashCount(ctx.sessionManager.getSessionId());
		ctx.ui.setWidget(
			"prompt-stash",
			(_tui, theme) => new StashIndicator(theme, () => stashCounts.get(ctx.sessionManager.getSessionId()) ?? 0),
			{ placement: "aboveEditor" },
		);
	});
}
