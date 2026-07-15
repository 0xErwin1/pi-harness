/**
 * Gradient startup header.
 *
 * Registers the sole `ctx.ui.setHeader` owner (the surface is otherwise
 * unclaimed) and renders the "pi / harness" banner. On a truecolor terminal the
 * banner is painted with a per-cell 24-bit Ayu gradient — the one place in the
 * harness the gradient is permitted. On any other terminal it degrades to the
 * same art in the theme's accent role, via a separate builder, so a raw escape
 * can never leak as visible text.
 */
import type { Component, TUI } from "@earendil-works/pi-tui";
import { getCapabilities } from "@earendil-works/pi-tui";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { renderGradientHeader, renderThemeHeader, supportsTrueColor } from "../packages/header/render.ts";

const registeredHeaderCwds = new Set<string>();

/**
 * A static banner component. The truecolor decision is fixed once at mount:
 * terminal color capability does not change within a session, so there is no
 * per-frame detection cost and no way for the two render paths to interleave.
 */
class GradientHeader implements Component {
	constructor(
		private readonly theme: Theme,
		private readonly trueColor: boolean,
	) {}

	render(width: number): string[] {
		return this.trueColor ? renderGradientHeader(width) : renderThemeHeader(width, this.theme);
	}

	invalidate(): void {}
}

export default function header(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		if (registeredHeaderCwds.has(ctx.cwd)) return;
		registeredHeaderCwds.add(ctx.cwd);

		const trueColor = supportsTrueColor(getCapabilities(), process.env.COLORTERM);

		ctx.ui.setHeader((_tui: TUI, theme: Theme) => new GradientHeader(theme, trueColor));
	});
}
