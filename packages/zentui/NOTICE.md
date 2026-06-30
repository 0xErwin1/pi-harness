# Vendored UI modules — pi-zentui

The files in this directory (`style.ts`, `config.ts`, `ui.ts`, `user-message.ts`,
`selector-border.ts`) are vendored from **pi-zentui** by Luka Milojević
(https://github.com/lmilojevicc/pi-zentui), licensed under the MIT License (see
`LICENSE`).

Only the Opencode-style editor chrome is vendored — the bordered editor with the
accent rail and the in-frame model/provider/thinking metadata (`ui.ts`), the
prompt-box user messages (`user-message.ts`), and the selector borders
(`selector-border.ts`), plus their `style.ts`/`config.ts` dependencies.

The Starship statusline/footer, runtime detection, git status, and the `/zentui`
settings command are intentionally NOT vendored. The harness keeps its own footer.

Relative imports were adjusted to carry the `.ts` extension to match the harness's
module resolution; the module logic is otherwise unchanged.
