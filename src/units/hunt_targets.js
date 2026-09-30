// Shared player automation / AI decisions. Only visible prey, known corpses and explored habitat.
import { STRUCTURES } from '../data/structures.js';
import { WEAPONS } from '../data/weapons.js';
import { EMPLACEMENT_WEAPONS } from '../data/emplacements.js';
import { SPECIES } from '../data/animals.js';
import { unitDef } from '../data/units.js';
import { areHostile, sideBit, sideIndex } from '../data/factions.js';
import { dist } from '../core/dmath.js';
import { isExploredAt } from '../world/fog.js';
import { sideAnchor, enemyHomeAnchor } from '../sim/sides.js';

export function huntThreat(sim, fid, x, z, radius = 40, weapons = true) {
  const bit = sideBit(fid);
  for (const q of sim.state.squads) {
    if (!areHostile(fid, q.faction) || !(q.visibleTo & bit) || !unitDef(q.type).combatUnit) continue;
    if (dist(q.cx, q.cz, x, z) < radius && q.members.some((m) => m.state === 'alive')) return true;
  }
  if (weapons) for (const st of sim.state.structures) {
    if (!areHostile(fid, st.holder || st.faction) || !((st.visibleTo | st.seenBy) & bit) || st.hp <= 0) continue;
    const d = STRUCTURES[st.type], w = WEAPONS[d.weapon] || EMPLACEMENT_WEAPONS[d.emplacement];
    if (w && dist(st.x, st.z, x, z) < w.range + 8) return true;
  }
  return false;
}
export function huntRouteSafe(sim, fid, gang, x, z) {
  const safe = gang.safeHunt !== 0, radius = safe ? 42 : 16;
  if (safe) {
    const home = sideAnchor(sim, fid, 'home'), enemy = enemyHomeAnchor(sim, fid);
    const dx = enemy[0] - home[0], dz = enemy[1] - home[1];
    const advance = ((x - home[0]) * dx + (z - home[1]) * dz) / Math.max(1, dx * dx + dz * dz);
    // An explored field beyond the front is still exposed unless an own drop-off supports it.
    if (advance > 0.6 && !sim.state.structures.some((s) => s.faction === fid && s.built && STRUCTURES[s.type].dropOff && dist(x, z, s.x, s.z) < 60)) return false;
  }
  // Coarse safety corridor, not omniscient pathfinding. Navigation resolves actual terrain.
  for (let k = 1; k <= 4; k++) {
    const t = k / 4;
    if (huntThreat(sim, fid, gang.cx + (x - gang.cx) * t, gang.cz + (z - gang.cz) * t, radius, safe)) return false;
  }
  return true;
}
export function forageSpot(sim, fid, gang) {
  const bit = sideBit(fid), range = gang.safeHunt === 0 ? 460 : 320;
  let best = null, score = Infinity;
  for (const a of sim.state.animals) {
    if (!(a.visibleTo & bit)) continue;
    const d = dist(gang.cx, gang.cz, a.x, a.z), s = d - SPECIES[a.sp].biomass * 6;
    if (d > range || s >= score || !huntRouteSafe(sim, fid, gang, a.x, a.z)) continue;
    score = s; best = { x: a.x, z: a.z, kind: 'animal', id: a.id };
  }
  for (const c of sim.state.corpses) {
    if (c.infected || c.riseAt || c.biomass < 0.5 || !(c.seenBy & bit)) continue;
    const d = dist(gang.cx, gang.cz, c.x, c.z), s = d - c.biomass * 2;
    if (d > range || s >= score || !huntRouteSafe(sim, fid, gang, c.x, c.z)) continue;
    score = s; best = { x: c.x, z: c.z, kind: 'corpse', id: c.id };
  }
  return best;
}
export function habitatSpot(sim, fid, gang, memo = {}) {
  let best = null, score = Infinity;
  for (const h of sim.world.habitats || []) {
    if ((memo[h.id] || 0) > sim.state.tick || !isExploredAt(sim.state.fog, sideIndex(fid), h.x, h.z)) continue;
    const d = dist(gang.cx, gang.cz, h.x, h.z);
    if (d > (gang.safeHunt === 0 ? 480 : 360) || d >= score || !huntRouteSafe(sim, fid, gang, h.x, h.z)) continue;
    score = d; best = h;
  }
  return best;
}
