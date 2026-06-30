/**
 * Pure, theme-agnostic tool argument formatters.
 *
 * Turns a tool name and its raw args into the display string shown on the call
 * line. No styling, no IO.
 */

const TOOL_VERBS: Record<string, string> = {
	read: "Read",
	bash: "Bash",
	edit: "Edit",
	write: "Write",
	grep: "Grep",
	find: "Find",
	ls: "Ls",
};

/**
 * Capitalizes a tool name to its display verb (`read` → `Read`).
 * Known built-in verbs use a fixed mapping; unknown tools get title-case.
 */
export function toolVerb(toolName: string): string {
	const known = TOOL_VERBS[toolName.toLowerCase()];
	if (known) return known;

	const lower = toolName.toLowerCase();
	return lower.length === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
}

type ArgRecord = Record<string, unknown> | undefined;

function asRecord(value: unknown): ArgRecord {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Renders the inclusive `offset-end` (or bare `offset`) line range for a read
 * call. Returns `undefined` when there is no offset so the caller shows just the
 * path. `limit` is the line count, so the last line is `offset + limit - 1`.
 */
function readLineRange(args: Record<string, unknown>): string | undefined {
	const offset = asNumber(args.offset);
	if (offset === undefined) return undefined;

	const limit = asNumber(args.limit);
	if (limit !== undefined) return `${offset}-${offset + limit - 1}`;
	return `${offset}`;
}

/**
 * Builds the per-tool display args (no verb, no styling):
 * read `path:lines` or `path`, bash `$ <cmd>`, grep/find `<pattern>`, ls
 * `<path>` (default `.`), edit/write `<path>`. Unknown tools yield an empty
 * string so the caller renders the verb alone.
 */
export function formatToolArgs(toolName: string, rawArgs: unknown): string {
	const args = asRecord(rawArgs) ?? {};

	switch (toolName.toLowerCase()) {
		case "read": {
			const path = asString(args.path) ?? "";
			if (path.length === 0) return "";
			const range = readLineRange(args);
			return range ? `${path}:${range}` : path;
		}
		case "bash": {
			const command = asString(args.command) ?? "";
			const newlineAt = command.indexOf("\n");
			// Collapse a multi-line command (e.g. a heredoc) to its first line plus an
			// ellipsis: the call line is width-clamped as a single string, and embedded
			// newlines garble that clamp (the rest of the script bleeds onto the line).
			return newlineAt < 0 ? `$ ${command}` : `$ ${command.slice(0, newlineAt)} …`;
		}
		case "grep":
		case "find":
			return asString(args.pattern) ?? "";
		case "ls":
			return asString(args.path) ?? ".";
		case "edit":
		case "write":
			return asString(args.path) ?? "";
		default:
			return "";
	}
}
