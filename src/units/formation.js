// Squad formations: centered local offsets (right = x, forward = z) for n soldiers.
// Pure functions + small cache. Individual soldiers follow slots around the squad anchor.
import { hashFloat } from '../core/rng.js';

export const FORMATIONS = Object.freeze({
  line: { id: 'line', key: 'formation.line' },
  column: { id: 'column', key: 'formation.column' },
  spread: { id: 'spread', key: 'formation.spread' },
  wedge: { id: 'wedge', key: 'formation.wedge' },
  cluster: { id: 'cluster', key: 'formation.cluster' },
  horde: { id: 'horde', key: 'formation.horde' },
});

export const PLAYER_FORMATIONS = ['line', 'column', 'spread', 'wedge'];

const cache = new Map();

export function formationOffsets(formation, n, spacing) {
  const key = formation + ':' + n + ':' + spacing;
  let res = cache.get(key);
  if (res) return res;
  res = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    let x = 0, z = 0;
    switch (formation) {
      case 'column': {
        const row = Math.floor(i / 2), col = i % 2;
        x = (col - 0.5) * spacing * 0.9;
        z = -row * spacing * 1.1;
        break;
      }
      case 'spread': {
        x = (i - (n - 1) / 2) * spacing * 1.85;
        z = i % 2 ? -0.9 : 0.9;
        break;
      }
      case 'wedge': {
        if (i === 0) { x = 0; z = spacing; }
        else {
          const k = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
          x = side * k * spacing * 0.95;
          z = spacing - k * spacing * 0.9;
        }
        break;
      }
      case 'cluster': {
        if (i === 0) break; // center man
        // ring of n-1 around the center; deterministic polygon from a constant table
        const k = Math.floor(((i - 1) / Math.max(1, n - 1)) * 12 + 0.5) % 12;
        const u = UNIT_CIRCLE[k];
        x = u[0] * spacing * 1.1;
        z = u[1] * spacing * 1.1;
        break;
      }
      case 'horde': {
        const perRow = Math.max(3, Math.ceil(Math.sqrt(n * 1.6)));
        const row = Math.floor(i / perRow), col = i % perRow;
        const cnt = Math.min(perRow, n - row * perRow);
        x = (col - (cnt - 1) / 2) * spacing + (hashFloat(i, n, 11) - 0.5) * spacing * 0.8;
        z = -row * spacing * 0.95 + (hashFloat(i, n, 23) - 0.5) * spacing * 0.9;
        break;
      }
      default: {
        // line: up to 5 wide single row, otherwise two ranks
        const perRow = n > 5 ? Math.ceil(n / 2) : n;
        const row = Math.floor(i / perRow), col = i % perRow;
        const cnt = Math.min(perRow, n - row * perRow);
        x = (col - (cnt - 1) / 2) * spacing;
        z = -row * spacing * 1.15;
      }
    }
    res[i * 2] = x;
    res[i * 2 + 1] = z;
  }
  // center on anchor
  let cx = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += res[i * 2]; cz += res[i * 2 + 1]; }
  cx /= n || 1; cz /= n || 1;
  for (let i = 0; i < n; i++) { res[i * 2] -= cx; res[i * 2 + 1] -= cz; }
  cache.set(key, res);
  return res;
}

// 12 unit directions (exact constants; no runtime trig)
const UNIT_CIRCLE = [
  [0, 1], [0.5, 0.8660254037844386], [0.8660254037844386, 0.5], [1, 0],
  [0.8660254037844386, -0.5], [0.5, -0.8660254037844386], [0, -1], [-0.5, -0.8660254037844386],
  [-0.8660254037844386, -0.5], [-1, 0], [-0.8660254037844386, 0.5], [-0.5, 0.8660254037844386],
];

/** Approximate squad footprint radius for a formation (for culling / picking / spacing). */
export function formationRadius(formation, n, spacing) {
  const offs = formationOffsets(formation, n, spacing);
  let r = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.sqrt(offs[i * 2] * offs[i * 2] + offs[i * 2 + 1] * offs[i * 2 + 1]);
    if (d > r) r = d;
  }
  return r + 1;
}
