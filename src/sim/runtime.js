// Runtime acceleration structures derived from GameState + world (never serialized).
// Everything here can be rebuilt from state at any time (e.g. after loading a save), so results
// never depend on whether a runtime cache existed.
import { createNav, rebuildNavDynamic } from '../world/nav.js';
import { createStructGrid, structGridRebuild } from '../world/structgrid.js';
import { ensureOccupancy } from '../construction/trench.js';
import { FOG_LAYERS } from '../data/factions.js';

export function createPointGrid(width, height, cs) {
  const cols = Math.ceil(width / cs), rows = Math.ceil(height / cs);
  return {
    cs, cols, rows,
    head: new Int32Array(cols * rows).fill(-1),
    next: new Int32Array(1024),
    refs: [],
    owners: [],
    count: 0,
  };
}

export function pointGridReset(g) {
  g.head.fill(-1);
  g.count = 0;
}

export function pointGridAdd(g, x, z, ref, owner) {
  const cx = Math.floor(x / g.cs), cz = Math.floor(z / g.cs);
  if (cx < 0 || cz < 0 || cx >= g.cols || cz >= g.rows) return;
  const i = g.count++;
  if (i >= g.next.length) {
    const n = new Int32Array(g.next.length * 2);
    n.set(g.next);
    g.next = n;
  }
  g.refs[i] = ref;
  g.owners[i] = owner;
  const cell = cz * g.cols + cx;
  g.next[i] = g.head[cell];
  g.head[cell] = i;
}

/** Iterate entries within radius r of (x,z): fn(ref, owner, d2). Deterministic order. */
export function pointGridQuery(g, x, z, r, fn) {
  const x0 = Math.max(0, Math.floor((x - r) / g.cs)), x1 = Math.min(g.cols - 1, Math.floor((x + r) / g.cs));
  const z0 = Math.max(0, Math.floor((z - r) / g.cs)), z1 = Math.min(g.rows - 1, Math.floor((z + r) / g.cs));
  const r2 = r * r;
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      for (let i = g.head[cz * g.cols + cx]; i !== -1; i = g.next[i]) {
        const ref = g.refs[i];
        const dx = ref.x - x, dz = ref.z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 <= r2) fn(ref, g.owners[i], d2);
      }
    }
  }
}

export function createRuntime(sim) {
  const { world } = sim;
  const rt = {
    squadById: new Map(),
    structById: new Map(),
    nodeById: new Map(),
    corpseById: new Map(),
    soldierIndex: new Map(), // soldier id -> squad
    nav: createNav(world),
    structGrid: createStructGrid(world.width, world.height, 8),
    soldierGrid: createPointGrid(world.width, world.height, 2),
    corpseGrid: createPointGrid(world.width, world.height, 4),
    structVersion: 0,
    visionSources: Array.from({ length: FOG_LAYERS }, () => []),
    pathWork: 0, // A* expansions spent this tick (see PATH_WORK_PER_TICK)
    perf: { tickMs: 0, aiMs: 0, pathMs: 0 },
  };
  sim.rt = rt;
  reindexAll(sim);
  structuresChanged(sim);
  return rt;
}

export function reindexAll(sim) {
  const { state, rt } = sim;
  rt.squadById.clear();
  rt.structById.clear();
  rt.nodeById.clear();
  rt.corpseById.clear();
  rt.soldierIndex.clear();
  for (const sq of state.squads) {
    rt.squadById.set(sq.id, sq);
    for (const m of sq.members) rt.soldierIndex.set(m.id, sq);
  }
  for (const s of state.structures) rt.structById.set(s.id, s);
  for (const n of state.nodes) rt.nodeById.set(n.id, n);
  for (const c of state.corpses) rt.corpseById.set(c.id, c);
}

export function structuresChanged(sim) {
  const { state, rt } = sim;
  for (const s of state.structures) if (s.type === 'trench') ensureOccupancy(s);
  structGridRebuild(rt.structGrid, state.structures);
  rebuildNavDynamic(rt.nav, state.structures);
  rt.structVersion++;
}

export function rebuildSoldierGrid(sim) {
  const { state, rt } = sim;
  const g = rt.soldierGrid;
  pointGridReset(g);
  for (const sq of state.squads) {
    for (const m of sq.members) {
      if (m.state === 'alive' || m.state === 'joining') pointGridAdd(g, m.x, m.z, m, sq);
    }
  }
}

export function rebuildCorpseGrid(sim) {
  const { state, rt } = sim;
  const g = rt.corpseGrid;
  pointGridReset(g);
  for (const c of state.corpses) pointGridAdd(g, c.x, c.z, c, null);
}
