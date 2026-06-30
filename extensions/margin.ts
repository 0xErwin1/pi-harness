/**
 * Global chat side-margin.
 *
 * Pi renders the transcript edge-to-edge — there is no content padding setting
 * (`editorPaddingX` pads only the editor). This extension gives the whole chat a
 * symmetric horizontal margin so messages, tool calls, and thinking blocks don't
 * sit flush against the terminal edges (opencode-style breathing room).
 *
 * Mechanism: a prototype patch on each chat MESSAGE component's `render` that
 * re-renders the component at `width - 2*MARGIN` and prefixes every non-empty line
 * with `MARGIN` spaces. Because the inner render uses the reduced width, the padded
 * lines are at most `width - MARGIN` columns — never over-width (an over-width line
 * is fatal in pi-tui). Any throw degrades to the un-margined native render.
 *
 * Composition: the patch is installed on a microtask AFTER `session_start`, so it
 * wraps any same-tick render patches from other harness extensions (mcp-renderer,
 * thinking-renderer, zentui user messages) as the OUTERMOST layer — it reduces the
 * width those inner patches see and pads their output, rather than the reverse.
 *
 * The editor and footer are intentionally excluded: they are not message components
 * (the editor carries its own accent rail; the footer spans the full width).
 */
import {
	AssistantMessageComponent,
	BashExecutionComponent,
	BranchSummaryMessageComponent,
	CompactionSummaryMessageComponent,
	CustomMessageComponent,
	type ExtensionAPI,
	SkillInvocationMessageComponent,
	ToolExecutionComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { patchPrototypeMethod, type PatchHandle } from "../packages/visual-hierarchy/index.ts";

/** Columns of empty space kept on EACH side of the chat content. */
const MARGIN = 2;
/** Below this inner width the margin is skipped — a cramped pane keeps every column. */
const MIN_INNER_WIDTH = 24;

const MARGIN_SYMBOL = Symbol("pi-harness-chat-margin");

type RenderFn = (width: number) => string[];

/**
 * Wraps a component `render` so its content renders at `width - 2*MARGIN` and each
 * non-empty line is shifted right by `MARGIN` spaces. Width-safe (padded lines fit
 * within `width`) and render-safe (any throw falls back to the native full-width render).
 */
function marginWrap(orig: Function): Function {
	const render = orig as RenderFn;
	return function (this: unknown, width: number): string[] {
		if (typeof width !== "number" || width < 2 * MARGIN + MIN_INNER_WIDTH) {
			return render.call(this, width);
		}

		let lines: string[];
		try {
			lines = render.call(this, width - 2 * MARGIN);
		} catch {
			return render.call(this, width);
		}

		try {
			const pad = " ".repeat(MARGIN);
			return lines.map((line) => (line.length === 0 ? line : `${pad}${line}`));
		} catch {
			return render.call(this, width);
		}
	};
}

/**
 * The chat message components that make up the transcript (everything but the
 * editor/footer). They share no TS base type but every one has `render(width): string[]`,
 * which is all `patchPrototypeMethod` needs — hence the minimal structural cast.
 */
type RenderableCtor = { prototype: { render: RenderFn } };
const CHAT_COMPONENTS = [
	AssistantMessageComponent,
	UserMessageComponent,
	ToolExecutionComponent,
	CustomMessageComponent,
	BashExecutionComponent,
	BranchSummaryMessageComponent,
	CompactionSummaryMessageComponent,
	SkillInvocationMessageComponent,
] as unknown as readonly RenderableCtor[];

let handles: PatchHandle[] = [];

function installMargin(): void {
	if (handles.length > 0) return;
	for (const component of CHAT_COMPONENTS) {
		handles.push(patchPrototypeMethod(component, "render", MARGIN_SYMBOL, marginWrap));
	}
}

function uninstallMargin(): void {
	for (const handle of handles) handle.restore();
	handles = [];
}

export default function chatMargin(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		// Defer to a microtask so this patch is installed AFTER other extensions'
		// synchronous render patches, making it the outermost (width-reducing) layer.
		setTimeout(() => installMargin(), 0);
	});

	pi.on("session_shutdown", () => {
		uninstallMargin();
	});
}
