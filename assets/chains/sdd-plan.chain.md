---
name: sdd-plan
description: Plan an SDD change through proposal, spec, design, and tasks.
---

## Persistence Contract

All SDD chain steps use Atlas as the default/new human-facing detailed artifact workspace and Engram as the mandatory agent memory/pointer store. Obsidian is explicit legacy/fallback only; file-backed/OpenSpec artifacts are explicit opt-in only. Phase outputs are logical artifacts at `sdd/<change>/<phase>.md` with Engram topic keys under `sdd/<change>/<phase>`. Atlas mutation requires discovery-first target resolution, compare-and-swap document writes, and explicit approval for human task/epic/subtask changes.

## sdd-init

output: init.md
outputMode: artifact-contract
progress: true

Initialize SDD context for {task} before planning. Detect the project stack and testing capabilities and persist them to Engram (topic_key `sdd-init/{project}`). If context already exists, read it and report the current SDD/testing configuration without blocking the chain.

## sdd-propose

reads: init.md
output: proposal.md
outputMode: artifact-contract
progress: true

Create or update the proposal for {task}. Use prior exploration if it is available in the project artifacts.

## sdd-spec

reads: proposal.md
output: spec.md
outputMode: artifact-contract
progress: true

Write delta specs for {task} using the proposal and previous output. Keep requirements and scenarios acceptance-focused.

## sdd-design

reads: proposal.md+spec.md
output: design.md
outputMode: artifact-contract
progress: true

Design the technical approach for {task}. Preserve native SDD orchestration intent and identify review/judgment risks.

## sdd-tasks

reads: proposal.md+spec.md+design.md
output: tasks.md
outputMode: artifact-contract
progress: true

Create reviewable strict-TDD implementation tasks for {task}. Include workload forecast and any required delivery decision.
