/**
 * Shell safety guard for Pi.
 *
 * Intercepts `bash` tool calls and applies two layers of protection:
 *
 *   1. Denied patterns  — destructive commands are blocked outright.
 *   2. Confirm patterns — sensitive commands require interactive confirmation
 *                          before they are allowed to run.
 *
 * The guard is intentionally self-contained: it has no dependencies beyond the
 * Pi extension types and does not read any assets or configuration.
 */
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEventResult,
} from "@mariozechner/pi-coding-agent";

/**
 * Commands that are never allowed. Each pattern targets an irreversible or
 * highly destructive operation. A match blocks the tool call with no prompt.
 */
const DENIED_BASH_PATTERNS: RegExp[] = [
	/\brm\s+-rf\s+(?:\/|~|\$HOME|\.\.?)(?:\s|$)/,
	/\bgit\s+reset\s+--hard\b/,
	/\bgit\s+clean\b(?=[^\n]*(?:-[^\n]*f|--force))(?=[^\n]*(?:-[^\n]*d|--directories))/,
	/\bgit\s+push\b(?=[^\n]*\s--force(?:-with-lease)?\b)/,
	/\bchmod\s+-R\s+777\b/,
	/\bchown\s+-R\b/,
];

/**
 * Commands that are allowed but sensitive enough to warrant an explicit
 * confirmation from the user before running.
 */
const CONFIRM_BASH_PATTERNS: RegExp[] = [
	/\bgit\s+push\b/,
	/\bgit\s+rebase\b/,
	/\bgit\s+branch\s+-D\b/,
	/\bnpm\s+publish\b/,
	/\bpi\s+remove\b/,
];

const PREVIEW_MAX_LENGTH = 180;

/**
 * Returns a block result if the command matches a denied pattern, otherwise
 * `undefined`.
 */
function evaluateDeniedCommand(
	command: string,
): ToolCallEventResult | undefined {
	for (const pattern of DENIED_BASH_PATTERNS) {
		if (pattern.test(command)) {
			return {
				block: true,
				reason:
					"Blocked a destructive shell command. Ask the user for an explicit, safer plan before retrying.",
			};
		}
	}

	return undefined;
}

function commandRequiresConfirmation(command: string): boolean {
	return CONFIRM_BASH_PATTERNS.some((pattern) => pattern.test(command));
}

/**
 * Collapses whitespace and truncates a command so it can be shown in a
 * confirmation dialog without overflowing the UI.
 */
function previewCommand(command: string): string {
	const normalized = command.replace(/\s+/g, " ").trim();

	if (normalized.length <= PREVIEW_MAX_LENGTH) {
		return normalized;
	}

	return `${normalized.slice(0, PREVIEW_MAX_LENGTH - 1)}…`;
}

/**
 * Resolves a single bash command against both guard layers.
 *
 * Denied patterns are checked first and always win. Confirm patterns then
 * prompt the user; without an interactive UI the command is blocked rather
 * than silently allowed.
 */
async function guardCommand(
	command: string,
	ctx: ExtensionContext,
): Promise<ToolCallEventResult | undefined> {
	const denied = evaluateDeniedCommand(command);
	if (denied) return denied;

	if (!commandRequiresConfirmation(command)) return undefined;

	if (!ctx.hasUI) {
		return {
			block: true,
			reason:
				"This command requires interactive confirmation, which is unavailable in the current mode.",
		};
	}

	const approved = await ctx.ui.confirm(
		"Allow guarded command?",
		previewCommand(command),
	);
	if (approved) return undefined;

	return {
		block: true,
		reason: "Blocked the command because it was not confirmed by the user.",
	};
}

export default function shellGuard(pi: ExtensionAPI): void {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		// `event` here is still widened to include CustomToolCallEvent, whose
		// `toolName` is a plain string and whose `input` is untyped. Extract
		// the command defensively rather than trusting the narrowing.
		const command: unknown = event.input.command;
		if (typeof command !== "string") return undefined;

		return guardCommand(command, ctx);
	});
}
