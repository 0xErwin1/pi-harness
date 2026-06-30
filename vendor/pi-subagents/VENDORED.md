# Vendored: pi-subagents

This directory is a vendored copy of a third-party Pi extension.

- **Source:** https://github.com/tintinweb/pi-subagents
- **Package:** `@tintinweb/pi-subagents`
- **Upstream commit:** `c32e8e07f325183332b84216852597d3c48d6434`
- **License:** MIT (see `LICENSE`)
- **Author:** tintinweb

Vendored with `.git/` and `media/` (an 8 MB demo video) removed.

One mechanical source transform was applied: relative import specifiers were
rewritten from `.js` to `.ts` (e.g. `from "./agent-manager.js"` →
`from "./agent-manager.ts"`). Upstream uses NodeNext-style `.js` specifiers that
only resolve after a `tsc` build; this harness loads the `.ts` source directly via
Pi's loose-file extension loader, which resolves the literal specifier (the same
way the harness's own extensions import with `.ts`). The reproducible transform:

    rg --files -g '*.ts' vendor/pi-subagents | xargs perl -i -pe \
      's/(["\x27])(\.\.?\/[^"\x27]*?)\.js\1/$1$2.ts$1/g'

To update, re-clone upstream at the desired commit, re-copy, re-apply the transform
above, and bump the commit hash.

Entry point: `src/index.ts` (wired via the harness `package.json` `pi.extensions`).
