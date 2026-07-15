import test from "node:test";
import assert from "node:assert/strict";

import { createDebouncer } from "../../packages/pr-info/debounce.ts";

test("a burst of schedules collapses to a single task run per window", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });

	let runs = 0;
	const debouncer = createDebouncer(400, () => {
		runs += 1;
	});

	for (let i = 0; i < 5; i += 1) debouncer.schedule();

	assert.equal(runs, 0, "task must not run before the window elapses");
	t.mock.timers.tick(400);
	assert.equal(runs, 1, "the burst produces exactly one run");
});

test("a new schedule after the window fires again", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });

	let runs = 0;
	const debouncer = createDebouncer(400, () => {
		runs += 1;
	});

	debouncer.schedule();
	t.mock.timers.tick(400);
	debouncer.schedule();
	t.mock.timers.tick(400);

	assert.equal(runs, 2);
});

test("dispose cancels a pending run", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });

	let runs = 0;
	const debouncer = createDebouncer(400, () => {
		runs += 1;
	});

	debouncer.schedule();
	debouncer.dispose();
	t.mock.timers.tick(400);

	assert.equal(runs, 0);
});
