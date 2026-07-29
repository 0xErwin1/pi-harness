## Harness Subagent Manager Runtime

The official `pi-subagents-j0k3r` package owns the subagent runtime. Pi Harness supplies agent definitions and routing policy only.

### Quick path

1. Choose the most specific agent role. Use `subagent_list_agents` when the available roster is unclear.
2. Call `subagent_run` with `agent`, `task`, and `mode`.
3. Use `mode: "task"` whenever the parent needs the result to continue routing.
4. Use `mode: "background"` only for genuinely independent work.
5. Use `/subagents` for the task/history UI; retrieve, continue, or cancel with the native task tools below.
6. Configure model/effort profiles with `/subagent-models`, not in a normal delegation payload.

### Native task controls

| Need | Native interface |
|------|------------------|
| Start work | `subagent_run` |
| Continue a task | `subagent_continue` |
| Check one task | `subagent_status` |
| Retrieve a result | `subagent_result` |
| List tasks | `subagent_list_tasks` |
| Cancel a task | `subagent_cancel` |
| Open task/history UI | `/subagents` |

Use `mode: "task"` for dependency work even if it may take time: the parent needs its result to continue routing. Use `mode: "background"` only when the parent can make progress independently. Background work must still be collected before its output is required. Respect the runtime's configured task and concurrency limits; do not assume fixed timeouts.

### Generic role selection

Generic subagents are every role that is not an SDD phase agent (`sdd-*`).

| Agent | Use for | Do not use for |
|-------|---------|----------------|
| `scout` | Fast codebase reconnaissance and compact handoff context. | Architecture decisions, edits, or final review. |
| `researcher` | External, web, or library research and evidence gathering. | Local code edits or repo-wide implementation. |
| `worker` | Bounded implementation after the parent selects scope and constraints. | Open-ended exploration or independent product decisions. |
| `reviewer` | Fresh-context review of plans, diffs, proposed fixes, or code health. | Writing the implementation it reviews. |
| `review-risk`, `review-readability`, `review-reliability`, `review-resilience` | Focused 4R review lenses. | General implementation or non-review tasks. |
| `jd-*` | Judgment Day blind review/fix workflows only. | Normal SDD phases or generic delegation. |

Routing rules:

1. Pick the most specific role; do not default to `worker` when `scout`, `researcher`, or a reviewer fits.
2. Preserve fixed SDD agent identities. Never route `proposal`, `spec`, `design`, `tasks`, `apply`, `verify`, `sync`, or `archive` work to a generic agent when an `sdd-*` agent exists.
3. Keep one writer thread. Do not run parallel writers unless isolated worktrees are explicitly approved.
4. Hydrate every worker prompt with exact files/areas, full requirements, edit permissions, acceptance criteria, verification commands, expected output, and memory instructions when applicable.
5. Do not paste the full parent prompt into child agents. Send the smallest complete handoff that lets the selected agent finish safely.

### Model and effort configuration

`/subagent-models` manages model/effort profiles through native `model_profiles` operator configuration. Do not invent launch-time model routing or include model selection in normal delegation. Select the agent role in `subagent_run`; leave model and effort assignment to the configured profile.

There is no fallback runtime, wrapper, alias, custom manager, or compatibility tool family. If a required native capability is unavailable, report the blocker rather than inventing alternate semantics.
