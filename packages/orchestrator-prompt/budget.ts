/**
 * Anti-regression ceiling for the rendered orchestrator core prompt, ruled at
 * ~18 KB (engram sdd/harness-ux-and-hardening/decision-orchestrator-budget).
 * This is a ceiling locked onto the honest relocation-only result, not a
 * target to squeeze toward — it must not be raised to accommodate new
 * content without an explicit recorded decision.
 *
 * Not yet enforced by a test: the relocation that determines the honest
 * measured size has not landed. The byte-budget test is added once that
 * measurement exists, so the ceiling is never asserted against stale content.
 */
export const BUDGET_BYTES = 18_432;
