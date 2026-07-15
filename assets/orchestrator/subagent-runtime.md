## Harness Subagent Manager Runtime

The harness owns the `subagent` tool. Do not depend on `pi-subagents` or route
delegation to a package fallback.

Runtime modes from `.pi/settings.json`:

- `manager` — default. Route all compatible delegation through the harness-owned
  manager.
- `hybrid` — reserved for provider experiments inside the harness manager.

Manager-runtime rules:

1. Preserve fixed SDD agent identities when routing SDD phases.
2. If status/interrupt/doctor or payload translation is unsupported, report the
   unsupported manager capability explicitly and adjust the delegation request.
3. Do not silently fall back to another package or invent partial semantics.
4. Keep unsupported payload failures actionable so the parent can choose a
   supported manager workflow.

### Generic Subagents (non-SDD)

Generic subagents are every role that is not an SDD phase agent (`sdd-*`). The default generic roster is:

| Agent | Use for | Do not use for |
|-------|---------|----------------|
| `scout` | Fast codebase reconnaissance, locating files/symbols, producing compact handoff context. | Architecture decisions, edits, or final review. |
| `researcher` | External/web/library research and evidence gathering. | Local code edits or repo-wide implementation. |
| `worker` | Bounded implementation work after the parent has selected scope and constraints. | Open-ended exploration or independent product decisions. |
| `reviewer` | Fresh-context review of plans, diffs, proposed fixes, or overall code health. | Writing the implementation it reviews. |
| `review-risk`, `review-readability`, `review-reliability`, `review-resilience` | Focused 4R review lenses. | General implementation or non-review tasks. |
| `jd-*` | Judgment Day blind review/fix workflows only. | Normal SDD phases or generic delegation. |

Generic routing rules:

1. Pick the most specific generic role; do not default to `worker` or `general-purpose` when `scout`, `researcher`, or `reviewer` fits.
2. The parent owns scope selection. Generic prompts must include exact files/areas, expected output, whether edits are allowed, and memory-write instructions when applicable.
3. Do not paste the full parent prompt into child agents. Send the smallest hydrated handoff that lets the chosen agent do its job, then rely on the agent's own compact completion contract.
4. Generic agents are not SDD phase executors. Never route `proposal`, `spec`, `design`, `tasks`, `apply`, `verify`, `sync`, or `archive` phase work to generic agents when an `sdd-*` phase agent exists.
5. Generic agents may run in background for independent work. If you need their result before proceeding, wait for or retrieve the result explicitly and summarize it for the user.

### Generic Subagent Model Routing

For generic subagents (`scout`, `researcher`, `reviewer`, `worker`, `review-*`, `jd-*`, and any non-SDD role), do NOT pass a `model` override when launching. Model and thinking assignments are global operator configuration managed through `/agents` and persisted in global agent state/frontmatter; they are not per-project and should not be overridden in ordinary prompts. The SDD model pins declared in `sdd-*` frontmatter apply only to SDD phase agents. Pass `model` for a generic subagent only when the user explicitly requests an override for that specific launch.

