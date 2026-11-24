// Which layer a click selects, the way Figma does it (no DOM here, so it's tested in Node):
//
// - a click selects at the current level: with nothing selected inside the screen, its top-level
//   layer under the pointer; with a layer selected, the layer under the pointer that sits beside it
//   (the same parent), climbing out if the pointer has left that parent;
// - a double-click goes one level deeper into the selected layer;
// - Cmd/Ctrl-click selects the deepest layer under the pointer.
//
// Pass-through wrappers (a layer with one child the same size as itself, as pages often nest
// #app > .shell > .page) are skipped: choosing one moves on to the child, so a click never lands on
// an invisible box. So are page-sized layout containers (big(el): the shell, the content area, a
// grid that fills it): a web page nests the thing you see four or five boxes deep, and clicking it
// should select it, not the page around it. They stay reachable from the layer list.
//
// node: the deepest element under the pointer. root: the page's body. current: the selected layer
// in this screen, or null. same(a, b): whether two layers have the same box. big(el): whether a
// layer is a page-sized container.

export function pickLayer(node, { root, current = null, deep = false, deeper = false, same = () => false, big = () => false }) {
  if (!node || node === root) return null;
  if (deep) return node;
  // the path from the page down to the pointer: [top-level layer, …, node]
  const path = [];
  for (let x = node; x && x !== root; x = x.parentElement) path.unshift(x);
  if (!path.length || path[0].parentElement !== root) return null; // not inside this page
  const at = (i) => skipWrappers(path, i, same, big);
  const inPath = current ? path.indexOf(current) : -1;
  if (!current) return at(0);
  if (deeper) {
    // one level into the selected layer; on a leaf, the layer itself (double-click edits its text)
    if (inPath === -1) return at(0);
    return inPath === path.length - 1 ? current : at(inPath + 1);
  }
  // a single click: the layer beside the selected one, under the pointer
  for (let parent = current.parentElement; parent; parent = parent.parentElement) {
    if (parent === root) return at(0);
    const i = path.indexOf(parent);
    if (i !== -1) return at(i + 1 < path.length ? i + 1 : i);
  }
  return at(0);
}

// from path[i], move down through pass-through wrappers along the path
function skipWrappers(path, i, same, big) {
  let k = i;
  while (k + 1 < path.length) {
    const a = path[k],
      b = path[k + 1];
    const kids = a.children ? a.children.length : 0;
    if ((kids === 1 && same(a, b)) || big(a)) k++;
    else break;
  }
  return path[k];
}
