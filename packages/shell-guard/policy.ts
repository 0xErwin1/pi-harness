import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type GuardAction = "allow" | "confirm" | "block";

export interface GuardrailsConfig {
	autonomousMode: boolean;
	guardedCommands: Record<string, GuardAction>;
}

export interface LoadGuardrailsConfigOptions {
	/** Override the agent dir (used in tests to avoid touching ~/.pi/agent). */
	agentDir?: string;
}

/**
 * Guarded command keys the policy recognizes. A command matching none of
 * these patterns, and none of the hard-deny patterns, is not guarded at all
 * and classifies as "allow".
 */
type GuardedCommandKey =
	| "gitPush"
	| "gitRebase"
	| "gitBranchDeleteForce"
	| "npmPublish"
	| "piRemove";

const GUARDED_COMMAND_KEYS: readonly GuardedCommandKey[] = [
	"gitPush",
	"gitRebase",
	"gitBranchDeleteForce",
	"npmPublish",
	"piRemove",
];

const GUARDED_COMMAND_PATTERNS: Record<GuardedCommandKey, RegExp> = {
	gitPush: /\bgit\s+push\b/,
	gitRebase: /\bgit\s+rebase\b/,
	gitBranchDeleteForce: /\bgit\s+branch\s+-D\b/,
	npmPublish: /\bnpm\s+publish\b/,
	piRemove: /\bpi\s+remove\b/,
};

/**
 * Action applied to a guarded command when autonomousMode is enabled and the
 * config's guardedCommands map has no override for that key.
 */
const AUTONOMOUS_DEFAULT_ACTIONS: Record<GuardedCommandKey, GuardAction> = {
	gitPush: "allow",
	gitRebase: "confirm",
	gitBranchDeleteForce: "confirm",
	npmPublish: "block",
	piRemove: "confirm",
};

/**
 * Hard-deny patterns always classify as "block", regardless of autonomousMode
 * or any configured override. Ported verbatim from the pre-policy-model
 * DENIED_BASH_PATTERNS in extensions/shell-guard.ts.
 */
const HARD_DENY_PATTERNS: readonly RegExp[] = [
	/\brm\s+-rf\s+(?:\/|~|\$HOME|\.\.?)(?:\s|$)/,
	/\bgit\s+reset\s+--hard\b/,
	/\bgit\s+clean\b(?=[^\n]*(?:-[^\n]*f|--force))(?=[^\n]*(?:-[^\n]*d|--directories))/,
	/\bgit\s+push\b(?=[^\n]*\s--force(?:-with-lease)?\b)/,
	/\bchmod\s+-R\s+777\b/,
	/\bchown\s+-R\b/,
];

export const SAFE_DEFAULTS: GuardrailsConfig = {
	autonomousMode: false,
	guardedCommands: {},
};

/**
 * Classifies a shell command under the runtime guard policy.
 *
 * Fixed ordering:
 *   1. Hard-deny pattern match -> "block", always, regardless of autonomousMode.
 *   2. Guarded pattern match, autonomousMode disabled -> "confirm" (legacy behavior).
 *   3. Guarded pattern match, autonomousMode enabled -> the configured action for
 *      that key, falling back to AUTONOMOUS_DEFAULT_ACTIONS.
 *   4. No pattern match -> "allow" (the command is not guarded).
 *
 * Does not apply the headless degrade; callers holding an ExtensionContext
 * must pass the result through degradeForHeadless.
 */
export function classifyGuardedCommand(
	command: string,
	config: GuardrailsConfig,
): GuardAction {
	for (const pattern of HARD_DENY_PATTERNS) {
		if (pattern.test(command)) return "block";
	}

	for (const key of GUARDED_COMMAND_KEYS) {
		if (!GUARDED_COMMAND_PATTERNS[key].test(command)) continue;

		if (!config.autonomousMode) return "confirm";

		return config.guardedCommands[key] ?? AUTONOMOUS_DEFAULT_ACTIONS[key];
	}

	return "allow";
}

/**
 * Applies the headless confirmation degrade: a "confirm" verdict with no
 * available UI becomes "block", because nobody can answer the prompt.
 * "allow" and "block" pass through unchanged.
 */
export function degradeForHeadless(action: GuardAction, hasUI: boolean): GuardAction {
	if (action === "confirm" && !hasUI) return "block";
	return action;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGuardAction(value: unknown): value is GuardAction {
	return value === "allow" || value === "confirm" || value === "block";
}

function parseGuardrailsConfigFile(raw: string): GuardrailsConfig | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed)) return undefined;

	const autonomousMode = parsed.autonomousMode === true;

	const rawGuardedCommands = isRecord(parsed.guardedCommands) ? parsed.guardedCommands : {};
	const guardedCommands: Record<string, GuardAction> = {};
	for (const key of GUARDED_COMMAND_KEYS) {
		const value = rawGuardedCommands[key];
		if (isGuardAction(value)) guardedCommands[key] = value;
	}

	return { autonomousMode, guardedCommands };
}

function defaultAgentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

/**
 * Loads the runtime guardrails config.
 *
 * Resolution (project overrides global):
 *   1. Read the global config from `${agentDir}/runtime-guardrails.json`.
 *   2. Read the project config from `${cwd}/.pi/runtime-guardrails.json`, merged
 *      on top of the global config: the project's autonomousMode replaces the
 *      global one, and project guardedCommands entries override global entries
 *      by key.
 *   3. Any parse or validation failure, at either layer, returns SAFE_DEFAULTS
 *      (the most restrictive config possible). This never fails open.
 */
export function loadGuardrailsConfig(
	cwd: string,
	options: LoadGuardrailsConfigOptions = {},
): GuardrailsConfig {
	try {
		const globalConfigPath = join(options.agentDir ?? defaultAgentDir(), "runtime-guardrails.json");
		const projectConfigPath = join(cwd, ".pi", "runtime-guardrails.json");

		let merged: GuardrailsConfig = { autonomousMode: false, guardedCommands: {} };

		if (existsSync(globalConfigPath)) {
			const globalParsed = parseGuardrailsConfigFile(readFileSync(globalConfigPath, "utf8"));
			if (!globalParsed) return SAFE_DEFAULTS;
			merged = globalParsed;
		}

		if (existsSync(projectConfigPath)) {
			const projectParsed = parseGuardrailsConfigFile(readFileSync(projectConfigPath, "utf8"));
			if (!projectParsed) return SAFE_DEFAULTS;
			merged = {
				autonomousMode: projectParsed.autonomousMode,
				guardedCommands: { ...merged.guardedCommands, ...projectParsed.guardedCommands },
			};
		}

		return merged;
	} catch {
		return SAFE_DEFAULTS;
	}
}
