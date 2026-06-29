export { patchPrototypeMethod, type PatchHandle } from "./prototype-patch.ts";
export { safeRenderWrapper, type LineTransform, type RenderFn } from "./render-safe.ts";
export { stripOsc133, reapplyOsc133, type Osc133Markers } from "./osc133.ts";
export { applyUserMarker, type LineStyler } from "./transforms.ts";
export {
	thinkingLineCount,
	summarizeThinking,
	collapseThinkingLines,
	toggleThinking,
	type ThinkingViewState,
} from "./thinking.ts";
