/**
 * Thinking-block grouped-block extension (S7).
 *
 * Installs an idempotent prototype patch on `AssistantMessageComponent.prototype.render`
 * so that thinking blocks render as a de-emphasised grouped block instead of the
 * SDK's native italic markdown. The grouped-block format is:
 *
 *   Thinking: <title>         ← dim header (title lifted from bold prefix / "Thinking:" prefix)
 *   │ first body line         ← dim gutter + body
 *   │ second body line
 *
 * Then the non-thinking text content follows in its NATIVE markdown rendering (the
 * patch re-renders each text child from `contentContainer.children` at the same
 * width, preserving pi-tui's own markdown styling for assistant prose).
 *
 * S7-T01 PROBE result: `AssistantMessageComponent` stores the current message in a
 * plain JS field `lastMessage` (declared `private` in TypeScript, accessible at
 * runtime). `lastMessage.content` is the `(TextContent | ThinkingContent | ToolCall)[]`
 * array from `@earendil-works/pi-ai`. ThinkingContent blocks have
 * `{ type: "thinking", thinking: string }`. `contentContainer` is likewise accessible
 * at runtime and holds the rendered child components in document order.
 *
 * Mechanism (mirrors the MCP and user-message patterns):
 *   1. `safeRenderWrapper` captures the baseline (native render) first.
 *   2. The transform strips OSC 133 markers from the baseline.
 *   3. It reads `self.lastMessage.content` to extract thinking texts.
 *   4. It walks `contentContainer.children` in parallel with `lastMessage.content`
 *      to re-render text children natively and replace thinking children with the
 *      render-core grouped block.
 *   5. `clampLineWidths` + OSC 133 reapplication complete the output.
 *
 * Render-safety: `safeRenderWrapper` catches any throw and falls back to the original
 * native output. All guards (missing fields, empty content, no thinking blocks, empty
 * children) degrade gracefully to the baseline without exception.
 *
 * Coexistence: pi-tool-display is still active during S1-S7. Two patches may coexist
 * on the same prototype; both are idempotent (Symbol slots); order is non-deterministic.
 * S8 removes pi-tool-display from settings.
 */
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	patchPrototypeMethod,
	safeRenderWrapper,
	stripOsc133,
	reapplyOsc133,
	type PatchHandle,
} from "../packages/visual-hierarchy/index.ts";
import { clampLineWidths } from "../packages/visual-hierarchy/transforms.ts";
import { renderThinkingBlock } from "../packages/render-core/formatters/thinking.ts";
import { RENDER_DEFAULTS } from "../packages/render-core/index.ts";
import type { RenderCtx, WidthOps } from "../packages/render-core/width.ts";
import { captureTheme, releaseTheme, currentRenderStyler } from "./theme-capture.ts";

const THINKING_RENDER_SYMBOL = Symbol("thinking-render-patch");

/**
 * Runtime shape of an `AssistantMessageComponent` instance.
 *
 * Both `lastMessage` and `contentContainer` are declared `private` in the TypeScript
 * type declaration but are plain JS object properties; they are accessible via
 * runtime reflection.
 */
interface AssistantMessageShape {
	lastMessage?: {
		content: ReadonlyArray<{
			type: string;
			text?: string;
			thinking?: string;
		}>;
	};
	contentContainer?: {
		children: ReadonlyArray<{ render(w: number): string[] }>;
	};
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

/**
 * Returns true when the content array contains at least one non-empty thinking block.
 */
function hasThinkingContent(
	content: ReadonlyArray<{ type: string; thinking?: string }> | undefined,
): boolean {
	if (!Array.isArray(content)) return false;
	return content.some(
		(b) => b.type === "thinking" && typeof b.thinking === "string" && b.thinking.trim().length > 0,
	);
}

/**
 * Rebuilds the rendered output by re-rendering `contentContainer.children` selectively:
 * thinking children are replaced by the render-core grouped block; text children are
 * re-rendered at native width; inter-block Spacers (detected as all-empty-line renders)
 * are preserved.
 *
 * Returns null when the rebuild cannot proceed safely (missing fields or no children),
 * so the caller can fall back to the baseline.
 */
function rebuildWithThinkingBlock(
	comp: Partial<AssistantMessageShape>,
	width: number,
	ctx: RenderCtx,
): string[] | null {
	const content = comp.lastMessage?.content;
	const children = comp.contentContainer?.children;

	if (!Array.isArray(content) || !Array.isArray(children) || children.length === 0) {
		return null;
	}

	const visibleBlocks = content.filter(
		(b) =>
			(b.type === "text" && typeof b.text === "string" && b.text.trim().length > 0) ||
			(b.type === "thinking" && typeof b.thinking === "string" && b.thinking.trim().length > 0),
	);

	if (visibleBlocks.length === 0) return null;

	const thinkingTexts: string[] = [];
	const textLines: string[] = [];

	// children[0] is the initial Spacer (always present when hasVisibleContent is true,
	// which is guaranteed since we confirmed hasThinkingContent above).
	let ci = 1;

	for (let bi = 0; bi < visibleBlocks.length; bi++) {
		const block = visibleBlocks[bi];
		const child = children[ci];

		if (!child) break;

		if (block.type === "thinking") {
			thinkingTexts.push(block.thinking as string);
			ci++;
		} else if (block.type === "text") {
			textLines.push(...child.render(width));
			ci++;
		}

		// Check for an inter-block Spacer between visible content blocks.
		// A Spacer renders as one or more empty strings; distinguish from a text child
		// that coincidentally starts with empty lines by checking ALL lines are empty.
		const hasMoreBlocks = bi < visibleBlocks.length - 1;
		if (hasMoreBlocks && ci < children.length) {
			const peek = children[ci].render(width);
			if (peek.length > 0 && peek.every((l: string) => l === "")) {
				textLines.push(...peek);
				ci++;
			}
		}
	}

	// Render any remaining children (e.g. aborted / error messages added after content).
	while (ci < children.length) {
		textLines.push(...children[ci].render(width));
		ci++;
	}

	if (thinkingTexts.length === 0) return null;

	const thinkingLines = renderThinkingBlock(thinkingTexts, ctx);
	if (thinkingLines.length === 0) return null;

	// Prepend the initial Spacer (the blank top margin of the message), then the
	// thinking block, then the text portion. textLines already includes any
	// inter-block Spacer between thinking and text.
	return ["", ...thinkingLines, ...textLines];
}

let patchHandle: PatchHandle | undefined;

function installPatch(): void {
	if (patchHandle?.installed) return;

	patchHandle = patchPrototypeMethod(
		AssistantMessageComponent,
		"render",
		THINKING_RENDER_SYMBOL,
		safeRenderWrapper((baseline, self, width) => {
			const comp = self as Partial<AssistantMessageShape>;

			if (!hasThinkingContent(comp.lastMessage?.content)) return baseline;

			const { markers } = stripOsc133(baseline);
			const ctx = makeRenderCtx(width);

			const rebuilt = rebuildWithThinkingBlock(comp, width, ctx);
			if (rebuilt === null) return baseline;

			return reapplyOsc133(clampLineWidths(rebuilt, width), markers);
		}),
	);
}

export default function thinkingRenderer(pi: ExtensionAPI): void {
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
