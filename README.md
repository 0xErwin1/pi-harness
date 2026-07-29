# pi-harness

A personal coding-agent harness for [Pi](https://github.com/mariozechner/pi): SDD
orchestration, subagent delegation discipline, shell safety guards, and skill
discovery.

It is a neutralized framework — the operating discipline of an agent harness
without any persona, branding, or cosmetic layer. Pi already has strong tools;
this adds the discipline for using them well.

## What it provides

| Surface | Purpose |
| --- | --- |
| `extensions/engram.ts` | Engram persistent-memory integration. |
| `extensions/sdd-orchestrator.ts` | Programmatic SDD orchestrator — reads development and testing DAG state from Engram and drives phase delegation. |
| `extensions/shell-guard.ts` | Shell safety guard — blocks destructive `bash` commands and confirms sensitive ones. |
| `extensions/btw.ts` | Lazy `/btw` side-question command with isolated transcript handling. |
| `pi-subagents-j0k3r@1.4.4` | Official npm package for native subagent delegation, discovered by Pi through `settings.json`. |
| `vendor/pi-ask-user/` | Vendored upstream `ask_user` decision prompt extension. |
| `assets/orchestrator.md` | Parent-session orchestration contract. |

## Install

Requires Node.js >=22.19.0 and pnpm.

```bash
pnpm install
pnpm run relink
```

`pnpm run relink` links the harness files into the global Pi agent directory
(`~/.pi/agent/`) and adds `npm:pi-subagents-j0k3r@1.4.4` idempotently to native
Pi `settings.json` package discovery, preserving other packages and settings.
Pi installs missing packages on startup. Existing real files replaced by harness
links are backed up to `<path>.bak`.

Agent definitions from `assets/agents/` are linked into Pi's global agent
directory. Skills remain managed separately by the upstream-ai-sync flow.

## Versioning policy

Nothing updates silently.

- `.npmrc` sets `save-exact=true` — no `^` / `~` ranges.
- `pnpm-lock.yaml` is committed.
- `devDependencies` are pinned to exact versions (used for type-checking and
  editor tooling; at runtime Pi resolves modules itself).
- Pi packages in `~/.pi/agent/settings.json` are pinned with explicit versions
  so `pi update` skips them.

## Development

```bash
pnpm run check   # tsc --noEmit over all harness extensions
pnpm run test    # focused harness/package tests
```

## SDD testing flow

`/sdd-test` starts an independent SDD-testing/QA flow for a feature. It is not a
shortcut for development verification: development `/sdd-verify` remains separate
and continues to verify implementation work in the `sdd/...` namespace.

Quick path:

1. Run `/sdd-test <feature>` to start guided testing intake.
2. Approve or provide suites at the suites gate.
3. Continue through `sdd-explore-testing`, `sdd-plan-testing`, scoped
   `sdd-run-testing` shards, parent merge/latest, and `sdd-report-testing`.

Direct advanced commands are also registered when prerequisites already exist:
`/sdd-test-status`, `/sdd-explore-testing`, `/sdd-plan-testing`,
`/sdd-run-testing <feature> <session_id> <unit_id>`, and
`/sdd-report-testing`. Direct run-testing refuses missing or unsafe shard IDs.

First-slice testing modes stay visible even when a runtime is missing:

| Mode | Unsupported or blocked behavior |
| --- | --- |
| Playwright/browser | Mark unsupported or blocked when package, browsers, target URL, setup, or auth is missing. |
| Backend | Block only when no safe project command or environment is known. |
| API | Block when endpoint, auth, environment, or safe credentials are missing. |
| Live browser/no-code | Mark unsupported when no Pi browser bridge or real browser session is available. |
| Mobile/Maestro | Mark unsupported or blocked when Maestro, device, app target, or write approval is missing. |
| Visual diff | Report skipped or partial when reference or capture capability is missing; pixel diff never gates pass/fail. |

Testing artifacts use `testing/{project_slug}/{feature_slug}/...` keys and
matching Atlas logical paths. Engram is the source of truth for testing agents
and orchestrator recovery; Atlas is the approved human-readable documentation
mirror. Testing agents report findings and evidence only; remediation happens in
a separate development SDD flow.

## Subagent runtime

Pi Harness uses the official `pi-subagents-j0k3r@1.4.4` npm package through
native Pi package discovery. There is no `/agents` command or compatibility alias
in Pi Harness.

### Quick path

1. Run `/subagent-models` to edit model/effort profiles.
2. Run `/subagents` to open the UI for running tasks and task history.
3. Use `subagent_run` with `mode: "task"` for blocking work or `mode: "background"` for independent work.

The native task controls are:

- `subagent_list_agents` — list discovered agents.
- `subagent_run` — start task or background work.
- `subagent_continue` — continue an existing task.
- `subagent_status` and `subagent_result` — inspect progress and results.
- `subagent_list_tasks` — list task history.
- `subagent_cancel` — cancel running work.

Native model assignments use `model_profiles` in global or project
`subagents.json`. Agent definitions use the normal global and project discovery
locations for `.pi/agents` or `.pi/subagents`; Pi Harness links its definitions
into the global agent directory. The package owns the runtime, task UI, and
manager—Pi Harness does not add a wrapper, fallback, duplicate manager, or custom
subagent TUI.

## Runtime notes

- The default native `session_resources: lean` keeps nested prompts isolated and
  removes context/prompt lifecycle hooks while preserving allowlisted tools and safety hooks.
- `/btw` loads its model runtime only when invoked, sends no tools, and keeps the
  side-question transcript out of the main conversation.
- The vendored `pi-ask-user` extension exposes the upstream `ask_user` tool.
- Atlas+Engram remains the SDD persistence authority. Atlas writes require approval;
  OpenSpec/file-backed artifacts are opt-in only.

## Companion packages

Recommended companions, installed separately via `~/.pi/agent/settings.json`
(pinned):

- `pi-lens` — real-time LSP / lint / type-check feedback.
- `pi-ask-user` — vendored from `https://github.com/edlsh/pi-ask-user` for
  interactive decision prompts.

This repo does not bundle the other companion packages themselves.
