# Vendored: pi-subagents

This directory is a vendored copy of a third-party Pi extension.

- **Active runtime source:** https://github.com/j0k3r-dev-rgl/pi-subagents-j0k3r
- **Active runtime package:** `pi-subagents-j0k3r`
- **Active runtime commit:** `36a07982338d946090c88f6e20252dbab46468a6`
- **Compatibility wrapper entry:** `src/index.ts`
- **License:** MIT (see `LICENSE`)

The active runtime lives under `j0k3r/` as a vendored snapshot of the fork. The
harness-owned `src/index.ts` file is a thin compatibility loader that boots the
j0k3r extension and re-registers the legacy `Agent`, `get_subagent_result`,
`steer_subagent`, and `/agents` surfaces expected by Pi Harness.

Compatibility notes:

- `/agents` remains the primary menu and can jump directly into per-agent model
  and thinking assignment.
- For markdown-backed agents, assignments write `model:` and `thinking:` to the
  defining `.md` frontmatter instead of treating `subagents.json`
  `model_profiles` as authoritative.
- `steer_subagent` is still a compatibility stub; use the native `/subagents`
  workflow when live steering is required.

The historical tintinweb snapshot remains in this vendor tree for now, but it is
not the active runtime after this change.

A mechanical source transform was applied to the j0k3r snapshot: relative import
specifiers were rewritten from `.js` to `.ts` so Pi can load the vendored source
without a separate build step. The reproducible transform:

    rg --files -g '*.ts' vendor/pi-subagents/j0k3r | xargs perl -i -pe \
      's/(["\x27])(\.\.?\/[^"\x27]*?)\.js\1/$1$2.ts$1/g'

Entry point: `src/index.ts` (wired by `scripts/link.sh` as the active
`pi-subagents.ts` loader).
