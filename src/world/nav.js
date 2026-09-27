// Grid navigation: squad-level A* with typed arrays, path smoothing, connectivity components,
// LRU path cache, and dynamic layers (building blockers, linear structures per faction).
// Individual soldiers never run A*; they steer to formation slots around the squad anchor.
import { STRUCTURES } from '../data/structures.js';
import { TERRAIN_TYPES } from '../data/terrain_types.js';
import { FACTIONS, FACTION_ORDER } from '../data/factions.js';
import { linearCellsVisit } from '../construction/trench.js';
import { dsin, dcos } from '../core/dmath.js';

const SQRT2 = 1.4142135623730951;
const MIN_COST = 1 / 1.15;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
// which line wins a shared cell (the more obstructive one); unknown types rank as walls
const LINEAR_PRIORITY = {
  trench: 1, low_sandbags: 2, sandbags: 3, bone_barricade: 3, breastwork: 4, timber_wall: 5, wire: 6, fortified_wall: 7,
};
export const PATH_MAX_EXPANSIONS = 70000;
const CACHE_SIZE = 128;

export function createNav(world) {
  const t = world.terrain;
  const n = t.cols * t.rows;
  const nav = {
    cols: t.cols, rows: t.rows, cell: t.cell, n, terrain: t,
    baseCost: new Float32Array(n),
    blocked: new Uint8Array(n),
    linear: new Array(n).fill(null),
    comp: new Int32Array(n),
    typeMult: [],
    version: 0,
    g: new Float64Array(n),
    parent: new Int32Array(n),
    stamp: new Uint32Array(n),
    closed: new Uint32Array(n),
    gen: 0,
    heapNodes: new Int32Array(n * 2 + 16),
    heapF: new Float64Array(n * 2 + 16),
    heapH: new Float64Array(n * 2 + 16),
    heapSize: 0,
    queue: new Int32Array(n),
    cache: new Map(),
    stats: { searches: 0, cacheHits: 0, expansions: 0 },
    lastCost: 0, // A* expansions of the last findPath (a cache hit reports what its search cost)
  };
  for (let i = 0; i < n; i++) {
    const sp = t.speed[i];
    nav.baseCost[i] = sp > 0 ? 1 / sp : 0;
  }
  // per faction terrain cost multipliers (e.g. Black Grail faster on infected ground)
  for (const fid of FACTION_ORDER) {
    const mods = FACTIONS[fid].terrainSpeed || {};
    const arr = new Float32Array(TERRAIN_TYPES.length);
    TERRAIN_TYPES.forEach((tt, i) => { arr[i] = mods[tt.id] ? 1 / mods[tt.id] : 1; });
    nav.typeMult.push(arr);
  }
  computeComponents(nav);
  return nav;
}

function markRect(nav, cx, cz, w, d, rot, shrink, fn) {
  const t = nav.terrain;
  const r = Math.sqrt(w * w + d * d) * 0.5 + 1;
  const s = dsin(rot), c = dcos(rot);
  const x0 = Math.max(0, Math.floor((cx - r) / t.cell)), x1 = Math.min(t.cols - 1, Math.floor((cx + r) / t.cell));
  const z0 = Math.max(0, Math.floor((cz - r) / t.cell)), z1 = Math.min(t.rows - 1, Math.floor((cz + r) / t.cell));
  for (let iz = z0; iz <= z1; iz++) {
    for (let ix = x0; ix <= x1; ix++) {
      const x = ix * t.cell + t.cell * 0.5 - cx, z = iz * t.cell + t.cell * 0.5 - cz;
      const lx = -x * c + z * s, lz = x * s + z * c;
      if (Math.abs(lx) <= w * 0.5 - shrink && Math.abs(lz) <= d * 0.5 - shrink) fn(iz * t.cols + ix);
    }
  }
}

/** Visit cells covered by a building footprint (same rule for nav + placement). */
export function footprintCellsVisit(nav, s, fn) {
  const def = STRUCTURES[s.type];
  markRect(nav, s.x, s.z, def.footprint.w, def.footprint.d, s.rot || 0, 0.2, fn);
}

/** Rebuild dynamic nav layers from the structure list. Deterministic. */
export function rebuildNavDynamic(nav, structures) {
  nav.blocked.fill(0);
  nav.linear.fill(null);
  for (const s of structures) {
    const def = STRUCTURES[s.type];
    if (def.kind === 'linear') {
      if (!s.built && s.progress < 0.3) continue;
      if (def.blocks) {
        // solid wall sections (fortified wall) block movement like a building; the gaps between
        // segments are the passages (a later gate system can open / close them)
        linearCellsVisit(nav.terrain, s, def.width * 0.5, (idx) => { nav.blocked[idx] = 1; });
        continue;
      }
      linearCellsVisit(nav.terrain, s, def.width * 0.5, (idx) => {
        const prev = nav.linear[idx];
        if (!prev || (LINEAR_PRIORITY[s.type] || 4) > (LINEAR_PRIORITY[prev.type] || 4)) nav.linear[idx] = s;
      });
    } else if (def.kind === 'building' && def.blocks) {
      footprintCellsVisit(nav, s, (idx) => { nav.blocked[idx] = 1; });
    }
  }
  computeComponents(nav);
  nav.version++;
  nav.cache.clear();
}

export function isPassable(nav, idx) {
  return idx >= 0 && nav.baseCost[idx] > 0 && nav.blocked[idx] === 0;
}

export function cellAt(nav, x, z) {
  const cx = Math.floor(x / nav.cell), cz = Math.floor(z / nav.cell);
  if (cx < 0 || cz < 0 || cx >= nav.cols || cz >= nav.rows) return -1;
  return cz * nav.cols + cx;
}

export function isPointPassable(nav, x, z) {
  return isPassable(nav, cellAt(nav, x, z));
}

function linearCostMult(s, factionId) {
  const def = STRUCTURES[s.type];
  if (s.faction === factionId) return s.type === 'wire' ? 1.5 : s.type === 'trench' ? 1 : def.kind === 'linear' && def.cover ? 1.4 : 1;
  return def.pathCostMult || 1;
}

function cellCost(nav, idx, factionId, fIdx) {
  const b = nav.baseCost[idx];
  if (b === 0 || nav.blocked[idx]) return 0;
  let c = b * nav.typeMult[fIdx][nav.terrain.types[idx]];
  const s = nav.linear[idx];
  if (s !== null) c *= linearCostMult(s, factionId);
  return c;
}

/** Movement speed multiplier at a point (terrain + faction terrain mods + linear structures). */
export function moveSpeedMult(nav, x, z, factionId, fIdx, heavy) {
  const idx = cellAt(nav, x, z);
  if (idx < 0 || nav.blocked[idx]) return 0;
  const t = nav.terrain;
  const sp = t.speed[idx];
  if (sp <= 0) return 0;
  let m = sp / nav.typeMult[fIdx][t.types[idx]];
  const s = nav.linear[idx];
  if (s !== null) {
    const def = STRUCTURES[s.type];
    if (s.faction === factionId) m *= def.moveMultFriendly !== undefined ? def.moveMultFriendly : 1;
    else if (heavy && def.moveMultHeavy !== undefined) m *= def.moveMultHeavy;
    else m *= def.moveMultEnemy !== undefined ? def.moveMultEnemy : 1;
  }
  return m;
}

function computeComponents(nav) {
  const { cols, rows, comp, queue } = nav;
  comp.fill(-1);
  let label = 0;
  const n = cols * rows;
  for (let i = 0; i < n; i++) {
    if (comp[i] !== -1 || !isPassable(nav, i)) continue;
    let head = 0, tail = 0;
    queue[tail++] = i;
    comp[i] = label;
    while (head < tail) {
      const cur = queue[head++];
      const cx = cur % cols, cz = (cur / cols) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k], nz = cz + DZ[k];
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
        const ni = nz * cols + nx;
        if (comp[ni] !== -1 || !isPassable(nav, ni)) continue;
        if (k >= 4 && (!isPassable(nav, cz * cols + nx) || !isPassable(nav, nz * cols + cx))) continue;
        comp[ni] = label;
        queue[tail++] = ni;
      }
    }
    label++;
  }
  nav.componentCount = label;
}

/** Nearest passable cell to idx within maxR rings (optionally same component). Deterministic. */
export function nearestPassable(nav, idx, maxR, compReq = -1) {
  const { cols, rows } = nav;
  const ox = idx % cols, oz = (idx / cols) | 0;
  for (let r = 1; r <= maxR; r++) {
    let best = -1, bestD = 1e18;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const nx = ox + dx, nz = oz + dz;
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
        const ni = nz * cols + nx;
        if (!isPassable(nav, ni)) continue;
        if (compReq >= 0 && nav.comp[ni] !== compReq) continue;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = ni; }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

function heapPush(nav, node, f, h) {
  const N = nav.heapNodes, F = nav.heapF, H = nav.heapH;
  let i = nav.heapSize++;
  if (i >= N.length) { nav.heapSize--; return; }
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (F[p] < f || (F[p] === f && H[p] <= h)) break;
    N[i] = N[p]; F[i] = F[p]; H[i] = H[p];
    i = p;
  }
  N[i] = node; F[i] = f; H[i] = h;
}

function heapPop(nav) {
  const N = nav.heapNodes, F = nav.heapF, H = nav.heapH;
  const top = N[0];
  const n = --nav.heapSize;
  if (n > 0) {
    const node = N[n], f = F[n], h = H[n];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= n) break;
      const r = l + 1;
      const c = r < n && (F[r] < F[l] || (F[r] === F[l] && H[r] < H[l])) ? r : l;
      if (F[c] > f || (F[c] === f && H[c] >= h)) break;
      N[i] = N[c]; F[i] = F[c]; H[i] = H[c];
      i = c;
    }
    N[i] = node; F[i] = f; H[i] = h;
  }
  return top;
}

function octile(ax, az, bx, bz) {
  const dx = Math.abs(ax - bx), dz = Math.abs(az - bz);
  return (dx > dz ? dx - dz + SQRT2 * dz : dz - dx + SQRT2 * dx) * MIN_COST;
}

function lineWalkable(nav, a, b, factionId, fIdx) {
  const cols = nav.cols;
  const ax = (a % cols) + 0.5, az = ((a / cols) | 0) + 0.5;
  const bx = (b % cols) + 0.5, bz = ((b / cols) | 0) + 0.5;
  const limit = Math.max(cellCost(nav, a, factionId, fIdx), cellCost(nav, b, factionId, fIdx), 1.0) * 1.05 + 0.001;
  const dx = bx - ax, dz = bz - az;
  const len = Math.sqrt(dx * dx + dz * dz);
  const steps = Math.ceil(len / 0.35);
  let prevCx = Math.floor(ax), prevCz = Math.floor(az);
  for (let k = 1; k <= steps; k++) {
    const x = ax + (dx * k) / steps, z = az + (dz * k) / steps;
    const cx = Math.floor(x), cz = Math.floor(z);
    if (cx === prevCx && cz === prevCz) continue;
    const idx = cz * cols + cx;
    const c = cellCost(nav, idx, factionId, fIdx);
    if (c === 0 || c > limit) return false;
    if (cx !== prevCx && cz !== prevCz) {
      // diagonal transition: both corner cells must be walkable
      const c1 = cellCost(nav, prevCz * cols + cx, factionId, fIdx);
      const c2 = cellCost(nav, cz * cols + prevCx, factionId, fIdx);
      if (c1 === 0 || c2 === 0) return false;
    }
    prevCx = cx; prevCz = cz;
  }
  return true;
}

/** Every cell touched by the world-space segment is passable (0.25m sampling). */
export function worldLineClear(nav, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const n = Math.ceil(Math.sqrt(dx * dx + dz * dz) / 0.25);
  for (let k = 0; k <= n; k++) {
    if (!isPassable(nav, cellAt(nav, ax + (dx * k) / Math.max(1, n), az + (dz * k) / Math.max(1, n)))) return false;
  }
  return true;
}

/**
 * Find a squad path. Returns { points:[x,z,...] (excluding start), reached:boolean } or null.
 * Deterministic for identical nav state + inputs (the cache only returns identical results).
 */
export function findPath(nav, factionId, sx, sz, gx, gz) {
  nav.lastCost = 0;
  const fIdx = FACTIONS[factionId] ? FACTIONS[factionId].index : 0;
  const { cols } = nav;
  let s = cellAt(nav, sx, sz), g = cellAt(nav, gx, gz);
  if (s < 0 || g < 0) return null;
  if (!isPassable(nav, s)) {
    s = nearestPassable(nav, s, 6);
    if (s < 0) return null;
  }
  let exact = true;
  if (!isPassable(nav, g)) {
    g = nearestPassable(nav, g, 16, nav.comp[s]);
    exact = false;
    if (g < 0) return null;
  }
  if (nav.comp[s] !== nav.comp[g]) {
    g = nearestPassable(nav, g, 40, nav.comp[s]);
    exact = false;
    if (g < 0) return null;
  }
  nav.stats.searches++;
  const key = factionId + '|' + s + '|' + g;
  let entry = nav.cache.get(key);
  if (entry) {
    nav.cache.delete(key);
    nav.cache.set(key, entry);
    nav.stats.cacheHits++;
  } else {
    const e0 = nav.stats.expansions;
    const found = astar(nav, s, g, factionId, fIdx);
    const cost = nav.stats.expansions - e0;
    if (!found) { nav.lastCost = cost; return null; }
    entry = { cells: found, cost };
    nav.cache.set(key, entry);
    if (nav.cache.size > CACHE_SIZE) nav.cache.delete(nav.cache.keys().next().value);
  }
  nav.lastCost = entry.cost;
  const cells = entry.cells;
  const half = nav.cell * 0.5;
  const points = [];
  for (let i = 1; i < cells.length; i++) {
    const c = cells[i];
    points.push((c % cols) * nav.cell + half, ((c / cols) | 0) * nav.cell + half);
  }
  // the squad starts at its exact position (not the cell center): keep the first leg clear
  const scx = (s % cols) * nav.cell + half, scz = ((s / cols) | 0) * nav.cell + half;
  if (points.length && !worldLineClear(nav, sx, sz, points[0], points[1])) points.unshift(scx, scz);
  if (exact) {
    if (points.length === 0) points.push(gx, gz);
    else {
      const n = points.length;
      const px = n >= 4 ? points[n - 4] : scx, pz = n >= 4 ? points[n - 3] : scz;
      if (worldLineClear(nav, px, pz, gx, gz)) { points[n - 2] = gx; points[n - 1] = gz; }
      else points.push(gx, gz); // goal cell center kept, then the exact goal inside it
    }
  } else if (points.length === 0) {
    points.push((g % cols) * nav.cell + half, ((g / cols) | 0) * nav.cell + half);
  }
  return { points, reached: exact };
}

function astar(nav, s, goal, factionId, fIdx) {
  const { cols, rows } = nav;
  const G = nav.g, P = nav.parent, ST = nav.stamp, CL = nav.closed;
  nav.gen = (nav.gen + 1) >>> 0;
  if (nav.gen === 0) { ST.fill(0); CL.fill(0); nav.gen = 1; }
  const gen = nav.gen;
  nav.heapSize = 0;
  const gx = goal % cols, gz = (goal / cols) | 0;
  G[s] = 0; ST[s] = gen; P[s] = -1;
  const h0 = octile(s % cols, (s / cols) | 0, gx, gz);
  heapPush(nav, s, h0, h0);
  let expanded = 0, found = false;
  while (nav.heapSize > 0) {
    const cur = heapPop(nav);
    if (CL[cur] === gen) continue;
    CL[cur] = gen;
    if (cur === goal) { found = true; break; }
    if (++expanded > PATH_MAX_EXPANSIONS) break;
    const cx = cur % cols, cz = (cur / cols) | 0;
    const gcur = G[cur];
    const ccur = cellCost(nav, cur, factionId, fIdx);
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k], nz = cz + DZ[k];
      if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
      const ni = nz * cols + nx;
      if (CL[ni] === gen) continue;
      const cn = cellCost(nav, ni, factionId, fIdx);
      if (cn === 0) continue;
      if (k >= 4) {
        if (cellCost(nav, cz * cols + nx, factionId, fIdx) === 0 || cellCost(nav, nz * cols + cx, factionId, fIdx) === 0) continue;
      }
      const ng = gcur + (k >= 4 ? SQRT2 : 1) * (ccur + cn) * 0.5;
      if (ST[ni] !== gen || ng < G[ni]) {
        ST[ni] = gen; G[ni] = ng; P[ni] = cur;
        const h = octile(nx, nz, gx, gz);
        heapPush(nav, ni, ng + h, h);
      }
    }
  }
  nav.stats.expansions += expanded;
  if (!found) return null;
  const raw = [];
  for (let c = goal; c !== -1; c = P[c]) raw.push(c);
  raw.reverse();
  return smoothPath(nav, raw, factionId, fIdx);
}

function smoothPath(nav, raw, factionId, fIdx) {
  if (raw.length <= 2) return raw;
  const out = [raw[0]];
  let anchor = 0;
  for (let k = 2; k < raw.length; k++) {
    if (k - anchor > 48 || !lineWalkable(nav, raw[anchor], raw[k], factionId, fIdx)) {
      out.push(raw[k - 1]);
      anchor = k - 1;
    }
  }
  out.push(raw[raw.length - 1]);
  return out;
}
