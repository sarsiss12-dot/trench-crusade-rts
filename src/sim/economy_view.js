// Read-only fog-safe view model shared by world overlay, minimap and resource lens.
import { sideDef, sideIndex } from '../data/factions.js';
import { STRUCTURES } from '../data/structures.js';
import { isExploredAt, isVisibleAt } from '../world/fog.js';
import { isCorpseKnownTo, isAnimalVisibleTo, isSectorKnownTo, isNodeKnownTo } from './perception.js';
import { huntThreat } from '../units/hunt_targets.js';

export function usesResourceSectors(fid) { return sideDef(fid).economyView === 'sectors'; }
const CACHE = new WeakMap();
export function economyViewItems(sim, viewer) {
  let bySide = CACHE.get(sim);
  if (!bySide) { bySide = new Map(); CACHE.set(sim, bySide); }
  const old = bySide.get(viewer);
  if (old && sim.state.tick >= old.tick && sim.state.tick - old.tick < 20) return old.items;
  const mode = sideDef(viewer).economyView, state = sim.state, items = [], index = sideIndex(viewer);
  const push = (x, z, kind, r = 0, safe = true) => { if (items.length < 128) items.push({ x, z, kind, r, safe }); };
  for (const st of state.structures) {
    if (st.faction !== viewer || !st.built || st.hp <= 0) continue;
    const d = STRUCTURES[st.type];
    if (mode === 'hunting') {
      if (d.dropOff) push(st.x, st.z, 'dropoff', d.harvestRadius || 8);
      if (d.infectionSource) push(st.x, st.z, 'plague', d.infectionSource.radius);
    } else if (mode === 'nodes') {
      if (d.fortAnchor || d.heavyDefense) push(st.x, st.z, 'fortification', d.anchorRadius || 16);
      if (d.supplyRate || d.materialRate) push(st.x, st.z, 'depot', d.resupplyRadius || 8);
    }
  }
  if (mode === 'hunting') {
    for (const h of sim.world.habitats || []) if (isExploredAt(state.fog, index, h.x, h.z)) push(h.x, h.z, 'habitat', h.r || 18, !huntThreat(sim, viewer, h.x, h.z, 45));
    let n = 0;
    for (const c of state.corpses) if (c.biomass > 0 && isCorpseKnownTo(c, viewer) && n++ < 24) push(c.x, c.z, 'corpse', c.infected ? 2.5 : 1.5);
    n = 0;
    for (const a of state.animals) if (isAnimalVisibleTo(a, viewer) && n++ < 24) push(a.x, a.z, 'animal', 1);
    n = 0;
    const inf = state.infection;
    for (let i = 0; i < inf.v.length && n < 24; i++) {
      if (inf.v[i] < 100) continue;
      const x = (i % inf.cols + 0.5) * inf.cs, z = (Math.floor(i / inf.cols) + 0.5) * inf.cs;
      if (isVisibleAt(state.fog, index, x, z)) { push(x, z, 'infection', inf.cs * 0.55); n++; }
    }
  } else {
    for (const n of state.nodes) if (n.amount > 0 && isNodeKnownTo(n, viewer)) push(n.x, n.z, 'heap', 3);
    if (mode === 'sectors') for (const s of state.sectors) if (isSectorKnownTo(s, viewer)) push(s.x, s.z, 'sector', s.r);
  }
  bySide.set(viewer, { tick: state.tick, items }); return items;
}
