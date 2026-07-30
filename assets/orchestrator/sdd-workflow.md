## SDD Workflow (Spec-Driven Development)

### Scope Proportionality (MANDATORY)

The spec and design MUST be proportional to the request. Do NOT expand a bounded feature into infrastructure the user did not ask for. Adding a background reconciler, retention/pruning jobs, idempotency-token schemes, distributed lifecycle/state machines, tombstoning ledgers, or exactly-once guarantees to a simple feature ("attach a file to a comment", "add a filter", "show a badge") is over-engineering and is banned unless the requirement explicitly calls for that guarantee or the user asks for it.

Pick the smallest design that satisfies the stated requirement. Surface any heavier option as an explicit "do you also want X?" question instead of silently building it. Forward this rule in every `sdd-propose` and `sdd-design` launch prompt.

A right-sized spec is the single biggest lever on delivery time: an inflated spec generates real-but-unrequested work — extra tasks, extra review findings, extra test surface — that no downstream guardrail can shrink after the fact.

### Phase Graph

```text
explore → propose → [user approval] → spec + design → tasks → [user approval] → apply → verify → sync → archive
```

Dependency graph:

```text
proposal → spec ─┬→ tasks → apply → verify → sync → archive
proposal → design ┘
```

### When to run each phase

Run phases in order. After **propose** and after **tasks**, pause and ask the user whether to continue. The user may redirect, adjust scope, or approve as-is. Never skip approval gates.

### How to execute phases

Call the `subagent` tool with the appropriate agent. Phase agents read their assigned SKILL.md when one exists; `sdd-sync` is self-contained for Pi Harness artifact reconciliation. You do not need to inject phase-skill instructions, just provide context.

Launch SDD phases that feed orchestration continuation in task/result mode, not background mode. Background completion is a notification/history mechanism and is not a guarantee that the parent will resume routing from the phase result.

Minimal task context to include in every phase call:

- Change name (a short slug, e.g. `oauth-login`)
- Project name (basename of cwd)
- Working directory (absolute path)
- Engram topic_keys of dependency artifacts (the sub-agent retrieves them via the injected Engram memory read tools)

Example for the explore phase:

```text
subagent(
  agent: "sdd-explore",
  task: |
    Change: oauth-login
    Project: myapp
    CWD: /home/user/dev/myapp

    The user wants to add OAuth login via GitHub. Investigate the current auth system,
    identify integration points, compare approaches, assess risks.

    Save your artifact to engram with topic_key "sdd/oauth-login/explore" and project "myapp".
)
```

### Artifact convention

| Phase         | Agent         | Topic key                        |
|---------------|---------------|----------------------------------|
| Exploration   | sdd-explore   | `sdd/{change}/explore`           |
| Proposal      | sdd-propose   | `sdd/{change}/proposal`          |
| Spec          | sdd-spec      | `sdd/{change}/spec`              |
| Design        | sdd-design    | `sdd/{change}/design`            |
| Tasks         | sdd-tasks     | `sdd/{change}/tasks`             |
| Apply         | sdd-apply     | `sdd/{change}/apply-progress`    |
| Verify        | sdd-verify    | `sdd/{change}/verify-report`     |
| Sync          | sdd-sync      | `sdd/{change}/sync-report`       |
| Archive       | sdd-archive   | `sdd/{change}/archive-report`    |

Project name for engram = `basename(cwd)` unless the user specifies otherwise.

### Parallel phases

Spec and design have no dependency on each other — run them in parallel:

```text
subagent(tasks: [
  { agent: "sdd-spec",   task: "..." },
  { agent: "sdd-design", task: "..." }
])
```

### Apply in batches

For large task lists, apply in batches. Each batch must read the existing `apply-progress` artifact, merge progress, and save the combined result back. Tell the sub-agent explicitly: "Read existing apply-progress first, merge your progress, save combined result."

### Verify and sync after apply

Always run `sdd-verify` after apply completes. Do not wait for the user to ask.

After a successful verification, run `sdd-sync` before `sdd-archive` when a change will continue across agents or sessions. In Pi Harness, sync reconciles selected-backend full human artifacts with Engram summaries/pointers; it does not create or merge OpenSpec files unless the user explicitly requested a file-backed exception.

### Apply Scope Contract (MANDATORY)

Every `sdd-apply` launch — batched or not — MUST pin the executor to an exclusive scope. The executor does not read this orchestrator file; without an explicit scope in its launch prompt it will drift past the work you intended — implementing later batches, running unsupervised for hours, and reporting work it did not actually do.

When launching `sdd-apply`, enumerate the EXACT assigned task IDs in the prompt (e.g. "Implement ONLY WU-0: T01-T04") and state explicitly: implement only these, then STOP and return; do NOT proceed to any other task, work unit, or batch. Pass artifact-store mode and the apply-progress merge instruction (see **Apply in batches**).

After `sdd-apply` returns, BEFORE launching the next batch or trusting the report, verify the executor stayed within the assigned scope using git status and git diff, changed files, the tasks artifact, and apply-progress—not the executor's prose. If the report conflicts with that evidence, treat it as unreliable and reconcile from the repository and active artifact backends. If apply overran its scope, STOP—do not launch further batches on top of an unsupervised overrun; surface the real state to the user.

Defense in depth: the executor has its own hard boundary (the `sdd-apply` skill's **Assigned Scope — HARD BOUNDARY**), and the orchestrator independently scopes each launch and checks the result.

### Visual-Aware Apply Split (local policy, MANDATORY)

Weaker models tend to produce weak visual/UI design. So when a change involves design work, the orchestrator isolates that work into its own apply launched with the strongest design-capable model this runtime offers — the same tier used for the design/architecture phases. Purely non-visual slices use the normal apply model.

Before launching the first `sdd-apply`, classify each task as **visual/design** (acceptance is "looks right": UI layout, styling/CSS, component visual design, spacing/typography/color, responsive behavior, matching a design reference, animations/transitions) or **non-visual** (acceptance is "behaves right": business logic, data layer, API/handlers, state, tests, config, build, infra).

If there are **no** visual/design tasks, run apply normally. If there **are**, split apply into sequential slices that preserve the original task order and dependencies, alternating by class: non-visual up to the first visual task (normal model) → contiguous visual/design tasks (strongest design model) → remaining non-visual (normal model); more slices if they interleave. The invariant is absolute: **every slice that contains design/visual work uses the strongest design-capable model; every purely non-visual slice uses the normal apply model.** Collapse empty slices. Each slice merges `apply-progress` as in **Apply in batches**. Verify once, after the last slice.

### Batched Apply-Verify Cycles (local policy)

Batching protects executor context and task dependencies. Use it only when the approved task set cannot fit safely in one executor context or dependency boundaries require independent verification.

**Plan.** Group approved tasks into ordered, self-contained batches along task dependencies and executor-context boundaries. Preserve task order and make every batch independently verifiable. In interactive mode, show the execution plan and wait for approval; in automatic mode, report the plan before proceeding.

**Cycle.** For each batch in order: (1) launch `sdd-apply` scoped to that batch only—every batch after the first merges `apply-progress` as in **Apply in batches**; (2) run `sdd-verify` scoped to that batch, treating later-batch tasks as `pending` rather than failures; (3) report a concise checkpoint with the completed scope, verify verdict, and next batch; (4) if verification reports a genuine BLOCKER/CRITICAL issue, STOP and remediate within that batch before continuing. A WARNING/SUGGESTION is logged without stopping the sequence, and a cross-batch design gap is surfaced as a scope decision rather than resetting to an upstream phase. After the last batch, run a final consolidated verify, then `sdd-sync`/`sdd-archive` as usual.

**Composition.** The **Visual-Aware Apply Split** still selects the model for each slice. Batching controls executor inputs, task dependencies, and verification checkpoints only.

## SDD Status Contract

`/sdd-status [change]` is the read-only status action for resolving the active change, artifact paths, task progress, dependency readiness, and action context before apply/verify/sync/archive.

Before `/sdd-continue`, `sdd-apply`, `sdd-verify`, `sdd-sync`, or `sdd-archive`, resolve and carry structured status. Lookup order: parent-provided status, then project override `.pi/gentle-ai/support/sdd-status-contract.md`, then globally installed `~/.pi/agent/gentle-ai/support/sdd-status-contract.md`, then the embedded `sdd-status` prompt contract. Do not use `assets/support/...` as a runtime path; that is only the package source path before installation.

Route only by `nextRecommended` and the dependency states; never infer routing from free text. Do not guess the active change — if change selection is ambiguous, ask the user and stop. If `actionContext.mode: workspace-planning` and no allowed edit roots are provided, stop before apply/verify/sync/archive and ask for an explicit implementation/edit scope. Carry `contextFiles`, task progress, dependency states, and `actionContext` into every subagent launch.

- `sdd-archive` cannot proceed unless status says `dependencies.archive` is `ready` or `all_done` — UNLESS the store carve-out is active (`nextRecommended: "resolve-via-engram"`), in which case resolve archive readiness from Engram instead of treating `not_applicable` as a gate failure.
- **Non-authoritative store carve-out:** when `nextRecommended: "resolve-via-engram"` is set, native status is **not authoritative**. This applies to `artifactStore: engram`, `artifactStore: none`, and `artifactStore: both` when the `openspec/` directory does not exist. For non-authoritative stores: resolve readiness from Engram using the Engram memory tools injected by the memory provider on the change topic keys (`sdd/{change-name}/proposal`, `sdd/{change-name}/spec`, `sdd/{change-name}/design`, `sdd/{change-name}/tasks`, etc.). Do **not** treat `blockedReasons` or `not_applicable` dependency states from the native engine as real blockers when the store carve-out is active.

## Execution Mode

For substantial SDD flows, choose or ask once per change:

- `interactive`: default — pause between major phases and ask whether to continue.
- `auto`: run phases back-to-back when the user explicitly wants speed and trusts the flow. Phases still run without interrupting the user, BUT the orchestrator runs the gatekeeper validation (below) after every phase before launching the next subagent — the user is interrupted only when the gatekeeper catches a real problem.

In interactive mode, between phases:

1. show concise phase result;
2. state next phase;
3. ask whether to continue or adjust.

Interactive approval is phase-scoped. A user reply such as "continue", "dale", or "go on" approves only the immediate next phase, not the rest of the SDD pipeline. Do not treat a generated artifact as approved until the user has had a chance to review it or explicitly delegate that review.

Before the propose phase in interactive mode, offer the user a proposal question round instead of silently deciding whether the proposal is clear enough. Explain that the questions exist to improve the proposal by uncovering business understanding, business rules, implications, impact, edge cases, and product tradeoffs. Prefer 3-5 concrete product questions per round, then summarize the resulting assumptions and ask whether the user wants to correct anything or run a second round. Cover business and product decisions: business problem, target users and situations, business rules, product outcome, current-state gap, implications and impact, edge cases, decision gaps, first-slice scope boundaries, non-goals, product constraints, and business tradeoffs. Do not ask about test commands, PR shape, changed-line budget, or other harness mechanics at proposal time unless the user explicitly asks to discuss delivery.

### Automatic Mode Gatekeeper

In `auto` mode the orchestrator is the gatekeeper between phases. When a delegated phase returns and BEFORE launching the next subagent, validate that the phase reached its objective with everything in order. This is autonomous validation — it does NOT ask the user (that is interactive mode); it surfaces only when it catches a problem.

Check every phase against the Result Contract:

- **Contract conformance**: the phase returned the expected fields and `status` indicates success, not partial/failed/blocked.
- **Artifact existence**: the declared artifact actually exists and is readable in the active backend — read it back (Engram: use the injected Engram memory read tools on the topic key; Atlas: use the declared document pointer/logical path after discovery; Obsidian/file: only when explicitly selected by the active contract). A phase that reports success but produced no retrievable artifact FAILS the gate.
- **No hallucination**: spot-check the concrete file paths, symbols, commands, or artifacts the phase claims it created or referenced; a path that does not resolve FAILS the gate.
- **No drift from inputs**: output stays consistent with the phase's required inputs per the dependency graph — spec within proposal scope, design answers the proposal, tasks cover spec and design, apply implements the tasks. Invented requirements, scope creep, or dropped requirements FAIL the gate.
- **Routing coherence**: the recommended next action follows the dependency graph and risks are within tolerance (no unaddressed CRITICAL).

Perform these checks inline from the phase result, persisted artifacts, and repository evidence where applicable. This gatekeeper validates conformance and does not launch review.

On PASS, continue automatically. On FAIL, re-run the same phase exactly once with corrective feedback naming the specific failures, then re-gate; if it fails again, STOP the automatic chain and report the phase, what was caught, both attempts, and the recommended fix. Do not advance dependent phases on a failed gate.

**Gate severity floor & precision (anti-thrash).** A gate FAIL is triggered ONLY by a structural failure listed above (contract non-conformance, missing/unreadable artifact, hallucinated path, real drift from inputs, or an unaddressed BLOCKER/CRITICAL) that you would defend with concrete evidence. A WARNING/SUGGESTION or a stylistic nit (a naming choice, a single HTTP status code, a phrasing preference, an unproven edge case) is recorded as `info` and NEVER fails the gate, re-runs a phase, or resets to an upstream planning phase — carry it as a non-blocking follow-up. The single allowed re-run is spent only on a genuine defect. Once a contract decision is frozen by a passed gate or by the user, a later gate does not re-open it; surface a real invalidation as a scope decision instead of looping back through design.

## Strict TDD Forwarding

For `sdd-apply` and `sdd-verify`, search Engram for the project context at topic_key `sdd-init/{project}`.

If it declares strict TDD and a test command, include a non-negotiable instruction in the phase prompt:

```text
STRICT TDD MODE IS ACTIVE. Test runner: <command>. Follow RED, GREEN, TRIANGULATE, REFACTOR. Record evidence.
```

Do not rely on the child agent to discover this independently.

