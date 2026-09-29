// Fog-of-war memory (presentation only, per viewer): what the local player KNOWS, as opposed to what
// the simulation knows. Enemy structures are shown live only while visible; otherwise the last
// snapshot taken while visible (including structures destroyed or built up since), until the spot is
// observed again. Resource heaps keep the amount last seen; infected ground keeps the rot last seen.
// Renderer, terrain carving, clutter, minimap, HUD and picking all read this memory, so none of them
// can leak what happened behind the fog. The memory survives a renderer rebuild (lost GPU context)
// and is stored with saves (outside the GameState: it is the player's knowledge, not the world).
import { isStructureVisibleTo, isStructureKnownTo, isPointVisibleTo, isNodeKnownTo } from '../sim/perception.js';
import { sideDef } from '../data/factions.js';
import { fogIndex } from '../world/fog.js';

function snapshot(st) {
  const s = { ...st };
  if (st.occ) s.occ = st.occ.slice();
  if (st.queue) s.queue = [];
  s.memory = true;
  return s;
}

/**
 * init (optional): a previous exportState() — structures, nodes and infection the viewer knew.
 * Without it (new match / old save) the first update primes the memory from the known state.
 */
export function createStructureMemory(init = null) {
  const snaps = new Map();
  const nodeSnaps = new Map();
  let inf = null; // Uint8Array snapshot of the infection grid as last seen
  const out = [];
  const nodeOut = [];
  let primed = false;
  if (init) {
    for (const s of init.structs || []) snaps.set(s.id, { ...s, memory: true });
    for (const n of init.nodes || []) nodeSnaps.set(n.id, { ...n });
    if (init.inf && init.inf.length) inf = Uint8Array.from(init.inf);
    primed = true;
  }

  function update(sim, viewer) {
    const { state, rt } = sim;
    for (const st of state.structures) {
      if (st.faction === viewer || st.faction === 'neutral') continue;
      if (isStructureVisibleTo(st, viewer)) snaps.set(st.id, snapshot(st));
      else if (!primed && isStructureKnownTo(st, viewer)) snaps.set(st.id, snapshot(st)); // first sight
    }
    for (const [id, s] of snaps) {
      if (rt.structById.has(id)) continue;
      // destroyed behind the fog: forget it only once the viewer sees the spot again
      if (isPointVisibleTo(sim, viewer, s.x, s.z)) snaps.delete(id);
    }
    // resource heaps: amount as last seen
    for (const n of state.nodes) {
      if (!isNodeKnownTo(n, viewer)) continue;
      if (!primed || isPointVisibleTo(sim, viewer, n.x, n.z) || !nodeSnaps.has(n.id)) {
        nodeSnaps.set(n.id, { id: n.id, type: n.type, x: n.x, z: n.z, amount: n.amount, max: n.max });
      }
    }
    primed = true;
  }

  /** Infected ground as the viewer knows it: refreshed only where the viewer sees right now. */
  function infection(sim, viewer) {
    const src = sim.state.infection;
    const n = src.cols * src.rows;
    if (!inf || inf.length !== n) inf = new Uint8Array(n);
    const fog = sim.state.fog;
    const f = sideDef(viewer);
    if (!f) { inf.set(src.v); return inf; }
    const vis = fog.vis[f.index];
    for (let z = 0; z < src.rows; z++) {
      for (let x = 0; x < src.cols; x++) {
        const i = z * src.cols + x;
        const fi = fogIndex(fog, x * src.cs + src.cs / 2, z * src.cs + src.cs / 2);
        if (fi >= 0 && vis[fi]) inf[i] = src.v[i];
      }
    }
    return inf;
  }

  /** Structures as the viewer knows them: own + neutral + visible enemy (live) + remembered enemy. */
  function list(sim, viewer) {
    out.length = 0;
    for (const st of sim.state.structures) {
      if (st.faction === viewer || st.faction === 'neutral' || isStructureVisibleTo(st, viewer)) out.push(st);
    }
    for (const s of snaps.values()) {
      const live = sim.rt.structById.get(s.id);
      if (live && isStructureVisibleTo(live, viewer)) continue;
      out.push(s);
    }
    return out;
  }

  /** Discovered resource heaps with the amount the viewer last saw (depleted ones included, amount 0). */
  function nodes() {
    nodeOut.length = 0;
    for (const n of nodeSnaps.values()) nodeOut.push(n);
    return nodeOut;
  }

  /** The structure with this id as the viewer knows it (live when visible / own, else the snapshot). */
  function known(sim, viewer, id) {
    const live = sim.rt.structById.get(id);
    if (live && (live.faction === viewer || live.faction === 'neutral' || isStructureVisibleTo(live, viewer))) return live;
    return snaps.get(id) || null;
  }

  function exportState() {
    return {
      structs: [...snaps.values()].map((s) => ({ ...s })),
      nodes: [...nodeSnaps.values()].map((n) => ({ ...n })),
      inf: inf ? inf.slice() : null, // typed array: base64 in the save codec
    };
  }

  function reset() {
    snaps.clear();
    nodeSnaps.clear();
    inf = null;
    primed = false;
  }

  return { update, list, nodes, known, infection, exportState, reset, snaps };
}
