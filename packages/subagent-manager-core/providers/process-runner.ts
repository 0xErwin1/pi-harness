import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { TOOL_PROGRESS_PREFIX } from "../events.ts";
import { agentIdFor, currentDepth, sessionRoot } from "../file-tree/paths.ts";
import type { ProviderRunContext, RunResult } from "../runtime.ts";
import { buildCompletedSummary } from "../store.ts";
import {
	assistantTextOf,
	assistantThinkingOf,
	finalAssistantText,
	formatToolCall,
	isMessageEnd,
	parseNdjsonLine,
	tokensOf,
	toolResultOf,
} from "./pi-json-events.ts";

/**
 * Builds the env overlay injected into every spawned pi child process.
 *
 * Three vars propagate the session root (shared across all nested pids),
 * the child's depth (parent depth + 1), and the parent's agentId so the file
 * sink can link child meta back to its parent in the tree.
 */
export function buildChildEnv(runId: string): Record<string, string> {
	return {
		PI_HARNESS_RUN_ROOT: sessionRoot(),
		PI_HARNESS_SUBAGENT_DEPTH: String(currentDepth() + 1),
		PI_HARNESS_PARENT_AGENT_ID: agentIdFor(runId),
	};
}

/**
 * Buffers a child process's stdout into complete lines while decoding bytes with
 * a `StringDecoder`. The child streams NDJSON in arbitrary chunks, and a single
 * multi-byte UTF-8 character can be split across two chunks; decoding each chunk
 * independently with `Buffer.toString()` would corrupt that character into the
 * replacement character (`�`). The decoder holds the partial trailing bytes
 * until the continuation arrives, so code points are always reassembled intact.
 */
export class StdoutLineBuffer {
	private readonly decoder = new StringDecoder("utf8");
	private pending = "";

	/** Decodes a chunk and returns any complete lines it produced (without the newline). */
	push(chunk: Buffer | string): string[] {
		this.pending += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
		const lines = this.pending.split("\n");
		this.pending = lines.pop() ?? "";
		return lines;
	}

	/** Flushes the trailing partial line (plus any decoder remainder) at stream close. */
	flush(): string | undefined {
		const tail = this.pending + this.decoder.end();
		this.pending = "";
		return tail.length > 0 ? tail : undefined;
	}
}

/**
 * Distills a tool invocation's arguments into a single short, human-readable
 * target so the live viewer can show "read src/foo.ts" or `bash pnpm test`
 * instead of a bare tool name. Picks the most relevant field per tool (path for
 * file tools, command for bash, pattern for search tools) and falls back to the
 * first meaningful string when the tool is unknown. Returns `undefined` when no
 * useful field is present, in which case callers show the tool name alone.
 */
export function summarizeToolArgs(toolName: string, args: unknown): string | undefined {
	if (!args || typeof args !== "object") return undefined;

	const fields = args as Record<string, unknown>;
	const pick = (key: string): string | undefined => {
		const value = fields[key];
		return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
	};

	switch (toolName.toLowerCase()) {
		case "read":
		case "edit":
		case "write":
		case "ls":
			return pick("path");
		case "bash":
			return pick("command");
		case "grep":
		case "find":
			return pick("pattern");
		default:
			return pick("path") ?? pick("command") ?? pick("pattern") ?? pick("file");
	}
}

function stripFrontmatter(markdown: string): string {
	if (!markdown.startsWith("---\n")) return markdown;
	const end = markdown.indexOf("\n---", 4);
	if (end < 0) return markdown;
	return markdown.slice(end + 4).trimStart();
}

async function resolvePromptText(promptRef: string): Promise<string> {
	if (existsSync(promptRef)) return stripFrontmatter(await readFile(promptRef, "utf8"));
	return promptRef;
}

function resolvePiInvocation(piArgs: string[]): { command: string; args: string[] } {
	const override = process.env.PI_HARNESS_PI_BIN;

	if (override) {
		const isNodeScript = /\.(m?[jt]s|cjs)$/.test(override);
		if (isNodeScript) {
			return { command: process.execPath, args: [override, ...piArgs] };
		}
		return { command: override, args: piArgs };
	}

	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...piArgs] };
	}

	const execName = currentScript
		? undefined
		: process.execPath.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "").toLowerCase();

	if (execName && !/^(node|bun)$/.test(execName)) {
		return { command: process.execPath, args: piArgs };
	}

	return { command: "pi", args: piArgs };
}

export async function runPiProcessProvider(context: ProviderRunContext): Promise<RunResult> {
	const systemPrompt = await resolvePromptText(context.agent.promptRef);
	const tmp = await mkdtemp(join(tmpdir(), "pi-harness-subagent-"));
	const promptFile = join(tmp, "system.md");
	await writeFile(promptFile, systemPrompt, { encoding: "utf8", mode: 0o600 });

	const model =
		typeof context.request.metadata?.model === "string"
			? context.request.metadata.model
			: context.agent.model;

	const thinking =
		typeof context.request.metadata?.thinking === "string"
			? context.request.metadata.thinking
			: context.agent.thinking;

	const piArgs = [
		"--mode",
		"json",
		"--no-session",
		...(model ? ["--model", model] : []),
		...(thinking ? ["--thinking", thinking] : []),
		"--append-system-prompt",
		promptFile,
		"-p",
		context.request.prompt,
	];

	const invocation = resolvePiInvocation(piArgs);
	const resolvedCmd = invocation.command;

	const events: ReturnType<typeof parseNdjsonLine>[] = [];
	let rawStdout = "";
	let stderr = "";
	const lineBuffer = new StdoutLineBuffer();

	context.emit({
		type: "run.progress",
		message: `starting subprocess for ${context.agent.name}`,
	});

	try {
		const exitCode = await new Promise<number>((resolve, reject) => {
			const proc = spawn(invocation.command, invocation.args, {
				cwd:
					typeof context.request.metadata?.cwd === "string"
						? context.request.metadata.cwd
						: process.cwd(),
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, ...buildChildEnv(context.runId) },
			});

			let wasAborted = false;
			let closed = false;
			let turn = 0;
			let killTimer: ReturnType<typeof setTimeout> | undefined;

			const killProc = () => {
				wasAborted = true;
				proc.kill("SIGTERM");
				const graceMs = Number.parseInt(process.env.PI_GRACE_MS ?? "5000", 10);
				killTimer = setTimeout(() => {
					if (!closed) proc.kill("SIGKILL");
				}, graceMs);
			};

			if (context.signal) {
				if (context.signal.aborted) {
					killProc();
				} else {
					context.signal.addEventListener("abort", killProc, { once: true });
				}
			}

			const parseLine = (line: string) => {
				if (!line.trim()) return;
				rawStdout += `${line}\n`;

				const event = parseNdjsonLine(line);
				if (!event) return;

				events.push(event);

				if (event.type === "tool_execution_start" && event.toolName) {
					const target = summarizeToolArgs(event.toolName, event.args);
					const toolCall = formatToolCall(event.toolName, event.args);
					const toolCallFull = formatToolCall(event.toolName, event.args, { full: true });
					context.emit({
						type: "run.progress",
						message: `${TOOL_PROGRESS_PREFIX} ${event.toolName}`,
						...(target ? { target } : {}),
						toolCall,
						toolCallFull,
					});
				}

				if (event.type === "tool_execution_end") {
					const toolResult = toolResultOf(event);
					if (toolResult) {
						context.emit({
							type: "run.tool_result",
							toolName: toolResult.toolName,
							...(toolResult.toolCallId !== undefined ? { toolCallId: toolResult.toolCallId } : {}),
							...(toolResult.resultText !== undefined ? { resultText: toolResult.resultText } : {}),
							...(toolResult.details !== undefined ? { details: toolResult.details } : {}),
							...(toolResult.isError !== undefined ? { isError: toolResult.isError } : {}),
						});
					}
				}

				if (isMessageEnd(event) && event.message) {
					const usage = tokensOf(event.message);
					let pendingTokens = usage?.total;
					const takeTokens = (): { tokens?: number } => {
						if (pendingTokens === undefined) return {};
						const carried = { tokens: pendingTokens };
						pendingTokens = undefined;
						return carried;
					};

					const thinking = assistantThinkingOf(event.message);
					if (thinking) {
						context.emit({
							type: "run.output",
							chunk: thinking,
							kind: "thinking",
							text: thinking,
							turn: turn + 1,
							...takeTokens(),
						});
					}

					const text = assistantTextOf(event.message);
					if (text) {
						turn += 1;
						context.emit({ type: "run.output", chunk: text, role: "assistant", text, turn, ...takeTokens() });
					}

					if (pendingTokens !== undefined) {
						context.emit({ type: "run.output", chunk: "", tokens: pendingTokens });
					}
				}
			};

			proc.stdout.on("data", (chunk) => {
				for (const line of lineBuffer.push(chunk)) parseLine(line);
			});

			proc.stderr.on("data", (chunk) => {
				stderr += chunk.toString();
			});

			proc.on("error", (error) => {
				const isEnoent = (error as NodeJS.ErrnoException).code === "ENOENT";
				if (isEnoent) {
					reject(
						new Error(
							`pi binary not found (resolved as '${resolvedCmd}'); ensure pi is on PATH or set PI_HARNESS_PI_BIN`,
						),
					);
				} else {
					stderr += error instanceof Error ? error.message : String(error);
					resolve(1);
				}
			});

			proc.on("close", (code) => {
				closed = true;
				if (killTimer !== undefined) clearTimeout(killTimer);
				context.signal?.removeEventListener("abort", killProc);

				const tail = lineBuffer.flush();
				if (tail && tail.trim()) parseLine(tail);

				if (wasAborted) {
					reject(new Error("run aborted via signal"));
					return;
				}

				resolve(code ?? 0);
			});
		});

		const parsedEvents = events.filter((e): e is NonNullable<typeof e> => e !== undefined);
		const text =
			finalAssistantText(parsedEvents) ??
			(stderr.trim() || rawStdout.trim() || "Subagent completed without output.");

		if (exitCode !== 0) throw new Error(text);

		return {
			runId: context.runId,
			summary: buildCompletedSummary(text, "subprocess", "provider:subprocess"),
			rawOutput: rawStdout,
		};
	} finally {
		await rm(tmp, { recursive: true, force: true });
	}
}
