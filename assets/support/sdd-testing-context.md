# SDD Testing Context Support

Use this support guide to create or refresh repo-root testing context documents that SDD-testing agents can read. These files are optional inputs for the pipeline, but they make plans and reports more accurate.

## Contract

- Ask before creating or overwriting any repo file.
- Never overwrite existing context without a diff preview and explicit approval.
- Do not edit application source and do not remediate product defects.
- Keep development SDD separate from testing. Context files support `testing/{project_slug}/...` artifacts and do not change `sdd/{change}/...` state.
- Engram is the source of truth for agents/orchestrator recovery and reusable context. Atlas is the human-readable documentation mirror for generated setup/context artifacts when approved.

## Output files

| File | Required? | Purpose |
| --- | --- | --- |
| `TESTING_CONTEXT.md` | Always offer | Product/business context: rules, roles, constraints, design references, what counts as pass/fail. |
| `TESTING_SETUP.md` | Always offer | Technical setup: commands, auth/env names, environments, browsers/devices, Playwright/Maestro/API/backend setup, flaky areas. |
| `ARCHITECTURE.md` | Optional | System overview for testers and agents. |
| `GLOSSARY.md` | Optional | Domain terms, roles, and language for reports. |

`TESTING_CONTEXT.md` explains results. `TESTING_SETUP.md` explains how to run tests. Keep flaky runner/tooling notes in setup, not product context.

## Workflow

1. Check whether the four files exist at the repo root.
2. Summarize existing content before suggesting edits.
3. For missing required files, ask whether to generate them.
4. For optional files, ask whether the user wants them.
5. For existing files, prepare a diff preview before changes.
6. Leave placeholders for product details that cannot be inferred safely.
7. Persist a summary/pointer to Engram and Atlas when approved.

## What to auto-detect

For `TESTING_SETUP.md`, infer only safe technical facts:

- Package manager and scripts from manifests.
- Playwright config and existing browser tests.
- Backend/API test commands and framework hints.
- Maestro flow locations and device/app hints from existing config.
- Environment variable names from examples or docs, never values.
- Known local commands only when they already exist in repo files.

For `TESTING_CONTEXT.md`, do not invent product facts. Ask for or leave placeholders for:

- Business rules that affect pass/fail.
- Role/permission matrix.
- Non-production constraints.
- Supported browsers/devices as product commitments.
- Design references for visual diff.
- Edge cases that matter to users.

## Template: TESTING_CONTEXT.md

```markdown
# Testing Context

## Product summary
<what this product/feature does and who uses it>

## Roles and permissions
| Role | Can do | Cannot do |
| --- | --- | --- |
| <role> | <allowed behavior> | <restricted behavior> |

## Business rules that affect testing
- <rule and expected observable behavior>

## Known constraints and non-production gaps
- <constraint; how reports should interpret it>

## Design references
| Area | Reference | Notes |
| --- | --- | --- |
| <screen/flow> | <Figma/screenshot/URL> | <visual diff notes> |

## Out-of-scope for routine testing
- <behavior not covered unless explicitly requested>
```

## Template: TESTING_SETUP.md

```markdown
# Testing Setup

## Commands
| Mode | Command | Notes |
| --- | --- | --- |
| Playwright/browser | <command> | <config/browser notes> |
| Backend | <command> | <services/db notes> |
| API | <command or curl base> | <endpoint/auth notes> |
| Mobile/Maestro | <command> | <device/app target notes> |

## Environments and targets
- Local: <URL/app target>
- Preview/staging: <URL/app target>

## Authentication and credentials
- Required env vars: `<NAMES_ONLY>`
- Setup steps: <safe steps, no secret values>

## Test data
- <seed command or manual data requirements>

## Browser and device coverage
- Browsers: <chromium/firefox/webkit/Chrome live session>
- Devices: <Android/iOS/web targets>

## Visual diff
- Design references: <where to find them>
- Screenshot/capture guidance: <temporary/out-of-repo location>

## Known flaky areas
- <tooling/environment instability, not product defects>
```

## Persistence

When context files are created or materially refreshed, persist a setup/context summary:

- Atlas logical path: `testing/{project_slug}/setup-state.md` or the path requested by the active contract.
- Engram topic key: `testing/{project_slug}/setup-state`.
- Include file paths changed, approvals obtained, placeholders left for the user, and any unavailable mode that remains blocked or unsupported.
