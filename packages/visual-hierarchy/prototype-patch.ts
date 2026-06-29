/**
 * Generic idempotent prototype monkey-patch helper.
 *
 * Installs a wrapper over one method on a class prototype and stores the
 * original in a caller-supplied Symbol slot so the patch can be restored
 * cleanly. The patch is idempotent: a second install with the same Symbol
 * detects the existing slot and does not re-wrap. Restore is guarded: if the
 * Symbol slot is absent (already restored or never installed) restore is a
 * no-op. A missing method or missing target class is also silently tolerated.
 */

export interface PatchHandle {
	restore(): void;
	readonly installed: boolean;
}

const NOOP_HANDLE: PatchHandle = {
	restore() {},
	get installed(): boolean {
		return false;
	},
};

/**
 * Wraps `target.prototype[method]` with `wrap(original)`, storing the original
 * in `target.prototype[symbolKey]`. Returns a handle to restore the original.
 *
 * Re-installing with the same Symbol while the patch is active is a no-op: the
 * existing slot is detected and the wrap function is NOT called again. The
 * returned handle still restores the true original.
 */
export function patchPrototypeMethod<T extends object>(
	target: { prototype: T } | undefined,
	method: keyof T & string,
	symbolKey: symbol,
	wrap: (orig: Function) => Function,
): PatchHandle {
	if (target === undefined) return NOOP_HANDLE;

	const proto = target.prototype;

	if (typeof (proto as Record<string, unknown>)[method] !== "function") {
		return NOOP_HANDLE;
	}

	const symProto = proto as Record<symbol, unknown>;
	const strProto = proto as Record<string, unknown>;

	if (Object.prototype.hasOwnProperty.call(proto, symbolKey)) {
		return makeHandle(proto, strProto, method, symbolKey);
	}

	const original = strProto[method] as Function;
	symProto[symbolKey] = original;
	strProto[method] = wrap(original);

	return makeHandle(proto, strProto, method, symbolKey);
}

function makeHandle(
	proto: object,
	strProto: Record<string, unknown>,
	method: string,
	symbolKey: symbol,
): PatchHandle {
	return {
		restore() {
			if (!Object.prototype.hasOwnProperty.call(proto, symbolKey)) return;
			const original = (proto as Record<symbol, unknown>)[symbolKey] as Function;
			strProto[method] = original;
			delete (proto as Record<symbol, unknown>)[symbolKey];
		},
		get installed(): boolean {
			return Object.prototype.hasOwnProperty.call(proto, symbolKey);
		},
	};
}
