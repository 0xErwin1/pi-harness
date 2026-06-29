/**
 * User message accent extension (S6).
 *
 * Installs an idempotent prototype patch on `UserMessageComponent.prototype.render`
 * so that user messages display with a clean layout — no background/padding box,
 * subtle `❯ ` left accent on the first line, and two-space indent on continuation
 * lines. Long messages wrap properly because the markdown child is re-rendered at
 * (width - 2), leaving room for the 2-char marker prefix.
 *
 * Mechanism (mirrors the MCP overlay pattern):
 *   1. `safeRenderWrapper` captures the baseline (native box render) first.
 *   2. The transform strips OSC 133 markers from the baseline for bookkeeping.
 *   3. It reads the `Markdown` child from `self.contentBox.children[0]` (a
 *      runtime-accessible JS property, `private` only in TypeScript types).
 *   4. The child is re-rendered at `(width - 2)` — proper word-wrapping without
 *      the native box padding — replacing the baseline lines entirely.
 *   5. `applyUserMarker` prefixes the content lines via `LineBuffer`.
 *   6. `clampLineWidths` + OSC 133 reapplication complete the output.
 *
 * Render-safety: `safeRenderWrapper` catches any throw and falls back to the
 * original native output. An inaccessible `contentBox`, missing `children`,
 * failed `render`, or empty result all degrade gracefully to the baseline.
 *
 * Coexistence: `enableNativeUserMessageBox` (pi-tool-display) is still active
 * during S1-S7. Both patches are installed on the same prototype with different
 * Symbol slots; the order in which they fire is non-deterministic. S8 removes
 * pi-tool-display, making this the sole handler.
 */
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	patchPrototypeMethod,
	safeRenderWrapper,
	stripOsc133,
	reapplyOsc133,
	type PatchHandle,
} from "../packages/visual-hierarchy/index.ts";
import { clampLineWidths } from "../packages/visual-hierarchy/transforms.ts";
import { applyUserMarker } from "../packages/render-core/formatters/user-message.ts";
import { RENDER_DEFAULTS } from "../packages/render-core/index.ts";
import type { RenderCtx, WidthOps } from "../packages/render-core/width.ts";
import { captureTheme, releaseTheme, currentRenderStyler } from "../packages/visual-hierarchy/theme-capture.ts";

const USER_MSG_RENDER_SYMBOL = Symbol("user-message-render-patch");

/**
 * Minimal shape of a `UserMessageComponent` instance readable at runtime.
 *
 * `contentBox` is declared `private` in TypeScript but is a plain JS object
 * property, accessible via runtime reflection. The `Box` component's `children`
 * field is PUBLIC (`Component[]`) and holds the `Markdown` child as index 0.
 */
interface UserMessageComponentShape {
	contentBox: {
		children: Array<{ render(width: number): string[] }>;
	} | undefined;
}

const PI_TUI_WIDTH: WidthOps = { visibleWidth, truncateToWidth };

function makeRenderCtx(width: number): RenderCtx {
	return {
		styler: currentRenderStyler(),
		width: PI_TUI_WIDTH,
		maxWidth: width,
		config: RENDER_DEFAULTS,
	};
}

let patchHandle: PatchHandle | undefined;

function installPatch(): void {
	if (patchHandle?.installed) return;

	patchHandle = patchPrototypeMethod(
		UserMessageComponent,
		"render",
		USER_MSG_RENDER_SYMBOL,
		safeRenderWrapper((baseline, self, width) => {
			const { markers } = stripOsc133(baseline);

			const comp = self as Partial<UserMessageComponentShape>;
			const children = comp.contentBox?.children;
			if (!Array.isArray(children) || children.length === 0) return baseline;

			const markdownChild = children[0];
			if (typeof markdownChild?.render !== "function") return baseline;

			const contentWidth = Math.max(1, width - 2);
			const contentLines = markdownChild.render(contentWidth);
			if (contentLines.length === 0) return baseline;

			const ctx = makeRenderCtx(width);
			const marked = applyUserMarker(contentLines, ctx);
			return reapplyOsc133(clampLineWidths(marked, width), markers);
		}),
	);
}

export default function userMessageRenderer(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		captureTheme(ctx.ui.theme);
		installPatch();
	});

	pi.on("session_shutdown", () => {
		patchHandle?.restore();
		patchHandle = undefined;
		releaseTheme();
	});
}
