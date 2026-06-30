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
Vendored with `.git/` removed.

One mechanical source transform was applied: relative import specifiers were
rewritten from `.js` to `.ts` (e.g. `from "./tool-renderer/batch.js"` →
`from "./tool-renderer/batch.ts"`). Upstream uses NodeNext-style `.js` specifiers;
this harness loads the `.ts` source directly via Pi's loose-file extension loader,
which resolves the literal specifier. The reproducible transform:

    rg --files -g '*.ts' vendor/pi-tool-renderer | xargs perl -i -pe \
      's/(["\x27])(\.\.?\/[^"\x27]*?)\.js\1/$1$2.ts$1/g'

To update, re-clone vstack at the desired commit, re-copy
`pi-extensions/pi-tool-renderer`, re-apply the transform above, and bump the hash.

Entry point: `extensions/tool-renderer.ts` (wired via the harness `package.json`
`pi.extensions`).
