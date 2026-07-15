# Vendored: pi-subagents

This directory is a vendored copy of a third-party Pi extension.

- **Active runtime source:** https://github.com/tintinweb/pi-subagents
- **Active runtime commit:** `8405e556acc8ab2c0fcfa02021f871365695f776`
- **Active runtime path:** `src/`
- **Active entry point:** `src/index.ts`
- **License:** MIT (see `LICENSE`)

The active runtime is the pinned tintinweb/pi-subagents snapshot under `src/`.
`src/index.ts` registers the native tintinweb `Agent`, `get_subagent_result`,
`steer_subagent`, and `/agents` surfaces directly; it must not import the
inactive j0k3r rollback snapshot or the Pi Harness j0k3r compatibility bridge.

The previous j0k3r runtime remains vendored under `j0k3r/` only as an inactive
rollback reference during the migration. Do not treat `j0k3r/` or
`packages/subagents-compat/` as the active runtime path.

## Local source transform

Upstream TypeScript source uses relative `.js` import specifiers. Pi Harness
loads the vendored TypeScript source directly through the generated
`pi-subagents.ts` loader, so relative import specifiers in `src/**/*.ts` are
rewritten from `.js` to `.ts`.

Reproducible transform used after checking out the pinned commit:

```sh
rg --files -g '*.ts' vendor/pi-subagents/src | xargs perl -i -pe \
  's/(["\x27])(\.\.?\/[^"\x27]*?)\.js\1/$1$2.ts$1/g'
```

Entrypoint wiring remains unchanged: `scripts/link.sh` and the Nix/Home Manager
projection load `vendor/pi-subagents/src/index.ts` as `pi-subagents.ts`.

## Local patches

Pi Harness maintains local forks of the vendored source. Each is a tracked patch
under `PATCHES/`. **Any re-vendor of an upstream snapshot MUST reapply every patch
in `PATCHES/` after the source transform above, or the harness loses the change
silently** — `vendor/**` is excluded from `tsc --noEmit`, so a dropped patch would
not be caught by a type-check.

- **`PATCHES/0001-agent-render-adapter.patch`** — replaces the inline `Agent`
  tool-call `renderCall`/`renderResult` bodies in `src/index.ts` with a thin
  delegation to the type-checked `packages/subagent-render` module (nerdfont +
  Ayu card styling). `execute` is untouched. The fork is unavoidable: a second
  `registerTool("Agent", ...)` is a fatal duplicate-tool startup error, so there
  is no override seam — the render must be edited in place. Keeping the logic in
  `packages/` (which `tsconfig` includes) is what makes it type-checked despite
  living behind an un-type-checked vendor edit.

Reapplication after a re-vendor:

```sh
git apply vendor/pi-subagents/PATCHES/0001-agent-render-adapter.patch
```

If the patch no longer applies cleanly (upstream moved the render block), port the
delegation by hand: add the `renderAgentCall`/`renderAgentResult` import from
`../../../packages/subagent-render/index.ts` and reduce the `Agent` tool's
`renderCall`/`renderResult` to call them. `tests/vendor/patch-applied.test.ts`
fails until the delegation is present, so `pnpm test` catches a forgotten reapply.
