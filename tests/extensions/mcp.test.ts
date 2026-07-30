import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mcpExtension, { __testing } from "../../extensions/mcp.ts";

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

test("MCP tools register in each fresh extension registry while duplicate initialization stays deduplicated", async () => {
	type SessionHandler = (event: unknown, ctx: unknown) => Promise<void> | void;

	function createFakePi() {
		const handlers = new Map<string, SessionHandler>();
		const registeredTools: string[] = [];
		return {
			api: {
				on(event: string, handler: SessionHandler) {
					handlers.set(event, handler);
				},
				registerCommand() {},
				registerTool(tool: { name: string }) {
					registeredTools.push(tool.name);
				},
			},
			handlers,
			registeredTools,
		};
	}

	const agentDir = mkdtempSync(join(tmpdir(), "pi-harness-mcp-"));
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { atlas: { url: "https://atlas.example/mcp" } } }),
	);

	const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
	const originalFetch = globalThis.fetch;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
		const payload = JSON.parse(String(init?.body)) as { id?: number; method: string };
		if (payload.method === "notifications/initialized") return new Response("", { status: 200 });

		const result = payload.method === "initialize"
			? {}
			: { tools: [{ name: "search", description: "Search Atlas", inputSchema: { type: "object" } }] };
		return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;

	try {
		const first = createFakePi();
		const second = createFakePi();
		mcpExtension(first.api as unknown as Parameters<typeof mcpExtension>[0]);
		mcpExtension(second.api as unknown as Parameters<typeof mcpExtension>[0]);

		const context = { ui: { setStatus() {}, notify() {} } };
		const firstSessionStart = first.handlers.get("session_start");
		const secondSessionStart = second.handlers.get("session_start");
		assert.equal(typeof firstSessionStart, "function");
		assert.equal(typeof secondSessionStart, "function");

		await firstSessionStart?.({}, context);
		await firstSessionStart?.({}, context);
		await secondSessionStart?.({}, context);

		assert.deepEqual(first.registeredTools, ["atlas_search"]);
		assert.deepEqual(second.registeredTools, ["atlas_search"]);
	} finally {
		globalThis.fetch = originalFetch;
		if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("HTTP MCP reconnects once when the cached session is missing", async () => {
	const originalFetch = globalThis.fetch;
	const seenSessionHeaders: Array<string | undefined> = [];
	let call = 0;

	globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
		const headers = new Headers(init?.headers);
		seenSessionHeaders.push(headers.get("mcp-session-id") ?? undefined);
		call += 1;

		switch (call) {
			case 1:
				return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
					status: 200,
					headers: { "mcp-session-id": "session-1" },
				});
			case 2:
				return new Response("", { status: 200 });
			case 3:
				return new Response("Not Found: Session not found", { status: 404 });
			case 4:
				return new Response(JSON.stringify({ jsonrpc: "2.0", id: 3, result: {} }), {
					status: 200,
					headers: { "mcp-session-id": "session-2" },
				});
			case 5:
				return new Response("", { status: 200 });
			case 6:
				return new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { ok: true } }), {
					status: 200,
				});
			default:
				throw new Error(`unexpected fetch call ${call}`);
		}
	}) as typeof fetch;

	try {
		const client = new __testing.HttpMcpClient("atlas", { url: "https://atlas.example/mcp" });
		await client.start();

		assert.deepEqual(await client.callTool("ping", {}), { ok: true });
		assert.deepEqual(seenSessionHeaders, [undefined, "session-1", "session-1", undefined, "session-2", "session-2"]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
