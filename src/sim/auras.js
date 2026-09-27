// Support auras (Phase 3): Trench Cleric, Lieutenant, Herald, Lord of Tumours, and consecrated aid
// stations (Faith & Medicine). Runtime lists derived from state (rt.auras) — rebuilt 2 Hz by
// combat and whenever a simulation is created / loaded, so readers (combat accuracy, infection
// resistance, consecration against rising) never see a stale or missing list.
import { unitDef } from '../data/units.js';
import { STRUCTURES } from '../data/structures.js';
import { FACTIONS } from '../data/factions.js';
import { specRule } from './specialities.js';

export function rebuildAuras(sim) {
  const { state, rt } = sim;
  const auras = rt.auras || (rt.auras = {});
  for (const fid in FACTIONS) { if (!auras[fid]) auras[fid] = []; auras[fid].length = 0; }
  for (const sq of state.squads) {
    const a = unitDef(sq.type).aura;
    if (!a || !auras[sq.faction]) continue;
    let alive = false;
    for (const m of sq.members) if (m.state === 'alive') { alive = true; break; }
    if (!alive) continue;
    auras[sq.faction].push({ ...a, x: sq.cx, z: sq.cz, r: a.radius, sq: sq.id });
  }
  for (const fid in FACTIONS) {
    if (!specRule(state, fid, 'consecrate')) continue;
    for (const st of state.structures) {
      if (st.faction !== fid || !st.built || !STRUCTURES[st.type].heal) continue;
      auras[fid].push({ x: st.x, z: st.z, r: 20, consecrate: 20 });
    }
  }
}

/** Strongest value of an aura key covering (x, z) for a faction (0 when none). */
export function auraValue(sim, faction, x, z, key) {
  const list = sim.rt.auras && sim.rt.auras[faction];
  if (!list) return 0;
  let v = 0;
  for (const a of list) {
    if (!a[key]) continue;
    const dx = a.x - x, dz = a.z - z;
    if (dx * dx + dz * dz <= a.r * a.r && a[key] > v) v = a[key];
  }
  return v;
}
