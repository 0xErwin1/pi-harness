import type { EventBus } from "@earendil-works/pi-coding-agent";
import type { ChannelName, Channels } from "./channels.ts";
import { CHANNEL_GUARDS } from "./guards.ts";

/**
 * The minimal shape `publish`/`subscribe` need from `ExtensionAPI`. Extensions
 * pass `pi` directly; tests can pass any object exposing a real `EventBus`
 * without constructing a full `ExtensionAPI`.
 */
export interface EventBusHost {
	events: EventBus;
}

export type Unsubscribe = () => void;

/**
 * Publishes a typed payload on a channel, over `pi.events.emit`.
 *
 * The payload type is tied to the channel name at the call site, so a
 * producer cannot publish a shape another channel's consumers do not expect.
 */
export function publish<K extends ChannelName>(pi: EventBusHost, channel: K, payload: Channels[K]): void {
	pi.events.emit(channel, payload);
}

/**
 * Subscribes to a typed channel, over `pi.events.on`.
 *
 * Every payload is run through the channel's runtime type guard before it
 * reaches `handler`. A payload that fails the guard is dropped silently: it
 * is not rendered and does not throw, matching the spec's "malformed payload
 * rejected" scenario.
 */
export function subscribe<K extends ChannelName>(
	pi: EventBusHost,
	channel: K,
	handler: (payload: Channels[K]) => void,
): Unsubscribe {
	const isValidPayload = CHANNEL_GUARDS[channel];

	return pi.events.on(channel, (data: unknown) => {
		if (!isValidPayload(data)) return;

		handler(data);
	});
}

export * from "./channels.ts";
export * from "./guards.ts";
