/**
 * Visual hierarchy — assistant gutter renderer.
 *
 * Installs a defensive prototype patch on AssistantMessageComponent.render
 * that composites the render pipeline: strip OSC 133 markers → apply dim
 * left-bar gutter → reapply markers. The original render output is the
 * fallback on any throw (via safeRenderWrapper), so a transform bug can
 * never crash pi-tui.
 *
 * The patch is idempotent under /reload and fully restored on session_shutdown
 * (R6.1-R6.3). User-message marker (WU2) and thinking collapse (WU3) are not
 * part of this slice.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import {
	patchPrototypeMethod,
	safeRenderWrapper,
	stripOsc133,
	reapplyOsc133,
	applyAssistantGutter,
	type PatchHandle,
	type LineStyler,
} from "../packages/visual-hierarchy/index.ts";

const SYM_A = Symbol("visual-hierarchy.assistant-render");

const ANSI_DIM_START = "\x1b[2m";
const ANSI_DIM_RESET = "\x1b[22m";

const dimStyler: LineStyler = {
	fg(role, text) {
		if (role === "dim") return `${ANSI_DIM_START}${text}${ANSI_DIM_RESET}`;
		return text;
	},
};

let assistantHandle: PatchHandle | undefined;

export default function assistantRenderer(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, _ctx) => {
		assistantHandle = patchPrototypeMethod(
			AssistantMessageComponent,
			"render",
			SYM_A,
			safeRenderWrapper((lines, _self, _width) => {
				const { body, markers } = stripOsc133(lines);
				const guttered = applyAssistantGutter(body, dimStyler);
				return reapplyOsc133(guttered, markers);
			}),
		);
	});

	pi.on("session_shutdown", () => {
		assistantHandle?.restore();
		assistantHandle = undefined;
	});
}
