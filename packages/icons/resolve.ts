import type { IconMode, IconSet } from "./types.ts";
import { ICON_CATALOG } from "./catalog.ts";

/**
 * Returns the IconSet for the given mode.
 * Callers that need dynamic mode resolution should use getIcons() from config.ts instead.
 */
export function resolveIconSet(mode: IconMode): IconSet {
	return ICON_CATALOG[mode];
}
