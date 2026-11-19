// Puts the Workshop runtime into a prototype page: first in <head> (so storage is namespaced before
// any app script runs) and the overrides stylesheet last (so design tweaks win over the page's own
// styles). Pure, no Node imports: the server and the hosted service worker both use it.

const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function injectHtml(html, env, settings) {
  const tag = `<script src="/_workshop/runtime.js" data-env="${escAttr(env)}" data-settings="${escAttr(JSON.stringify(settings || {}))}"></script>`;
  const link = `<link rel="stylesheet" href="/env/${escAttr(env)}/__overrides.css" data-workshop-overrides>`;
  let out = html;
  const head = /<head(\s[^>]*)?>/i.exec(out);
  if (head) out = out.slice(0, head.index + head[0].length) + tag + out.slice(head.index + head[0].length);
  else {
    const h = /<html(\s[^>]*)?>/i.exec(out);
    if (h) out = out.slice(0, h.index + h[0].length) + tag + out.slice(h.index + h[0].length);
    else out = tag + out;
  }
  const lower = out.toLowerCase();
  const end = lower.lastIndexOf("</body>");
  out = end >= 0 ? out.slice(0, end) + link + out.slice(end) : out + link;
  return out;
}

