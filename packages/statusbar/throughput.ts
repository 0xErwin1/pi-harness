/**
 * Output-token throughput derived from streaming message deltas.
 *
 * The producer feeds this a per-message stream of content deltas and, at
 * message end, asks for a tokens/sec figure. The calculation is pure and
 * timestamp-driven so it can be tested without a live model stream.
 */

const CHARS_PER_ESTIMATED_TOKEN = 4;
const MIN_DELTAS = 2;
const MIN_STREAM_MS = 50;

/** Accumulated timing/size of one assistant message's content stream. */
export interface StreamAccumulator {
	streamStartMs: number | null;
	lastDeltaMs: number | null;
	totalChars: number;
	firstDeltaChars: number;
	deltaCount: number;
	sawToolCall: boolean;
}

export function emptyStream(): StreamAccumulator {
	return {
		streamStartMs: null,
		lastDeltaMs: null,
		totalChars: 0,
		firstDeltaChars: 0,
		deltaCount: 0,
		sawToolCall: false,
	};
}

function estimateContentTokens(characters: number): number {
	return Math.ceil(characters / CHARS_PER_ESTIMATED_TOKEN);
}

/** Records a text/thinking content delta of `deltaChars` observed at `nowMs`. */
export function recordContentDelta(acc: StreamAccumulator, deltaChars: number, nowMs: number): StreamAccumulator {
	const isFirst = acc.streamStartMs === null;

	return {
		...acc,
		streamStartMs: isFirst ? nowMs : acc.streamStartMs,
		firstDeltaChars: isFirst ? deltaChars : acc.firstDeltaChars,
		lastDeltaMs: nowMs,
		totalChars: acc.totalChars + deltaChars,
		deltaCount: acc.deltaCount + 1,
	};
}

/** Flags that the message emitted a tool call, which makes usage.output untrusted. */
export function markToolCall(acc: StreamAccumulator): StreamAccumulator {
	return { ...acc, sawToolCall: true };
}

/**
 * Computes tokens/sec for the finished stream, or `null` when there is no
 * observable cadence: a tool-call-only turn (no content), a single delta, or a
 * sub-50ms burst. The first delta's tokens are excluded from the numerator so
 * an initial chunk delivered at the very start is not counted as if it were
 * generated instantaneously at t=0.
 *
 * `outputTokens` is the authoritative count from usage; it is trusted only when
 * no tool call was seen (a tool call inflates it with non-text tokens), else the
 * character estimate is used.
 */
export function finalizeTokensPerSecond(acc: StreamAccumulator, outputTokens: number): number | null {
	if (acc.streamStartMs === null || acc.totalChars === 0) return null;

	const streamEndMs = acc.lastDeltaMs ?? acc.streamStartMs;
	const streamMs = streamEndMs - acc.streamStartMs;

	const firstDeltaTokens = estimateContentTokens(acc.firstDeltaChars);
	const streamedTokens =
		!acc.sawToolCall && outputTokens > 0
			? Math.max(0, outputTokens - firstDeltaTokens)
			: Math.max(0, estimateContentTokens(acc.totalChars) - firstDeltaTokens);

	if (acc.deltaCount < MIN_DELTAS || streamMs < MIN_STREAM_MS || streamedTokens <= 0) return null;

	return streamedTokens / (streamMs / 1000);
}
