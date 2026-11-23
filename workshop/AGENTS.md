# Atelier — instructions for agents

This folder is a separate web app that the repository owner added: a canvas for HTML prototypes.
It does not build into FigCraft and touches none of its crates. FigCraft's Rust-only rules in the
root `AGENTS.md` cover the native app; this folder follows the rules below. The root house rules
(check, then claim; keep fixes narrow and tested; report only what ran; no secrets) still apply.

## Two kinds of work happen here

1. **Working on prototypes** (most sessions). The prototypes live in `workspace/envs/<id>/`, or,
   in a connected space, in the project's own folders (`folder` in `list_environments`; edit those
   real files in place, and put visual tweaks in the overrides file the brief names). Use the
   `workshop` MCP server (`.mcp.json` in this folder registers it): `list_environments`,
   `get_selection` (what the designer is pointing at), `list_canvas` (their notes, highlights, arrows
   and hand-drawn marks — read them as feedback; screenshot the screen under a mark to see it), `take_task` / `update_task` (requests typed in Chat),
   `create_branch` / `review_branch` / `merge_branch`, `set_style`, `read_file` / `write_file`,
   `save_version`, `screenshot`, `list_recipes` / `run_recipe` (the team's shared instructions for
   recurring work), `add_frame` (a new empty page to design; a frame whose file still says
   `atelier:empty-frame` is waiting for a design). Several people and agents work here at once:
   read `get_activity` before you start, and `post_update` when you start something big, finish,
   or need the designer. `list_canvas` also lists links (Figma files, running apps) and pictures
   brought in from elsewhere. Read the prototype's brief and recent decisions (`take_task` and
   `get_environment` include them) and keep to them. Work on a branch, not on main. A branch reads its parent's files
   until it changes them; `checkout_branch` (or `take_task`) copies them into its folder. Visual
   tweaks go in `overrides.css`; structure goes in `index.html`. Keep to the prototype's own design
   system (Libra tokens for Libra prototypes).
2. **Working on the Workshop itself** (`src/`, `ui/`, `bin/`, `test/`). Rules for that:

## Rules for the Workshop code

- **No runtime dependencies.** Node 20+ built-ins only, ES modules, no build step. Playwright is
  optional and only used for screenshots when it is already installed.
- **Atelier has its own look, not Libra's.** The editor's colours, shadows, type and motion come
  from the Atelier tokens at the top of `ui/app.css` ("studio white": neutral greys with no warm tint,
  white surfaces lifted off a soft studio light (`--studio` behind the home, a plain neutral canvas),
  hairlines and soft layered shadows; fills, hovers and hairlines are translucent neutral tints;
  controls are flat: white pills with a hairline (`--raise`, `--sh-btn`) and the flat ink pill for
  the one main action (`--raise-ink`, `--sh-ink`); no gloss, no gradients on controls; status lights glow; every control's surface, edge and shadow is set once,
  in the Skins block at the end of `ui/app.css`; no texture or grain; fields are white with a hairline; meta tags are outlined; a tool-blue accent for selection and links only; empty states carry a
  hand-drawn mark; shapes: what you press is a pill and icon buttons are circles, list rows are
  rounded 8, fields 10, sheets 16 and panels 20; padding follows the control scale at the end
  of `ui/app.css` (32-tall pills 14 a side, 28-tall 12, 24-tall 8, a leading icon takes 2 off the left); type in
  three tokens: `--display` Inter Bold for the wordmark only (header logo and intro lockup; never
  titles or other app text), `--fakt` Inter for the interface (Regular for controls and values,
  SemiBold for headings, tightening as it grows: no letter-spacing at 12–14px, about -.02em on
  titles), `--hand` Shantell Sans for notes and handwritten marks, never on buttons; mono only for
  code). Font files are never committed here: `src/fonts.js` serves them from a craft-fonts
  checkout, and every token falls back to system fonts. Libra's tokens belong to the prototypes: they appear only inside boards
  and in the inspector's swatches. Compose new surfaces from the existing classes (`.dbtn`,
  `.createbtn`, `.ghbtn`, `.segds`, `.cnmenu`, `.ddtrig`, `.afld-in`, `.tagro`, `.tct`, `.md`,
  `.toast`, `.isec`/`.irow`). No new hex values outside the token block, spacing 2/4/6/8/12/16/24/32,
  12px text and 28px rows in panels and menus, sentence case, verb-first buttons, and a dark-mode
  pair for every token. Motion uses four curves and nothing else (`--ease-out`, `--ease-smooth`, `--ease-io`,
  `--ease-spring`), and follows the animations.dev bar: nothing animates on keyboard or
  high-frequency actions, menus 180ms in and 120ms out from their trigger, press `scale(.97)`, no
  hover scaling (one exception: a home-canvas card swells under the pointer, after
  design.cash.app), and reduced motion keeps colour and opacity only. Chrome is glass after iOS 27
  (`--glass-*` tokens: floating panels, capsule toolbar and banner, glass menus and dialogs); the
  inspector's controls follow DialKit (number bars with the label and value inside, `numField` in
  `ui/panels.js`). Motion timing follows transitions.dev's tokens (250ms smooth-out
  `cubic-bezier(.22,1,.36,1)` for tabs and slides, 150ms for appear, 2px blur on content swaps).
  All three are design references only: no code or assets are copied from any of them.
  Anything still loading shows it: words that say so ("Loading…", "Running…", "Connecting…") get
  `.shimmer`, content on its way gets `skeleton()` rows or cards, a button that started something
  slow gets `pendingButton()`, and a progress toast is `loadingToast()` (all in `ui/lib.js`).
- **Loading stays smooth.** Prototype pages never load on the editor's main thread when they don't
  have to: home thumbnails and the background pages that draw boards load from the other loopback
  name (`apartUrl` in `ui/lib.js`: 127.0.0.1 ↔ localhost), so Chrome runs them in their own process,
  and a background page draws itself (`ui/snap.js`, imported by the runtime on the editor's request)
  and sends back only the drawing. Only live boards (Play, element editing) load on the editor's own
  site. Every frame loads through `loadPage`/`pagesFree`, which hold while the intro plays. Saved
  drawings carry only what's shown: hidden parts emptied, CSS trimmed to what matches, each picture
  once. They decode one at a time when idle. Bump `DRAWING` in `ui/gfx.js` when what goes into a
  drawing changes. `ui/snap.js` takes no imports: it runs inside any prototype.
  The home canvas (`ui/home.js`) follows the same rules: one transform on one layer for the camera,
  only tiles in view exist, thumbnails come from that pipeline (`thumbJob`, `onBitmap`), and decodes
  wait while someone drags (`setBusy`). What the pointer is over comes from the cell maths, not
  hit-testing, so it stays right while the field coasts. Its pure maths lives in `ui/motion.js`,
  tested in Node. Nothing made up stands in for a prototype, on the home or in the intro: a slot
  without a real one is an empty state (`.pempty`, or the home's action cards) that does something real.
  The home is a sidebar that stays (sections, recent prototypes, the agent) and a main area that
  changes with the section (`#/`, `#/prototypes`, `#/learn`, `#/activity`): only the main area
  re-renders. Product pictures (the home hero, the Learn cards and the Learn dialog) live in
  `ui/visuals.js`, built from Atelier's own classes: each is a short plain headline and one real
  piece of Atelier on a flat dotted canvas (no pastel blooms); follow the `product-visuals` skill
  (`.claude/skills/product-visuals/SKILL.md`) for any new one.
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
  tasks, comments, share links). `workspace/canvas/`, `workspace/envs/` and `workspace/recipes/`
  are shared and committed.
- **Spaces.** Any folder can be a space (`src/spaces.js`). A connected folder keeps Atelier's data
  in `.atelier/` and links its prototypes (`env.link`): `Store.filesDir(id)` is where their files
  are, `pathFor(id, rel)` the one way to a file's path. `env.json` and `overrides.css` always live
  in Atelier's folder. Never write, move or delete inside a linked folder except through
  `writeFile`, merges and restores, which save a version first.
- **Nothing runs an agent on its own by default.** Recipe triggers start off; switching one on is
  the person's choice, because each run costs them.

## Libra assets

The Libra logo, icons, tokens and the Fourth Age prototype belong to Libra. They are not covered
by this repository's open-source licence: don't copy them into other projects or packages.
