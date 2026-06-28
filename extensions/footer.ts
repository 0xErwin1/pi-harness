/**
 * Custom Pi status footer.
 *
 * Replaces the built-in footer (via `ctx.ui.setFooter`) with a width-aware,
 * Claude-Code-style layout while preserving every piece of information the
 * built-in footer carried: cumulative token/cost stats and, critically, the
 * extension status line (the subagent widget publishes into it via setStatus).
 *
 * The render function is synchronous, so values that require async work — git
 * diff counts and provider rate-limit windows — are cached in mutable state and
 * a redraw is requested (`tui.requestRender()`) once they update.
 */
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Component, TUI } from "@mariozechner/pi-tui";
import type {
	ExtensionAPI,
	ExtensionContext,
	ReadonlyFooterDataProvider,
	Theme,
} from "@mariozechner/pi-coding-agent";
import {
	type CumulativeStats,
	type DiffCounts,
	type EffortLevel,
	type FooterRenderInput,
	type UsageWindow,
	composeFooterLines,
	effortColorRole,
	extractUsageWindows,
	formatEffortLabel,
	formatModelName,
	parseShortstat,
	sumDiffs,
} from "../packages/subagent-manager-pi/statusbar/index.ts";

const PROBE_PATH = join(homedir(), ".pi", "agent", "harness-ratelimit-headers.jsonl");

const GIT_DEBOUNCE_MS = 400;

const registeredFooterCwds = new Set<string>();
const liveFooters = new Set<StatusFooter>();

/** Latest provider usage windows, refreshed by `after_provider_response`. */
let usageWindows: UsageWindow[] = [];

/** Notifies every mounted footer that cached state changed and a redraw is due. */
function requestRenderAll(): void {
	for (const footer of liveFooters) footer.requestRender();
}

/**
 * Appends the rate-limit-ish subset of response headers to a debug JSONL file so
 * the extractor can be refined against real data. Only keys whose lowercased
 * name contains `ratelimit` or `limit` are written (never auth tokens or the
 * full header set). Best-effort: any failure is swallowed.
 */
function probeRateLimitHeaders(headers: Record<string, string>, provider: string | undefined): void {
	try {
		const subset: Record<string, string> = {};
		for (const [key, value] of Object.entries(headers)) {
			const lowered = key.toLowerCase();
			if (lowered.includes("ratelimit") || lowered.includes("limit")) subset[key] = value;
		}

		if (Object.keys(subset).length === 0) return;

		const line = `${JSON.stringify({ at: new Date().toISOString(), provider: provider ?? null, headers: subset })}\n`;
		appendFileSync(PROBE_PATH, line);
	} catch {
		// Debug aid only; never disturb the agent on a logging failure.
	}
}

interface RawUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

function toNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Defensively reads token/cost usage from a session message. Returns `undefined`
 * for anything that is not an assistant message carrying a usage object, so the
 * union of message shapes never fabricates counts.
 */
function assistantUsage(message: unknown): RawUsage | undefined {
	if (message === null || typeof message !== "object") return undefined;

	const candidate = message as { role?: unknown; usage?: unknown };
	if (candidate.role !== "assistant" || candidate.usage === null || typeof candidate.usage !== "object") {
		return undefined;
	}

	const usage = candidate.usage as Record<string, unknown>;
	const costObject = usage.cost && typeof usage.cost === "object" ? (usage.cost as Record<string, unknown>) : undefined;

	return {
		input: toNumber(usage.input),
		output: toNumber(usage.output),
		cacheRead: toNumber(usage.cacheRead),
		cacheWrite: toNumber(usage.cacheWrite),
		cost: costObject ? toNumber(costObject.total) : 0,
	};
}

/** Sums cumulative usage across all assistant messages in the session. */
function readCumulative(ctx: ExtensionContext): RawUsage {
	const total: RawUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "message") continue;

		const usage = assistantUsage((entry as { message?: unknown }).message);
		if (!usage) continue;

		total.input += usage.input;
		total.output += usage.output;
		total.cacheRead += usage.cacheRead;
		total.cacheWrite += usage.cacheWrite;
		total.cost += usage.cost;
	}

	return total;
}

/** Replaces the `$HOME` prefix of a path with `~`. */
function homeRelative(path: string): string {
	const home = process.env.HOME;
	if (home && path.startsWith(home)) return `~${path.slice(home.length)}`;
	return path;
}

/**
 * The footer component. One instance per active session; it captures the live
 * `ctx`/`pi`/`tui` and reads fresh data on every synchronous render, while git
 * diff counts are refreshed asynchronously (debounced) on branch change and
 * after each turn.
 */
class StatusFooter implements Component {
	private git: DiffCounts = { added: 0, removed: 0 };
	private gitTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly unsubscribeBranch: () => void;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly footerData: ReadonlyFooterDataProvider,
		private readonly ctx: ExtensionContext,
		private readonly pi: ExtensionAPI,
	) {
		liveFooters.add(this);
		this.unsubscribeBranch = footerData.onBranchChange(() => this.scheduleGitRefresh());
		this.scheduleGitRefresh();
	}

	requestRender(): void {
		this.tui.requestRender();
	}

	/** Debounced git-diff refresh; collapses bursts of triggers into one exec pair. */
	scheduleGitRefresh(): void {
		if (this.gitTimer !== undefined) return;

		this.gitTimer = setTimeout(() => {
			this.gitTimer = undefined;
			void this.refreshGit();
		}, GIT_DEBOUNCE_MS);
	}

	private async refreshGit(): Promise<void> {
		try {
			const cwd = this.ctx.cwd;
			const [unstaged, staged] = await Promise.all([
				this.pi.exec("git", ["diff", "--shortstat"], { cwd }),
				this.pi.exec("git", ["diff", "--cached", "--shortstat"], { cwd }),
			]);

			const next = sumDiffs(parseShortstat(unstaged.stdout), parseShortstat(staged.stdout));
			if (next.added !== this.git.added || next.removed !== this.git.removed) {
				this.git = next;
				this.tui.requestRender();
			}
		} catch {
			// git may be unavailable (not a repo, binary missing); keep last counts.
		}
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		return composeFooterLines(this.buildInput(), width);
	}

	private buildInput(): FooterRenderInput {
		const model = this.ctx.model;
		const contextUsage = this.ctx.getContextUsage();

		const reasoning = model?.reasoning ?? false;
		const level: EffortLevel = this.pi.getThinkingLevel();

		const cumulative: CumulativeStats = {
			...readCumulative(this.ctx),
			sub: model ? this.ctx.modelRegistry.isUsingOAuth(model) : false,
		};

		return {
			model: formatModelName(model),
			effort: reasoning ? formatEffortLabel(level) : undefined,
			effortRole: reasoning ? effortColorRole(level) : undefined,
			context: {
				percent: contextUsage?.percent ?? null,
				tokens: contextUsage?.tokens ?? null,
				contextWindow: contextUsage?.contextWindow ?? model?.contextWindow ?? 0,
			},
			dir: homeRelative(this.ctx.sessionManager.getCwd()),
			branch: this.footerData.getGitBranch(),
			git: this.git,
			usageWindows,
			cumulative,
			statuses: this.footerData.getExtensionStatuses(),
			theme: this.theme,
		};
	}

	invalidate(): void {}

	dispose(): void {
		liveFooters.delete(this);
		this.unsubscribeBranch();
		if (this.gitTimer !== undefined) {
			clearTimeout(this.gitTimer);
			this.gitTimer = undefined;
		}
	}
}

export default function statusFooter(pi: ExtensionAPI): void {
	pi.on("after_provider_response", (event, ctx) => {
		const provider = ctx.model?.provider;
		usageWindows = extractUsageWindows(event.headers, provider);
		probeRateLimitHeaders(event.headers, provider);
		requestRenderAll();
	});

	pi.on("turn_end", () => {
		for (const footer of liveFooters) footer.scheduleGitRefresh();
	});

	pi.on("session_start", (_event, ctx) => {
		if (registeredFooterCwds.has(ctx.cwd)) return;
		registeredFooterCwds.add(ctx.cwd);

		ctx.ui.setFooter((tui, theme, footerData) => new StatusFooter(tui, theme, footerData, ctx, pi));
	});
}
