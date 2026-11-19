# Libra Workshop — instructions for agents

This folder is a separate web app that the repository owner added: a canvas for HTML prototypes.
It does not build into FigCraft and touches none of its crates. FigCraft's Rust-only rules in the
root `AGENTS.md` cover the native app; this folder follows the rules below. The root house rules
(check, then claim; keep fixes narrow and tested; report only what ran; no secrets) still apply.

## Two kinds of work happen here

1. **Working on prototypes** (most sessions). The prototypes live in `workspace/envs/<id>/`. Use the
   `workshop` MCP server (`.mcp.json` in this folder registers it): `list_environments`,
   `get_selection` (what the designer is pointing at), `list_canvas` (their notes, highlights and
   arrows — read them as feedback), `take_task` / `update_task` (requests typed in Chat),
   `create_branch` / `review_branch` / `merge_branch`, `set_style`, `read_file` / `write_file`,
   `save_version`, `screenshot`. Work on a branch, not on main. A branch reads its parent's files
   until it changes them; `checkout_branch` (or `take_task`) copies them into its folder. Visual
   tweaks go in `overrides.css`; structure goes in `index.html`. Keep to the prototype's own design
   system (Libra tokens for Libra prototypes).
2. **Working on the Workshop itself** (`src/`, `ui/`, `bin/`, `test/`). Rules for that:

## Rules for the Workshop code

- **No runtime dependencies.** Node 20+ built-ins only, ES modules, no build step. Playwright is
  optional and only used for screenshots when it is already installed.
- **The UI is Libra.** Colours, radii, shadows, type and motion come from the tokens at the top of
  `ui/app.css`, which are 1:1 with the Libra DS. New surfaces are recompositions of the existing
  classes (`.dbtn`, `.createbtn`, `.ghbtn`, `.segds`, `.cnmenu`, `.ddtrig`, `.afld-in`, `.tagro`,
  `.tct`, `.md`, `.toast`, `.isec`/`.irow`). No new hex values, no 5/7/10/13/15px one-offs, sentence
  case, verb-first buttons. Every surface needs its dark-mode pair (`:root[data-ltheme="dark"]`).
- **The canvas shell scales below 1180px** (`fitShell`). Anything measured with
  `getBoundingClientRect` and written into a style inside `#frame` is divided by `frScale()`
  (`inFrame()` in `ui/lib.js` does it for menus).
- **Everything the canvas does is an API call** in `src/server.js`, and anything a harness needs
  is an MCP tool in `src/mcp.js`, so people and agents act on the same files.
- **Guards say why.** Limits, path checks, the host check and the `x-workshop` header each carry a
  comment saying what they prevent. Read it before changing one.
- **Never crash the page or the server.** Return errors with a message a person can act on
  (`StoreError`), treat prototype HTML and harness input as hostile, cap sizes.
- **Tests.** `npm test` runs `node --test`. A fix comes with a test that fails without it. For UI
  changes, look at the result in a browser (`npm start`, open http://127.0.0.1:4600).
- **Don't commit `workspace/.workshop/`** — it is one computer's local state (versions, trash,
  tasks, comments, share links). `workspace/canvas/` and `workspace/envs/` are shared and committed.

## Libra assets

The Libra logo, icons, tokens and the Fourth Age prototype belong to Libra. They are not covered
by this repository's open-source licence: don't copy them into other projects or packages.
