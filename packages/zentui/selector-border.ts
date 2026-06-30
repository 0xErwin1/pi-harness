import {
	ModelSelectorComponent,
	SettingsSelectorComponent,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import type { PolishedTuiConfig } from "./config.ts";
import { EDITOR_BORDER_STYLE, renderChromeBorder, renderEditorBorder } from "./style.ts";

type RenderFn = (width: number) => string[];

type PatchableSelectorPrototype = {
	render: RenderFn;
	__zentuiSelectorBorderOriginalRender?: RenderFn;
	__zentuiSelectorBorderPatched?: boolean;
	__zentuiSelectorBorderWrapper?: RenderFn;
	__zentuiSelectorBorderActive?: boolean;
	__zentuiSelectorBorderGetTheme?: () => Theme | undefined;
	__zentuiSelectorBorderGetConfig?: () => PolishedTuiConfig;
};

type Cleanup = () => void;

function stripAnsi(text: string): string {
	return text.replaceAll(/\x1b\[[0-9;]*m/g, "");
}

function isHorizontalBorderLine(line: string): boolean {
	return /^─+$/.test(stripAnsi(line));
}

function renderBorderLine(
	width: number,
	theme: Theme | undefined,
	config: PolishedTuiConfig | undefined,
): string {
	const text = "─".repeat(Math.max(1, width));
	if (theme && config) {
		return renderChromeBorder(theme, config.colorSources.editor, EDITOR_BORDER_STYLE, text);
	}
	return renderEditorBorder(text);
}

export function patchSelectorBorderStyle(
	prototype: PatchableSelectorPrototype,
	getTheme?: () => Theme | undefined,
	getConfig?: () => PolishedTuiConfig,
): Cleanup {
	prototype.__zentuiSelectorBorderGetTheme = getTheme;
	prototype.__zentuiSelectorBorderGetConfig = getConfig;
	prototype.__zentuiSelectorBorderActive = true;

	if (
		prototype.__zentuiSelectorBorderPatched &&
		prototype.render === prototype.__zentuiSelectorBorderWrapper
	) {
		return () => {
			prototype.__zentuiSelectorBorderActive = false;
		};
	}

	prototype.__zentuiSelectorBorderOriginalRender = prototype.render;
	const wrapper = function renderWithZentuiSelectorBorders(this: unknown, width: number): string[] {
		const original = prototype.__zentuiSelectorBorderOriginalRender ?? prototype.render;
		if (!prototype.__zentuiSelectorBorderActive) return original.call(this, width);

		const lines = original.call(this, width);
		if (lines.length === 0 || width <= 0) return lines;

		return lines.map((line, index) => {
			if (index !== 0 && index !== lines.length - 1) return line;
			if (!isHorizontalBorderLine(line)) return line;
			return renderBorderLine(
				width,
				prototype.__zentuiSelectorBorderGetTheme?.(),
				prototype.__zentuiSelectorBorderGetConfig?.(),
			);
		});
	};
	prototype.__zentuiSelectorBorderWrapper = wrapper;
	prototype.render = wrapper;
	prototype.__zentuiSelectorBorderPatched = true;

	return () => {
		prototype.__zentuiSelectorBorderActive = false;
	};
}

export function installSelectorBorderStyle(
	getTheme?: () => Theme | undefined,
	getConfig?: () => PolishedTuiConfig,
): Cleanup {
	const cleanupModel = patchSelectorBorderStyle(
		ModelSelectorComponent.prototype as unknown as PatchableSelectorPrototype,
		getTheme,
		getConfig,
	);
	const cleanupSettings = patchSelectorBorderStyle(
		SettingsSelectorComponent.prototype as unknown as PatchableSelectorPrototype,
		getTheme,
		getConfig,
	);
	return () => {
		cleanupModel();
		cleanupSettings();
	};
}
