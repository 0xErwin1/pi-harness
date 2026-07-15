/**
 * A single row in the subagent roster, published on "harness:agents".
 *
 * `id` is the only required field so any consumer can key on it; `agentType`
 * and `status` are optional display hints the subagent-ui producer fills in.
 * The channel guard validates `id` only, so these additions stay backward
 * compatible with the malformed-payload rejection contract.
 */
export interface AgentRow {
	id: string;
	agentType?: string;
	status?: string;
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
