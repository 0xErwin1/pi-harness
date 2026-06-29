/**
 * OSC 133 prompt-zone marker strip/reapply for render transforms.
 *
 * The SDK's AssistantMessageComponent and UserMessageComponent prepend OSC 133
 * shell-integration markers to the first and last rendered lines:
 *   lines[0]    = ZONE_START + lines[0]
 *   lines[last] = ZONE_TRAILING + lines[last]
 *
 * When first == last (single-line output), both mutations apply to lines[0],
 * yielding ZONE_TRAILING + ZONE_START + content.
 *
 * The strip/reapply pair allows a line transform to operate on clean body lines
 * and then restore the markers to their correct positions, satisfying R5.
 */

const ZONE_START    = "\x1b]133;A\x07";
const ZONE_END      = "\x1b]133;B\x07";
const ZONE_FINAL    = "\x1b]133;C\x07";
const ZONE_TRAILING = ZONE_END + ZONE_FINAL;
const ZONE_SINGLE   = ZONE_TRAILING + ZONE_START;

export interface Osc133Markers {
	leading:  string;
	trailing: string;
}

/**
 * Strips OSC 133 markers from the rendered output, returning the clean body
 * lines and the stripped markers for later reapplication.
 *
 * Handles three cases:
 * - Empty: returns empty body with no markers.
 * - Single line: detects the combined TRAILING+START prefix and stores both.
 * - Multi-line: strips ZONE_START from first, ZONE_TRAILING from last.
 *
 * Lines without a recognized marker prefix are returned unchanged (no-marker
 * passthrough).
 */
export function stripOsc133(lines: string[]): { body: string[]; markers: Osc133Markers } {
	if (lines.length === 0) {
		return { body: [], markers: { leading: "", trailing: "" } };
	}

	const body = lines.slice();
	let leading  = "";
	let trailing = "";

	if (lines.length === 1) {
		if (body[0].startsWith(ZONE_SINGLE)) {
			leading  = ZONE_START;
			trailing = ZONE_TRAILING;
			body[0]  = body[0].slice(ZONE_SINGLE.length);
		}
	} else {
		if (body[0].startsWith(ZONE_START)) {
			leading = ZONE_START;
			body[0] = body[0].slice(ZONE_START.length);
		}

		const last = body.length - 1;
		if (body[last].startsWith(ZONE_TRAILING)) {
			trailing    = ZONE_TRAILING;
			body[last]  = body[last].slice(ZONE_TRAILING.length);
		}
	}

	return { body, markers: { leading, trailing } };
}

/**
 * Restores stripped OSC 133 markers to the correct positions in a transformed
 * body array.
 *
 * - Empty body: returned unchanged.
 * - Single line: prepends `trailing + leading` (matching the SDK's mutation
 *   order where TRAILING is applied after START, making it the outermost prefix).
 * - Multi-line: prepends `leading` to body[0] and `trailing` to body[last].
 *
 * When both markers are empty strings the body is returned unchanged
 * (no-marker passthrough).
 */
export function reapplyOsc133(body: string[], markers: Osc133Markers): string[] {
	if (body.length === 0) return body;
	if (!markers.leading && !markers.trailing) return body;

	const result = body.slice();

	if (result.length === 1) {
		result[0] = markers.trailing + markers.leading + result[0];
	} else {
		if (markers.leading) {
			result[0] = markers.leading + result[0];
		}
		const last = result.length - 1;
		if (markers.trailing) {
			result[last] = markers.trailing + result[last];
		}
	}

	return result;
}
