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
| `vendor/pi-ask-user/` | Vendored upstream `ask_user` decision prompt extension. |
| `assets/orchestrator.md` | Parent-session orchestration contract. |

## Install

Delivery is by per-file symlink into the global Pi agent directory
(`~/.pi/agent/`). The repo owns harness files under `extensions/`, `packages/`,
`vendor/`, and `assets/`; `agents/` and `skills/` are managed separately by the
upstream-ai-sync flow.

```bash
pnpm install
pnpm run relink
```

`pnpm run relink` runs `scripts/link.sh`, which symlinks each file and backs up
any pre-existing real file to `<path>.bak`.

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

The active subagent runtime is the native vendored entrypoint at
`vendor/pi-subagents/src/index.ts`. It exposes the compatibility names existing
SDD flows use while preserving native controls:

- `Agent(subagent_type, prompt)`
- `get_subagent_result`
- `steer_subagent`
- `/agents` as the primary operator entrypoint

`/agents` can also open the model/thinking assignment flow. Assignments are
global, not per-project: global markdown-backed agents save `model:` and
`thinking:` directly into their agent `.md` frontmatter, while project-backed or
synthetic rows save to the global Pi agent config (`~/.pi/agent/subagents.json`
or `PI_CODING_AGENT_DIR/subagents.json`). The menu does not write project-local
`.pi/subagents.json` model assignments.

`steer_subagent` sends steering messages to running native subagent sessions.

## Runtime notes

- Named subagents receive isolated prompts: parent orchestration policy stays in
  the parent session instead of being injected into every child prompt.
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
