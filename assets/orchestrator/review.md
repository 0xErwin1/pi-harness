## Review Protocols (opt-in only)

Adversarial multi-agent review is **never automatic**. Nothing here starts a review because code was written, a phase finished, a commit was made, or a PR was opened. Only the user starts one.

Two **separate** protocols exist. They share **no** common auto-trigger. They run together only when the user names both.

### Judgment Day

**Triggers (any is enough):** Judgment Day, Judgement Day, dual review, adversarial review (when named as judgment), `juicio`, `juzgar`, `que lo juzguen`.

**Does:** load the `judgment-day` skill and run that protocol only — two blind judges (`jd-judge-a`, `jd-judge-b`), optional fix via `jd-fix-agent`, scoped re-judge per the skill.

**Does not:** start 4R, invent a shared trigger with 4R, or run after apply/verify by inference.

### 4R

**Triggers (any is enough):** `4R`, `full 4R`, `corré un 4R`, `hacé 4R`, `run 4R`, or explicitly naming the full four-lens set (risk + resilience + readability + reliability).

**Does:** launch the four lenses, or the `4r-review` chain, on the stated target. Report findings. No automatic fix→re-review loop unless the user asks to fix findings.

**Does not:** start Judgment Day unless the user also requested it.

### Both

If the user asks for juicio **and** 4R in the same request, run **both** protocols separately (announce each), produce two report sections, and do not merge them into one invented protocol.

### Ambiguous "review this"

If the user says only "review this" / "revisá esto" without naming juicio or 4R, ask which they want: a single generic `reviewer` pass, 4R, juicio, or both. Do not default to 4R or Judgment Day.

### No inferred activation

- Commit, push, open PR, merge: execute directly; never insert 4R or juicio first.
- After `sdd-verify` PASS (batch or final): stop. Do not chain or suggest 4R or juicio.

## 4R Review

Four read-only review lenses are available as subagents (`review-risk`, `review-readability`, `review-reliability`, `review-resilience`) and as the `4r-review` chain, which runs all four in sequence and writes one report per lens. Each lens reports findings only as findings ledger rows with `severity: BLOCKER | CRITICAL | WARNING | SUGGESTION`; they never fix code. If a lens is clean, it still returns an empty ledger record with zero rows.

### Review Budgets

These bound every protocol above, so a review terminates on a schedule the user can predict.

**Sweep budget.** Standard review: exactly 1 exhaustive sweep of the diff per lens, then stop. Full-4R review (hot path — the diff touches `**/auth/**`, `**/update/**`, `**/security/**`, `**/payments/**` — or more than 400 changed lines): at most 2 sweeps per lens. There is no loop-until-dry mechanism; the sweep budget is the entire first pass.

**Convergence budget.** Maximum 2 fix rounds per review. One fix round = the orchestrator (directly or via a single writer subagent) applies fixes for all open BLOCKER/CRITICAL findings, then a scoped re-review verifies the fix diff against the ledger; in judgment-day the fix actor is `jd-fix-agent`. Anything still open after round 2 is reported to the user as open — the loop never extends.

**Scoped re-review.** A re-review pass takes the persisted ledger and the fix diff as input. It verifies each ledger finding's resolution and reviews only fix-touched lines; it does not re-read the full original diff. A finding on an untouched line is logged with status `info` and never by itself triggers another round.

### Review Ledger

The review ledger row schema is: `severity`, `status`, `finding_id`, `source`, `summary`, `evidence`, `affected_files`, `owner`, `created_at`, `resolved_at`. Review agents report their own ledger rows; the orchestrator merges rows from all lenses into one ledger and persists it according to the active artifact store:

- OpenSpec/file store active: persist the merged ledger to the active review-ledger file path, such as `openspec/changes/{change-name}/review-ledger.md`.
- Engram active: upsert the merged ledger to topic `sdd/{change-name}/review-ledger`, or `review/{target-slug}/ledger` for ad-hoc reviews. If Engram upsert or the memory tool is unavailable, keep the merged ledger inline and explicitly report degraded persistence.
- No store active: keep the merged ledger inline only; do not write files or Engram artifacts.

### Review Gate Compatibility Module

The legacy `review-gate` compatibility module loads without registering handlers. It does not observe commands, emit notifications or suggestions, block actions, or start review. Explicit review remains available through the user-invoked protocols above.

### Review Lens Selection

Once the user has asked for a review, pick the shape that fits.

`reviewer` is a generic review intent; the 4R agents are concrete risk lenses. Use both deliberately:

- **Quick / general review** (small diffs, no dominant risk): the generic `reviewer` subagent is fine.
- **Risk-driven review** (pre-PR, incident audit, hot path, large diff): select concrete lens(es) by risk profile instead of the generic reviewer:

| Risk signal | Review lens |
| --- | --- |
| Clear naming, structure, maintainability, small refactors | `review-readability` |
| Behavior, state, tests, determinism, regressions | `review-reliability` |
| Shell/process integration, partial failures, recovery, degraded dependencies | `review-resilience` |
| Security, permissions, data exposure/loss, architecture, dependencies | `review-risk` |
| Large PR, hot path, or >400 changed lines | Full 4R: `review-risk`, `review-resilience`, `review-readability`, `review-reliability` |

If multiple rows match, run the narrow set that covers the risk (e.g. shell integration that mutates live state → `review-reliability` + `review-resilience`, not `review-readability`).
