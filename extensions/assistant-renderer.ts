/**
 * Visual hierarchy — assistant message renderer.
 *
 * Assistant turns use pi's native markdown render with no additional decoration.
 * Decoration is limited to user messages (WU2) and thinking blocks (WU3).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function assistantRenderer(_pi: ExtensionAPI): void {
	// No prototype patch on AssistantMessageComponent: native markdown render is used as-is.
}
