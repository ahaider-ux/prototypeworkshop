/* Workshop runtime — injected as the first script of every environment page the Workshop serves.
   It gives each environment its own browser storage (so a fork never shares state with its parent),
   applies the environment's saved settings (theme, opening screen, state, variants, text edits),
   and exposes window.__workshop so the canvas can inspect and drive the page.

   A prototype can describe its own screens and variants by defining window.workshopEnv:
     { screens: [{group, name}] | () => [...], screen: () => name, go: name => void,
       states: [...], setState: s => void,
       variants: () => [{label, options, value}], setVariant: (label, option) => void,
       theme: t => void }
   Libra prototypes with the prototype tools bar are understood without any changes. */
(function () {
  "use strict";
  var me = document.currentScript;
  var ENV = (me && me.getAttribute("data-env")) || "";
  var SETTINGS = {};
  try { SETTINGS = JSON.parse((me && me.getAttribute("data-settings")) || "{}") || {}; } catch (e) { SETTINGS = {}; }
  try {
    /* each board on the canvas is the same prototype at its own screen: /env/<id>/?ws-screen=Chat&ws-state=Empty */
    var q = new URLSearchParams(location.search);
    if (q.has("ws-screen")) SETTINGS.screen = q.get("ws-screen") || null;
    if (q.has("ws-state")) SETTINGS.state = q.get("ws-state") || null;
  } catch (e) {}
  var doc = document, root = doc.documentElement;
  root.classList.add("ws-env");
  var embedded = false;
  try { embedded = window.parent !== window && !!window.parent.__workshopCanvas; } catch (e) { embedded = false; }
  if (embedded) root.classList.add("ws-embed");

  /* ---- storage: one namespace per environment ---- */
  function shim(real, prefix) {
    var mem = {};
    function keys() {
      var out = [];
      try { for (var i = 0; i < real.length; i++) { var k = real.key(i); if (k && k.indexOf(prefix) === 0) out.push(k.slice(prefix.length)); } }
      catch (e) { out = Object.keys(mem); }
      return out;
    }
    var api = {
      getItem: function (k) { try { var v = real.getItem(prefix + k); return v; } catch (e) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; } },
      setItem: function (k, v) { try { real.setItem(prefix + k, String(v)); } catch (e) { mem[k] = String(v); } },
      removeItem: function (k) { try { real.removeItem(prefix + k); } catch (e) { delete mem[k]; } },
      clear: function () { keys().forEach(function (k) { api.removeItem(k); }); },
      key: function (i) { return keys()[i] === undefined ? null : keys()[i]; }
    };
    Object.defineProperty(api, "length", { get: function () { return keys().length; } });
    return api;
  }
  ["localStorage", "sessionStorage"].forEach(function (name) {
    try {
      var real = window[name];
      if (!real) return;
      var s = shim(real, "ws:" + ENV + ":");
      Object.defineProperty(window, name, { configurable: true, get: function () { return s; } });
    } catch (e) { /* storage blocked: the page keeps whatever it had */ }
  });

  /* ---- selectors the inspector and agents can write rules against ---- */
  var STATE = { on: 1, open: 1, active: 1, "is-open": 1, show: 1, cur: 1, sel: 1, selected: 1, hover: 1, focus: 1, chg: 1, "in": 1, out: 1, off: 1, vis: 1, fading: 1, ready: 1, gready: 1, live: 1 };
  function esc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, "\\$&"); }
  function selectorFor(el, exact) {
    if (!el || el.nodeType !== 1) return "";
    var parts = [];
    while (el && el.nodeType === 1 && el !== root) {
      if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && doc.querySelectorAll("#" + esc(el.id)).length === 1) { parts.unshift("#" + esc(el.id)); break; }
      var s = el.localName;
      var cls = [];
      for (var i = 0; i < el.classList.length && cls.length < 2; i++) { var c = el.classList[i]; if (/^[A-Za-z_][\w-]*$/.test(c) && !STATE[c] && c.indexOf("ws-") !== 0) cls.push(c); }
      if (cls.length) s += "." + cls.map(esc).join(".");
      var p = el.parentElement;
      if (p && (exact || !cls.length)) {
        var same = [], all = p.children;
        for (var j = 0; j < all.length; j++) if (all[j].localName === el.localName) same.push(all[j]);
        if (same.length > 1) s += ":nth-of-type(" + (same.indexOf(el) + 1) + ")";
      }
      parts.unshift(s);
      if (el === doc.body) break;
      el = p;
    }
    return parts.join(" > ");
  }
  var STYLE_KEYS = ["display", "position", "width", "height", "padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-bottom", "gap", "border-radius", "background-color", "color", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align", "opacity", "box-shadow", "border-top-width", "border-top-style", "border-top-color", "flex-direction", "flex-wrap", "align-items", "justify-content", "translate", "rotate", "overflow", "visibility", "flex-grow", "flex-basis", "align-self", "order", "min-width", "max-width"];
  function describe(el) {
    if (!el || el.nodeType !== 1) return null;
    var cs = getComputedStyle(el), st = {};
    STYLE_KEYS.forEach(function (k) { st[k] = cs.getPropertyValue(k); });
    var r = el.getBoundingClientRect();
    var html = el.outerHTML.replace(/data:[^"')\s]{40,}/g, "data:…");
    if (html.length > 3000) html = html.slice(0, 3000) + "…";
    var text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    var sel = selectorFor(el, false), exact = selectorFor(el, true), n = 0;
    try { n = doc.querySelectorAll(sel).length; } catch (e) { n = 0; }
    var ownText = "";
    var kids = el.childNodes, onlyText = el.children.length === 0;
    for (var i = 0; i < kids.length; i++) if (kids[i].nodeType === 3) ownText += kids[i].nodeValue;
    var cls = [];
    for (var j = 0; j < el.classList.length; j++) if (el.classList[j].indexOf("ws-") !== 0) cls.push(el.classList[j]);
    return {
      env: ENV, tag: el.localName, id: el.id || "", classes: cls, label: label(el),
      selector: sel, exactSelector: exact, matches: n,
      text: text.slice(0, 600), ownText: ownText.replace(/\s+/g, " ").trim().slice(0, 600), editableText: onlyText && text.length > 0 && text.length <= 600,
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      styles: st, html: html
    };
  }
  function label(el) {
    var cls = "";
    for (var i = 0; i < el.classList.length; i++) { var c = el.classList[i]; if (!STATE[c] && c.indexOf("ws-") !== 0) { cls = c; break; } }
    return el.localName + (el.id ? "#" + el.id : cls ? "." + cls : "");
  }

  /* ---- adapters: what screens, states and variants this prototype offers ---- */
  function hiddenClick(html) {
    var h = doc.createElement("div");
    h.className = "pbpop ws-ghost";
    h.setAttribute("aria-hidden", "true");
    h.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none";
    h.innerHTML = html;
    doc.body.appendChild(h);
    try { h.firstElementChild && h.firstElementChild.click(); } finally { setTimeout(function () { h.remove(); }, 0); }
  }
  function txt(el) { return el ? (el.textContent || "").replace(/\s+/g, " ").trim() : ""; }
  var LIBRA_SCREENS = [
    ["Workspace", ["Home", "Templates", "Global database", "Legal sources"]],
    ["Project", ["Chat", "Review", "Discovery", "Drafting", "Project files"]],
    ["Settings", ["General", "Memory", "Integrations", "Tool activation", "Team", "Subscription"].map(function (x) { return "Settings › " + x; })],
    ["Flows", ["Sign-up · V1 Card", "Sign-up · V2 Guided"]]
  ];
  var libra = {
    name: "Libra prototype tools",
    detect: function () { return !!(doc.getElementById("tunePanel") && (window.protoBar || doc.querySelector(".pbpop"))); },
    screens: function () { var out = []; LIBRA_SCREENS.forEach(function (g) { g[1].forEach(function (n) { out.push({ group: g[0], name: n }); }); }); return out; },
    screen: function () {
      if (doc.querySelector(".content.set")) { var c = doc.getElementById("crSetName"); return "Settings" + (c && txt(c) ? " › " + txt(c) : ""); }
      var on = doc.querySelector(".sidebar .sb-item.on .lbl") || doc.querySelector(".sidebar .sb-item.on");
      return on ? txt(on) : "";
    },
    go: function (n) {
      if (n === "Sign-up · V1 Card") { if (window.suStart) window.suStart(); return; }
      if (n === "Sign-up · V2 Guided") { if (window.ob2Start) window.ob2Start(); return; }
      hiddenClick('<button type="button" data-scr="' + String(n).replace(/"/g, "&quot;") + '"></button>');
    },
    states: ["Default", "Loading", "Empty", "No results", "Error"],
    setState: function (s) { hiddenClick('<button type="button" class="pchip" data-st="' + String(s).replace(/"/g, "&quot;") + '"></button>'); },
    segs: function () {
      var out = [], pop = doc.querySelector('.pbpop[data-p="alt"]');
      if (!pop) return out;
      var segs = pop.querySelectorAll(".seg:not(.pseg)");
      for (var i = 0; i < segs.length; i++) {
        var s = segs[i], g = s.closest(".tgrp");
        var lab = s.getAttribute("aria-label") || txt(g && g.querySelector(".tttl")) || "Variant";
        var bs = s.querySelectorAll("button"), opts = [], val = "";
        for (var j = 0; j < bs.length; j++) { var t = txt(bs[j]); opts.push(t); if (bs[j].classList.contains("on")) val = t; }
        if (opts.length > 1) out.push({ label: lab, options: opts, value: val, el: s });
      }
      return out;
    },
    variants: function () { return libra.segs().map(function (v) { return { label: v.label, options: v.options, value: v.value }; }); },
    setVariant: function (lab, opt) {
      var v = libra.segs().filter(function (x) { return x.label === lab; })[0];
      if (!v) return false;
      var bs = v.el.querySelectorAll("button");
      for (var j = 0; j < bs.length; j++) if (txt(bs[j]) === opt) { if (!bs[j].classList.contains("on")) bs[j].click(); return true; }
      return false;
    },
    theme: function (t) { if (window.libraTheme && window.libraTheme.set) window.libraTheme.set(t); }
  };
  var custom = {
    name: "workshopEnv",
    detect: function () { return !!window.workshopEnv; },
    screens: function () { var s = window.workshopEnv.screens; s = typeof s === "function" ? s() : s; return (s || []).map(function (x) { return typeof x === "string" ? { group: "Screens", name: x } : x; }); },
    screen: function () { return window.workshopEnv.screen ? String(window.workshopEnv.screen() || "") : ""; },
    go: function (n) { if (window.workshopEnv.go) window.workshopEnv.go(n); },
    get states() { return (window.workshopEnv && window.workshopEnv.states) || []; },
    setState: function (s) { if (window.workshopEnv.setState) window.workshopEnv.setState(s); },
    variants: function () { var v = window.workshopEnv.variants; return (typeof v === "function" ? v() : v) || []; },
    setVariant: function (l, o) { return window.workshopEnv.setVariant ? window.workshopEnv.setVariant(l, o) : false; },
    theme: function (t) { if (window.workshopEnv.theme) window.workshopEnv.theme(t); else plain.theme(t); }
  };
  var plain = {
    name: "",
    detect: function () { return true; },
    screens: function () { return []; }, screen: function () { return ""; }, go: function () {},
    states: [], setState: function () {}, variants: function () { return []; }, setVariant: function () { return false; },
    theme: function (t) {
      var mode = t === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : t;
      root.setAttribute("data-theme", mode);
      root.style.colorScheme = mode;
    }
  };
  function adapter() { return custom.detect() ? custom : libra.detect() ? libra : plain; }

  /* ---- applying settings ---- */
  function applyTheme(t) {
    if (!t) return;
    try { adapter().theme(t); } catch (e) {}
  }
  var textPatches = [];
  function applyText() {
    var left = 0;
    textPatches.forEach(function (p) {
      var nodes = [];
      try { nodes = doc.querySelectorAll(p.selector); } catch (e) { return; }
      if (!nodes.length) { left++; return; }
      for (var i = 0; i < nodes.length; i++) if (nodes[i].children.length === 0 && nodes[i].textContent !== p.text) nodes[i].textContent = p.text;
    });
    return left;
  }
  function apply(s, opts) {
    s = s || {};
    var first = opts && opts.first;
    if (s.theme) applyTheme(s.theme);
    var a = adapter();
    var t = 0;
    if (s.screen && (first || (opts && opts.screen))) { setTimeout(function () { try { a.go(s.screen); } catch (e) {} }, t += 120); }
    if (s.variants) {
      setTimeout(function () {
        Object.keys(s.variants).forEach(function (k) { try { a.setVariant(k, s.variants[k]); } catch (e) {} });
      }, t += 380);
    }
    if (s.state && s.state !== "Default" && (first || (opts && opts.state))) setTimeout(function () { try { a.setState(s.state); } catch (e) {} }, t += 420);
    textPatches = (s.patches || []).filter(function (p) { return p && p.type === "text" && p.selector; });
    if (textPatches.length) {
      [t + 200, t + 900, t + 2500].forEach(function (ms) { setTimeout(applyText, ms); });
    }
  }

  function ready(fn) { if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", fn, { once: true }); else fn(); }

  if (SETTINGS.theme === "dark" || SETTINGS.theme === "light") {
    root.setAttribute("data-ltheme", SETTINGS.theme);
  }

  window.__workshop = {
    env: ENV,
    embedded: embedded,
    settings: SETTINGS,
    adapter: function () { var a = adapter(); return { name: a.name, screens: a.screens(), screen: a.screen(), states: a.states || [], variants: a.variants() }; },
    go: function (n) { adapter().go(n); },
    setState: function (s) { adapter().setState(s); },
    setVariant: function (l, o) { return adapter().setVariant(l, o); },
    setTheme: applyTheme,
    apply: function (s, o) { SETTINGS = s || SETTINGS; apply(SETTINGS, o); },
    selectorFor: selectorFor,
    describe: describe,
    label: label,
    /* the canvas hands over the latest overrides.css text, so a tweak shows without a reload or a flash */
    setOverrides: function (css) {
      var s = doc.querySelector("style[data-workshop-live]");
      if (!s) { s = doc.createElement("style"); s.setAttribute("data-workshop-live", ""); (doc.body || root).appendChild(s); }
      s.textContent = String(css || "");
      var l = doc.querySelector("link[data-workshop-overrides]");
      if (l) l.disabled = true;
    },
    applyText: function (patches) { textPatches = (patches || []).filter(function (p) { return p && p.type === "text" && p.selector; }); applyText(); }
  };

  ready(function () {
    /* the prototype's own tools hints would sit on top of every board; on the canvas, the canvas is the toolbar */
    if (embedded) {
      var st = doc.createElement("style");
      st.setAttribute("data-workshop", "");
      st.textContent = "html.ws-embed :is(.cchint,.pbnudge){display:none!important}";
      (doc.head || root).appendChild(st);
    }
    setTimeout(function () { apply(SETTINGS, { first: true }); }, 60);
  });
})();
