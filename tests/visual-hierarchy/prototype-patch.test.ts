import test from "node:test";
import assert from "node:assert/strict";
import { patchPrototypeMethod } from "../../packages/visual-hierarchy/prototype-patch.ts";

test("patchPrototypeMethod: installs and wraps the target method", () => {
	class Target {
		render(width: number): string[] {
			return [`original:${width}`];
		}
	}

	const sym = Symbol("test-install");
	let calls = 0;

	const handle = patchPrototypeMethod(Target, "render", sym, (orig) => {
		return function (this: unknown, width: number) {
			calls++;
			return (orig as (w: number) => string[]).call(this, width);
		};
	});

	assert.equal(handle.installed, true);

	const t = new Target();
	const result = t.render(80);

	assert.equal(calls, 1);
	assert.deepEqual(result, ["original:80"]);
});

test("patchPrototypeMethod: installed flag reflects actual state", () => {
	class Target {
		greet(): string {
			return "hello";
		}
	}

	const sym = Symbol("test-flag");
	const handle = patchPrototypeMethod(Target, "greet", sym, (orig) => {
		return function (this: unknown) {
			return "wrapped:" + (orig as () => string).call(this);
		};
	});

	assert.equal(handle.installed, true);

	handle.restore();

	assert.equal(handle.installed, false);
});

test("patchPrototypeMethod: idempotent re-install does not double-wrap", () => {
	class Target {
		render(): string[] {
			return ["original"];
		}
	}

	const sym = Symbol("test-idempotent");
	let wrapCount = 0;

	patchPrototypeMethod(Target, "render", sym, (orig) => {
		wrapCount++;
		return function (this: unknown) {
			return ["wrapped:" + (orig as () => string[]).call(this).join(",")];
		};
	});

	const handle2 = patchPrototypeMethod(Target, "render", sym, (orig) => {
		wrapCount++;
		return function (this: unknown) {
			return ["double-wrapped:" + (orig as () => string[]).call(this).join(",")];
		};
	});

	assert.equal(wrapCount, 1, "wrap function called only once");

	const t = new Target();
	assert.deepEqual(t.render(), ["wrapped:original"]);

	handle2.restore();
	assert.deepEqual(new Target().render(), ["original"]);
});

test("patchPrototypeMethod: restore is a no-op when our Symbol is absent", () => {
	class Target {
		compute(): number {
			return 42;
		}
	}

	const sym = Symbol("test-restore-guard");
	const handle = patchPrototypeMethod(Target, "compute", sym, () => {
		return function () {
			return 100;
		};
	});

	handle.restore();
	assert.equal(new Target().compute(), 42, "first restore works");

	assert.doesNotThrow(() => handle.restore(), "second restore is a no-op");
	assert.equal(new Target().compute(), 42, "value unchanged after second restore");
});

test("patchPrototypeMethod: returns noop handle when target is undefined", () => {
	const sym = Symbol("test-undef");
	const handle = patchPrototypeMethod(
		undefined as unknown as { prototype: object },
		"render" as never,
		sym,
		() => () => [],
	);

	assert.equal(handle.installed, false);
	assert.doesNotThrow(() => handle.restore());
});

test("patchPrototypeMethod: returns noop handle when method is absent", () => {
	class Target {}

	const sym = Symbol("test-missing");
	const handle = patchPrototypeMethod(Target as unknown as { prototype: { render: unknown } }, "render", sym, () => () => []);

	assert.equal(handle.installed, false);
	assert.doesNotThrow(() => handle.restore());
});
