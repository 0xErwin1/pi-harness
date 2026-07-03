import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";

const DENIED_BASH_PATTERNS: RegExp[] = [
	/\brm\s+-rf\s+(?:\/|~|\$HOME|\.\.?)(?:\s|$)/,
	/\bgit\s+reset\s+--hard\b/,
	/\bgit\s+clean\b(?=[^\n]*(?:-[^\n]*f|--force))(?=[^\n]*(?:-[^\n]*d|--directories))/,
	/\bgit\s+push\b(?=[^\n]*\s--force(?:-with-lease)?\b)/,
	/\bchmod\s+-R\s+777\b/,
	/\bchown\s+-R\b/,
];

const CONFIRM_BASH_PATTERNS: RegExp[] = [
	/\bgit\s+push\b/,
	/\bgit\s+rebase\b/,
	/\bgit\s+branch\s+-D\b/,
	/\bnpm\s+publish\b/,
	/\bpi\s+remove\b/,
];

const GUARDED_PATH_TOOL_NAMES = new Set(["read", "write", "edit"]);
const PATH_INPUT_KEYS = new Set([
	"path",
	"paths",
	"file",
	"files",
	"file_path",
	"file_paths",
	"filePath",
	"filePaths",
	"oldPath",
	"newPath",
	"confirmPath",
	"confirmOldPath",
	"confirmNewPath",
	"old_path",
	"new_path",
	"confirm_path",
	"confirm_old_path",
	"confirm_new_path",
]);
const EXACT_SENSITIVE_BASENAMES = new Set([
	".npmrc",
	"id_rsa",
	"id_ed25519",
]);
const TOKEN_SECRET_BASENAME_PATTERN =
	/^(?:token|tokens|secret|secrets|api[-_.]?token|access[-_.]?token|auth[-_.]?token|refresh[-_.]?token|bearer[-_.]?token)(?:\.(?:env|json|ya?ml|toml|ini|conf|config|txt))?$/i;
const SENSITIVE_PATH_PATTERNS: RegExp[] = [
	/(^|\/)\.ssh(?:\/|$)/i,
	/(^|\/)\.gnupg(?:\/|$)/i,
	/(^|\/)\.aws\/credentials$/i,
	/(^|\/)(?:secrets|\.credentials)(?:\/|$)/i,
	/(^|\/)Library\/Keychains(?:\/|$)/i,
	/(^|\/)\.config\/gh\/hosts\.ya?ml$/i,
];
const PREVIEW_MAX_LENGTH = 180;

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

function previewCommand(command: string): string {
	const normalized = command.replace(/\s+/g, " ").trim();

	if (normalized.length <= PREVIEW_MAX_LENGTH) {
		return normalized;
	}

	return `${normalized.slice(0, PREVIEW_MAX_LENGTH - 1)}…`;
}

function normalizeCandidatePath(value: string): string {
	return value.trim().replace(/^~(?=\/|$)/, homedir()).replace(/\\/g, "/");
}

function basenameOfPath(value: string): string {
	const normalized = normalizeCandidatePath(value).replace(/\/+$/g, "");
	const parts = normalized.split("/");
	return (parts[parts.length - 1] ?? "").toLowerCase();
}

function isSensitivePath(value: string): boolean {
	const normalized = normalizeCandidatePath(value).toLowerCase();
	const basename = basenameOfPath(value);

	if (basename === ".env" || /^\.env[._-]/i.test(basename)) return true;
	if (EXACT_SENSITIVE_BASENAMES.has(basename)) return true;
	if (/\.(?:pem|key|p12|pfx)$/i.test(basename)) return true;
	if (TOKEN_SECRET_BASENAME_PATTERN.test(basename)) return true;
	return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function collectPathInputs(value: unknown, key?: string): string[] {
	if (typeof value === "string") {
		return key && PATH_INPUT_KEYS.has(key) ? [value] : [];
	}
	if (Array.isArray(value)) {
		return value.flatMap((item) => collectPathInputs(item, key));
	}
	if (!value || typeof value !== "object") return [];
	return Object.entries(value).flatMap(([entryKey, entryValue]) =>
		collectPathInputs(entryValue, entryKey),
	);
}

function evaluateSensitivePathTool(
	toolName: string,
	input: unknown,
): ToolCallEventResult | undefined {
	if (!GUARDED_PATH_TOOL_NAMES.has(toolName.toLowerCase())) return undefined;
	const sensitivePath = collectPathInputs(input).find(isSensitivePath);
	if (!sensitivePath) return undefined;
	return {
		block: true,
		reason: `Blocked access to sensitive path: ${normalizeCandidatePath(sensitivePath)}. Ask the user for an explicit safer plan.`,
	};
}

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

export const __testing = {
	collectPathInputs,
	commandRequiresConfirmation,
	evaluateDeniedCommand,
	evaluateSensitivePathTool,
	isSensitivePath,
	normalizeCandidatePath,
	previewCommand,
};

export default function shellGuard(pi: ExtensionAPI): void {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === "bash") {
			const command: unknown = event.input.command;
			if (typeof command !== "string") return undefined;
			return guardCommand(command, ctx);
		}

		return evaluateSensitivePathTool(event.toolName, event.input);
	});
}
