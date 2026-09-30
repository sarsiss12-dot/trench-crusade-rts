// Minimal event/DOM harness for the real HUD builders. Does not claim to test browser layout.
export class TestElement {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.attrs = {};
    this.events = {}; this.parentNode = null; this.disabled = false; this._text = ''; this._html = '';
    const classes = new Set();
    this.classList = { add: (...xs) => xs.forEach((x) => classes.add(x)), remove: (...xs) => xs.forEach((x) => classes.delete(x)),
      contains: (x) => classes.has(x), toggle: (x, on) => { on = on === undefined ? !classes.has(x) : on; on ? classes.add(x) : classes.delete(x); return on; } };
  }
  get firstChild() { return this.children[0]; }
  get lastChild() { return this.children[this.children.length - 1]; }
  get textContent() { return this._text + this._html.replace(/<[^>]*>/g, '') + this.children.map((c) => c.textContent).join(''); }
  set textContent(s) { this._text = String(s); this._html = ''; this.children.length = 0; }
  get innerHTML() { return this._html; }
  set innerHTML(s) { this._html = s; this._text = ''; this.children.length = 0; }
  appendChild(n) { this.children.push(n); n.parentNode = this; return n; }
  append(...ns) { for (const n of ns) this.appendChild(n); }
  prepend(n) { this.children.unshift(n); n.parentNode = this; }
  insertBefore(n, before) { const i = this.children.indexOf(before); if (i < 0) return this.appendChild(n); this.children.splice(i, 0, n); n.parentNode = this; return n; }
  removeChild(n) { this.children.splice(this.children.indexOf(n), 1); n.parentNode = null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(k, fn) { (this.events[k] ||= []).push(fn); }
  dispatch(k, fields = {}) {
    const e = { type: k, target: this, stopped: false, prevented: false,
      stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; }, ...fields };
    for (const fn of this.events[k] || []) fn(e);
    return e;
  }
  click() { if (!this.disabled) this.dispatch('click'); }
  querySelectorAll(selector) {
    const out = [], classes = [...selector.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
    const tag = /^[a-z]+/.exec(selector)?.[0], attr = /\[data-([\w-]+)="([^"]*)"\]/.exec(selector);
    const visit = (node) => { for (const c of node.children) {
      if ((!tag || c.tagName === tag) && classes.every((x) => c.classList.contains(x)) && (!attr || c.dataset[attr[1]] === attr[2])) out.push(c);
      visit(c);
    } };
    visit(this); return out;
  }
  querySelector(s) { return this.querySelectorAll(s)[0] || null; }
}
export function installDOM() {
  const prior = globalThis.document;
  globalThis.document = { createElement: (tag) => new TestElement(tag), createTextNode: (text) => { const n = new TestElement('#text'); n.textContent = text; return n; } };
  return () => { if (prior === undefined) delete globalThis.document; else globalThis.document = prior; };
}
