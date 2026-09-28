// Support auras of ELITES (Phase 3, reworked in 4.1): Trench Cleric (SANCTIFIED PRESENCE),
// Lieutenant (COMMAND COHESION), Herald (fly cloud), Lord of Tumours (tumour court), and
// consecrated aid stations (Faith & Medicine). All passive — no ability buttons.
// STACKING RULE: an aura has a KIND (data: units.js aura.kind). Auras of the SAME kind never stack
// numerically — a soldier inside two Lieutenants' areas gets ONE command bonus (the strongest);
// two Lieutenants far apart simply cover a wider front (the UNION of their areas). Different kinds
// combine (a Lieutenant and a Cleric both help the same soldier).
// Runtime lists derived from state (rt.auras) — rebuilt 2 Hz by combat and whenever a simulation is
// created / loaded, so readers never see a stale or missing list.
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
    auras[sq.faction].push({ ...a, kind: a.kind || sq.type, x: sq.cx, z: sq.cz, r: a.radius, sq: sq.id });
  }
  for (const fid in FACTIONS) {
    if (!specRule(state, fid, 'consecrate')) continue;
    for (const st of state.structures) {
      if (st.faction !== fid || !st.built || !STRUCTURES[st.type].heal) continue;
      auras[fid].push({ kind: 'consecrated_station', x: st.x, z: st.z, r: 20, consecrate: 20 });
    }
  }
}

const BEST = new Map();

/**
 * Value of an aura key covering (x, z) for a faction: per KIND the strongest covering aura (no
 * same-kind stacking), summed over the different kinds (0 when none).
 */
export function auraValue(sim, faction, x, z, key) {
  const list = sim.rt.auras && sim.rt.auras[faction];
  if (!list || !list.length) return 0;
  BEST.clear();
  for (const a of list) {
    const v = a[key];
    if (!v) continue;
    const dx = a.x - x, dz = a.z - z;
    if (dx * dx + dz * dz > a.r * a.r) continue;
    const k = a.kind || '';
    if (!BEST.has(k) || v > BEST.get(k)) BEST.set(k, v);
  }
  let v = 0;
  for (const b of BEST.values()) v += b;
  return v;
}

/** Is (x, z) inside ANY aura of this kind (union coverage)? Returns the covering aura or null. */
export function auraOfKindAt(sim, faction, kind, x, z) {
  const list = sim.rt.auras && sim.rt.auras[faction];
  if (!list) return null;
  let best = null;
  for (const a of list) {
    if (a.kind !== kind) continue;
    const dx = a.x - x, dz = a.z - z;
    if (dx * dx + dz * dz <= a.r * a.r && (!best || a.sq < best.sq)) best = a;
  }
  return best;
}

/** The distinct aura kinds of a faction's list (deterministic order of first appearance). */
export function auraKinds(sim, faction) {
  const list = sim.rt.auras && sim.rt.auras[faction];
  const out = [];
  if (!list) return out;
  for (const a of list) if (out.indexOf(a.kind) < 0) out.push(a.kind);
  return out;
}
