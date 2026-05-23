---
name: sdd-verify
description: Apply, verify, and optionally archive an already planned SDD change.
---

## sdd-init

output: init.md
outputMode: file-only
progress: true

Initialize SDD context for {task} before apply/verify. Detect the project stack and testing capabilities and persist them to Engram (topic_key `sdd-init/{project}`). If context already exists, read it and report the current SDD/testing configuration without blocking the chain.

## sdd-apply

reads: init.md
output: apply-progress.md
outputMode: file-only
progress: true

Implement pending approved tasks for {task}; update the tasks and apply-progress artifacts with strict TDD evidence.

## sdd-verify

reads: init.md+apply-progress.md
output: verify-report.md
outputMode: file-only
progress: true

Run focused and full verification for {task} using the apply-progress and project artifacts. Include review/judgment blockers.

## sdd-sync

reads: init.md+apply-progress.md+verify-report.md
output: sync-report.md
outputMode: file-only
progress: true

Sync {task} artifacts between Obsidian and Engram after verification. Do not create OpenSpec files unless explicitly requested.

## sdd-archive

reads: verify-report.md+sync-report.md
output: archive-report.md
outputMode: file-only
progress: true

Archive {task} only when verification succeeds and artifact sync is clean. If verification fails, leave artifacts active and report the blocker.
