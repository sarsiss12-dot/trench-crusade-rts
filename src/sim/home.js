// Faction-aware "home" focus point (HOME button, initial camera). Pure function of state + world:
// 1) the faction's living, built HQ structure (FACTIONS[fid].home.hq) — several candidates (e.g.
//    multiple Grail Altars) resolve deterministically to the one nearest the faction anchor;
// 2) otherwise the faction-specific map anchor (FACTIONS[fid].home.anchor);
// 3) otherwise any own living structure, then the faction's side of the map.
// There is no global hard-coded home: AI factions, saves and reloads all go through this.
import { FACTIONS } from '../data/factions.js';

export function factionHome(sim, fid) {
  const { state, world } = sim;
  const fdef = FACTIONS[fid] || {};
  const h = fdef.home || {};
  const anchors = world.anchors || {};
  const anchor = h.anchor && anchors[h.anchor] && anchors[h.anchor][0];
  const front = h.front || 0;
  const hq = h.hq || [];
  let best = null, bestD = Infinity;
  const refX = anchor ? anchor[0] : world.width / 2, refZ = anchor ? anchor[1] : world.height / 2;
  for (const s of state.structures) {
    if (s.faction !== fid || s.hp <= 0 || !s.built || hq.indexOf(s.type) < 0) continue;
    const dx = s.x - refX, dz = s.z - refZ;
    const d = dx * dx + dz * dz;
    if (d < bestD || (d === bestD && best && s.id < best.id)) { best = s; bestD = d; }
  }
  if (best) return { x: best.x, z: best.z + front, source: 'hq', sid: best.id };
  if (anchor) return { x: anchor[0], z: anchor[1], source: 'anchor', sid: 0 };
  for (const s of state.structures) {
    if (s.faction === fid && s.hp > 0) return { x: s.x, z: s.z, source: 'structure', sid: s.id };
  }
  const role = state.factions[fid] && state.factions[fid].role;
  return { x: world.width / 2, z: role === 'defender' ? world.height - 90 : 90, source: 'side', sid: 0 };
}
