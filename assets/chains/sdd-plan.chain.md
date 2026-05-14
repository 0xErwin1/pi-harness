---
name: sdd-plan
description: Plan an SDD change through proposal, spec, design, and tasks.
---

## sdd-init

output: init.md
outputMode: file-only
progress: true

Initialize SDD context for {task} before planning. Detect the project stack and testing capabilities and persist them to Engram (topic_key `sdd-init/{project}`). If context already exists, read it and report the current SDD/testing configuration without blocking the chain.

## sdd-propose

reads: init.md
output: proposal.md
outputMode: file-only
progress: true

Create or update the proposal for {task}. Use prior exploration if it is available in the project artifacts.

## sdd-spec

reads: proposal.md
output: spec.md
outputMode: file-only
progress: true

Write delta specs for {task} using the proposal and previous output. Keep requirements and scenarios acceptance-focused.

## sdd-design

reads: proposal.md+spec.md
output: design.md
outputMode: file-only
progress: true

Design the technical approach for {task}. Preserve native SDD orchestration intent and identify review/judgment risks.

## sdd-tasks

reads: proposal.md+spec.md+design.md
output: tasks.md
outputMode: file-only
progress: true

Create reviewable strict-TDD implementation tasks for {task}. Include workload forecast and any required delivery decision.
