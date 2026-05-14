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
| `extensions/` (planned) | Shell safety guards, skill registry, SDD init detection, harness core. |
| `assets/chains/` (planned) | SDD phase chains. |
| `assets/orchestrator.md` (planned) | Parent-session orchestration contract. |

## Install

Delivery is by per-file symlink into the global Pi agent directory
(`~/.pi/agent/`). The repo owns `extensions/` and `assets/chains/` only;
`agents/` and `skills/` are managed separately by the upstream-ai-sync flow.

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
pnpm check   # type-check all extensions
```

## Companion packages

Only `pi-subagents` is a hard dependency of this harness. Recommended
companions, installed separately via `~/.pi/agent/settings.json` (pinned):

- `pi-subagents` — subagent delegation (required).
- `pi-lens` — real-time LSP / lint / type-check feedback.
- `@juicesharp/rpiv-ask-user-question` — structured questionnaires for SDD
  approval gates.

This repo does not bundle them.
