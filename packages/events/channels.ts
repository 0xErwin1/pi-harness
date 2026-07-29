export interface ThroughputPayload {
	tokensPerSecond: number | null;
	turnId: string;
}

export interface PrInfoPayload {
	number: number;
	url: string;
	isDraft: boolean;
}

/**
 * The full set of typed channels carried over `pi.events`. Each producer
 * extension publishes exactly one of these; each chrome-owning consumer
 * subscribes to the channels it renders.
 */
export interface Channels {
	"harness:throughput": ThroughputPayload;
	"harness:pr": PrInfoPayload | null;
}

export type ChannelName = keyof Channels;
