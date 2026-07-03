---
name: sdd-verify
description: Apply, verify, and optionally archive an already planned SDD change.
---

## Persistence Contract

All SDD chain steps use Atlas as the default/new human-facing detailed artifact workspace and Engram as the mandatory agent memory/pointer store. Obsidian is explicit legacy/fallback only; file-backed/OpenSpec artifacts are explicit opt-in only. Phase outputs are logical artifacts at `sdd/<change>/<phase>.md` with Engram topic keys under `sdd/<change>/<phase>`. Atlas mutation requires discovery-first target resolution, compare-and-swap document writes, and explicit approval for human task/epic/subtask changes.

## sdd-init

output: init.md
outputMode: artifact-contract
progress: true

Initialize SDD context for {task} before apply/verify. Detect the project stack and testing capabilities and persist them to Engram (topic_key `sdd-init/{project}`). If context already exists, read it and report the current SDD/testing configuration without blocking the chain.

## sdd-apply

reads: init.md
output: apply-progress.md
outputMode: artifact-contract
progress: true

Implement pending approved tasks for {task}; update the tasks and apply-progress artifacts with strict TDD evidence.

## sdd-verify

reads: init.md+apply-progress.md
output: verify-report.md
outputMode: artifact-contract
progress: true

Run focused and full verification for {task} using the apply-progress and project artifacts. Include review/judgment blockers.

## sdd-sync

reads: init.md+apply-progress.md+verify-report.md
output: sync-report.md
outputMode: artifact-contract
progress: true

Sync {task} artifacts between the selected human backend and Engram after verification. Use Atlas logical paths for the default human artifact backend, keep Engram topic-key pointers, and do not create OpenSpec files unless explicitly requested.

## sdd-archive

reads: verify-report.md+sync-report.md
output: archive-report.md
outputMode: artifact-contract
progress: true

Archive {task} only when verification succeeds and artifact sync is clean. If verification fails, leave artifacts active and report the blocker.
