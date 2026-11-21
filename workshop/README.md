# Atelier

Atelier is a canvas for HTML prototypes where branching and annotating come first. It is laid out like a
design tool: **Home** lists your prototypes, each opens in a **tab**, and inside a prototype every
**branch is a page**, with **main** as the first one. A page shows the prototype's screens as live
boards, each running exactly like the app it imitates. Try an idea on a branch, mark it up with
notes, highlights, arrows and comments, **compare** it with main, then **review and merge** it.
Coding agents (Claude Code or your own harness) work on the same files, read your annotations, and
do their work on branches you merge.

Bring your own projects: **connect any folder** on your computer as a **space** and Atelier finds
the prototypes in it and works on them where they are. The repository's own workspace, with
**Libra — Fourth Age** and two example branches, is just the first space.

## Start

Needs Node 20 or later. Nothing to install.

```bash
cd workshop
```

```bash
npm start
```

Open http://127.0.0.1:4600. The server only listens on this computer.

## Spaces: work in your own project folders

Open the **Atelier** menu (top left) and choose **Connect a folder…**, or click **Connect a
folder** on Home. Paste a path or pick one in the folder browser, then connect. From the command
line, `node bin/workshop.js connect ~/Projects/app` does the same.

- **What counts as a prototype:** the folder's own `index.html`, any folder up to two levels down
  with an `index.html`, and loose `.html` pages at the top. **Look for new prototypes** (same menu)
  picks up ones you add later. `node_modules` and dot folders are skipped.
- **In place.** Prototypes stay where they are and show *In place* in the Page panel. Edits to the
  files (from your editor, an agent or a merge) show up live, and merging a branch writes the real
  files. Atelier saves a version before every agent run, merge and restore.
- **Atelier's own data** (branches, versions, notes, design overrides, recipes) goes in a hidden
  `.atelier` folder inside the connected folder. Add it to your `.gitignore`, or commit it to
  share branches and notes with your team (its own `.gitignore` keeps this computer's versions
  and tasks out). Design overrides stay in `.atelier`, never in your files,
  until you merge them into the code yourself.
- **Switching.** Your spaces are listed at the top of the Atelier menu; pick one to open it. The
  list is kept in `~/.atelier/spaces.json` (or `$ATELIER_HOME`). `workshop serve`, `workshop mcp`
  and the other commands open the space you last used unless you pass `--workspace`, and a
  connected agent follows you when you switch.
- **Limits.** A connected prototype is versioned whole, so a folder over 3,000 files or 200 MB is
  skipped with a note: connect the folder that holds just the prototype. **Remove from Atelier**
  forgets a prototype and leaves its folder alone. Restoring a version puts back every file it had
  and leaves files you added since.

## The workspace on disk

```
workspace/
  workshop.json              name and the agent command
  envs/<id>/index.html       a prototype — edit it in anything
  envs/<id>/env.json         name, theme, variants, text edits, the brief and decision log, and for a
                             branch: its parent and base
  envs/<id>/overrides.css    design tweaks from the inspector and agents; loads after the page's styles
  canvas/<id>.json           what's on the canvas: boards (a prototype at a screen), and the notes,
                             highlights, arrows and drawings made on each page
  recipes/<id>.json          shared recipes: versioned instructions agents run on a branch
  .workshop/                 this computer's own state (not committed): versions, trash, tasks,
                             comments, share links, the current selection, agent heartbeats
```

A branch folder starts with just `env.json` and `overrides.css`: files it hasn't changed are read
from its parent, so branching a 6 MB prototype takes no time and no space. Any change to these
files — from the canvas, an editor or an agent — reaches every open canvas.

## Finding your way

| | |
|---|---|
| **Home** | Your prototypes, with their open branches and a live preview. Click one to open it in a tab; **Import HTML** adds another. The top bar shows whether an agent is connected. |
| **Branches** (File, left) | Main and every branch of the open prototype, like pages, with how many changes each has. Click one to go to its page; **+** creates a branch of the page you're on. |
| **Layers** (File, left) | This page's frames — one per screen — and its notes, highlights and arrows. Open a frame to reach the live page's landmarks: sidebar, content, panels. |
| **Screens** (left) | Every screen, state and flow the prototype offers. Click to place it on this page or drag it onto the canvas; **Place all** fills a row. Fourth Age lists its screens through its own prototype tools. |
| **Agents** (left) | Ask for a change. From main it happens on a new branch, so main only changes when you merge. **Ask** in the toolbar opens it. |
| **Notes** (left) | Every note, highlight and comment on this page, or on all of the prototype's pages. |
| **History** (left) | Versions of this page (restore one, or copy it as a new prototype) and the branches merged so far. |
| **Page banner** | Across the top of the canvas: which page this is. On a branch: how many changes and conflicts, **Compare with main** (main's screens above the branch's, both live), **Update from main** and **Review and merge**. |
| **Design** (right) | Whatever is selected: the page (its changes, or its branches when it's main), a frame (screen, state, size), an element (see below) or an annotation. |
| **Prototype** (right) | How this page runs: theme and variants, its flows (place one or play it in a new tab), Interact, Present and Share. The zoom is next to the tabs. |
| **Review and merge** | Every change — settings, design overrides, files — with main's value and the branch's. Where main changed the same thing since the branch was made, pick which side wins. Merging saves main as a version first and archives the branch. |

The toolbar: **V** select, **H** hand, **N** note, **B** highlight (drag a box), **A** arrow (drag
from a note, box or board to what it's about), **C** comment on a board, **P** Interact (the pointer
goes to the page: use it like the app).

## Working on the canvas

These follow FigCraft's canvas commands and the shortcuts you know from design tools (**?** lists
them all):

- **Select**: click; **Shift**-click adds or removes; drag on an empty spot to select everything
  the box touches; **⌘A** selects everything on the page. Pan with **Space**-drag, the hand (**H**),
  or by scrolling.
- **Move**: drag (several at once move together), or nudge with the arrow keys (**Shift** 8 px).
  Smart guides line things up with the rest of the page as you drag; hold **⌥** to move freely.
- **Align and distribute** several boards and annotations: in the Design panel, the right-click
  menu, or **⌥A / ⌥H / ⌥D** (left, centre, right), **⌥W / ⌥V / ⌥S** (top, middle, bottom) and
  **⌥⇧H / ⌥⇧V** (distribute).
- **Copy, cut, paste, duplicate** boards and annotations (**⌘C / ⌘X / ⌘V / ⌘D**), on the same page
  or onto another branch: a pasted board shows that page's version of the prototype.
- **Undo and redo** everything — moves, resizes, adding and removing, alignment and every element
  edit — with **⌘Z** and **⌘⇧Z**.
- **Right-click** anything for what you can do with it.
- **View**: **⌘Y** outlines every element on the live boards, **⇧R** shows or hides the rulers.
- **Draw** (**D**): give notes by hand, the way an atelier marks up a fitting — circle the problem,
  underline what works, cross out what goes. A glass tray above the toolbar holds the marker, pen,
  pencil and highlighter (**1–4**), the eraser (**E**, takes away whole marks), eight inks and three
  weights (**[ ]**). Hold **⇧** for a straight line. A mark drawn over a screen moves with it; marks
  can be selected, moved, recoloured, undone and removed like anything else, and agents see them in
  `list_canvas` (as drawings, with the screen each one is on). The pens' behaviour follows Benji
  Taylor's [Drawesome](https://github.com/benjitaylor/drawesome) (MIT): Atelier has its own
  implementation of its approach in `ui/ink.js`.

### How it stays fast

The canvas draws boards as pictures on a graphics layer, so a page of dozens of screens pans and
zooms smoothly. The real pages run in the background: a few hidden frames load each board, let
the prototype settle on its screen, and turn it into a picture. Only the boards you're working in
are live — the one you selected, the one under the pointer, and the few in view once you zoom in
close — so they're ready to click into, edit or use, and a live board hands back a fresh picture
when you leave it. Any change to a prototype's files or settings redraws its pictures.

Pictures are saved on this computer (`.workshop/snapshots`, the newest 600) and named by what the
board shows: a hash of the prototype's files, overrides and look settings, plus the screen, state
and size. Opening a page again draws from them without loading the prototype, and a branch nobody
has changed yet (an agent's new branch, say) shares its parent's pictures. When a picture is made,
hidden parts of the page are left out and the wait ends as soon as the page has reached its
screen. What's saved is the drawing (an SVG of the page, gzipped), because browsers don't let a
page read back the pixels of such a drawing.

## Frames

Press **F** (or the frame button in the toolbar) and drag on the canvas to draw a frame, or pick
a size in the tray: Phone, Tablet, Laptop, Desktop or Wide. A frame is a new, empty page of the
prototype (`frames/<name>.html`) shown as its own board, at exactly that size. Name it in the
Design panel, and choose **Design with an agent** to have an agent build it in the prototype's own
style, reading the notes and drawings you put on it. You can also edit the file yourself.

On a branch, a frame's page belongs to the branch, so merging brings it into main. Agents can draw
frames too (`add_frame`), for example to propose a new screen or the same screen at phone size,
and `list_canvas` lists the frames on each page.

## Editing elements

Elements inside a board are edited like frames in a design tool, and every edit is saved as CSS in
the page's `overrides.css`, so the prototype shows it everywhere it runs: on every board, in
Present, in a new tab and in share links. On a branch it is one of the changes you review and merge.

- **Select**: click inside a board to select the element under the pointer; **Esc** selects its
  parent, **Enter** on a frame its first child. Layers shows where it sits.
- **Move**: drag it. Inside an auto layout (a flex or grid parent) dragging **reorders** it among
  its siblings, with a line showing where it will land (saved with `order`); anywhere else it moves
  freely (saved with `translate`). Arrow keys reorder or nudge it, **Shift** for 8 px.
- **Resize**: drag one of its eight handles (saved as `width` and `height`; in an auto layout it
  stops growing or shrinking along that axis).
- **Remove**: **Delete** hides it with `display: none`, so it can come back.
- **Design panel**, in the same order as FigCraft's: Position (X, Y, rotation), Layout (add or
  remove auto layout, direction, alignment, gap, width and height as Fixed, Hug or Fill, padding,
  clip content), Appearance (opacity, corner radius, visible), Typography (size, weight, line
  height, alignment, colour, the text itself), Fill, Stroke and Effects. Colours, spacing, radii and
  type sizes come from the Libra tokens, and anything off the system is flagged. Number fields
  step with the arrow keys or scrub by dragging their label.
- **This element or all like it**: an edit applies to the selected element, or to every element
  like it, as a component would. Moves always apply to the one you moved.
- **Structure**: **Enter** selects the first child, **⇧Enter** the parent, **Tab / ⇧Tab** the next or
  previous sibling. **]** / **[** bring to front or send to back, **⌘]** / **⌘[** forward or backward
  (saved as `z-index`). Right-click → **Copy CSS** copies its styles.
- **Undo**: **⌘Z** and **⌘⇧Z**, one edit at a time. **Changes on this element** lists what the page
  changed on it, with **Reset**.

Drag a frame by its title, or select the frame first (**Esc** from an element) and drag it. Live
pages keep the keyboard only in Interact mode or while you edit text in them.

Other keys: **Space** drag to pan, **⇧1** fit, **⇧2** zoom to the selection, **⌘D** duplicate,
**⌘K** search, **⌘\** hide the panels, **?** all shortcuts.

## Brief, decisions and recipes

Agents do better work with the context a team already has. Atelier keeps three kinds of it with the
prototype, in files that are committed and shared:

- **The brief.** One per prototype, in the Design panel when nothing is selected. Say what the
  prototype is for, its design rules and what to keep. Every agent request starts with it, and its
  branches read it too.
- **The decision log.** Every merge records what changed, who merged it and, if you write one in
  the merge dialog, why. History lists them. Agents read the ten most recent, so they don't undo
  what was decided.
- **Recipes.** The **Recipes** tab holds instructions for jobs you ask for often. A new workspace
  starts with *Apply my notes*, *Polish pass* and *State audit*. Running one from Main makes a new
  branch first, so its result is a draft you review and merge, never a change to Main. On a branch,
  it runs there.
  - **Versions.** Changing a recipe's instructions saves a new version as *testing*. Production
    keeps running until you promote the new one. Use **Try** to run a testing version on a branch
    first.
  - **Results.** Each recipe shows its runs and what became of their branches: merged, still open,
    or not kept. Run history lives in `.workshop/`, so each computer counts its own runs.
  - **Run when notes are added.** This switch (off by default, because each run uses your agent)
    queues the recipe on a branch 15 seconds after you stop adding notes, highlights, arrows or
    drawings there. A recipe already waiting on that branch isn't queued twice, and merging or
    archiving a branch calls off the runs still waiting on it.

## Connect a coding agent

### Claude Code over MCP

From this folder, Claude Code picks up `.mcp.json` automatically. From anywhere else:

```bash
claude mcp add workshop -- node /path/to/workshop/bin/workshop.js mcp --workspace /path/to/workshop/workspace
```

Then ask it things like "take the next Workshop task", "read the notes on the canvas and fix them",
"make what I selected denser", or "branch Fourth Age and try the citations panel at app level".
The canvas shows it as connected.

Tools: `list_environments`, `get_environment`, `get_selection`, `list_canvas` (boards and your
notes, highlights and arrows), `place_screen`, `add_note`, `create_branch`, `review_branch`,
`merge_branch`, `checkout_branch`, `read_file`, `write_file`, `create_environment`,
`fork_environment`, `update_environment`, `set_style`, `set_text`, `save_version`, `list_versions`,
`restore_version`, `screenshot`, `list_tasks`, `take_task`, `update_task`, `list_comments`,
`reply_comment`, `resolve_comment`, `list_recipes`, `run_recipe`, `update_brief`, `add_frame`.

### Run requests automatically

Instead of waiting for a connected agent, the Workshop can run a command for each request, one at
a time, in the prototype's folder, after saving a version:

```bash
node bin/workshop.js agent claude -p {prompt} --permission-mode acceptEdits
```

`{prompt}` is the full brief (the prototype's brief, recent decisions, the request or recipe, the
selected element, how to work), `{request}` the words typed,
`{dir}` the folder and `{file}` its `index.html`. Without `{prompt}` the brief arrives on stdin, so
any harness works. Turn it off with `node bin/workshop.js agent --off`. The same choice is in the
canvas under **Connect an agent**.

### Any other MCP client

```json
{ "mcpServers": { "workshop": { "command": "node", "args": ["/path/to/workshop/bin/workshop.js", "mcp", "--workspace", "/path/to/workshop/workspace"] } } }
```

## Make a prototype canvas-aware

Libra prototypes with the prototype tools bar work as they are. Any other prototype can describe
its screens, states and variants for the inspector:

```html
<script>
  window.workshopEnv = {
    screens: [{ group: "App", name: "Inbox" }, { group: "App", name: "Settings" }],
    screen: () => currentScreenName(),
    go: (name) => showScreen(name),
    states: ["Default", "Empty", "Error"],
    setState: (s) => setDemoState(s),
    variants: () => [{ label: "Density", options: ["Comfortable", "Compact"], value: density }],
    setVariant: (label, option) => setDensity(option),
    theme: (t) => document.documentElement.setAttribute("data-theme", t),
  };
</script>
```

## Command line

```bash
node bin/workshop.js help
```

`serve`, `mcp`, `list`, `import <file.html | folder>`, `fork <env>`, `version <env>`,
`restore <env> <n>`, `screenshot <env>`, `tasks`, `selection`, `agent`. Every command takes
`--workspace <dir>` (or `$WORKSHOP_DIR`).

## Safety

- The server listens on `127.0.0.1` and refuses requests addressed to any other host name, so a web
  page elsewhere can't reach it by DNS rebinding. Every change needs an `x-workshop: 1` header,
  which cross-site forms and images can't send.
- Network sharing opens a second port that serves share links only: each link reaches one
  prototype, read only (or read and comment), and can be turned off.
- Prototypes run in the same origin as the canvas, which is what lets the canvas select and edit
  their elements. Only add prototypes you trust, as you would with a local dev server.
- File paths from requests and agents are resolved inside their environment folder; `..` and dot
  files are refused. Uploads, logs, versions and selections are size-capped.

## Tests

```bash
npm test
```

## Look and Libra assets

Atelier has its own quiet, neutral look (light and dark), so the prototype on the canvas is the
only thing that looks like a product. The inspector's swatches show the prototype's own tokens.

Its chrome follows iOS 27's Liquid Glass: the canvas runs underneath, and the panels, toolbar, page
banner, menus and dialogs float above it as glass with capsule controls and concentric corners.
Workspace menu → **Glass** sets how clear it is (clear, balanced, frosted); reduced-transparency
settings make it solid. The inspector's controls follow DialKit: each number is a bar with its label
and value inside — drag or click it to set (bars with a range fill to the value), click the number
to type, arrow keys to step.


The Libra logo, icons, design tokens and the Fourth Age prototype belong to Libra. They are not
covered by this repository's open-source licence and are not for reuse outside this project.
