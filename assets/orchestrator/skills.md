## Skill Registry Protocol

The parent resolves skills once per session or before first delegation:

1. Read `.agent/skill-registry.md` if present.
2. Match task context and target files against the `Trigger / description` column.
3. Pass only matching `Path` values to subagents under `## Skills to load before work`.
4. Tell subagents to read those exact `SKILL.md` files before reading, writing, reviewing, testing, or creating artifacts.
5. If the registry is absent, continue but mention that project-specific skill paths were unavailable.

Subagents should receive exact indexed paths. They should not have to rediscover the registry.

Important distinction: SDD subagents still use their assigned executor/phase skill when one exists (for example `sdd-apply`, `sdd-design`, or `sdd-verify`; `sdd-sync` is self-contained). What they should not do during normal runtime is independently discover additional project/user `SKILL.md` files or the registry. The parent passes selected project/user skill paths explicitly.

If a subagent reports `skill_resolution`, interpret it as project/user skill resolution:

- `paths-injected`: parent supplied `## Skills to load before work` with exact `SKILL.md` paths.
- `fallback-registry`: subagent self-loaded skill paths from the registry because parent paths were missing; degraded but auditable.
- `fallback-path`: subagent loaded explicit skill paths because parent paths were missing; degraded but auditable.
- `none`: no project/user skills were loaded.

If any subagent reports a fallback instead of `paths-injected`, treat it as an orchestration gap and correct future delegations by passing exact indexed paths directly.

### Mandatory writing skills

Comments and documentation are not freeform. Whenever you, or a subagent you launch, will write a comment (PR/issue/review comment, chat or async reply, support ticket, email) or any documentation (README, RFC, guide, onboarding, architecture doc, PR description), you MUST load the relevant writing skill:

- Comments -> `comment-writer`
- Documentation -> `cognitive-doc-design`

This is not optional and overrides the "lightweight, not hard routing" guidance below. It is also independent of registry matching: if the activity is writing a comment or a doc, the corresponding skill applies even when the registry returned no match for "comment" or "doc".

Applies in BOTH modes:
- **Delegating**: include the matching `SKILL.md` path in the subagent prompt under `## Skills to load before work`.
- **Writing directly (no subagent)**: YOU must read the matching `SKILL.md` yourself BEFORE drafting a single line. Self-check before any comment/doc output: "Did I load the writing skill this turn? If no, STOP and load it now." Do not rely on prior session memory of the skill -- read the file in the current turn.

Also pass the destination context (target repo/thread/channel and its primary language) so the writer applies the correct language: write in the destination's language, not the chat language -- English when the destination is primarily English, even if the user is talking to you in Spanish.

### Code comment hygiene

Code comments are not freeform either. Default to NO inline comments. Add one only when the WHY is non-obvious: a hidden constraint, a subtle invariant, a workaround for a specific bug, or behavior that would surprise a reader. If deleting the comment would not confuse a future reader, do not write it. Function-level documentation (intent, invariants, assumptions, side effects) is allowed and preferred over inline statement comments. Never write comments that restate what the code does, and never reference the current task, fix, PR, or ticket.

This applies whether you write code inline or delegate it. Pi subagents (workers, sdd-apply, executors) are self-sufficient and do NOT load this orchestrator file or any CLAUDE.md/AGENTS.md, so they will not follow this rule unless you state it in the subagent prompt. When delegating any code-writing task, include this rule.

## Intent-Driven Skill Discovery

For skill-shaped requests, do not treat injected `<available_skills>` as complete. Use the registry and filesystem only as a discovery aid; do not let a trigger table override the user's concrete request or turn a small request into a larger workflow.

Discovery order:

1. Read `.agent/skill-registry.md` when present.
2. If the registry suggests a specific skill, load the indexed `SKILL.md` path before acting.
3. If the expected skill is absent from the registry but the request clearly names a known workflow, search common project/user skill dirs such as `./skills`, `.pi/skills`, `.agents/skills`, `~/.config/opencode/skills`, `~/.claude/skills`, and other configured skill roots.
4. Prefer the most specific project skill over a global skill with the same intent.
5. If no matching skill exists, continue with the smallest safe fallback and say which expected skill was unavailable.

Common intent hints, not hard routing:

| User intent                | Skill to check                         |
| -------------------------- | -------------------------------------- |
| PR review / GitHub PR URL  | project review skill, then `pr-review` |
| Post-ready review comments | `comment-writer`                       |
| Create/open/prepare PR     | `branch-pr`                            |
| Split/stack/large PR       | `chained-pr`                           |

Keep this lightweight: loading a skill should improve the immediate task, not force extra ceremony.

