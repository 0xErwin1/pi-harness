/**
 * Render-safety wrapper for prototype-patched component render methods.
 *
 * The invariant: a patched `render()` that throws is FATAL for pi-tui because
 * the TUI has no error boundary. This wrapper captures the original output
 * (baseline) before running the transform, and falls back to the baseline on
 * any throw. The original render throw (pi's own bug) propagates unchanged
 * because the baseline capture happens before the try/catch.
 */

export type RenderFn = (width: number) => string[];

/** Transform applied to the original render output before it is returned. */
export type LineTransform = (lines: string[], self: unknown, width: number) => string[];

/**
 * Wraps a `LineTransform` so that it can be passed to `patchPrototypeMethod`.
 *
 * Returns a function compatible with the `wrap: (orig: Function) => Function`
 * parameter of `patchPrototypeMethod`. The returned RenderFn:
 * 1. Calls `orig(width)` to capture the baseline.
 * 2. Runs `transform(baseline, this, width)` inside a try/catch.
 * 3. Returns the transform result on success; returns the baseline on any throw.
 */
export function safeRenderWrapper(transform: LineTransform): (orig: Function) => Function {
	return (orig: Function): Function => {
		return function (this: unknown, width: number): string[] {
			const baseline = (orig as RenderFn).call(this, width);
			try {
				return transform(baseline, this, width);
			} catch {
				return baseline;
			}
		};
	};
}
