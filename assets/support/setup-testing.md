# Setup Testing Support

Use this support guide when a user asks to prepare testing prerequisites, or when SDD-testing reports missing Playwright, backend/API, live browser, Maestro/mobile, visual-diff, device, auth, or environment setup.

## Contract

- Discover first. Do not install, provision, download, accept licenses, create devices, or write repo files before explicit user approval.
- Stay system-agnostic across Linux, macOS, Windows, and WSL. Do not assume a package manager.
- Keep source safe. Do not edit application source or remediate product defects.
- Testing setup is independent from development SDD. Use `testing/{project_slug}/setup-state`, not `sdd/{change}/...`.
- Engram is the source of truth for agents/orchestrator recovery. Atlas is the human-readable documentation mirror for setup notes when approved.
- If Atlas is unavailable, return partial unless the active `TestingPersistenceContract` permits full-content Engram fallback. If Engram is unavailable, block.

## Discovery checklist

| Area | What to inspect | Degraded result |
| --- | --- | --- |
| Platform | OS, shell, WSL/container, available package managers. | Record unknowns; do not guess installers. |
| Repo hints | `TESTING_SETUP.md`, `TESTING_CONTEXT.md`, lockfiles, scripts, existing `.maestro/` flows, Playwright config. | Mark missing docs as setup gaps. |
| Playwright/browser | `@playwright/test`, config, browser binaries, target URLs, auth fixtures. | Mark browser testing blocked/unsupported until approved setup exists. |
| Backend | Safe project runner command, test database/service dependencies, env vars by name only. | Block backend mode when no safe command/environment is known. |
| API | Endpoint base URL, auth method, non-secret env names, seed/test data. | Block API mode when endpoint/auth/environment is missing. |
| Live browser/no-code | Pi browser bridge availability, Chrome/Chromium, real-session requirements. | Mark live mode unsupported when no bridge/session is available. |
| Mobile/Maestro | Maestro CLI/helpers, `.maestro/**/*.yaml`, devices/simulators/emulators, app ID/bundle/app path. | Block or mark unsupported when device/app target/tooling is absent. |
| Visual diff | Design reference source, screenshot/capture method, temporary evidence location. | Mark visual diff partial/skipped when reference or capture is absent. |

Never print secret values. Record only variable names and whether a value is present when that can be checked safely.

## User approval points

Ask before any of these actions:

- Installing packages or browser binaries.
- Downloading SDKs, accepting Android licenses, creating or booting emulators/simulators.
- Installing/upgrading Maestro or configuring runtime bridges.
- Using cloud devices or paid services.
- Writing repo files such as `TESTING_SETUP.md`, `TESTING_CONTEXT.md`, `.maestro/**/*.yaml`, Playwright specs, or runtime config.
- Running commands that mutate databases, queues, external state, or user accounts.

There is no default yes. If approval is not explicit, stop at discovery.

## Setup output shape

Report setup readiness by mode:

```markdown
# Testing Setup State

## Summary
- Project: <project_slug>
- Status: ready | partial | blocked
- Atlas logical path: testing/<project_slug>/setup-state.md
- Engram topic key: testing/<project_slug>/setup-state

## Mode readiness
| Mode | Status | Evidence | Next action |
| --- | --- | --- | --- |
| Playwright/browser | ready/blocked/unsupported | <package/config/browser evidence> | <action> |
| Backend | ready/blocked | <command/environment evidence> | <action> |
| API | ready/blocked | <endpoint/auth evidence> | <action> |
| Live browser/no-code | ready/unsupported | <bridge/session evidence> | <action> |
| Mobile/Maestro | ready/blocked/unsupported | <device/app/tool evidence> | <action> |
| Visual diff | ready/partial/skipped | <reference/capture evidence> | <action> |

## Approved changes performed
- <exact commands or files changed, if any>

## Manual actions remaining
- <credentials, devices, approvals, design references>
```

## Persistence

When setup state changes, persist the full setup artifact to Atlas at `testing/{project_slug}/setup-state.md` when approved. Save Engram with:

- title: `testing/{project_slug}/setup-state`
- topic_key: `testing/{project_slug}/setup-state`
- type: `config`
- project: project name from context

If setup was discovery-only and no changes were approved, still save the discovered state when persistence is available so future testing phases can degrade honestly.
