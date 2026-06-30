# Vendored: pi-tool-renderer

This directory is a vendored copy of a single extension from a third-party monorepo.

- **Source repo:** https://github.com/vanillagreencom/vstack
- **Extension path:** `pi-extensions/pi-tool-renderer`
- **Package:** `@vanillagreen/pi-tool-renderer`
- **Upstream commit:** `5590d31b1a43cbc16c568ac3dcef4c18100b0d2e`
- **License:** MIT
- **Author:** vanillagreen

vstack is a large monorepo (a Rust CLI, theme/icon sets, iced-rs examples, and many
Pi extensions). Only the `pi-tool-renderer` extension is vendored here — the
opencode-style renderer for tools, MCP output, diffs, user messages, and chrome.
Vendored verbatim with `.git/` removed. No source changes. To update, re-clone vstack
at the desired commit, re-copy `pi-extensions/pi-tool-renderer`, and bump the hash.

Entry point: `extensions/tool-renderer.ts` (wired via the harness `package.json`
`pi.extensions`).
