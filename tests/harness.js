// Minimal zero-dependency test harness.
export const registry = [];

export function test(name, fn) {
  registry.push({ name, fn, file: currentFile.name });
}

export const currentFile = { name: '' };

class AssertionError extends Error {}

function fmt(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

export const assert = {
  ok(v, msg) {
    if (!v) throw new AssertionError(msg || 'expected truthy, got ' + fmt(v));
  },
  equal(a, b, msg) {
    if (a !== b) throw new AssertionError((msg ? msg + ': ' : '') + 'expected ' + fmt(b) + ', got ' + fmt(a));
  },
  notEqual(a, b, msg) {
    if (a === b) throw new AssertionError((msg ? msg + ': ' : '') + 'expected values to differ, both ' + fmt(a));
  },
  deepEqual(a, b, msg) {
    const sa = fmt(a), sb = fmt(b);
    if (sa !== sb) throw new AssertionError((msg ? msg + ': ' : '') + 'deep mismatch\n  got      ' + sa.slice(0, 400) + '\n  expected ' + sb.slice(0, 400));
  },
  approx(a, b, eps, msg) {
    if (!(Math.abs(a - b) <= eps)) throw new AssertionError((msg ? msg + ': ' : '') + `expected ${b}±${eps}, got ${a}`);
  },
  greater(a, b, msg) {
    if (!(a > b)) throw new AssertionError((msg ? msg + ': ' : '') + `expected ${a} > ${b}`);
  },
  less(a, b, msg) {
    if (!(a < b)) throw new AssertionError((msg ? msg + ': ' : '') + `expected ${a} < ${b}`);
  },
  throws(fn, msg) {
    let threw = false;
    try { fn(); } catch { threw = true; }
    if (!threw) throw new AssertionError(msg || 'expected function to throw');
  },
};
