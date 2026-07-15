## 4R Review

Four read-only review lenses are available as subagents (`review-risk`, `review-readability`, `review-reliability`, `review-resilience`) and as the `4r-review` chain, which runs all four in sequence and writes one report per lens. Each lens reports findings only as findings ledger rows with `severity: BLOCKER | CRITICAL | WARNING | SUGGESTION`; they never fix code. If a lens is clean, it still returns an empty ledger record with zero rows.

The review ledger row schema is: `severity`, `status`, `finding_id`, `source`, `summary`, `evidence`, `affected_files`, `owner`, `created_at`, `resolved_at`. Review agents report their own ledger rows; the orchestrator merges rows from all lenses into one ledger and persists it according to the active artifact store:

- OpenSpec/file store active: persist the merged ledger to the active review-ledger file path, such as `openspec/changes/{change-name}/review-ledger.md`.
- Engram active: upsert the merged ledger to topic `sdd/{change-name}/review-ledger`, or `review/{target-slug}/ledger` for ad-hoc reviews. If Engram upsert or the memory tool is unavailable, keep the merged ledger inline and explicitly report degraded persistence.
- No store active: keep the merged ledger inline only; do not write files or Engram artifacts.

The `review-gate` extension (`extensions/review-gate.ts`) gates `bash` calls that look like git/gh workflow events, using the trigger rules in `lib/review-triggers.ts`:

- **pre-commit / pre-push** (`git commit`, `git push`): advisory only. The extension notifies the user to consider running one cheap lens (`review-readability`) but does NOT block. No orchestrator action is required.
- **pre-pr** (`gh pr create`): strong gate. The extension BLOCKS the command when the changed paths match hot globs (`**/auth/**`, `**/update/**`, `**/security/**`, `**/payments/**`) OR the diff exceeds 400 changed lines; the block reason names the four lenses to run first. The gate is fail-open — if it cannot compute the diff it lets the command through.

When the extension blocks a `gh pr create`, the orchestrator must launch the `4r-review` chain (or run the four lenses individually), surface their reports, and only then let the user retry the PR command. Do NOT bypass the block by reshaping the command. Treat the lens reports as findings for the user, not as tasks to silently act on.

After a high-risk SDD phase (design, apply), prefer `judgment-day` for adversarial dual review; the 4R lenses complement it for pre-PR breadth.

### Review Lens Selection

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

If multiple rows match, run the narrow set that covers the risk (e.g. shell integration that mutates live state → `review-reliability` + `review-resilience`, not `review-readability`). The `review-gate` extension's pre-PR block names the four lenses; satisfy it with the concrete lenses or the `4r-review` chain, not the generic reviewer.

