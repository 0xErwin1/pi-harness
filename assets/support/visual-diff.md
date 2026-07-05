# Visual Diff Support

Use this support guide inside `sdd-run-testing` when a browser or mobile test case has `visual diff: yes` and a design reference is available.

## Contract

- Visual diff is a structured human-readable checklist, not pixel-perfect gating.
- Pixel screenshots are informative evidence only. They must not decide pass/fail by themselves.
- Apply visual diff only to browser/mobile surfaces: Playwright/browser, live browser/no-code, or mobile/Maestro.
- Do not edit application source, design assets, or product code. Report findings only.
- Store screenshots or temporary captures outside the repo unless the active testing persona and user approval explicitly permit a repo artifact.
- Persist the checklist in the run artifact. Engram is the source of truth for agents/orchestrator recovery; Atlas is the human-readable documentation mirror.

## Supported engines

| Engine/persona | Capture method | Notes |
| --- | --- | --- |
| Playwright/browser | Browser CLI/API screenshots and computed styles. | Best for repeatable cross-browser visual checks. |
| Live browser/no-code | Pi browser bridge/real Chrome session evidence. | Chrome-only, good for real-session state and observed checks. |
| Mobile/Maestro | Maestro screenshots and hierarchy when available. | Best for native, hybrid, device-first, or approved web/Chromium flows. |

If the selected engine is unavailable, mark the visual case `unsupported` or `blocked`. Do not switch engines silently.

## Design references

A valid reference can be:

- Figma frame or node URL.
- Zeplin, Adobe XD, Sketch Cloud, or similar inspectable URL.
- Screenshot or image file.
- Renderable reference URL.
- Product-approved description with explicit visual requirements.

If no reference is accessible, mark visual diff `skip` or `partial` and state what was missing.

## Checklist method

### 1. Extract expected design properties

Use the best available method for the reference. Capture only properties that can be inspected reliably:

- Typography: font family, size, weight, line height.
- Colors: text, fill, stroke, background, brand actions.
- Spacing: padding, margin, gap for key containers.
- Layout: alignment, direction, grid/column structure, responsive breakpoints when relevant.
- Hierarchy: modal stacking, primary/secondary actions, key content order.

Skip highly dynamic content, generated avatars, dates, user data, animation timing, shadows/blur precision, and exact pixel positions unless the design explicitly requires them.

### 2. Capture observed implementation

Use the selected engine only:

- Playwright/browser: capture screenshots and computed styles through the project Playwright setup.
- Live browser/no-code: inspect the real Chrome session through the available Pi browser bridge; do not create Playwright specs.
- Mobile/Maestro: capture screenshots/hierarchy from the selected device or web target.

Save evidence outside the repo, for example `/tmp/sdd-testing/{project_slug}/{feature_slug}/screenshots/`, unless the active contract says otherwise.

### 3. Compare with a table

```markdown
## Visual Diff Checklist

Reference: <Figma/screenshot/URL>
Surface: <browser/device>
Engine: <playwright | chrome-extension | maestro>

| Item | Expected | Observed | Result | Notes |
| --- | --- | --- | --- | --- |
| Primary button color | <token/hex> | <observed> | pass/fail/skip | <short evidence> |
| Heading type scale | <size/weight> | <observed> | pass/fail/skip | <short evidence> |
| Form spacing | <gap/padding> | <observed> | pass/fail/skip | <short evidence> |
```

Result semantics:

- `pass`: observed property matches the design expectation within reasonable implementation tolerance.
- `fail`: observed property clearly contradicts the design expectation.
- `skip`: property could not be inspected or did not apply to the current state.

### 4. Decide case outcome

- Visual checklist all non-skip `pass` → visual component of the case passes.
- Any checklist `fail` → visual component of the case fails.
- Only skipped or insufficient evidence → visual component is partial/skipped; do not fail the whole product flow solely because the design reference was missing.

## Run artifact snippet

```markdown
### Visual diff: <TC-ID>

- Reference: <source>
- Evidence: <screenshot/hierarchy/temp path or attachment reference>
- Verdict: pass | fail | partial | skipped

| Item | Expected | Observed | Result | Notes |
| --- | --- | --- | --- | --- |
| <property> | <expected> | <observed> | <result> | <note> |
```

## Persistence note

Include the visual checklist in the `testing/{project_slug}/{feature_slug}/run/{session_id}/{unit_id}` artifact. When screenshots are stored outside the repo, include paths or attachment references but do not assume they are permanent unless Atlas/Engram attachment support confirms it.
