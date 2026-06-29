/**
 * Bash spinner + elapsed-timer formatter.
 *
 * Provides a braille spinner and an elapsed timer for the call-phase render
 * while a bash command is executing. Pure and theme-agnostic: colour comes from
 * the injected RenderStyler; no pi-tui or SDK imports.
 *
 * SpinnerState is designed to live in `context.state` (shared across re-renders
 * for the same tool call ID), so both the frame position and the start time
 * persist across invalidate cycles without any external map.
 */

import { LineBuffer, type RenderCtx } from "../width.ts";

/** Persistent state for one bash call's spinner. Lives in `context.state`. */
export type SpinnerState = { frame: number; startedAt: number };

/**
 * Ten braille dot patterns — pure unicode, NOT emoji, no U+FE0F variation
 * selector. These are Braille Pattern characters (U+2800 block), distinct from
 * emoji and safe to display in all terminals that support unicode.
 */
const BRAILLE_FRAMES = [
	"⠋",
	"⠙",
	"⠹",
	"⠸",
	"⠼",
	"⠴",
	"⠦",
	"⠧",
	"⠇",
	"⠏",
] as const;

/**
 * Advances the spinner to the next frame (wraps at 10 frames).
 *
 * Returns the character for the CURRENT frame plus the new state with the frame
 * index incremented. The `now` parameter is accepted for API consistency and to
 * allow future elapsed-delta logic; the state machine itself is frame-count-
 * driven, not time-driven.
 */
export function nextSpinner(
	state: SpinnerState,
	_now: number,
): { state: SpinnerState; frame: string } {
	const frame = BRAILLE_FRAMES[state.frame] ?? BRAILLE_FRAMES[0];
	const nextFrameIdx = (state.frame + 1) % BRAILLE_FRAMES.length;
	return { state: { frame: nextFrameIdx, startedAt: state.startedAt }, frame };
}

/**
 * Formats elapsed milliseconds as a compact human-readable duration.
 *
 * Below 60 seconds: `Xs`. 60 seconds and above: `XmYs`.
 */
function formatElapsed(elapsedMs: number): string {
	const totalSeconds = Math.floor(elapsedMs / 1000);
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}m${seconds}s`;
}

/**
 * Builds the bash call line for the running or done phase.
 *
 * - `running`: `<frame> Bash <command> <elapsed>` — braille spinner frame (dim),
 *   verb bold+accent, command muted, elapsed dim. Used while executing.
 * - `done`: `Bash <command>` — verb bold+accent, command muted. Used when
 *   execution has ended and the call slot is waiting for the result renderer.
 *
 * All output is emitted through `LineBuffer` for structural width-clamping.
 */
export function buildBashCallLine(
	command: string,
	phase: "running" | "done",
	frame: string,
	elapsedMs: number,
	ctx: RenderCtx,
): string[] {
	const lb = new LineBuffer(ctx);
	const verb = ctx.styler.bold(ctx.styler.fg("accent", "Bash"));

	if (phase === "running") {
		const elapsed = formatElapsed(elapsedMs);
		lb.push(`${ctx.styler.fg("dim", frame)} ${verb} ${ctx.styler.fg("muted", command)} ${ctx.styler.fg("dim", elapsed)}`);
	} else {
		lb.push(`${verb} ${ctx.styler.fg("muted", command)}`);
	}

	return lb.done();
}
