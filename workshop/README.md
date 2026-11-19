# Libra Workshop

A canvas for HTML prototypes. Every prototype is a folder with an `index.html`, shown on the canvas
as a live board: the real page at its real size, running exactly like the app it imitates. Fork a
prototype to try something next to the original, change it with Libra tokens, compare variants
side by side, share it as a running app, and let coding agents — Claude Code or your own harness —
work on the same files while the boards reload in front of you.

Think of it as three tools in one place:

- **Canvas** — boards, layers, an inspector, comments, present mode.
- **HTML-native design** — boards are real pages, so selecting an element selects the DOM node and
  every change is real CSS in a file.
- **Agents on the files** — requests typed on the canvas become tasks an agent picks up over MCP
  (or a local command runs), with a version saved before every change.

It starts with one prototype: **Libra — Fourth Age** (`workspace/envs/libra-fourth-age/`).

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
  workshop.json              name, where each board sits, the agent command
  envs/<id>/index.html       the prototype itself — edit it in anything
  envs/<id>/env.json         name, lineage, board size, theme, opening screen, state, variants, text edits
  envs/<id>/overrides.css    design tweaks from the inspector and agents; loads after the prototype's styles
  .workshop/                 this computer's local state (not committed): versions, trash, tasks,
                             comments, share links, the current selection, agent heartbeats
```

Any change to these files — from the canvas, an editor or an agent — reaches every open canvas.

## Using the canvas

| | |
|---|---|
| **Design mode** (`P` to switch) | Click inside a board to select the element under the pointer. `Esc` selects its parent. Double-click text to edit it. Drag a board by its name or from inside; resize it from the right and bottom handles. |
| **Prototype mode** | The pointer goes to the page: use the prototype like the app. |
| **Inspector** | For an element: text, padding, gap, radius, fill, text colour, size and weight — Libra tokens only. Anything off the system is flagged. Changes go to `overrides.css`, for this element or for every match. `⌘Z` undoes the last one. |
| **Environment** | For a board: size presets, theme, the screen it opens on, screen state (default, loading, empty, no results, error) and the prototype's own variants. Libra prototypes expose these through their prototype tools; others can opt in (below). |
| **Versions** | Save a version of the whole folder; restore it or fork from it. Restoring saves the current state first. |
| **Fork** (`⌘D`) | Copies the folder — and the page's saved browser state — into a new board next to the original. Every board keeps its own storage, so forks never share state. |
| **Comments** (`C`) | Pin a comment on a board; reply, resolve, or send it to an agent. Agents can read and resolve them too. |
| **Share** | A local link on this computer, and — with network sharing on — view or comment links for people on the same network. Links open the running prototype and nothing else. |
| **Present** | The board fills the window at 1:1 as the app. `Esc` exits. |

Other shortcuts: `V` select, `H` hand, `Space` drag to pan, `⇧1` zoom to fit, `⇧2` zoom to the
selection, `⌘0` 100%, `⌘K` search.

## Connect a coding agent

### Claude Code over MCP

From this folder, Claude Code picks up `.mcp.json` automatically. From anywhere else:

```bash
claude mcp add workshop -- node /path/to/workshop/bin/workshop.js mcp --workspace /path/to/workshop/workspace
```

Then ask it things like "take the next Workshop task", "make the selected card denser", or "fork
Fourth Age and try the citations panel at app level". The canvas shows it as connected.

Tools: `list_environments`, `get_environment`, `get_selection`, `read_file`, `write_file`,
`create_environment`, `fork_environment`, `update_environment`, `set_style`, `set_text`,
`save_version`, `list_versions`, `restore_version`, `screenshot`, `list_tasks`, `take_task`,
`update_task`, `list_comments`, `reply_comment`, `resolve_comment`.

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
covered by this repository's open-source licence; keep the repository private.
