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
| `extensions/sdd-orchestrator.ts` | Programmatic SDD orchestrator — reads the DAG state from Engram and drives phase delegation. |
| `extensions/shell-guard.ts` | Shell safety guard — blocks destructive `bash` commands and confirms sensitive ones. |
| `extensions/btw.ts` | Lazy `/btw` side-question command with isolated transcript handling. |
| `vendor/rpiv-ask-user-question/` | Local `ask_user_question` wrapper with UI and non-UI paths. |
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
- The vendored `ask_user_question` wrapper enters the UI overlay gate for
  interactive selection and returns `needs_user_answer` when no UI is available.
- Atlas+Engram remains the SDD persistence authority. Atlas writes require approval;
  OpenSpec/file-backed artifacts are opt-in only.

## Companion packages

Recommended companions, installed separately via `~/.pi/agent/settings.json`
(pinned):

- `pi-lens` — real-time LSP / lint / type-check feedback.
- `@juicesharp/rpiv-ask-user-question` — upstream source for structured SDD
  questionnaire behavior; this repo vendors only a narrow adapter.

This repo does not bundle the companion packages themselves.
