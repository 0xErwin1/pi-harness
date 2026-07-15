/**
 * Anti-regression ceiling for `assets/orchestrator.md`, the always-on core
 * prompt, measured as the RAW authored file (placeholder tokens in place,
 * before `renderOrchestratorPrompt` substitutes them for absolute paths).
 *
 * Raw, not resolved, is the enforced quantity: a resolved placeholder's
 * length depends on where the assets directory happens to live on disk (a
 * short repo checkout vs. a long `/nix/store/<hash>-...` path), so asserting
 * against the resolved output would make the ceiling — and thus CI — drift
 * with install location rather than with authored content. The raw file is
 * the actual, stable thing being budgeted; see
 * `tests/orchestrator/budget.test.ts` for both measurements.
 *
 * Honest post-relocation measurement (WU8, engram
 * sdd/harness-ux-and-hardening/decision-orchestrator-budget, ~18 KB ruling):
 * the pure relocation-only raw core came to 17,891 B, comfortably under the
 * 18,432 B ceiling. `BUDGET_BYTES` is locked at 17,891 B rounded up to the
 * next 512 B — an anti-regression ceiling on the measured result, not a
 * target to squeeze toward, and it must not be raised to accommodate new
 * content without an explicit recorded decision.
 */
export const BUDGET_BYTES = 17_920;
