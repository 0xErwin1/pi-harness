/**
 * Provider-agnostic usage window. Only the extractor functions in this module
 * know provider-specific header shapes; everything downstream consumes this
 * neutral model.
 */
export interface UsageWindow {
	id: string;
	label: string;
	percent: number | null;
	resetsInSeconds?: number;
}

const SECONDS_PER = { d: 86400, hr: 3600, h: 3600, min: 60, m: 60, s: 1 } as const;

/**
 * Formats a reset duration as up to three descending units (days, hours,
 * minutes), dropping zero-valued units, e.g. `4d 22hr 35m`, `2hr 25m`, `12m`.
 * Sub-minute durations collapse to `0m`.
 */
export function formatDuration(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));

	const days = Math.floor(total / 86400);
	const hours = Math.floor((total % 86400) / 3600);
	const minutes = Math.floor((total % 3600) / 60);

	const parts: string[] = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}hr`);
	if (minutes > 0) parts.push(`${minutes}m`);

	return parts.length > 0 ? parts.join(" ") : "0m";
}

/** `"<pct>% · <human-duration>"`, omitting whichever part is unavailable. */
export function formatUsageWindow(window: UsageWindow): string {
	const parts: string[] = [];

	if (window.percent !== null) parts.push(`${window.percent.toFixed(1)}%`);
	if (window.resetsInSeconds !== undefined) parts.push(formatDuration(window.resetsInSeconds));

	return parts.join(" · ");
}

function numOrNull(value: string | undefined): number | null {
	if (value === undefined) return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

function parseDurationString(raw: string): number | undefined {
	const matches = raw.toLowerCase().matchAll(/(\d+(?:\.\d+)?)\s*(d|hr|h|min|m|s)/g);

	let total = 0;
	let matched = false;
	for (const m of matches) {
		matched = true;
		total += Number.parseFloat(m[1]!) * SECONDS_PER[m[2] as keyof typeof SECONDS_PER];
	}

	return matched ? Math.floor(total) : undefined;
}

/**
 * Resolves a header reset value to seconds-from-now. Tolerant of three shapes:
 * a numeric epoch-seconds timestamp (large integer), a numeric seconds-remaining
 * value (small integer), a duration string (`6m0s`, `2h30m`), or an ISO
 * timestamp. Returns `undefined` when none applies.
 */
export function parseResetSeconds(raw: string | undefined, nowMs: number = Date.now()): number | undefined {
	if (raw === undefined) return undefined;
	const trimmed = raw.trim();
	if (trimmed.length === 0) return undefined;

	const nowSec = Math.floor(nowMs / 1000);

	if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
		const n = Number.parseFloat(trimmed);
		return n > 1e7 ? Math.max(0, Math.floor(n - nowSec)) : Math.max(0, Math.floor(n));
	}

	const duration = parseDurationString(trimmed);
	if (duration !== undefined) return duration;

	const parsed = Date.parse(trimmed);
	if (Number.isFinite(parsed)) return Math.max(0, Math.floor((parsed - nowMs) / 1000));

	return undefined;
}

function lowercaseKeys(headers: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
	return out;
}

function clampPercent(value: number | null): number | null {
	if (value === null) return null;
	return Math.max(0, Math.min(100, value));
}

const ROLE_KEYWORDS = ["remaining", "used", "reset", "status"] as const;
type Role = (typeof ROLE_KEYWORDS)[number] | "limit";

/**
 * Splits a rate-limit header key into its window group and the role it carries
 * (remaining / used / reset / status / limit). The role segment is removed to
 * form the group key, so sibling headers for the same window collapse together.
 */
function classifyKey(key: string): { group: string; role: Role } | undefined {
	const segments = key.split(/[^a-z0-9]+/).filter(Boolean);

	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i]!;
		const keyword = ROLE_KEYWORDS.find((r) => seg.includes(r));
		const role: Role | undefined = keyword ?? (seg === "limit" ? "limit" : undefined);
		if (!role) continue;

		const group = [...segments.slice(0, i), ...segments.slice(i + 1)].join("-");
		return { group, role };
	}

	return undefined;
}

type RoleMap = Partial<Record<Role, string>>;

function computePercent(group: RoleMap): number | null {
	const limit = numOrNull(group.limit);
	const used = numOrNull(group.used);
	const remaining = numOrNull(group.remaining);

	if (used !== null && limit !== null && limit > 0) return (used / limit) * 100;
	if (remaining !== null && limit !== null && limit > 0) return ((limit - remaining) / limit) * 100;
	if (used !== null && remaining !== null && used + remaining > 0) return (used / (used + remaining)) * 100;

	const status = numOrNull(group.status);
	return status;
}

function windowLabel(group: string): string {
	const token = group.split("-").find((seg) => /^\d+[a-z]$/.test(seg) || seg === "unified");
	return token ?? group;
}

/**
 * Anthropic-style extractor. Defensive: it scans every `*ratelimit*` / `*limit*`
 * key that also names `anthropic`, groups siblings by window token, and emits a
 * window whenever it can compute at least a percent OR a reset. Exact weekly /
 * 5h field names are not assumed.
 */
function extractAnthropicWindows(lower: Record<string, string>, nowMs: number): UsageWindow[] {
	const groups = new Map<string, RoleMap>();

	for (const [key, value] of Object.entries(lower)) {
		if (!key.includes("anthropic")) continue;
		if (!key.includes("ratelimit") && !key.includes("limit")) continue;

		const classified = classifyKey(key);
		if (!classified) continue;

		const map = groups.get(classified.group) ?? {};
		map[classified.role] = value;
		groups.set(classified.group, map);
	}

	const windows: UsageWindow[] = [];
	for (const [group, map] of groups) {
		const percent = clampPercent(computePercent(map));
		const resetsInSeconds = parseResetSeconds(map.reset, nowMs);
		if (percent === null && resetsInSeconds === undefined) continue;

		windows.push({ id: group, label: windowLabel(group), percent, resetsInSeconds });
	}

	return windows;
}

/** OpenAI-style extractor for the `x-ratelimit-*-tokens` / `*-requests` families. */
function extractOpenAiWindows(lower: Record<string, string>, nowMs: number): UsageWindow[] {
	const windows: UsageWindow[] = [];

	for (const resource of ["tokens", "requests"] as const) {
		const limit = numOrNull(lower[`x-ratelimit-limit-${resource}`]);
		const remaining = numOrNull(lower[`x-ratelimit-remaining-${resource}`]);
		const reset = lower[`x-ratelimit-reset-${resource}`];

		const percent = clampPercent(
			limit !== null && remaining !== null && limit > 0 ? ((limit - remaining) / limit) * 100 : null,
		);
		const resetsInSeconds = parseResetSeconds(reset, nowMs);

		if (percent === null && resetsInSeconds === undefined) continue;

		windows.push({ id: `openai-${resource}`, label: resource, percent, resetsInSeconds });
	}

	return windows;
}

/** Last-resort extractor: any `*ratelimit*reset*` paired with a `*remaining*`/`*limit*`. */
function extractGenericWindows(lower: Record<string, string>, nowMs: number): UsageWindow[] {
	let reset: string | undefined;
	let remaining: number | null = null;
	let limit: number | null = null;

	for (const [key, value] of Object.entries(lower)) {
		if (!key.includes("ratelimit") && !key.includes("limit")) continue;

		if (reset === undefined && key.includes("reset")) reset = value;
		else if (remaining === null && key.includes("remaining")) remaining = numOrNull(value);
		else if (limit === null && /(^|[^a-z])limit([^a-z]|$)/.test(key) && !key.includes("remaining"))
			limit = numOrNull(value);
	}

	const percent = clampPercent(
		remaining !== null && limit !== null && limit > 0 ? ((limit - remaining) / limit) * 100 : null,
	);
	const resetsInSeconds = parseResetSeconds(reset, nowMs);

	if (percent === null && resetsInSeconds === undefined) return [];

	return [{ id: "ratelimit", label: "ratelimit", percent, resetsInSeconds }];
}

/**
 * Dispatches to per-provider extractors and returns the first non-empty result.
 * The provider hint only orders the attempts; an unknown provider tries all
 * shapes. Returns `[]` when no usage windows can be derived.
 */
export function extractUsageWindows(
	headers: Record<string, string>,
	provider?: string,
	nowMs: number = Date.now(),
): UsageWindow[] {
	const lower = lowercaseKeys(headers);
	const hint = provider?.toLowerCase() ?? "";

	const ordered = hint.includes("anthropic")
		? [extractAnthropicWindows, extractGenericWindows]
		: hint.includes("openai")
			? [extractOpenAiWindows, extractGenericWindows]
			: [extractAnthropicWindows, extractOpenAiWindows, extractGenericWindows];

	for (const extractor of ordered) {
		const windows = extractor(lower, nowMs);
		if (windows.length > 0) return windows;
	}

	return [];
}
