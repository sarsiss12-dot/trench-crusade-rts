// Minimal DOM helpers for the UI layer (no framework).

/** Create an element: el('div.cls#id', { attrs / on* handlers }, children...) */
export function el(spec, props, ...children) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(spec);
  const node = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g) || []) {
      if (part[0] === '.') node.classList.add(part.slice(1));
      else node.id = part.slice(1);
    }
  }
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else node.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Button that never steals focus / double-fires on touch. */
export function button(cls, html, onClick, title) {
  const b = el('button.' + cls.split(' ').join('.'), { type: 'button', html, title: title || null, 'aria-label': title || null });
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!b.disabled) onClick(e);
  });
  return b;
}

/** Set textContent only when it changed (cheap per-frame updates). */
export function setText(node, text) {
  const s = String(text);
  if (node.textContent !== s) node.textContent = s;
}

export function setWidth(node, frac) {
  const w = Math.max(0, Math.min(100, frac * 100)).toFixed(1) + '%';
  if (node.style.width !== w) node.style.width = w;
}

export function toggleClass(node, cls, on) {
  if (node.classList.contains(cls) !== !!on) node.classList.toggle(cls, !!on);
}
