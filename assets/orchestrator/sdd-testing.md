## SDD Testing Workflow (Independent QA Flow)

SDD-testing is an independent testing/QA workflow. It does not replace, extend, or automatically trigger from development SDD phases. Development `/sdd-verify`, `/sdd-continue`, `/sdd-sync`, and `/sdd-archive` stay in the development DAG and must not silently enter testing.

Start SDD-testing only when the user explicitly invokes `/sdd-test` or gives clear testing intent such as asking to test a feature, plan QA coverage, run a testing session, or produce a testing report. If intent is ambiguous, ask whether they mean development verification or independent SDD-testing before launching any testing agents.

### Testing phase graph

```text
/sdd-test → intake → sdd-explore-testing → suites gate → sdd-plan-testing → sdd-run-testing shards → parent merge/latest → sdd-report-testing
```

The suites gate is mandatory: exploration may propose coverage, but planning must use user-approved suites when suites exist or were requested. Do not invent replacement cases after the gate.

### Testing agents

| Phase | Agent | Responsibility |
| --- | --- | --- |
| Explore | `sdd-explore-testing` | Map feature scope, code/test surfaces, setup, modes, risks, design references, and blockers. |
| Plan | `sdd-plan-testing` | Convert approved suites into executable cases and run units. |
| Run | `sdd-run-testing` | Execute one assigned unit/session shard and record outcomes. |
| Report | `sdd-report-testing` | Consolidate latest run + plan into a human-readable QA report. |

Testing agents must not launch child subagents. The parent orchestrator owns suite approval, run fan-out, shard merge, `run/latest`, and phase progression.

### Testing persistence

Testing artifacts use a namespace separate from development SDD.

| Artifact | Engram topic key | Atlas logical path |
| --- | --- | --- |
| Setup state | `testing/{project_slug}/setup-state` | `testing/{project_slug}/setup-state.md` |
| Suites | `testing/{project_slug}/{feature_slug}/suites` | `testing/{project_slug}/{feature_slug}/suites.md` |
| Explore | `testing/{project_slug}/{feature_slug}/explore` | `testing/{project_slug}/{feature_slug}/explore.md` |
| Plan | `testing/{project_slug}/{feature_slug}/plan` | `testing/{project_slug}/{feature_slug}/plan.md` |
| Run shard | `testing/{project_slug}/{feature_slug}/run/{session_id}/{unit_id}` | `testing/{project_slug}/{feature_slug}/runs/{session_id}/{unit_id}.md` |
| Run summary | `testing/{project_slug}/{feature_slug}/run/{session_id}` | `testing/{project_slug}/{feature_slug}/runs/{session_id}/summary.md` |
| Latest run | `testing/{project_slug}/{feature_slug}/run/latest` | `testing/{project_slug}/{feature_slug}/runs/latest.md` |
| Report | `testing/{project_slug}/{feature_slug}/report` | `testing/{project_slug}/{feature_slug}/report.md` |

Engram is the source of truth for agents/orchestrator recovery and phase progression. Atlas is the human-readable documentation mirror for full testing artifacts when approved and available. If Engram is unavailable, block the testing pipeline. If Atlas is unavailable or unapproved, do not silently downgrade; return partial/blocked unless the active `TestingPersistenceContract` explicitly permits Engram full-content fallback.

### Testing modes and degraded paths

Keep all relevant modes visible in explore, plan, run, and report. Unsupported modes are reported as `unsupported`; missing prerequisites are `blocked`. Do not hide them or switch engines silently.

| Mode | Use for | Degraded path |
| --- | --- | --- |
| Playwright/browser | Repeatable web UI, cross-browser, regression-ready checks. | Block/unsupported when package, browsers, config, auth, or target URL is missing. |
| backend | Services, jobs, data-layer, project test runners. | Block only when no safe command/environment is known. |
| API | HTTP endpoints and API contracts. | Block when endpoint, auth, environment, or safe credentials are missing. |
| live browser/no-code | Real Chrome session checks using existing cookies/extensions and no generated code artifacts. | Unsupported when no Pi browser bridge or real browser session is available. |
| mobile/Maestro | Native, hybrid, device-first, or approved web/Chromium Maestro flows. | Block/unsupported when Maestro, device, app target, or write approval is missing. |
| visual diff | Playwright/browser, live browser/no-code, or mobile/Maestro checks with Figma, screenshot, URL, or design reference. | Partial/skipped when reference or capture capability is missing; pixel diff never gates pass/fail. |

### No-remediation rule

SDD-testing reports findings; it does not fix product code. `sdd-run-testing` and `sdd-report-testing` must record failures, evidence, severity, blocked/unsupported modes, and follow-up recommendations, then stop. Remediation happens only as separate user-directed development work, usually through the normal SDD development flow.

### Parent run fan-out and merge

For run-testing, the parent generates one `session_id`, launches one `sdd-run-testing` per execution unit, and passes the exact `unit_id`. Direct `/sdd-run-testing` requires `/sdd-run-testing <feature> <session_id> <unit_id>` and must refuse missing or unsafe IDs. Each runner writes only its shard. After shards finish, the parent reads shards from Engram, writes `run/{session_id}` and `run/latest`, then launches `sdd-report-testing`. Continue to the report phase only when both `run/latest` and the referenced consolidated run artifact exist; test failures are report findings, not an instruction to remediate.

