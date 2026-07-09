---
name: 4r-review
description: Pre-PR 4R review fan-out — runs all four review lenses (risk, readability, reliability, resilience) in sequence and writes individual reports.
---

## review-risk

output: review-risk-report.md
outputMode: file-only
progress: true

Run R1 Risk review on the current diff. Report security, privilege boundary, data exposure, dependency, and merge-blocking vulnerability findings. Return findings ledger rows using the review ledger schema; if the first pass finds nothing, return an empty ledger record with zero rows rather than skip ledger output.

## review-readability

reads: review-risk-report.md
output: review-readability-report.md
outputMode: file-only
progress: true

Run R2 Readability review on the current diff. Report naming, complexity, intention, maintainability, review size, and context clarity findings. Return findings ledger rows using the review ledger schema; if the first pass finds nothing, return an empty ledger record with zero rows rather than skip ledger output.

## review-reliability

reads: review-risk-report.md+review-readability-report.md
output: review-reliability-report.md
outputMode: file-only
progress: true

Run R3 Reliability review on the current diff. Report behavior-first test coverage, edge case, determinism, contract, and regression findings. Return findings ledger rows using the review ledger schema; if the first pass finds nothing, return an empty ledger record with zero rows rather than skip ledger output.

## review-resilience

reads: review-risk-report.md+review-readability-report.md+review-reliability-report.md
output: review-resilience-report.md
outputMode: file-only
progress: true

Run R4 Resilience review on the current diff. Report fallback, retry/backoff, graceful degradation, observability, load, rollback, and SLO risk findings. Return findings ledger rows using the review ledger schema; if the first pass finds nothing, return an empty ledger record with zero rows rather than skip ledger output.

## Review ledger handoff

Each 4R lens returns its own findings ledger rows. The orchestrator merges the rows into one ledger and persists it according to the active artifact store: OpenSpec/file when active, Engram topic when active, or inline-only when no store is active. If Engram upsert or the memory tool is unavailable, the orchestrator keeps the merged ledger inline and explicitly reports degraded persistence.

Ledger row schema: `severity`, `status`, `finding_id`, `source`, `summary`, `evidence`, `affected_files`, `owner`, `created_at`, `resolved_at`.
