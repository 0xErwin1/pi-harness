/**
 * Process-wide count of focused custom overlays (the conversation viewer, the
 * todos overlay, the stash browser, the model panel...).
 *
 * pi runs extension `onTerminalInput` listeners BEFORE the focused overlay
 * receives a key, so any global key router — notably the agents/todos widget,
 * which turns the right arrow at an empty prompt into "open todos" — must stay
 * inert while ANY overlay is up. Otherwise it consumes keys (arrows, Esc) meant
 * for the overlay, e.g. opening the todos modal from inside the stash browser.
 *
 * Every overlay brackets its lifetime with {@link enterOverlay} / {@link
 * exitOverlay}; routers consult {@link anyOverlayOpen}. This is a single shared
 * module so all overlays and routers observe the same count regardless of which
 * package they live in.
 */
let openOverlays = 0;

/** Marks one more overlay as open. Pair with {@link exitOverlay} in a `finally`. */
export function enterOverlay(): void {
	openOverlays += 1;
}

/** Marks one overlay as closed. Never drops below zero. */
export function exitOverlay(): void {
	openOverlays = Math.max(0, openOverlays - 1);
}

/** Whether at least one custom overlay currently holds keyboard focus. */
export function anyOverlayOpen(): boolean {
	return openOverlays > 0;
}
