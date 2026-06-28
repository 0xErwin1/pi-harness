import test from "node:test";
import assert from "node:assert/strict";

import {
	type UsageWindow,
	extractUsageWindows,
	formatDuration,
	formatUsageWindow,
	parseResetSeconds,
} from "../../../packages/subagent-manager-pi/statusbar/usage.ts";

const NOW_MS = 1_000_000_000_000; // nowSec = 1_000_000_000
const NOW_SEC = NOW_MS / 1000;

function byId(windows: UsageWindow[], id: string): UsageWindow {
	const found = windows.find((w) => w.id === id);
	assert.ok(found, `expected a window with id ${id}, got ${JSON.stringify(windows)}`);
	return found;
}

// ── formatDuration ────────────────────────────────────────────────────────────

test("formatDuration renders descending non-zero units", () => {
	assert.equal(formatDuration(4 * 86400 + 22 * 3600 + 35 * 60), "4d 22hr 35m");
	assert.equal(formatDuration(2 * 3600 + 25 * 60), "2hr 25m");
	assert.equal(formatDuration(12 * 60), "12m");
});

test("formatDuration collapses sub-minute and zero to 0m", () => {
	assert.equal(formatDuration(0), "0m");
	assert.equal(formatDuration(45), "0m");
	assert.equal(formatDuration(-100), "0m");
});

// ── formatUsageWindow ─────────────────────────────────────────────────────────

test("formatUsageWindow joins percent and duration", () => {
	assert.equal(
		formatUsageWindow({ id: "w", label: "w", percent: 48, resetsInSeconds: 4 * 86400 + 22 * 3600 + 35 * 60 }),
		"48.0% · 4d 22hr 35m",
	);
});

test("formatUsageWindow omits whichever part is missing", () => {
	assert.equal(formatUsageWindow({ id: "w", label: "w", percent: null, resetsInSeconds: 720 }), "12m");
	assert.equal(formatUsageWindow({ id: "w", label: "w", percent: 30 }), "30.0%");
});

// ── parseResetSeconds ─────────────────────────────────────────────────────────

test("parseResetSeconds treats a large integer as epoch seconds", () => {
	assert.equal(parseResetSeconds(String(NOW_SEC + 3600), NOW_MS), 3600);
});

test("parseResetSeconds treats a small integer as seconds remaining", () => {
	assert.equal(parseResetSeconds("600", NOW_MS), 600);
});

test("parseResetSeconds parses duration strings", () => {
	assert.equal(parseResetSeconds("6m0s", NOW_MS), 360);
	assert.equal(parseResetSeconds("2h30m", NOW_MS), 9000);
	assert.equal(parseResetSeconds("1.5s", NOW_MS), 1);
});

test("parseResetSeconds parses an ISO timestamp", () => {
	const iso = new Date(NOW_MS + 3600_000).toISOString();
	assert.equal(parseResetSeconds(iso, NOW_MS), 3600);
});

test("parseResetSeconds returns undefined for unusable input", () => {
	assert.equal(parseResetSeconds(undefined, NOW_MS), undefined);
	assert.equal(parseResetSeconds("", NOW_MS), undefined);
	assert.equal(parseResetSeconds("not-a-time", NOW_MS), undefined);
});

// ── extractUsageWindows: Anthropic-style ──────────────────────────────────────

test("extractUsageWindows reads anthropic-style unified windows", () => {
	const headers = {
		"anthropic-ratelimit-unified-7d-limit": "100",
		"anthropic-ratelimit-unified-7d-remaining": "52",
		"anthropic-ratelimit-unified-7d-reset": String(NOW_SEC + (4 * 86400 + 22 * 3600 + 35 * 60)),
		"anthropic-ratelimit-unified-5h-limit": "100",
		"anthropic-ratelimit-unified-5h-remaining": "85",
		"anthropic-ratelimit-unified-5h-reset": String(NOW_SEC + (2 * 3600 + 25 * 60)),
	};
	const windows = extractUsageWindows(headers, "anthropic", NOW_MS);
	assert.equal(windows.length, 2);

	const weekly = byId(windows, "anthropic-ratelimit-unified-7d");
	assert.equal(weekly.percent, 48);
	assert.equal(formatUsageWindow(weekly), "48.0% · 4d 22hr 35m");

	const fiveHour = byId(windows, "anthropic-ratelimit-unified-5h");
	assert.equal(fiveHour.percent, 15);
	assert.equal(formatUsageWindow(fiveHour), "15.0% · 2hr 25m");
});

test("extractUsageWindows emits an anthropic window from a reset alone", () => {
	const headers = { "anthropic-ratelimit-unified-5h-reset": String(NOW_SEC + 3600) };
	const windows = extractUsageWindows(headers, "anthropic", NOW_MS);
	assert.equal(windows.length, 1);
	assert.equal(windows[0]!.percent, null);
	assert.equal(windows[0]!.resetsInSeconds, 3600);
});

// ── extractUsageWindows: OpenAI-style ─────────────────────────────────────────

test("extractUsageWindows reads openai-style token and request windows", () => {
	const headers = {
		"x-ratelimit-limit-tokens": "100000",
		"x-ratelimit-remaining-tokens": "75000",
		"x-ratelimit-reset-tokens": "6m0s",
		"x-ratelimit-limit-requests": "100",
		"x-ratelimit-remaining-requests": "90",
		"x-ratelimit-reset-requests": "1s",
	};
	const windows = extractUsageWindows(headers, "openai", NOW_MS);
	assert.equal(windows.length, 2);

	const tokens = byId(windows, "openai-tokens");
	assert.equal(tokens.percent, 25);
	assert.equal(tokens.resetsInSeconds, 360);

	const requests = byId(windows, "openai-requests");
	assert.equal(requests.percent, 10);
	assert.equal(requests.resetsInSeconds, 1);
});

// ── extractUsageWindows: generic fallback + unknown ───────────────────────────

test("extractUsageWindows falls back to a generic ratelimit pair (unknown provider)", () => {
	const headers = {
		"ratelimit-limit": "60",
		"ratelimit-remaining": "15",
		"ratelimit-reset": "120",
	};
	const windows = extractUsageWindows(headers, undefined, NOW_MS);
	assert.equal(windows.length, 1);
	assert.equal(windows[0]!.percent, 75);
	assert.equal(windows[0]!.resetsInSeconds, 120);
});

test("extractUsageWindows returns [] when no rate-limit headers are present", () => {
	assert.deepEqual(extractUsageWindows({ "content-type": "application/json" }, "anthropic", NOW_MS), []);
	assert.deepEqual(extractUsageWindows({}, undefined, NOW_MS), []);
});

test("extractUsageWindows is case-insensitive to header key casing", () => {
	const headers = {
		"X-RateLimit-Limit-Tokens": "100000",
		"X-RateLimit-Remaining-Tokens": "60000",
		"X-RateLimit-Reset-Tokens": "30s",
	};
	const windows = extractUsageWindows(headers, "openai", NOW_MS);
	assert.equal(windows.length, 1);
	assert.equal(byId(windows, "openai-tokens").percent, 40);
});
