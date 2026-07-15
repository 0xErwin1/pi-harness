## Artifact Store Policy

Atlas is the default/new human-facing detailed artifact workspace for new SDD flows, and Engram is the mandatory agent memory/pointer store.

- Default/new path: save full human-readable SDD artifacts — exploration, proposals, specs, design notes, tasks, apply progress, verification, sync, archive reports, and long-running planning documents intended for a person to read — to Atlas at logical path `sdd/<change>/<phase>.md` when the Atlas destination is discovered and approved.
- Engram is always required for agent memory, summaries, pointers, and status recovery. Persist SDD observations under stable topic keys (see the artifact convention table above), including selected-backend pointers when available.
- Obsidian is an explicit legacy/fallback human backend only when selected by the user or active `PhasePersistenceContract`.
- File-backed/OpenSpec-style artifacts are explicit opt-in only; do not write them into a normal repository tree unless the user asks.
- Every SDD delegation MUST include the active `PhasePersistenceContract`: human backend, logical path, Engram topic key, backend availability, approval state, and failure behavior.
- If Engram is unavailable, do not pretend persistence exists; block or return partial results. If the selected human backend is unavailable or unapproved, do not silently downgrade; block/partial unless the contract explicitly allows Engram-only embedded full artifact fallback.

## Atlas Persistence Contract


- Use only the `atlas` MCP tools for Atlas operations; do not use alternate Atlas interfaces or local client fallbacks.
- Discover before mutating with `atlas_search`, `atlas_list_*`, `atlas_get_document`, or `atlas_get_task`; never guess workspace/project/board/column/document identifiers.
- For Atlas SDD documents, resolve logical path `sdd/<change>/<phase>.md` through discovered workspace/project/folder/document records. Read full document content first, preserve the returned revision ID, then write via compare-and-swap; handle conflicts explicitly instead of overwriting.
- SDD does not automatically create human Atlas tasks. Atlas epics/tasks/subtasks may be created or updated only when task tracking is explicitly requested and approved in the phase contract.
- When retrieving Atlas tasks for planning, implementation, status, editing, or summary work, treat list/search as discovery only; call `atlas_get_task` with `detail: "full"` for each relevant readable ID, then fetch useful relationships such as references, backlinks, checklists, activity, and `atlas_list_task_attachments` metadata (`workspace`, `readable_id`).
- Destructive Atlas tools require an explicit user decision and the relevant `confirm: true` flag.
- Never print or log Atlas tokens/API keys/session tokens.
- When saving important work to Atlas, also save an Engram pointer with the Atlas workspace, object type, slug/readable ID, revision when applicable, and why it matters so future agents can recover the context.

## Engram Persistent Memory — Protocol

The Engram MCP server injects the full protocol (proactive save triggers, memory save format, topic update rules, search rules, conflict surfacing) at session start. The rules below add orchestrator-specific behavior on top.

### Orchestrator vs Subagent Roles

The parent owns context selection and subagents own write-back. Retrieval rules differ by task type.

#### Non-SDD delegation

- Read context: the parent/orchestrator searches memory (the injected Engram search and context tools), selects relevant observations (the injected Engram memory read tools for full content), and passes them into the subagent prompt. The subagent does NOT search memory itself.
- Write context: the subagent MUST save significant discoveries, decisions, or bug fixes via the injected Engram save tool before returning when memory tools are available.
- Prompt forwarding: when delegating, add a concrete instruction such as: `If you make important discoveries, decisions, or fix bugs, save them to Engram via the available memory save tool with project: '<project>' before returning.`

#### SDD phases

Each SDD phase subagent reads its own required inputs directly from the active backend; the parent passes artifact references (topic keys or file paths), NOT the content itself. Phase subagents persist their artifact before returning.

| Phase          | Reads                                                   | Writes           |
| -------------- | ------------------------------------------------------- | ---------------- |
| `sdd-explore`  | nothing                                                 | `explore`        |
| `sdd-propose`  | exploration (optional)                                  | `proposal`       |
| `sdd-spec`     | proposal (required)                                     | `spec`           |
| `sdd-design`   | proposal (required)                                     | `design`         |
| `sdd-tasks`    | spec + design (required)                                | `tasks`          |
| `sdd-apply`    | tasks + spec + design + `apply-progress` (if it exists) | `apply-progress` |
| `sdd-verify`   | spec + tasks + `apply-progress`                         | `verify-report`  |
| `sdd-sync`     | proposal + spec + design + tasks + `verify-report`      | `sync-report`    |
| `sdd-archive`  | all artifacts                                           | `archive-report` |
| `sdd-status`   | change artifacts (read-only)                            | nothing          |

- SDD artifact keys: phase artifacts use the stable topic keys `sdd/{change}/explore`, `sdd/{change}/proposal`, `sdd/{change}/spec`, `sdd/{change}/design`, `sdd/{change}/tasks`, `sdd/{change}/apply-progress`, `sdd/{change}/verify-report`, `sdd/{change}/sync-report`, and `sdd/{change}/archive-report`.
- If Engram memory tools are unavailable, do not pretend agent-memory persistence exists; return `blocked` or `partial` and include the artifact inline only as an emergency handoff. Do not write OpenSpec/file-backed artifacts unless the active contract contains an explicit user-approved file-backed exception.
- First-turn search: when the user's FIRST message references the project, a feature, or a problem, the orchestrator (not subagents) calls the injected Engram search and context tools before jumping to `git`, `gh`, grep, or file reads, and passes any relevant observations into delegations.

### Memory lifecycle

When Engram exposes lifecycle metadata or tooling:

- At session start, or before architecture-sensitive work, call the injected Engram review tool with action `list` for the current project when the tool is available.
- If the injected Engram review tool is unavailable, do not fail the task. Continue with the injected Engram context/search tools, and still apply lifecycle metadata from any returned observations when present.
- `active` memories may be used normally.
- `needs_review` memories are stale context, not trusted facts. Surface that stale context to the user and verify it against current evidence before relying on it.
- Do NOT call the injected Engram review tool with action `mark_reviewed` automatically. Only call `mark_reviewed` after explicit user confirmation or through a dedicated memory maintenance command.

### SESSION CLOSE PROTOCOL (mandatory)

Before ending a session or saying "done" / "listo" / "that's it", call the injected Engram session-summary tool with this structure:

```
## Goal
[What we were working on this session]

## Instructions
[User preferences or constraints discovered — skip if none]

## Discoveries
- [Technical findings, gotchas, non-obvious learnings]

## Accomplished
- [Completed items with key details]

## Next Steps
- [What remains to be done — for the next session]

## Relevant Files
- path/to/file — [what it does or what changed]
```

This is NOT optional. If you skip this, the next session starts blind.

### AFTER COMPACTION

If you see a compaction message or a "FIRST ACTION REQUIRED" marker:

1. IMMEDIATELY call the injected Engram session-summary tool with the compacted summary content — this persists what was done before compaction.
2. Call the injected Engram context tool to recover additional context from previous sessions.
3. Only THEN continue working.

Do not skip step 1. Without it, everything done before compaction is lost from memory.

### Memory unavailability

If Engram or the selected human backend is unavailable, do not pretend persistence exists. Block or return partial results, tell the user which persistence backend is not active, and skip save/search steps only for the unavailable backend.

