import type { ThemeColor } from "@earendil-works/pi-coding-agent";

/**
 * The minimal theme surface the subagent-ui builders consume. The real pi
 * `Theme` satisfies it structurally; tests pass a no-op passthrough so
 * assertions see raw text instead of ANSI.
 */
export interface UiTheme {
	fg(color: ThemeColor, text: string): string;
	bold(text: string): string;
	italic(text: string): string;
}
