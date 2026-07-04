# rpiv-ask-user-question adapter

This directory contains a minimal Pi Harness-compatible adaptation of `rpiv-ask-user-question`.

## Provenance

| Field | Value |
| --- | --- |
| Upstream | `https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question` |
| Inspection date | 2026-07-04 |
| Local scope | Narrow wrapper for `ask_user_question` registration, overlay-gate bracketing, and non-UI fallback. |

## Local behavior

- Enters the shared overlay gate before interactive selection and exits it in `finally`.
- Returns `needs_user_answer` when UI is unavailable instead of hanging.
- Keeps the adapter intentionally small; upstream's full TUI questionnaire is not vendored here.
