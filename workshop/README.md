# Libra Workshop

A canvas for HTML prototypes where branching and annotating come first. Every prototype is a
folder with an `index.html`; on the canvas it becomes a **section** of live boards, one per screen,
each running exactly like the app it imitates. Try an idea on a **branch** — its own section, joined
to where it came from by a line — then **review and merge** it. Mark things up with notes,
highlights, arrows and comments. Coding agents (Claude Code or your own harness) work on the same
files, read your annotations, and do their work on branches you merge.

It starts with **Libra — Fourth Age** and two example branches.

## Start

Needs Node 20 or later. Nothing to install.

```bash
cd workshop
```

```bash
npm start
```

Open http://127.0.0.1:4600. The server only listens on this computer.

## The workspace on disk

```
workspace/
  workshop.json              name and the agent command
  envs/<id>/index.html       a prototype — edit it in anything
  envs/<id>/env.json         name, theme, variants, text edits, and for a branch: its parent and base
  envs/<id>/overrides.css    design tweaks from the inspector and agents; loads after the page's styles
  canvas/<id>.json           what's on the canvas: boards (a prototype at a screen), notes, highlights, arrows
  .workshop/                 this computer's own state (not committed): versions, trash, tasks,
                             comments, share links, the current selection, agent heartbeats
```

A branch folder starts with just `env.json` and `overrides.css`: files it hasn't changed are read
from its parent, so branching a 6 MB prototype takes no time and no space. Any change to these
files — from the canvas, an editor or an agent — reaches every open canvas.

## The canvas

| | |
|---|---|
| **Sections and branches** | Each prototype's boards sit in a section. **Branch** (in the section header) makes a new section with the same screens, below, joined by a lineage line. The header says how many changes the branch has and whether any conflict with main. |
| **Review and merge** | Shows every change — settings, design overrides, files — with main's value and the branch's. Where main changed the same thing since the branch was made, pick which side wins. Merging saves main as a version first and archives the branch. **Update from main** brings main's newer changes into a branch. |
| **Screens** (left panel) | Every screen, state and flow the prototype offers. Drag one onto the canvas or click to place it; **Place all** fills a row. Fourth Age lists its screens through its own prototype tools. |
| **Annotate** | **N** note, **B** highlight (drag a box), **A** arrow (drag from a note, box or board to what it's about), **C** comment on a board. **Notes** (right panel) lists them all. Agents read them too. |
| **Design mode** (**P** switches) | Click inside a board to select the element under the pointer; **Esc** selects its parent; double-click text to edit it. The inspector only offers Libra tokens and flags anything off the system. Changes go to the branch's `overrides.css`. |
| **Prototype mode** | The pointer goes to the page: use it like the app. |
| **Layers** (left panel) | The selected board's landmarks only — sidebar, content, panels, sections — folded. Click into a board to reach anything else. |
| **Chat** (right panel) | Ask for a change. From main it happens on a new branch, so main only changes when you merge. |
| **History** | Save versions of a prototype or branch; restore one or copy it as a new prototype. |
| **Share · Present** | A local link, and view or comment links for people on your network. **Present** plays a board full-window at 1:1. |

Other keys: **V** select, **H** hand, **Space** drag to pan, **⇧1** fit, **⇧2** zoom to the selection,
**⌘D** duplicate, **⌘K** search, **⌘\** hide the panels, **⌘Z** undo a style edit.

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
`reply_comment`, `resolve_comment`.

### Run requests automatically

Instead of waiting for a connected agent, the Workshop can run a command for each request, one at
a time, in the prototype's folder, after saving a version:

```bash
node bin/workshop.js agent claude -p {prompt} --permission-mode acceptEdits
```

`{prompt}` is the full brief (request, selected element, how to work), `{request}` the words typed,
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

## Libra assets

The Libra logo, icons, design tokens and the Fourth Age prototype belong to Libra. They are not
covered by this repository's open-source licence and are not for reuse outside this project.
