/**
 * Core tool documentation enrichment.
 *
 * Appends factual usage guidance to the descriptions of the built-in tools
 * (read, edit, write, bash, grep, find, ls) as the model sees them. The
 * rewrite happens on the provider request payload via `before_provider_request`,
 * just before the request is sent: the in-session tool registry, parameter
 * schemas, and execute implementations are never touched, so tool behavior is
 * identical to the stock builtins.
 *
 * Re-registering the tools with enriched descriptions was rejected on purpose:
 * the session constructs its builtins with settings-derived options (image
 * auto-resize, shell command prefix and shell path) that extensions cannot
 * read, so a re-created tool could silently diverge from the session's own
 * instance. Rewriting the wire payload has no such failure mode.
 *
 * Provider payload shapes differ (Anthropic uses flat `tools[]` entries,
 * OpenAI completions nests under `function`, Google under
 * `functionDeclarations`, Bedrock under `toolConfig.tools[].toolSpec`), so the
 * rewriter walks the tool subtrees generically and only touches objects that
 * look like tool entries: a matching `name`, a string `description`, and a
 * parameter schema sibling.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_WALK_DEPTH = 8;

const SCHEMA_KEYS = [
	"parameters",
	"input_schema",
	"inputSchema",
	"parametersJsonSchema",
] as const;

/**
 * Extra guidance appended to each core tool description. Every statement is
 * grounded in the builtin tool sources in
 * `@earendil-works/pi-coding-agent/dist/core/tools/`.
 */
export const TOOL_DESCRIPTION_ADDENDA: ReadonlyMap<string, string> = new Map([
	[
		"read",
		"offset is a 1-indexed line number and limit caps how many lines are returned. " +
			"When output is truncated, the result ends with a bracketed note stating which lines were shown and which offset to use next; keep calling read with that offset until the file is complete. " +
			"Reading past the end of the file is an error that reports the total line count. " +
			"If a single line exceeds the 50KB byte limit, the result suggests a bash fallback for extracting that line. " +
			"Image files are returned as image attachments and may be downscaled to fit inline size limits. " +
			"Read a file before editing it so that edit oldText can be matched against its current content.",
	],
	[
		"edit",
		"All edits are validated before anything is written: if any oldText is not found, matches more than once, or overlaps another edit, the call fails with a descriptive error and the file is left unchanged. " +
			"oldText must match the file content exactly, including whitespace, indentation, and newlines. " +
			"Entries in edits[] are applied as one atomic change, and each oldText is matched against the original file, not against the result of earlier entries. " +
			"After a failed edit, re-read the file to check its current content before retrying. " +
			"Prefer several small, targeted edits over one giant edit spanning large unchanged regions. " +
			"Line endings (LF vs CRLF) and a leading BOM are detected and preserved automatically.",
	],
	[
		"write",
		"The file content is replaced entirely; there is no append or partial mode. " +
			"Prefer edit for partial changes to existing files and reserve write for new files or intentional full rewrites. " +
			"Parent directories are created automatically, so no separate mkdir is needed. " +
			"The result reports how many bytes were written.",
	],
	[
		"bash",
		"Commands run through a shell in the session working directory; stdout and stderr are captured together in the order they are produced. " +
			"Truncation keeps the tail of the output, and the truncation note includes the path of a temp file containing the full output — read or grep that file to inspect the earlier lines. " +
			"timeout is in seconds and has no default; when it fires, the whole process tree is killed and the call fails with a timeout error. " +
			"A non-zero exit code is reported as an error together with the captured output. " +
			"Commands run non-interactively with no stdin, so anything that prompts for input will hang until timeout or abort; pass non-interactive flags where available.",
	],
	[
		"grep",
		"The search is backed by ripgrep: pattern is a regex by default, literal=true treats it as a plain string, ignoreCase enables case-insensitive matching, glob restricts which files are searched, and context adds that many lines around each match. " +
			"limit overrides the default 100-match cap. " +
			"Matches are reported as path:line: text with paths relative to the search directory; hidden files are included while gitignored paths are skipped. " +
			"Use grep to locate content inside files, find to locate files by name pattern, and ls to inspect a single directory.",
	],
	[
		"find",
		"pattern is a glob matched by fd (e.g. '*.ts' or 'src/**/*.spec.ts'); patterns containing '/' are matched against the full path, others against the file basename. " +
			"limit overrides the default 1000-result cap. " +
			"Hidden files are included while gitignored paths are skipped. " +
			"Use find to locate files by name or path pattern, grep to search file contents, and ls to inspect a single directory.",
	],
	[
		"ls",
		"The listing covers a single directory only — it does not recurse into subdirectories. " +
			"limit overrides the default 500-entry cap, and entries that cannot be inspected are skipped. " +
			"Use ls to inspect one directory, find to locate files across a tree, and grep to search file contents.",
	],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a node is a serialized tool entry rather than an arbitrary object
 * that happens to carry `name` and `description` (for example a JSON schema
 * fragment). Every provider tool shape carries the parameter schema as a
 * sibling of the description.
 */
function isToolEntry(node: Record<string, unknown>): boolean {
	return SCHEMA_KEYS.some((key) => key in node);
}

function enrichNode(node: unknown, depth: number): void {
	if (depth > MAX_WALK_DEPTH) return;

	if (Array.isArray(node)) {
		for (const item of node) enrichNode(item, depth + 1);
		return;
	}

	if (!isRecord(node)) return;

	const { name, description } = node;
	if (typeof name === "string" && typeof description === "string" && isToolEntry(node)) {
		// Anthropic OAuth requests remap builtin names to Claude Code casing
		// (read -> Read), so matching is case-insensitive.
		const addendum = TOOL_DESCRIPTION_ADDENDA.get(name.toLowerCase());
		if (addendum && !description.includes(addendum)) {
			node.description = `${description}\n\n${addendum}`;
		}
		return;
	}

	for (const value of Object.values(node)) enrichNode(value, depth + 1);
}

/**
 * Appends the core tool addenda to matching tool descriptions in a provider
 * request payload, mutating it in place. Only the tool declaration subtrees
 * are walked (`tools` for most providers, `toolConfig` for Bedrock); message
 * history is never traversed. Unknown payload shapes are left untouched.
 */
export function enrichToolDescriptionsInPayload(payload: unknown): void {
	if (!isRecord(payload)) return;

	enrichNode(payload.tools, 0);
	enrichNode(payload.toolConfig, 0);
}

export default function toolDocs(pi: ExtensionAPI): void {
	pi.on("before_provider_request", (event) => {
		enrichToolDescriptionsInPayload(event.payload);
		return event.payload;
	});
}
