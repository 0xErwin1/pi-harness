#!/usr/bin/env node

/**
 * Fake pi binary for subprocess tests.
 * Emits a single NDJSON message_end event then exits 0.
 * On SIGTERM, emits a terminated event and exits 130.
 *
 * Environment variables:
 *   PI_ARGS_FILE        — path to write received argv (slice 2) as JSON before output
 *   PI_SLOW_MODE        — when set, waits indefinitely before emitting output (for abort tests)
 *   PI_IGNORE_SIGTERM   — when set, traps SIGTERM without exiting (to test SIGKILL fallback)
 *   PI_TOOL_WITH_ARGS   — when set, emits a tool_execution_start carrying {toolName, args}
 *                         before a final message_end (for tool-target extraction tests)
 *   PI_TOOL_MCP         — when set, emits a tool_execution_start for an MCP-style tool with
 *                         multi-field args before a final message_end (for rich tool-call
 *                         formatting tests)
 *   PI_TOOL_MCP_FULL    — when set, emits a tool_execution_start for an MCP-style tool whose
 *                         args have more than four keys and an over-long value, so the
 *                         summarized `toolCall` and the complete `toolCallFull` differ
 *                         (for full-args viewer plumbing tests)
 *   PI_TOOL_WITH_RESULT — when set, emits tool_execution_start + tool_execution_end (with result)
 *                         before a final message_end (for run.tool_result emission tests)
 *   PI_THINKING         — when set, emits a message_end whose assistant content carries
 *                         a thinking block before the final text (for thinking-stream tests)
 *   PI_TOKENS           — when set, emits two assistant message_end events each carrying a
 *                         `usage` payload (for token-accounting tests)
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
	} else if (process.env.PI_TOOL_WITH_ARGS) {
		process.stdout.write(
			JSON.stringify({
				type: "tool_execution_start",
				toolName: "read",
				args: { path: "src/foo.ts" },
			}) + "\n",
		);
		process.stdout.write(
			JSON.stringify({
				type: "message_end",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "done" }],
				},
			}) + "\n",
		);
		process.exit(0);
	} else if (process.env.PI_TOOL_WITH_RESULT) {
		process.stdout.write(
			JSON.stringify({
				type: "tool_execution_start",
				toolCallId: "call-r001",
				toolName: "read",
				args: { path: "README.md" },
			}) + "\n",
		);
		process.stdout.write(
			JSON.stringify({
				type: "tool_execution_end",
				toolCallId: "call-r001",
				toolName: "read",
				result: {
					content: [{ type: "text", text: "README contents here" }],
					details: { truncation: null },
				},
				isError: false,
			}) + "\n",
		);
		process.stdout.write(
			JSON.stringify({
				type: "message_end",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "tool result done" }],
				},
			}) + "\n",
		);
		process.exit(0);
	} else if (process.env.PI_TOOL_MCP) {
		process.stdout.write(
			JSON.stringify({
				type: "tool_execution_start",
				toolName: "engram_mem_save",
				args: { query: "auth bug root cause", project: "pi-harness" },
			}) + "\n",
		);
		process.stdout.write(
			JSON.stringify({
				type: "message_end",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "done" }],
				},
			}) + "\n",
		);
		process.exit(0);
	} else if (process.env.PI_TOOL_MCP_FULL) {
		process.stdout.write(
			JSON.stringify({
				type: "tool_execution_start",
				toolName: "engram_mem_save",
				args: {
					project: "ignis",
					scope: "project",
					type: "architecture",
					title: "Proposed LSP references hardening and resolver fix across modules and packages",
					topic_key: "sdd/x/proposal",
				},
			}) + "\n",
		);
		process.stdout.write(
			JSON.stringify({
				type: "message_end",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "done" }],
				},
			}) + "\n",
		);
		process.exit(0);
	} else if (process.env.PI_TOKENS) {
		process.stdout.write(
			JSON.stringify({
				type: "message_end",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "first" }],
					usage: { input: 100, output: 50 },
				},
			}) + "\n",
		);
		process.stdout.write(
			JSON.stringify({
				type: "message_end",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "second" }],
					usage: { input_tokens: 200, output_tokens: 25 },
				},
			}) + "\n",
		);
		process.exit(0);
	} else if (process.env.PI_THINKING) {
		process.stdout.write(
			JSON.stringify({
				type: "message_end",
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "Let me weigh the options first." },
						{ type: "text", text: "final answer" },
					],
				},
			}) + "\n",
		);
		process.exit(0);
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
