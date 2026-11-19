// overrides.css: a flat list of rules that the inspector and agents both edit.
// Pure functions with no Node imports, so the server and the hosted service worker share them.

export const SELECTOR_CHARS = 1_000;
export const VALUE_CHARS = 400;
export const PROP_RE = /^-{0,2}[a-z][a-z0-9-]{0,63}$/;

export class CssError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.status = 400;
  }
}

// Splits CSS into top-level chunks: comments, plain rules and anything else (kept verbatim).
export function parseCss(css) {
  const out = [];
  let i = 0;
  const n = css.length;
  while (i < n) {
    if (/\s/.test(css[i])) {
      let j = i;
      while (j < n && /\s/.test(css[j])) j++;
      out.push({ kind: "ws", text: css.slice(i, j) });
      i = j;
      continue;
    }
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      const j = end < 0 ? n : end + 2;
      out.push({ kind: "comment", text: css.slice(i, j) });
      i = j;
      continue;
    }
    // a rule or at-rule: read the prelude up to "{" then the balanced block
    let j = i;
    let depth = 0;
    let quote = null;
    let preludeEnd = -1;
    for (; j < n; j++) {
      const c = css[j];
      if (quote) {
        if (c === "\\") j++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (css.startsWith("/*", j)) {
        const end = css.indexOf("*/", j + 2);
        j = end < 0 ? n : end + 1;
      } else if (c === "{") {
        if (depth === 0) preludeEnd = j;
        depth++;
      } else if (c === "}") {
        depth--;
        if (depth <= 0) {
          j++;
          break;
        }
      } else if (c === ";" && depth === 0) {
        j++;
        break;
      }
    }
    const text = css.slice(i, j);
    if (preludeEnd > 0 && !text.trimStart().startsWith("@")) {
      const selector = css.slice(i, preludeEnd).trim();
      const body = css.slice(preludeEnd + 1, j - 1);
      out.push({ kind: "rule", selector, decls: parseDecls(body), text });
    } else out.push({ kind: "other", text });
    i = j;
  }
  return out;
}

export function parseDecls(body) {
  const decls = [];
  let cur = "";
  let depth = 0;
  let quote = null;
  const push = () => {
    const k = cur.indexOf(":");
    if (k > 0) {
      const prop = cur.slice(0, k).trim().toLowerCase();
      const value = cur.slice(k + 1).trim();
      if (prop) decls.push([prop, value]);
    }
    cur = "";
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      cur += c;
      if (c === "\\") cur += body[++i] ?? "";
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ";" && depth <= 0) {
      push();
      continue;
    }
    cur += c;
  }
  push();
  return decls;
}

export const normSel = (s) => s.replace(/\s+/g, " ").replace(/\s*>\s*/g, " > ").trim();

function ruleText(selector, decls) {
  return `${selector} {\n${decls.map(([p, v]) => `  ${p}: ${v};`).join("\n")}\n}`;
}

export function checkSelector(selector) {
  const s = String(selector || "").trim();
  // Guard: a brace or a closing tag in a selector would break out of the rule (or the style tag).
  if (!s || s.length > SELECTOR_CHARS || /[{}]|<\//.test(s)) throw new CssError("bad_selector", "That selector can't be used in overrides");
  return s;
}

function checkValue(v) {
  const s = String(v ?? "").trim();
  if (s.length > VALUE_CHARS || /[{};]|<\//.test(s)) throw new CssError("bad_value", `That value can't be used: ${s.slice(0, 60)}`);
  return s;
}

export function mergeRule(css, selector, props) {
  const sel = checkSelector(selector);
  const chunks = parseCss(css);
  const target = chunks.find((c) => c.kind === "rule" && normSel(c.selector) === normSel(sel));
  const entries = Object.entries(props || {});
  for (const [p] of entries) if (!PROP_RE.test(p)) throw new CssError("bad_property", `Not a CSS property: ${String(p).slice(0, 40)}`);
  if (target) {
    for (const [p, raw] of entries) {
      const k = target.decls.findIndex(([q]) => q === p);
      if (raw === null || raw === "") {
        if (k >= 0) target.decls.splice(k, 1);
        continue;
      }
      const v = checkValue(raw);
      const val = /!important$/.test(v) ? v : `${v} !important`;
      if (k >= 0) target.decls[k][1] = val;
      else target.decls.push([p, val]);
    }
    target.text = target.decls.length ? ruleText(target.selector, target.decls) : "";
  } else {
    const decls = entries.filter(([, v]) => v !== null && v !== "").map(([p, v]) => {
      const val = checkValue(v);
      return [p, /!important$/.test(val) ? val : `${val} !important`];
    });
    if (decls.length) chunks.push({ kind: "ws", text: "\n\n" }, { kind: "rule", selector: sel, decls, text: ruleText(sel, decls) });
  }
  return chunks
    .map((c) => c.text)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
    .concat("\n");
}

export function rulesOf(css) {
  return parseCss(css)
    .filter((c) => c.kind === "rule")
    .map((c) => ({ selector: c.selector, decls: c.decls }));
}

export const OVERRIDES_HEAD = (name) =>
  `/* Design overrides for ${name.replace(/\*\//g, "")}.\n   The Workshop inspector and agents write here; these rules win over the prototype's own styles.\n   Fold them into index.html whenever you like. */\n`;

