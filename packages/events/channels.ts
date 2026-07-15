/**
 * A single row in the subagent roster, published on "harness:agents".
 *
 * Minimal placeholder: Work Unit 10 (subagent-ui) owns the final shape and
 * may extend this interface as its roster model solidifies.
 */
export interface AgentRow {
	id: string;
}

export interface ThroughputPayload {
	tokensPerSecond: number | null;
	turnId: string;
}

export interface PrInfoPayload {
	number: number;
	url: string;
	isDraft: boolean;
}

export interface AgentsPayload {
	rows: AgentRow[];
}

/**
 * The full set of typed channels carried over `pi.events`. Each producer
 * extension publishes exactly one of these; each chrome-owning consumer
 * subscribes to the channels it renders.
 */
export interface Channels {
	"harness:throughput": ThroughputPayload;
	"harness:pr": PrInfoPayload | null;
	"harness:agents": AgentsPayload;
}

export type ChannelName = keyof Channels;
