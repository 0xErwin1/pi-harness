import test from "node:test";
import assert from "node:assert/strict";
import { __testing } from "../../extensions/mcp.ts";

test("MCP tool names are Pi-safe and server-prefixed", () => {
	assert.equal(__testing.toolName("context-7", "resolve-library-id"), "context_7_resolve_library_id");
	assert.equal(__testing.toolName("123", "tool"), "_123_tool");
});

test("MCP content is rendered as text for tool results", () => {
	assert.equal(
		__testing.stringifyMcpContent({
			content: [
				{ type: "text", text: "hello" },
				{ type: "image", mimeType: "image/png" },
			],
		}),
		"hello\n[image: image/png]",
	);
});

test("SSE MCP responses parse the last data message", () => {
	assert.deepEqual(
		__testing.parseSse('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n'),
		{ jsonrpc: "2.0", id: 1, result: { ok: true } },
	);
});
