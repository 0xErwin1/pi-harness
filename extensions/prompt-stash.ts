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
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { enterOverlay, exitOverlay } from "../packages/shared/overlay-gate.ts";
import { PromptDb } from "../packages/prompt-stash/db.ts";
import { StashIndicator } from "../packages/prompt-stash/indicator.ts";
import { StashPopup } from "../packages/prompt-stash/stash-popup.ts";
import type { StashTab } from "../packages/prompt-stash/popup-model.ts";

const DB_PATH = join(homedir(), ".pi", "agent", "harness-prompts.db");

let db: PromptDb | undefined;

/** cwds whose above-prompt stash indicator has already been registered. */
const registeredIndicatorCwds = new Set<string>();

/** Opens the database on first use; one connection is shared for the process. */
function getDb(): PromptDb {
	if (!db) db = new PromptDb(DB_PATH);
	return db;
}

/** Last path segment of `cwd`, used to tag a history entry with its project. */
function projectOf(cwd: string): string {
	return cwd.split("/").filter(Boolean).pop() ?? cwd;
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
			(tui, theme, _keybindings, done) => new StashPopup(tui, theme, done, getDb(), sessionId, initialTab),
			{
				overlay: true,
				overlayOptions: { anchor: "center", width: "80%", maxHeight: "80%" },
			},
		)
		.finally(exitOverlay);

	if (result && result.length > 0) ctx.ui.setEditorText(result);
}

export default function promptStash(pi: ExtensionAPI): void {
	pi.on("input", (event, ctx) => {
		if (event.source === "interactive" && !event.text.startsWith("/")) {
			try {
				const cwd = ctx.sessionManager.getCwd();
				getDb().addHistory({
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
				getDb().saveStash(sessionId, text);
				ctx.ui.setEditorText("");
				return;
			}

			const last = getDb().popLast(sessionId);
			if (last) ctx.ui.setEditorText(last.text);
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

		ctx.ui.setWidget(
			"prompt-stash",
			(_tui, theme) => new StashIndicator(theme, getDb, () => ctx.sessionManager.getSessionId()),
			{ placement: "aboveEditor" },
		);
	});
}
