/**
 * Parity fixture types for render-core.
 *
 * A `ParityFixture` drives BOTH consumers (main-thread render-core formatters
 * and the subagent conversation viewer) with the same event data. For fixtures
 * tagged `parity: "strict"`, the test asserts `deepEqual(stripAnsi(A), stripAnsi(B))`.
 * For fixtures tagged `parity: { diverges: reason }`, the test asserts NOT equal
 * AND records the reason — divergence is opt-in and visible, never silent.
 */

/** A single completed (or pending) tool interaction in a fixture event stream. */
export interface ToolInteraction {
	toolName: string;
	args: unknown;
	result?: {
		resultText?: string;
		details?: unknown;
		isError?: boolean;
	};
}

/** Strict parity or an explicit, documented divergence. */
export type ParityMode = "strict" | { diverges: string };

/** A fully specified parity scenario. */
export interface ParityFixture {
	id: string;
	description: string;
	events: ToolInteraction[];
	/** Render width both consumers use. A large value (≥200) avoids truncation. */
	width: number;
	parity: ParityMode;
}
