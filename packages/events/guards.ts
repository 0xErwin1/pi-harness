import type { AgentRow, AgentsPayload, ChannelName, Channels, PrInfoPayload, ThroughputPayload } from "./channels.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableNumber(value: unknown): value is number | null {
	return value === null || typeof value === "number";
}

export function isThroughputPayload(value: unknown): value is ThroughputPayload {
	if (!isRecord(value)) return false;

	return isNullableNumber(value.tokensPerSecond) && typeof value.turnId === "string";
}

export function isPrInfoPayload(value: unknown): value is PrInfoPayload {
	if (!isRecord(value)) return false;

	return (
		typeof value.number === "number" &&
		typeof value.url === "string" &&
		typeof value.isDraft === "boolean"
	);
}

/** The "harness:pr" channel payload is nullable — no open PR is a valid state. */
export function isPrChannelPayload(value: unknown): value is PrInfoPayload | null {
	return value === null || isPrInfoPayload(value);
}

function isAgentRow(value: unknown): value is AgentRow {
	return isRecord(value) && typeof value.id === "string";
}

export function isAgentsPayload(value: unknown): value is AgentsPayload {
	if (!isRecord(value)) return false;

	return Array.isArray(value.rows) && value.rows.every(isAgentRow);
}

/**
 * One runtime type guard per channel, keyed by channel name. `subscribe`
 * looks up the guard for the channel it is called with and uses it to
 * validate every payload crossing the `pi.events` boundary.
 */
export const CHANNEL_GUARDS: { [K in ChannelName]: (value: unknown) => value is Channels[K] } = {
	"harness:throughput": isThroughputPayload,
	"harness:pr": isPrChannelPayload,
	"harness:agents": isAgentsPayload,
};
