#!/usr/bin/env node

/**
 * Fake pi binary for subprocess tests.
 * Emits a single NDJSON message_end event then exits 0.
 * On SIGTERM, emits a terminated event and exits 130.
 *
 * Environment variables:
 *   PI_ARGS_FILE      — path to write received argv (slice 2) as JSON before output
 *   PI_SLOW_MODE      — when set, waits indefinitely before emitting output (for abort tests)
 *   PI_IGNORE_SIGTERM — when set, traps SIGTERM without exiting (to test SIGKILL fallback)
 */

import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);

if (process.env.PI_ARGS_FILE) {
	writeFileSync(process.env.PI_ARGS_FILE, JSON.stringify(args));
}

if (process.env.PI_IGNORE_SIGTERM) {
	process.on("SIGTERM", () => {});
	setTimeout(() => {}, 60_000);
} else {
	process.on("SIGTERM", () => {
		process.stdout.write(JSON.stringify({ type: "terminated" }) + "\n");
		process.exit(130);
	});

	if (process.env.PI_SLOW_MODE) {
		setTimeout(() => {}, 60_000);
	} else {
		const multiCount = process.env.PI_MULTI_MESSAGE ? parseInt(process.env.PI_MULTI_MESSAGE, 10) : 0;

		if (multiCount > 0) {
			for (let i = 1; i <= multiCount; i++) {
				process.stdout.write(
					JSON.stringify({
						type: "message_end",
						message: {
							role: "assistant",
							content: [{ type: "text", text: `message ${i}` }],
						},
					}) + "\n",
				);
			}
			process.stdout.write(JSON.stringify({ type: "tool_execution_start", toolName: "fake_tool" }) + "\n");
		} else {
			process.stdout.write(
				JSON.stringify({
					type: "message_end",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "fake-pi response" }],
					},
				}) + "\n",
			);
		}

		process.exit(0);
	}
}
