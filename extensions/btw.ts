import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export const BTW_COMMAND_NAME = "btw";

export interface BtwRequest {
	question: string;
	systemPrompt: string;
	messages: Array<{ role: "user"; content: Array<{ type: "text"; text: string }> }>;
	tools: [];
	transcript: "isolated";
}

export type BtwResult =
	| { ok: true; answer: string; transcriptIsolated: true }
	| { ok: false; error: string; transcriptIsolated: true };

export interface BtwRuntime {
	askSideQuestion(request: BtwRequest, ctx: ExtensionCommandContext): Promise<BtwResult>;
}

export interface BtwExtensionOptions {
	loadRuntime?: () => Promise<BtwRuntime>;
}

const BTW_USAGE = "Usage: /btw <question>";
const BTW_SYSTEM_PROMPT = [
	"You answer a side question for the user.",
	"Do not call tools. Do not modify files. Keep the answer concise.",
	"This exchange is isolated from the main conversation transcript.",
].join("\n");

export function buildBtwRequest(rawQuestion: string): BtwRequest {
	const question = rawQuestion.trim();
	return {
		question,
		systemPrompt: BTW_SYSTEM_PROMPT,
		messages: [{ role: "user", content: [{ type: "text", text: question }] }],
		tools: [],
		transcript: "isolated",
	};
}

function assistantText(message: unknown): string {
	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => {
			return (
				part !== null &&
				typeof part === "object" &&
				(part as { type?: unknown }).type === "text" &&
				typeof (part as { text?: unknown }).text === "string"
			);
		})
		.map((part) => part.text)
		.join("\n")
		.trim();
}

async function askSameModelSideQuestion(request: BtwRequest, ctx: ExtensionCommandContext): Promise<BtwResult> {
	if (!ctx.model) {
		return { ok: false, error: "/btw requires an active model", transcriptIsolated: true };
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok) {
		return { ok: false, error: `/btw model is misconfigured: ${auth.error}`, transcriptIsolated: true };
	}
	if (!auth.apiKey) {
		return { ok: false, error: "/btw model has no API key available", transcriptIsolated: true };
	}

	const { completeSimple } = await import("@earendil-works/pi-ai/compat");
	const response = await completeSimple(
		ctx.model,
		{
			systemPrompt: request.systemPrompt,
			messages: request.messages.map((message) => ({ ...message, timestamp: Date.now() })) as never,
			tools: request.tools,
		},
		{ apiKey: auth.apiKey, headers: auth.headers, signal: ctx.signal },
	);

	if (response.stopReason === "aborted") {
		return { ok: false, error: "/btw call was aborted", transcriptIsolated: true };
	}
	if (response.stopReason === "error") {
		return { ok: false, error: `/btw call failed: ${response.errorMessage ?? "unknown error"}`, transcriptIsolated: true };
	}

	const text = assistantText(response);
	if (!text) {
		return { ok: false, error: "/btw returned no text content", transcriptIsolated: true };
	}
	return { ok: true, answer: text, transcriptIsolated: true };
}

async function loadDefaultBtwRuntime(): Promise<BtwRuntime> {
	return { askSideQuestion: askSameModelSideQuestion };
}

export function createBtwExtension(options: BtwExtensionOptions = {}): (pi: ExtensionAPI) => void {
	const loadRuntime = options.loadRuntime ?? loadDefaultBtwRuntime;
	return (pi: ExtensionAPI) => {
		pi.registerCommand(BTW_COMMAND_NAME, {
			description: "Ask a side question without adding it to the main transcript.",
			async handler(args: string, ctx: ExtensionCommandContext) {
				const question = args.trim();
				if (!question) {
					ctx.ui.notify(BTW_USAGE, "warning");
					return;
				}

				const request = buildBtwRequest(question);
				try {
					const runtime = await loadRuntime();
					const result = await runtime.askSideQuestion(request, ctx);
					if (result.ok) {
						ctx.ui.notify(result.answer, "info");
					} else {
						ctx.ui.notify(result.error, "error");
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`/btw failed: ${message}`, "error");
				}
			},
		});
	};
}

export default function btw(pi: ExtensionAPI): void {
	createBtwExtension()(pi);
}
