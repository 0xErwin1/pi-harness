import assert from "node:assert/strict";
import test from "node:test";

import { buildTranscriptLines } from "../extensions/transcript-viewer.ts";

test("buildTranscriptLines extracts user and assistant text from session entries", () => {
	const lines = buildTranscriptLines([
		{ type: "message", message: { role: "user", content: "hello" } },
		{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "hi\nthere" }] } },
	]);

	assert.deepEqual(
		lines.map((line) => line.text),
		["You:", "hello", "", "Agent:", "hi", "there"],
	);
});

test("buildTranscriptLines includes tool call placeholders without crashing on unknown blocks", () => {
	const lines = buildTranscriptLines([
		{
			type: "message",
			message: {
				role: "assistant",
				content: [
					{ type: "toolCall", name: "read" },
					{ type: "unknown", value: 1 },
					{ type: "text", text: "done" },
				],
			},
		},
	]);

	assert.deepEqual(lines.map((line) => line.text), ["Agent:", "[tool call: read]", "done"]);
});
