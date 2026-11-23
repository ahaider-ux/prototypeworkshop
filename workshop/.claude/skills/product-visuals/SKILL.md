---
name: product-visuals
description: Make launch visuals, announcement-modal art, presentation frames and product-film stills that show Atelier's real UI with high-end craft (layered depth, macro detail, soft fades), built from Atelier's own design system in code and safe to ship live. Use for "launch visual", "announcement", "what's new modal", "Learn card", "feature visual", "product shot", "hero image", "presentation frame", "marketing art", "show off the UI", and for a creative-direction research pass before a new visual direction.
---

# Product visuals (Atelier)

How to present Atelier's own UI in launch visuals, the Learn dialog, home cards and product films:
real components, composed with depth and restraint, never a redrawn mock-up and never a generic
SaaS graphic.

Atelier's design system lives in code, not in a Figma library: the tokens and component classes in
`workshop/ui/app.css`, the icons in `IC` (`workshop/ui/lib.js`), the marker engine in
`workshop/ui/ink.js`. The pictures that ship are built in `workshop/ui/visuals.js` from those same
classes. Read `workshop/AGENTS.md` (the look, type and motion rules) before you start.

## 0. Workflow (every request)

1. **Brief.** What changes for the user, in one sentence? Which 1–3 moments of the feature need a
   visual? Where will it live (the Learn dialog, a home or Learn card, the home hero, a post, a deck,
   a film)?
2. **Directions.** Check the existing pictures in `ui/visuals.js` (`ART`). If this is a new
   direction, or the existing ones look alike, run the creative direction check (§10) first.
3. **Pick per frame:** one look (§2) plus one or two devices (§3), and one focal element.
4. **Build** from Atelier's own classes only (§7), in the 360 × 240 design box, then let it scale.
5. **Audit** with a script (§9): content rules, duplicates, truncation, text over text, pointer aim.
6. **Check in a render:** on its own, and in context (the Learn dialog, a card, the hero), in light
   and dark.
7. **Deliver in code first** (`ui/visuals.js`, shown in the app). Export stills or a Figma copy only
   when asked.

When asked for several variations, make each one a different *spatial idea* (a different look
and/or device), not a rearrangement. A "mix" of two directions must be a new composition that
borrows ideas, not panels.

## 1. Formats

| Format | Default size | Notes |
|---|---|---|
| Learn dialog (announcement modal) | 731 × 502, copy left, art right | `openLearn()` in `ui/visuals.js`; the in-app "what's new" steps |
| Learn dialog art | 365.5 × 502 (the dialog's right half) | Ships live, so the content rules apply |
| Home and Learn cards | 16:10 (about 304 × 190 at rest) | `featureCard()`; title and one line under the art |
| Home hero art | about 650 × 300 (the hero's right part) | `artEl("intro")` |
| Presentation frame | 1335 × 804 | Posts, decks, the dialog shown on a background |
| Film | 1920 × 1080 | Product films; the first-run intro (`ui/intro.js`) is the house example |

Every picture is drawn once in a **360 × 240 design box** and scaled to fit its container
(`artEl()` does it), so one composition serves the card, the hero and the dialog. Export stills at
2× (`deviceScaleFactor: 2` in Playwright) and presentation frames at 2×.

**Announcement flow (the Learn dialog).**

- **Intro step first:** "Introducing Atelier" (or "Introducing ‹feature›"), one plain sentence on
  what changes for the user, and two buttons: **Learn more** (secondary, opens the Learn page) and
  **See what's new** (primary).
- **Then one step per part of the feature**, each with its own art.
- **The last step's primary button is Done.**
- **Step bars show the real count**, so the intro is 1/n.
- **The intro art shows the whole feature at a glance**, so it never repeats a later step's art.
- **One direction per flow:** every step in a flow uses the same look and devices.
- A step may offer one real action as a ghost button ("Connect an agent"), only when there is a
  real thing to do; never a fake.

## 2. Looks

- **Photo.** Not used in Atelier: there are no photo assets. Don't add one without an asset whose
  licence is recorded (see the repository's asset rules).
- **Studio light** (Atelier's pastel light, the default). The pale cool base `--pv-base` with soft
  blooms `--bloom-a` (white), `--bloom-b` (ice blue) and `--bloom-c` (mint): radial gradients about
  2–3× the element size, fading to transparent (`.pv-bloom`). Use it for the Learn cards, the hero,
  the dialog and isolated UI.
- **Graphite** (Atelier's editorial dark: the dark theme of the same pictures). `--pv-base` and the
  blooms switch to their dark pair automatically under `data-ltheme="dark"`; the components are
  Atelier's own dark surfaces with `--sh-md` / `--sh-modal` elevation. Don't hand-tune a separate
  dark picture; check both themes in a render.

Never mix looks in one frame. Colour stays Atelier's: ink and white, one blue (`--text-accent`) for
selection and links, the marker colours (`--i-red`, `--i-green`) only for hand-drawn marks.

## 3. Presentation devices

Use one or two per frame, never all of them.

1. **One hero at scale.** A single real component at 1.3–1.7×, crisp, with a lot of air around it.
2. **Glass bezel.**
   - The hero sits inside a translucent white rim, 6–8 px wide, with radius = inner radius + rim.
   - Fill `--glass-bg`, plus `--glass-rim` / `--glass-spec`.
   - Backdrop blur from `--glass-blur`, soft shadow `--sh-md`.
3. **Concentric rims.** A white icon tile, with an `IC` icon at 2×, ringed by 2–3 translucent rounded
   squares. Their fills are white at 22 / 34 / 56 %. Use it for one concept at the centre.
4. **Scatter in depth.** Small objects (chips, tags, rows) spread across the frame on a depth ladder,
   using `piece(x, y, html, { s, o, b })`:
   | Depth | Scale (`s`) | Opacity (`o`) | Blur (`b`, px) |
   |---|---|---|---|
   | far | 1.0 | 0.5 | 1.4 |
   | mid | 1.1 | 0.72 | 0.7 |
   | near | 1.2 | 0.9 | 0.3 |
   | hero | 1.35+ | 1 | 0 |
5. **Frosted context, crisp focus.** Context sits behind, frosted (opacity 0.4–0.8, blur 1–5 px).
   The element that matters sits in front, crisp. (`branch` in `ui/visuals.js`)
6. **Lift.** One item is pulled out of its list, crisp and slightly larger with an elevation,
   extending past the list's edge. Its slot stays empty (`.pv-slot`), so the text never appears
   twice. (`branch`)
7. **Stack or deck.** The same surface repeated and receding, offset diagonally with the back
   layers blurred and faded. It says "in every ‹container›". (`recipes`)
8. **Pointer on the control.** The ink cursor (`pointer` in `ui/visuals.js`) only where there's an
   action. Mark the control with `data-aim`; `artEl()` lands the pointer's tip in its padding just
   past the label, measured from layout, so it never covers the words. (`agent`, `merge`)
9. **Window plus companion.** A large surface cropped by the frame edge, with a smaller crisp
   element (the composer, the toolbar) layered over one corner.
10. **Title card** (motion only). One centred line in Inter, grey and sentence case, with one word
    in ink.
11. **Macro detail with depth of field.**
    - 1–2 real components at 1.8–2.3×, crisp, over a far plane of related UI blurred past
      legibility (blur 5 px+, opacity about 0.3–0.45). That blur means the crop never cuts readable
      text. (`markup`)
    - Near and mid elements differ in scale and blur, and they never cover each other's text.
12. **Focus pull.** A real list exploded into separate surfaces. The item that matters is in focus
    at 1.3–1.6×, with full elevation and the pointer on its control. Its neighbours step away in
    scale (1.1 → 1.06), opacity (0.45 → 0.3) and blur (2 → 3.5 px). (`merge`, `recipes`)
13. **Popover on a cropped surface.** A close crop of a real surface with its own popover open (a
    comment peek, a menu), anchored to its trigger and spilling past the surface's edge. Open it
    into empty space, so it never covers text. (`intro`)
14. **System lines** (use sparingly). Components as nodes joined by 1 px connectors with rounded
    elbows. They read as a SaaS diagram; use them only when the point is literally a flow.

Prefer devices 1, 5, 6, 11, 12 and 13: close, layered, in-focus UI reads as product craft. Node
graphs, bento grids, orb gradients and primary-colour block compositions read as generic.

## 4. Composition

- One focal element per frame; everything else supports it.
- Crop by the frame edge on purpose, but never cut text mid-word and never truncate a label with
  "…". Shorten the label or widen the element.
- No text over text. Overlaps happen on surfaces and empty areas only.
- Everything sits inside the design box unless it deliberately bleeds off an edge.
- References are a framework, not a template: never reuse a reference's own elements, copy or exact
  layout.

## 5. Content rules (the art ships live)

- No names of people, no avatars or profile photos, no real company or client names. The agent
  appears as a product ("Claude", with the spark icon in `.pv-ag`), never as an avatar circle.
- No placeholder text, lorem ipsum or sample fields. Hide rows you can't fill truthfully.
- **Nothing made up stands in for a prototype** (Atelier's own rule): a frame shows Atelier's empty
  state ("Ask an agent to design it") or a wireframe blurred past legibility, never a fake app.
- No text repeated within a frame, including echoing the dialog title or the card caption in the
  art.
- Content reads like real work in Atelier's domain, kept generic: branch names ("Roomier cards",
  "Denser sidebar"), requests ("Make the button bolder"), notes ("Tighten the cards, they feel
  cramped"), style changes ("#hmGrid · gap · none → 32px"), recipes ("Polish pass · 5 runs ·
  4 merged").
- No explanatory callouts or tooltips in the art. The copy lives in the dialog's text column, the
  card caption or the post.
- Selected or active items show their selected state as the product does: Atelier's icons are
  outline only, so selection is the accent colour (`--text-accent`) and the raised pill
  (`--raise` / `--sh-btn`), not a filled icon.

## 6. Fades

- Soft only: an eased gradient running over at least 30 % of the element. Never a short hard band.
- Fade the context, never the hero. Prefer depth (opacity plus blur on `piece()`) to masks.
- If a mask is needed, use `mask-image` with an eased `linear-gradient` of 10–14 stops (see the
  helper below), never two stops.

## 7. Building (in code: `workshop/ui/visuals.js`)

- Build only from Atelier's own classes: `.pg` rows, `.shd` headers, `.pinpeek`, `.toast`, `.note`,
  `.ccomp` / `.cagent`, `.isec.rcard`, `.tagro`, `.createbtn` / `.dbtn`, `.isel` selection
  handles, `.pempty` empty states, and `IC` icons. Search `ui/app.css` before inventing a surface.
- Add a picture as an entry in `ART` (a function returning HTML) and a step in `FEATURES` (title,
  one plain sentence, optional real action). Pieces go through `piece(x, y, html, { w, s, o, b, z,
  cls })` in the 360 × 240 design box.
- Hand-drawn marks come from the real pen engine: `ring()` and `arrow()` (built on
  `outline()` from `ui/ink.js`), drawn in a `.pv-ink` SVG with the `.ik red` / `.ik green` fills.
- **Tokens.** Surfaces and shadows come from the token block at the top of `ui/app.css`. Raw values
  are only for blooms and depth, and new colours become tokens (with a dark pair) before use: no new
  hex values outside the token block.
- Component classes that are absolute or hidden on the canvas (`.pinpeek`, `.toast`, `.note`) are
  reset for pictures under `.pv` in `ui/app.css`; reuse those resets, don't restyle the component.
- **Hi-res stills.** Render the page in Playwright with `deviceScaleFactor: 2` and screenshot the
  `.pv` element.
- **If a Figma copy is asked for** (Plugin API): build at 1×, then `rescale()`; instance children
  set to FILL ignore a parent rescale, so rescale those one by one and restore FILL afterwards; a
  gradient mask doesn't fade a frame with `clipsContent = true`; clone the frame, `rescale(k)` the
  clone, screenshot it, then delete it; clear the target frame first so a retry is safe.

Helpers:

```js
// eased stops for a soft fade (p0..p1 = positions 0..1, a0..a1 = alpha), as CSS
const eased = (p0, p1, a0, a1, n = 12) =>
  Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1), s = t * t * (3 - 2 * t);
    return `rgba(0,0,0,${(a0 + (a1 - a0) * s).toFixed(3)}) ${((p0 + (p1 - p0) * t) * 100).toFixed(1)}%`;
  }).join(",");
// a vertical mask (top → bottom)
const vMask = (stops) => `linear-gradient(180deg,${stops})`;
```

## 8. Motion (films and the app)

- Title words reveal letter by letter (opacity plus a slight blur), and one word lands in ink.
- Scattered objects drift in depth, then converge on the hero.
- The hero enters with the house ease (`--ease-smooth`): a small rise and a 2 px blur settle. The
  pointer travels to the control (`--ease-io`) before it toggles.
- Window shots push in slowly, and companions arrive after the window lands.
- In the Learn dialog a step change swaps the art with a 240 ms fade from a 4 px blur and the copy
  with a 150 ms fade from a 2 px blur; arrow keys change steps without animation.
- Reduced motion keeps opacity and drops travel and blur.

## 9. Audit (script it, then render)

Run this in Playwright over every picture before showing it (on the Learn page, `#/learn`, where
every picture is on screen at once):

```js
const issues = [];
for (const card of document.querySelectorAll(".lcard")) {
  const name = card.querySelector(".lcap b").textContent;
  const pieces = [...card.querySelectorAll(".pv-x")];
  // every run of text, as glyph rectangles (a box can be bigger than its words)
  const texts = pieces.flatMap((pc, i) => {
    const out = [], w = document.createTreeWalker(pc, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode()); ) {
      if (!n.textContent.trim()) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      for (const rect of r.getClientRects()) out.push({ i, n, rect, t: n.textContent.trim() });
    }
    return out;
  });
  const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  // text over text: a later, visible piece over any glyphs
  for (const t of texts) for (const [j, pc] of pieces.entries()) {
    if (j <= t.i || +getComputedStyle(pc).opacity < 0.5) continue;
    const box = pc.classList.contains("pv-aim") ? pc.querySelector("svg").getBoundingClientRect() : pc.getBoundingClientRect();
    if (hit(t.rect, box) && !pc.contains(t.n)) issues.push(`${name}: "${t.t}" is covered`);
  }
  // duplicates and truncation
  const all = texts.map((t) => t.t);
  for (const t of new Set(all)) if (all.filter((x) => x === t).length > 1) issues.push(`${name}: "${t}" repeats`);
  for (const t of all) if (/…|\.\.\.$/.test(t)) issues.push(`${name}: "${t}" is truncated`);
  // people and avatars
  if (card.querySelector(".cav, [class*=avatar]")) issues.push(`${name}: an avatar`);
}
```

Checklist:

- [ ] One focal element; its look and device(s) named.
- [ ] Atelier's own classes only; nothing redrawn.
- [ ] No names, avatars, companies, placeholders, fake prototypes or repeats; no truncation; no text
      over text.
- [ ] Fades soft; far planes blurred past legibility wherever they're cropped.
- [ ] Selected states as the product shows them (accent and the raised pill).
- [ ] Pointers only on controls, aimed with `data-aim`.
- [ ] Checked in a render on its own and in context, in light and dark.
- [ ] `npm test` passes (the content-rule test in `test/ui.test.js` covers the source).

## 10. Creative direction check

Run it before a new direction, and whenever the directions start to look alike.

1. **Sample 6–10 references.**
   - Galleries for breadth: Land-book (SaaS), Landing Love, Godly, Lapa Ninja, Mobbin, and
     Pinterest (needs a login).
   - Category leaders for depth: design and prototyping tools (Figma, Paper, Flora, Framer),
     best-in-class work tools (Linear, Attio, Notion), and calm AI products.
   - Screenshot each site's hero and one or two product sections.
2. **Note five things per reference:** the canvas, how the UI is framed (window, crop, isolated
   component, diagram), the depth device, the type voice, and the motion.
3. **Extract 2–3 candidate directions.** A direction is a look plus one or two devices, not a single
   site. Name each one in a few words.
4. **Check each candidate against the product.**
   - It must show real components and follow the content rules.
   - It must suit Atelier's tone: calm, plain, a little playful, product-led (studio white, ink,
     one blue, hand-drawn marks as the human touch).
   - It must differ from the existing directions in look and device, not just layout.
5. **Pick one**, add any new device to §3, and build it as a new `ART` entry next to the existing
   ones for comparison.
6. **Log it.** Add a dated table (reference | canvas | framing | device to borrow), the sites you
   couldn't sample, the candidates, the choice and its reasons, in §12. Log revisions too.

Guardrails:

- Borrow the device, never the assets, copy or layout.
- No trend for its own sake.
- If a site is blocked or behind a login, note it and move on.

## 11. Project specifics

- **Design system:** code, not a Figma library. Tokens at the top of `workshop/ui/app.css` (studio
  white: `--bg-layer`, `--raise`, `--sh-btn`, `--sh-md`, `--sh-modal`, `--text-accent`, the `--pv-*`
  and `--bloom-*` picture tokens, with dark pairs); component skins in its Skins block; icons in `IC`
  (`workshop/ui/lib.js`, outline only); Inter for everything (`--fakt`), Inter Bold for the
  wordmark only (`--display`), Shantell Sans for notes (`--hand`); fonts from craft-fonts.
- **Components that suit product shots:** branch rows (`.pg`, `.shd`), the comment peek
  (`.pinpeek`), the composer with the agent switch (`.ccomp`, `.cagent`), toasts (`.toast`), sticky
  notes (`.note.warm`), recipe cards (`.isec.rcard`, `.rcbar`), selection handles (`.isel`), the
  empty state (`.pempty`), the toolbar (`#tb`), pills (`.createbtn`, `.dbtn`), meta tags
  (`.tagro`), and hand-drawn marks from `ui/ink.js`.
- **Background assets:** none; the studio light and blooms are CSS (`.pv`, `.pv-bloom`). No photo
  or texture assets exist, and none may be added without a licence row in `ATTRIBUTION.md`.
- **Existing reference frames or files:** the pictures in `workshop/ui/visuals.js` (intro, branch,
  markup, agent, merge, recipes); the first-run intro in `workshop/ui/intro.js`; the owner's
  reference frames in the Figma file "Libra UX Improvements" (Shopify admin home 9177:2, Paper Learn
  9643:20632, Flora home 9643:21159), used as references only.
- **Product tone and voice:** sentence case, verb-first buttons, plain and calm, short sentences
  that say what changes for the person ("Change anything on a branch while Main stays as it is").
- **Domain-appropriate sample content (generic, no names):** branches "Roomier cards", "Denser
  sidebar", "Tighter cards"; requests "Make the button bolder"; notes "Tighten the cards, they feel
  cramped"; changes "#hmGrid · gap · none → 32px", ".cards · padding", ".side · width"; recipes
  "Polish pass", "Tidy spacing", "Check contrast"; toasts "Branch ready to review".

## 12. Lessons

From the first project that used this; each of these was rejected, so don't repeat them:

- A dark explanatory callout beside the UI. The UI should tell the story.
- Literal screen crops with no layering.
- Reusing a reference's elements.
- Placeholder people, avatars, repeated text and hard fade bands in art that ships live.
- A "mix" that only rearranged earlier panels.
- Node-and-connector diagrams, which read as SaaS marketing rather than product craft.

From Atelier:

- A wall of ~20 literal app parts at once (the first intro) read as generated. One story with a few
  large pieces works.
- Abstract primary-colour blocks read as a generic template, not as the product.
- Made-up apps standing in for prototypes, with no real buttons behind them. Show empty states.
- A peek or toast placed over the words it's next to, and a pointer covering its button's label:
  measure text as glyphs, and aim pointers with `data-aim`.

What worked:

- macro detail with depth of field
- focus pulls
- popovers on cropped surfaces
- soft depth instead of hard fades
- one consistent direction per flow

### Direction log

| Date | Direction | Look + devices | Why |
|---|---|---|---|
| 2026-11-23 | Studio light, in depth | Studio light; hero at scale, popover on a cropped surface, lift, macro DOF, focus pull, pointer on the control | Matches the studio-white app; product-led like the references (Shopify admin, Paper, Flora); every piece real |
