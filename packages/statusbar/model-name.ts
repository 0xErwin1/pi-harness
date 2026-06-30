import type { ThemeColor } from "@earendil-works/pi-coding-agent";

/**
 * Reasoning effort levels reported by `pi.getThinkingLevel()`. Kept as a local
 * union so the pure statusbar layer does not depend on the agent-core package.
 */
export type EffortLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh";

/** Minimal shape of a model needed for footer display. Provider-agnostic. */
export interface ModelLike {
	name?: string | null;
	id?: string | null;
}

/**
 * Friendly, provider-agnostic model label. Prefers the human `name`, falls back
 * to the raw `id`, and finally to `"no-model"` when no model is active.
 */
export function formatModelName(model: ModelLike | null | undefined): string {
	const name = model?.name?.trim();
	if (name) return name;

	const id = model?.id?.trim();
	if (id) return id;

	return "no-model";
}

const EFFORT_COLOR_ROLES: Record<EffortLevel, ThemeColor> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
};

/**
 * The theme color role for an effort token, matching the built-in thinking
 * indicator coloring (`thinkingOff` … `thinkingXhigh`).
 */
export function effortColorRole(level: EffortLevel): ThemeColor {
	return EFFORT_COLOR_ROLES[level];
}

/** Display label for the effort token. Identity today; isolated for future tuning. */
export function formatEffortLabel(level: EffortLevel): string {
	return level;
}
