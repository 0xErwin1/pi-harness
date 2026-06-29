/**
 * Visual hierarchy — message renderer.
 *
 * Installs defensive prototype patches on two SDK components:
 *
 * UserMessageComponent.render (SYM_U):
 *   Pipeline: strip OSC 133 → apply accent left marker → reapply markers.
 *   Accent styling comes from the session theme via ctx.ui.theme.
 *
 * AssistantMessageComponent.render (SYM_A):
 *   Pipeline: strip OSC 133 → collapse/expand thinking section → reapply markers.
 *   The thinking state is a module-level flag toggled by the Alt-T shortcut.
 *   Default: collapsed (shows "▸ thinking · N líneas" summary).
 *   When expanded: thinking lines render with the SDK's de-emphasized thinkingText styling.
 *
 * Both patches are idempotent under /reload and fully restored on session_shutdown
 * (R6.1-R6.3). safeRenderWrapper ensures a transform error can never crash pi-tui
 * (R4.1-R4.3).
 *
 * Key collision check: ctrl+t is taken by the SDK's app.thinking.toggle keybinding.
 * This extension uses alt+t (free as of pi-coding-agent 0.79.10).
 */
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { UserMessageComponent, AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import {
	patchPrototypeMethod,
	safeRenderWrapper,
	stripOsc133,
	reapplyOsc133,
	applyUserMarker,
	clampLineWidths,
	thinkingLineCount,
	summarizeThinking,
	collapseThinkingLines,
	toggleThinking,
	type PatchHandle,
	type LineStyler,
	type ThinkingViewState,
} from "../packages/visual-hierarchy/index.ts";

const SYM_U = Symbol("visual-hierarchy.user-render");
const SYM_A = Symbol("visual-hierarchy.assistant-render");

// Fallback ANSI codes used if ctx.ui.theme is unavailable at session_start.
const ANSI_ACCENT_START = "\x1b[36m";
const ANSI_ACCENT_RESET = "\x1b[39m";
const ANSI_DIM_START    = "\x1b[2m";
const ANSI_DIM_RESET    = "\x1b[22m";

const FALLBACK_ACCENT_STYLER: LineStyler = {
	fg: (role, text) => role === "accent" ? `${ANSI_ACCENT_START}${text}${ANSI_ACCENT_RESET}` : text,
};

const FALLBACK_DIM_STYLER: LineStyler = {
	fg: (role, text) => role === "dim" ? `${ANSI_DIM_START}${text}${ANSI_DIM_RESET}` : text,
};

// Module-level session state — reset on session_shutdown.
let userHandle:      PatchHandle | undefined;
let assistantHandle: PatchHandle | undefined;
let capturedTui:     TUI | undefined;

// Styling closures rebuilt from the session theme on each session_start.
let accentStyler:    LineStyler = FALLBACK_ACCENT_STYLER;
let dimStyler:       LineStyler = FALLBACK_DIM_STYLER;

// Predicate that detects thinking lines in the rendered output.
// Rebuilt per session from theme.getFgAnsi("thinkingText").
let isThinkingLine: (line: string) => boolean = () => false;

// Global thinking collapse/expand state. Default: collapsed.
// Persists within a session, resets to collapsed on session_shutdown.
let thinkingViewState: ThinkingViewState = { collapsed: true };

function buildStylers(theme: Theme): void {
	accentStyler = { fg: (role, text) => role === "accent" ? theme.fg("accent", text) : text };
	dimStyler    = { fg: (role, text) => role === "dim"    ? theme.fg("dim",    text) : text };

	const thinkingAnsi = theme.getFgAnsi("thinkingText");
	isThinkingLine = thinkingAnsi
		? (line) => line.includes(thinkingAnsi)
		: () => false;
}

export default function messageRenderer(pi: ExtensionAPI): void {
	pi.registerShortcut("alt+t", {
		description: "Toggle thinking block collapse/expand",
		handler: (ctx: ExtensionContext) => {
			if (ctx.mode !== "tui") return;
			thinkingViewState = toggleThinking(thinkingViewState);
			capturedTui?.requestRender();
		},
	});

	pi.on("session_start", (_event, ctx) => {
		// Rebuild theme-aware stylers from the current session theme.
		const theme = ctx.ui.theme;
		if (theme) {
			buildStylers(theme);
		}

		// Reset thinking state to collapsed for each new session.
		thinkingViewState = { collapsed: true };

		// Capture TUI via a zero-height sentinel widget so the shortcut handler
		// can call requestRender() after toggling the thinking state.
		ctx.ui.setWidget(
			"vh-thinking-cap",
			(t) => {
				capturedTui = t;
				return {
					render(_w: number) { return []; },
					invalidate() {},
				};
			},
		);

		userHandle = patchPrototypeMethod(
			UserMessageComponent,
			"render",
			SYM_U,
			safeRenderWrapper((lines, _self, width) => {
				const { body, markers } = stripOsc133(lines);
				const marked = applyUserMarker(body, accentStyler);
				return reapplyOsc133(clampLineWidths(marked, width), markers);
			}),
		);

		assistantHandle = patchPrototypeMethod(
			AssistantMessageComponent,
			"render",
			SYM_A,
			safeRenderWrapper((lines, self, width) => {
				const { body, markers } = stripOsc133(lines);

				// lastMessage is TypeScript-private on AssistantMessageComponent but is
				// a standard JS property (not a #private field), so the runtime access
				// works. The any cast is the only way to reach it here; thinkingLineCount
				// handles any malformed or missing value defensively.
				const n = thinkingLineCount((self as any).lastMessage?.content);
				const summary = summarizeThinking(n, dimStyler);

				const transformed = collapseThinkingLines(body, isThinkingLine, thinkingViewState.collapsed, summary);

				return reapplyOsc133(clampLineWidths(transformed, width), markers);
			}),
		);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		userHandle?.restore();
		assistantHandle?.restore();

		userHandle      = undefined;
		assistantHandle = undefined;

		// Remove the sentinel widget; capturedTui becomes stale after shutdown.
		ctx.ui.setWidget("vh-thinking-cap", undefined);
		capturedTui = undefined;

		// Reset thinking state so the next session starts collapsed.
		thinkingViewState = { collapsed: true };

		// Restore fallback stylers.
		accentStyler   = FALLBACK_ACCENT_STYLER;
		dimStyler      = FALLBACK_DIM_STYLER;
		isThinkingLine = () => false;
	});
}
