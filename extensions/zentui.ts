/**
 * Zentui editor chrome (Opencode-style) for the harness.
 *
 * Installs the vendored pi-zentui editor + message chrome (see
 * `packages/zentui/NOTICE.md` — MIT, by Luka Milojević) WITHOUT its Starship
 * footer: the harness keeps its own footer (`extensions/footer.ts`). Specifically
 * this entry:
 *   1. Replaces the editor with `PolishedEditor` via `ctx.ui.setEditorComponent` —
 *      a bordered input box with an accent rail down the left (the left gutter the
 *      user wanted) and the model / provider / thinking level rendered inside the
 *      frame.
 *   2. Prototype-patches `UserMessageComponent` so prior user messages render as
 *      prompt-box rows matching the editor chrome.
 *   3. Prototype-patches the model/settings selectors so their borders match.
 *
 * The harness's own `user-message-renderer` extension is removed in favour of
 * Zentui's, so only one patch owns `UserMessageComponent.prototype.render`.
 *
 * GLOBAL-IMPACT SAFETY: this affects the interactive editor (a broken editor blocks
 * input). The vendored modules clamp their own width and degrade to the base render
 * on error; install/uninstall is symmetric and restored on `session_shutdown`.
 */
import type {
	ExtensionAPI,
	ExtensionContext,
	KeybindingsManager,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { ensureConfigExists, loadConfig, type PolishedTuiConfig } from "../packages/zentui/config.ts";
import { PolishedEditor } from "../packages/zentui/ui.ts";
import { installUserMessageStyle } from "../packages/zentui/user-message.ts";
import { installSelectorBorderStyle } from "../packages/zentui/selector-border.ts";

/** Editor metadata rendered inside the frame: the model id and its provider label. */
interface EditorMeta {
	modelLabel: string;
	providerLabel: string;
}

/** Title-cases a provider id for display, mirroring Zentui's footer/provider label. */
function formatProviderLabel(provider: string | undefined): string {
	if (!provider) return "Unknown";
	const known: Record<string, string> = {
		anthropic: "Anthropic",
		gemini: "Google",
		google: "Google",
		ollama: "Ollama",
		openai: "OpenAI",
		openrouter: "OpenRouter",
	};
	const lower = provider.toLowerCase();
	return known[lower] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** Reads the current model/provider labels from an extension context. */
function readModelMeta(ctx: ExtensionContext): EditorMeta {
	return {
		modelLabel: ctx.model?.id ?? "no-model",
		providerLabel: formatProviderLabel(ctx.model?.provider),
	};
}

export default function zentui(pi: ExtensionAPI): void {
	let config: PolishedTuiConfig = loadConfig();
	let modelMeta: EditorMeta = { modelLabel: "no-model", providerLabel: "Unknown" };
	let cleanupPatches: () => void = () => {};
	let editorInstalled = false;

	const isTuiContext = (ctx: ExtensionContext): boolean => {
		const mode = (ctx as ExtensionContext & { mode?: string }).mode;
		return ctx.hasUI && (mode === undefined || mode === "tui");
	};

	const installEditor = (ctx: ExtensionContext): void => {
		const uiTheme: Theme = ctx.ui.theme;

		const cleanupUserMessage = installUserMessageStyle(
			() => uiTheme,
			() => config,
		);
		const cleanupSelectorBorder = installSelectorBorderStyle(
			() => uiTheme,
			() => config,
		);
		cleanupPatches = () => {
			cleanupUserMessage();
			cleanupSelectorBorder();
		};

		const factory = (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) =>
			new PolishedEditor(
				tui,
				theme,
				keybindings,
				uiTheme,
				() => config,
				() => modelMeta,
				() => pi.getThinkingLevel(),
			);

		ctx.ui.setEditorComponent(factory);
		editorInstalled = true;
	};

	const teardown = (ctx?: ExtensionContext): void => {
		cleanupPatches();
		cleanupPatches = () => {};
		if (ctx && isTuiContext(ctx) && editorInstalled) {
			ctx.ui.setEditorComponent(undefined);
		}
		editorInstalled = false;
	};

	const refreshModelMeta = (_event: unknown, ctx: ExtensionContext): void => {
		if (!isTuiContext(ctx)) return;
		modelMeta = readModelMeta(ctx);
	};

	pi.on("session_start", (_event, ctx) => {
		if (!isTuiContext(ctx)) return;
		ensureConfigExists();
		config = loadConfig();
		modelMeta = readModelMeta(ctx);
		teardown();
		installEditor(ctx);
	});

	pi.on("model_select", refreshModelMeta);
	pi.on("agent_start", refreshModelMeta);

	pi.on("session_shutdown", (_event, ctx) => {
		teardown(ctx);
	});
}
