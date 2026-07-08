import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const PROTOCOL_VERSION = "2025-06-18";
const REQUEST_TIMEOUT_MS = 20_000;
const STARTUP_TIMEOUT_MS = 8_000;

type JsonObject = Record<string, unknown>;

interface McpConfig {
	mcpServers?: Record<string, McpServerConfig>;
}

interface McpServerConfig {
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	url?: string;
	headers?: Record<string, string>;
	lifecycle?: string;
}

interface McpTool {
	name: string;
	description?: string;
	inputSchema?: JsonObject;
}

interface McpClient {
	name: string;
	start(): Promise<void>;
	listTools(): Promise<McpTool[]>;
	callTool(name: string, args: JsonObject): Promise<unknown>;
	close(): void;
}

interface ServerState {
	name: string;
	config: McpServerConfig;
	status: "pending" | "loaded" | "failed";
	tools: string[];
	error?: string;
	client?: McpClient;
}

const states = new Map<string, ServerState>();
const registeredToolNames = new Set<string>();

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function configPath(): string {
	return join(agentDir(), "mcp.json");
}

function loadConfig(): McpConfig {
	const path = configPath();
	if (!existsSync(path)) return {};
	return JSON.parse(readFileSync(path, "utf8")) as McpConfig;
}

function isObject(value: unknown): value is JsonObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeName(value: string): string {
	return value.replace(/[^A-Za-z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
}

function toolName(server: string, tool: string): string {
	return sanitizeName(`${server}_${tool}`);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const timer = new Promise<never>((_, reject) => {
		timeout = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
	});
	return Promise.race([promise, timer]).finally(() => {
		if (timeout) clearTimeout(timeout);
	});
}

function schemaForTool(tool: McpTool): JsonObject {
	if (isObject(tool.inputSchema) && tool.inputSchema.type === "object") return tool.inputSchema;
	return Type.Object({}) as unknown as JsonObject;
}

function stringifyMcpContent(result: unknown): string {
	if (!isObject(result)) return typeof result === "string" ? result : JSON.stringify(result, null, 2);

	const content = result.content;
	if (Array.isArray(content)) {
		const parts = content.map((part) => {
			if (!isObject(part)) return JSON.stringify(part);
			if (part.type === "text" && typeof part.text === "string") return part.text;
			if (part.type === "image") return `[image: ${part.mimeType ?? "unknown"}]`;
			if (part.type === "resource") return `[resource: ${JSON.stringify(part.resource)}]`;
			return JSON.stringify(part);
		});
		return parts.join("\n");
	}

	return JSON.stringify(result, null, 2);
}

class StdioMcpClient implements McpClient {
	private child: ChildProcessWithoutNullStreams | undefined;
	private nextId = 1;
	private buffer = "";
	private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

	constructor(
		readonly name: string,
		private readonly config: McpServerConfig,
	) {}

	async start(): Promise<void> {
		if (!this.config.command) throw new Error(`MCP server ${this.name} is missing command`);

		this.child = spawn(this.config.command, this.config.args ?? [], {
			cwd: this.config.cwd,
			env: { ...process.env, ...(this.config.env ?? {}) },
			stdio: ["pipe", "pipe", "pipe"],
		});

		this.child.stdout.setEncoding("utf8");
		this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
		this.child.on("exit", (code, signal) => {
			const error = new Error(`MCP server ${this.name} exited (${code ?? signal ?? "unknown"})`);
			for (const pending of this.pending.values()) pending.reject(error);
			this.pending.clear();
		});

		await this.request("initialize", {
			protocolVersion: PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: { name: "pi-harness", version: "0.1.0" },
		});
		this.notify("notifications/initialized", {});
	}

	async listTools(): Promise<McpTool[]> {
		const result = await this.request("tools/list", {});
		return isObject(result) && Array.isArray(result.tools) ? (result.tools as McpTool[]) : [];
	}

	async callTool(name: string, args: JsonObject): Promise<unknown> {
		return this.request("tools/call", { name, arguments: args });
	}

	close(): void {
		this.child?.kill();
		this.child = undefined;
	}

	private onStdout(chunk: string): void {
		this.buffer += chunk;
		for (;;) {
			const index = this.buffer.indexOf("\n");
			if (index === -1) return;
			const line = this.buffer.slice(0, index).trim();
			this.buffer = this.buffer.slice(index + 1);
			if (!line) continue;

			let message: JsonObject;
			try {
				message = JSON.parse(line) as JsonObject;
			} catch {
				continue;
			}

			const id = message.id;
			if (typeof id !== "number") continue;
			const pending = this.pending.get(id);
			if (!pending) continue;
			this.pending.delete(id);

			if (isObject(message.error)) {
				pending.reject(new Error(String(message.error.message ?? JSON.stringify(message.error))));
			} else {
				pending.resolve(message.result);
			}
		}
	}

	private request(method: string, params: JsonObject): Promise<unknown> {
		if (!this.child) throw new Error(`MCP server ${this.name} is not started`);
		const id = this.nextId++;
		const message = JSON.stringify({ jsonrpc: "2.0", id, method, params });
		this.child.stdin.write(`${message}\n`);
		return withTimeout(
			new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })),
			REQUEST_TIMEOUT_MS,
			`${this.name}.${method}`,
		);
	}

	private notify(method: string, params: JsonObject): void {
		this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
	}
}

class HttpMcpClient implements McpClient {
	private sessionId: string | undefined;
	private nextId = 1;

	constructor(
		readonly name: string,
		private readonly config: McpServerConfig,
	) {}

	async start(): Promise<void> {
		await this.initializeSession();
	}

	private async initializeSession(): Promise<void> {
		const result = await this.send(
			{
				jsonrpc: "2.0",
				id: this.nextId++,
				method: "initialize",
				params: {
					protocolVersion: PROTOCOL_VERSION,
					capabilities: {},
					clientInfo: { name: "pi-harness", version: "0.1.0" },
				},
			},
			false,
		);
		if (isObject(result) && isObject(result.error)) {
			throw new Error(String(result.error.message ?? JSON.stringify(result.error)));
		}
		await this.send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }, false);
	}

	async listTools(): Promise<McpTool[]> {
		const result = await this.request("tools/list", {});
		return isObject(result) && Array.isArray(result.tools) ? (result.tools as McpTool[]) : [];
	}

	async callTool(name: string, args: JsonObject): Promise<unknown> {
		return this.request("tools/call", { name, arguments: args });
	}

	close(): void {}

	private async notify(method: string, params: JsonObject): Promise<void> {
		await this.send({ jsonrpc: "2.0", method, params }, true);
	}

	private async request(method: string, params: JsonObject): Promise<unknown> {
		const result = await this.send({ jsonrpc: "2.0", id: this.nextId++, method, params }, true);
		if (isObject(result) && isObject(result.error)) {
			throw new Error(String(result.error.message ?? JSON.stringify(result.error)));
		}
		return isObject(result) ? result.result : result;
	}

	private async send(payload: JsonObject, retryMissingSession: boolean): Promise<unknown> {
		if (!this.config.url) throw new Error(`MCP server ${this.name} is missing url`);
		const headers: Record<string, string> = {
			...(this.config.headers ?? {}),
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
		};
		if (this.sessionId) headers["mcp-session-id"] = this.sessionId;

		const response = await fetch(this.config.url, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
		});

		const nextSession = response.headers.get("mcp-session-id");
		if (nextSession) this.sessionId = nextSession;

		if (!response.ok) {
			const body = await response.text();
			if (retryMissingSession && this.sessionId && response.status === 404 && /session not found/i.test(body)) {
				this.sessionId = undefined;
				await this.initializeSession();
				return this.send(payload, false);
			}
			throw new Error(`HTTP ${response.status}: ${body}`);
		}

		const text = await response.text();
		const contentType = response.headers.get("content-type") ?? "";
		if (contentType.includes("text/event-stream")) return parseSse(text);
		if (!text.trim()) return undefined;
		return JSON.parse(text) as unknown;
	}
}

function parseSse(text: string): unknown {
	const dataLines = text
		.split(/\r?\n/)
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice("data:".length).trim())
		.filter((line) => line && line !== "[DONE]");
	if (dataLines.length === 0) return undefined;
	return JSON.parse(dataLines[dataLines.length - 1]!) as unknown;
}

async function createClient(name: string, config: McpServerConfig): Promise<McpClient> {
	const client: McpClient = config.url ? new HttpMcpClient(name, config) : new StdioMcpClient(name, config);
	await client.start();
	return client;
}

function renderStatus(): string {
	if (states.size === 0) return "No MCP servers configured.";
	return [...states.values()]
		.map((state) => {
			const suffix = state.status === "loaded" ? `${state.tools.length} tool(s)` : (state.error ?? "pending");
			return `- ${state.name}: ${state.status} — ${suffix}`;
		})
		.join("\n");
}

function updateStatus(ctx: ExtensionContext): void {
	const loaded = [...states.values()].filter((state) => state.status === "loaded").length;
	ctx.ui.setStatus("mcp", `MCP: ${loaded}/${states.size} servers`);
}

async function registerServer(pi: ExtensionAPI, ctx: ExtensionContext, name: string, config: McpServerConfig): Promise<void> {
	const state: ServerState = { name, config, status: "pending", tools: [] };
	states.set(name, state);
	updateStatus(ctx);

	try {
		const client = await withTimeout(createClient(name, config), STARTUP_TIMEOUT_MS, `MCP ${name} startup`);
		state.client = client;
		const tools = await withTimeout(client.listTools(), STARTUP_TIMEOUT_MS, `MCP ${name} tools/list`);
		for (const tool of tools) {
			const registeredName = toolName(name, tool.name);
			state.tools.push(registeredName);
			if (registeredToolNames.has(registeredName)) continue;
			registeredToolNames.add(registeredName);

			pi.registerTool({
				name: registeredName,
				label: `${name}: ${tool.name}`,
				description: tool.description ?? `MCP tool ${tool.name} from server ${name}`,
				promptSnippet: `Call MCP tool ${tool.name} on server ${name}`,
				parameters: schemaForTool(tool),
				async execute(_toolCallId, params) {
					const result = await client.callTool(tool.name, isObject(params) ? params : {});
					return {
						content: [{ type: "text" as const, text: stringifyMcpContent(result) }],
						details: { server: name, tool: tool.name, result },
					};
				},
			});
		}
		state.status = "loaded";
	} catch (error) {
		state.status = "failed";
		state.error = errorMessage(error);
		state.client?.close();
		state.client = undefined;
	} finally {
		updateStatus(ctx);
	}
}

export const __testing = {
	sanitizeName,
	toolName,
	stringifyMcpContent,
	parseSse,
	HttpMcpClient,
};

export default function mcpExtension(pi: ExtensionAPI): void {
	pi.registerCommand("mcp", {
		description: "Show MCP server/tool status loaded from ~/.pi/agent/mcp.json.",
		handler: async (_args, ctx) => {
			ctx.ui.notify(renderStatus(), states.size === 0 ? "warning" : "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		let config: McpConfig;
		try {
			config = loadConfig();
		} catch (error) {
			states.set("config", {
				name: "config",
				config: {},
				status: "failed",
				tools: [],
				error: errorMessage(error),
			});
			updateStatus(ctx);
			return;
		}

		const servers = config.mcpServers ?? {};
		await Promise.all(Object.entries(servers).map(([name, server]) => registerServer(pi, ctx, name, server)));
	});

	pi.on("session_shutdown", () => {
		for (const state of states.values()) state.client?.close();
		states.clear();
	});
}
