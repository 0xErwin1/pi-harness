/**
 * Visual hierarchy — message renderer.
 *
 * Installs a defensive prototype patch on UserMessageComponent.render that
 * composites the render pipeline: strip OSC 133 markers → apply accent left
 * marker → reapply markers. The original render output is the fallback on any
 * throw (via safeRenderWrapper), so a transform bug can never crash pi-tui.
 *
 * The patch is idempotent under /reload and fully restored on session_shutdown
 * (R6.1-R6.3). Thinking collapse (WU3) will be added to this file when
 * AssistantMessageComponent needs to be re-patched for that slice.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
import {
	patchPrototypeMethod,
	safeRenderWrapper,
	stripOsc133,
	reapplyOsc133,
	applyUserMarker,
	type PatchHandle,
	type LineStyler,
} from "../packages/visual-hierarchy/index.ts";

const SYM_U = Symbol("visual-hierarchy.user-render");

const ANSI_ACCENT_START = "\x1b[36m";
const ANSI_ACCENT_RESET = "\x1b[39m";

const accentStyler: LineStyler = {
	fg(role, text) {
		if (role === "accent") return `${ANSI_ACCENT_START}${text}${ANSI_ACCENT_RESET}`;
		return text;
	},
};

let userHandle: PatchHandle | undefined;

export default function messageRenderer(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, _ctx) => {
		userHandle = patchPrototypeMethod(
			UserMessageComponent,
			"render",
			SYM_U,
			safeRenderWrapper((lines, _self, _width) => {
				const { body, markers } = stripOsc133(lines);
				const marked = applyUserMarker(body, accentStyler);
				return reapplyOsc133(marked, markers);
			}),
		);
	});

	pi.on("session_shutdown", () => {
		userHandle?.restore();
		userHandle = undefined;
	});
}
