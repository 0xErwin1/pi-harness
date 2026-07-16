import test, { mock } from "node:test";
import assert from "node:assert/strict";

import subagentUi from "../../extensions/subagent-ui.ts";

/**
 * These tests drive the real overlay components through the same
 * `ctx.ui.custom(factory, ...)` seam pi uses: the factory pi would call is
 * invoked with a stub TUI/theme, and the component it returns is the genuine
 * `SubagentDashboard`/`TakeoverView`. Only the terminal boundary is faked, so
 * the wiring under test (key classification, transcript seeding, background
 * painting, timestamp threading) is exercised for real.
 *
 * The stub theme marks backgrounds as `[bg:token]...[/bg]` so assertions can
 * see which rows were painted.
 */

interface Component {
	render(width: number): string[];
	handleInput(data: string): void;
	dispose?(): void;
	focused?: boolean;
}

type CustomFactory = (tui: unknown, theme: unknown, keybindings: unknown, done: (result: unknown) => void) => Component;

interface Shortcut {
	description: string;
	handler: (ctx: unknown) => unknown;
}

const MANAGER_SYMBOL = Symbol.for("pi-subagents:manager");

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (color: string, text: string) => `[bg:${color}]${text}[/bg]`,
	bold: (text: string) => text,
	italic: (text: string) => text,
};

const tui = {
	terminal: { rows: 24, columns: 80 },
	requestRender() {},
};

function createPi() {
	const commands = new Map<string, { handler: (args: string, ctx: unknown) => unknown }>();
	const shortcuts = new Map<string, Shortcut>();
	const events = new Map<string, (payload: unknown) => void>();

	const pi = {
		events: {
			on(name: string, handler: (payload: unknown) => void) {
				events.set(name, handler);
			},
			emit() {},
		},
		on() {},
		registerCommand(name: string, command: { handler: (args: string, ctx: unknown) => unknown }) {
			commands.set(name, command);
		},
		registerShortcut(key: string, options: Shortcut) {
			shortcuts.set(key, options);
		},
	};

	return { commands, shortcuts, events, pi };
}

function setManager(record: unknown): void {
	(globalThis as Record<symbol, unknown>)[MANAGER_SYMBOL] = {
		getRecord: (id: string) => (id === "a1" ? record : undefined),
	};
}

/**
 * Register the extension, put one running agent `a1` on the roster, and return
 * the captured overlay components. `picks` scripts what each successive
 * `ctx.ui.custom` call resolves with, mirroring the dashboard -> takeover loop.
 */
async function openOverlays(picks: unknown[]): Promise<Component[]> {
	const { commands, events, pi } = createPi();
	subagentUi(pi as never);

	events.get("subagents:created")?.({ id: "a1", type: "explorer", description: "probe agent" });
	events.get("subagents:started")?.({ id: "a1", type: "explorer", description: "probe agent" });

	const captured: Component[] = [];
	let call = 0;

	const ctx = {
		mode: "tui",
		ui: {
			notify() {},
			custom(factory: CustomFactory) {
				const component = factory(tui, theme, {}, () => {});
				captured.push(component);
				return Promise.resolve(picks[call++]);
			},
		},
	};

	await commands.get("fleet")?.handler("", ctx);
	for (const component of captured) component.dispose?.();

	return captured;
}

test("registers ctrl+alt+f as the fleet shortcut", () => {
	const { shortcuts, pi } = createPi();

	subagentUi(pi as never);

	const shortcut = shortcuts.get("ctrl+alt+f");
	assert.ok(shortcut, "expected a ctrl+alt+f shortcut to be registered");
	assert.match(shortcut.description, /fleet|subagent/i);
});

test("keeps the /fleet command registered alongside the shortcut", () => {
	const { commands, pi } = createPi();

	subagentUi(pi as never);

	assert.equal(commands.has("fleet"), true);
});

test("the fleet shortcut opens no overlay outside the TUI", async () => {
	const { shortcuts, pi } = createPi();

	subagentUi(pi as never);

	let customCalls = 0;
	const notifications: string[] = [];
	const ctx = {
		mode: "headless",
		ui: {
			notify(message: string) {
				notifications.push(message);
			},
			custom() {
				customCalls += 1;
			},
		},
	};

	await shortcuts.get("ctrl+alt+f")?.handler(ctx);

	assert.equal(customCalls, 0);
	assert.equal(notifications.length, 1);
});

test("the dashboard renders a running agent's relative start time", async () => {
	setManager({ startedAt: Date.now() - 180_000 });

	const [dashboard] = await openOverlays([null]);
	const row = dashboard.render(80).find((line) => line.includes("explorer"));

	assert.ok(row, "expected a roster row for the running agent");
	assert.match(row, /3m ago/);
});

test("the dashboard survives an agent whose record is unavailable", async () => {
	setManager(undefined);

	const [dashboard] = await openOverlays([null]);
	const row = dashboard.render(80).find((line) => line.includes("explorer"));

	assert.ok(row, "expected a roster row even without a manager record");
	assert.doesNotMatch(row, /ago/);
});

test("every dashboard row is painted with a background", async () => {
	setManager({ startedAt: Date.now() - 1000 });

	const [dashboard] = await openOverlays([null]);

	for (const line of dashboard.render(80)) {
		assert.match(line, /^\[bg:[a-zA-Z]+\]/, `unpainted dashboard row: ${JSON.stringify(line)}`);
	}
});

test("the dashboard closes on esc and ctrl+c, and ignores unowned keys", async () => {
	setManager({ startedAt: Date.now() });

	for (const key of ["\x1b", "\x03"]) {
		const { commands, events, pi } = createPi();
		subagentUi(pi as never);
		events.get("subagents:created")?.({ id: "a1", type: "explorer", description: "probe agent" });
		events.get("subagents:started")?.({ id: "a1", type: "explorer", description: "probe agent" });

		let closed = false;
		const ctx = {
			mode: "tui",
			ui: {
				notify() {},
				custom(factory: CustomFactory) {
					return new Promise((resolve) => {
						const component = factory(tui, theme, {}, (result) => {
							closed = true;
							resolve(result);
						});

						component.handleInput("\x04");
						assert.equal(closed, false, "ctrl+d must stay inert in the dashboard");

						component.handleInput(key);
						component.dispose?.();
						resolve(null);
					});
				},
			},
		};

		await commands.get("fleet")?.handler("", ctx);
		assert.equal(closed, true, `expected ${JSON.stringify(key)} to close the dashboard`);
	}
});

test("the takeover seeds prior session history before subscribing", async () => {
	setManager({
		startedAt: Date.now(),
		session: {
			messages: [
				{ role: "user", content: "explore the repo" },
				{ role: "assistant", content: [{ type: "text", text: "found the entrypoint" }] },
			],
			subscribe: () => () => {},
			steer: async () => {},
		},
	});

	const [, takeover] = await openOverlays(["a1", null]);
	const lines = takeover.render(80).join("\n");

	assert.match(lines, /explore the repo/);
	assert.match(lines, /found the entrypoint/);
	assert.doesNotMatch(lines, /\(no output yet\)/);
});

test("the takeover shows the empty hint only when history is genuinely empty", async () => {
	setManager({
		startedAt: Date.now(),
		session: { messages: [], subscribe: () => () => {}, steer: async () => {} },
	});

	const [, takeover] = await openOverlays(["a1", null]);

	assert.match(takeover.render(80).join("\n"), /\(no output yet\)/);
});

test("the takeover attaches to a session that only appears after it opened", async () => {
	const record: { startedAt: number; session?: unknown } = { startedAt: Date.now() };
	setManager(record);

	mock.timers.enable({ apis: ["setInterval"] });

	const captured: Component[] = [];

	try {
		const { commands, events, pi } = createPi();
		subagentUi(pi as never);

		events.get("subagents:created")?.({ id: "a1", type: "explorer", description: "probe agent" });
		events.get("subagents:started")?.({ id: "a1", type: "explorer", description: "probe agent" });

		const picks: unknown[] = ["a1", null];
		let call = 0;

		const ctx = {
			mode: "tui",
			ui: {
				notify() {},
				custom(factory: CustomFactory) {
					captured.push(factory(tui, theme, {}, () => {}));
					return Promise.resolve(picks[call++]);
				},
			},
		};

		await commands.get("fleet")?.handler("", ctx);

		const takeover = captured[1];
		assert.ok(takeover, "expected a takeover overlay");
		assert.match(takeover.render(80).join("\n"), /\(no output yet\)/);

		const listeners: ((event: unknown) => void)[] = [];
		record.session = {
			messages: [{ role: "user", content: "explore the repo" }],
			subscribe: (listener: (event: unknown) => void) => {
				listeners.push(listener);
				return () => {};
			},
			steer: async () => {},
		};

		mock.timers.tick(1000);

		assert.match(takeover.render(80).join("\n"), /explore the repo/);
		assert.equal(listeners.length, 1, "expected the late session to be subscribed exactly once");

		listeners[0]?.({
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "found the entrypoint" }] },
		});

		assert.match(takeover.render(80).join("\n"), /found the entrypoint/);

		mock.timers.tick(1000);
		assert.equal(listeners.length, 1, "a settled attachment must not resubscribe");
	} finally {
		for (const component of captured) component.dispose?.();
		mock.timers.reset();
	}
});

test("every takeover row is painted with a background", async () => {
	setManager({
		startedAt: Date.now(),
		session: {
			messages: [{ role: "user", content: "hi" }],
			subscribe: () => () => {},
			steer: async () => {},
		},
	});

	const [, takeover] = await openOverlays(["a1", null]);

	for (const line of takeover.render(80)) {
		assert.match(line, /^\[bg:[a-zA-Z]+\]/, `unpainted takeover row: ${JSON.stringify(line)}`);
	}
});
