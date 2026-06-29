/**
 * Parity test drivers.
 *
 * `driveConsumerA` runs fixture events through the render-core formatters exactly
 * as Consumer A (main thread) wires them. `driveConsumerB` converts the fixture
 * to `RunEvent[]`, drives the conversation viewer's `eventsToBodyLines`, and
 * styles each line through `styleTranscriptLine`. Both accept the same `styler`
 * and `widthOps` so a deterministic test double produces comparable output.
 *
 * `fixtureToRunEvents` converts a `ToolInteraction[]` to the `RunEvent` stream
 * that `eventsToBodyLines` expects. Events are interleaved (progress then result)
 * so adjacency matching in the viewer correctly correlates each result to its call.
 */

import type { RunEvent } from "../../subagent-manager-core/events.ts";
import {
	eventsToBodyLines,
	styleTranscriptLine,
	type TranscriptStyler,
} from "../../subagent-manager-pi/tui/conversation-viewer-model.ts";
import { buildToolCallLine } from "../formatters/tool-call.ts";
import { buildToolResultLines } from "../formatters/tool-result.ts";
import type { WidthOps, RenderCtx } from "../width.ts";
import type { RenderStyler } from "../styler.ts";
import { RENDER_DEFAULTS } from "../config.ts";
import { toolVerb, formatToolArgs } from "../formatters/tool-args.ts";
import type { ParityFixture } from "./parity-fixtures.ts";

/**
 * Converts a `ParityFixture`'s interactions to the `RunEvent` stream that
 * `eventsToBodyLines` expects. Events are emitted in progress-then-result order
 * for each interaction so adjacency-based result matching in the viewer is correct.
 */
export function fixtureToRunEvents(fixture: ParityFixture): RunEvent[] {
	const events: RunEvent[] = [];
	let seq = 0;

	for (const interaction of fixture.events) {
		const now = new Date().toISOString();
		const displayArgs = formatToolArgs(interaction.toolName, interaction.args);
		const fullCall = displayArgs.length > 0
			? `${toolVerb(interaction.toolName)} ${displayArgs}`
			: toolVerb(interaction.toolName);

		events.push({
			id: `e${seq++}`,
			runId: "parity",
			type: "run.progress",
			at: now,
			message: `tool: ${interaction.toolName}`,
			toolCallFull: fullCall,
		});

		if (interaction.result !== undefined) {
			events.push({
				id: `e${seq++}`,
				runId: "parity",
				type: "run.tool_result",
				at: now,
				toolName: interaction.toolName,
				resultText: interaction.result.resultText,
				details: interaction.result.details,
				isError: interaction.result.isError,
			});
		}
	}

	return events;
}

/**
 * Drives Consumer A: runs each fixture interaction through the render-core
 * formatters and collects the styled, clamped output lines.
 */
export function driveConsumerA(
	fixture: ParityFixture,
	styler: RenderStyler,
	widthOps: WidthOps,
): string[] {
	const ctx: RenderCtx = {
		styler,
		width: widthOps,
		maxWidth: fixture.width,
		config: RENDER_DEFAULTS,
	};

	const all: string[] = [];

	for (const interaction of fixture.events) {
		if (interaction.result !== undefined) {
			const lines = buildToolResultLines(
				interaction.toolName,
				interaction.args,
				interaction.result,
				interaction.result.isError ?? false,
				false,
				ctx,
			);
			all.push(...lines);
		} else {
			const lines = buildToolCallLine(interaction.toolName, interaction.args, ctx);
			all.push(...lines);
		}
	}

	return all;
}

/**
 * Drives Consumer B: converts the fixture to `RunEvent[]`, calls
 * `eventsToBodyLines` at the fixture width, then styles every body line through
 * `styleTranscriptLine`. The same `styler` is used by both consumers so colour
 * token differences surface clearly in assertion output.
 *
 * `RenderStyler` and `TranscriptStyler` share the same structural shape; the
 * cast lets TypeScript accept them as compatible without importing the viewer
 * interface in every test file.
 */
export function driveConsumerB(
	fixture: ParityFixture,
	styler: RenderStyler,
	_widthOps: WidthOps,
): string[] {
	const events = fixtureToRunEvents(fixture);
	const bodyLines = eventsToBodyLines(events, fixture.width);
	return bodyLines.map((line) => styleTranscriptLine(line, styler as unknown as TranscriptStyler));
}
