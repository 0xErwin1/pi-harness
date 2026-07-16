import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

/**
 * `ThemeBg` itself is not re-exported from the package root, so the token
 * union is derived structurally from `Theme.bg`'s parameter instead of a
 * hand-copied literal union that could drift out of sync.
 */
export type UiThemeBg = Parameters<Theme["bg"]>[0];

/**
 * The minimal theme surface the subagent-ui builders consume. The real pi
 * `Theme` satisfies it structurally; tests pass a no-op passthrough so
 * assertions see raw text instead of ANSI.
 */
export interface UiTheme {
	fg(color: ThemeColor, text: string): string;
	bg(color: UiThemeBg, text: string): string;
	bold(text: string): string;
	italic(text: string): string;
}
