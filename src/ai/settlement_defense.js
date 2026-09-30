// Risk is a planning budget, not a currency. Enemy-facing arcs, visible pressure and memory.
import { STRUCTURES } from '../data/structures.js';
import { unitDef } from '../data/units.js';
import { areHostile, sideBit } from '../data/factions.js';
import { dist, clamp, datan2 } from '../core/dmath.js';
import { sideAnchor, enemyHomeAnchor } from '../sim/sides.js';
import { validatePlacement, heavyDefenseAllowed } from '../construction/construction.js';
import { unlockedBySpec } from '../sim/specialities.js';
import { policyFor } from './doctrine.js';

export function settlementRisk(sim, fid, st, ai = {}) {
  const state = sim.state, bit = sideBit(fid), home = sideAnchor(sim, fid, 'home');
  const enemy = enemyHomeAnchor(sim, fid);
  let ex = enemy[0], ez = enemy[1], nearest = 150, pressure = 0, guard = 0, corpses = 0, supply = false;
  for (const q of state.squads) {
    const d = dist(q.cx, q.cz, st.x, st.z);
    if (d > 150) continue;
    let n = 0; for (const m of q.members) if (m.state === 'alive') n++;
    if (q.faction === fid && d < 40 && unitDef(q.type).combatUnit) guard += n;
    else if (areHostile(fid, q.faction) && (q.visibleTo & bit) && n) {
      if (d < 80) pressure += n;
      if (d < nearest) { nearest = d; ex = q.cx; ez = q.cz; }
    }
  }
  for (const c of state.corpses) if (c.infected && (c.seenBy & bit) && dist(c.x, c.z, st.x, st.z) < 45) corpses += c.riseAt ? 3 : 1;
  for (const s of state.structures) if (s.faction === fid && s.built && STRUCTURES[s.type].resupplyRadius && dist(s.x, s.z, st.x, st.z) < 55) { supply = true; break; }
  const recent = state.tick - Math.max(st.lastDamageTick || -10000, (ai.seenThreat && ai.seenThreat[st.id]) || -10000) < 1200;
  const score = clamp(0.08 + dist(home[0], home[1], st.x, st.z) / 650 + Math.max(0, 150 - nearest) / 380 +
    Math.min(0.3, pressure / 100) + (recent ? 0.2 : 0) + Math.min(0.15, corpses * 0.025) + (supply ? 0 : 0.07) - Math.min(0.16, guard * 0.004), 0, 1);
  const tier = score >= 0.68 ? 3 : score >= 0.42 ? 2 : score >= 0.22 ? 1 : 0;
  const d = Math.max(1, dist(st.x, st.z, ex, ez));
  return { score, tier, label: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'][tier], dx: (ex - st.x) / d, dz: (ez - st.z) / d,
    guardSquads: tier >= 2 ? 2 : 1, budget: Math.min(0.4, [0.1, 0.2, 0.3, 0.35][tier] * policyFor(state, fid).defense) };
}
export function defensePlan(sim, fid, st, risk) {
  const { dx, dz, tier } = risk, px = -dz, pz = dx;
  const line = (stype, forward, lateral, length) => ({ stype,
    x1: st.x + dx * forward + px * (lateral - length / 2), z1: st.z + dz * forward + pz * (lateral - length / 2),
    x2: st.x + dx * forward + px * (lateral + length / 2), z2: st.z + dz * forward + pz * (lateral + length / 2) });
  const point = (stype, forward, lateral) => ({ stype, x: st.x + dx * forward + px * lateral, z: st.z + dz * forward + pz * lateral, rot: datan2(dx, dz) });
  const plan = [line('wire', 25, -9, 14)];
  if (tier >= 1) plan.push(line('wire', 25, 9, 14), line('sandbags', 17, -7, 12), line('sandbags', 17, 7, 12));
  if (tier >= 2) {
    if (!heavyDefenseAllowed(sim, fid, st.x, st.z)) plan.push(point('muster_point', -14, 16));
    plan.push(point(unlockedBySpec(sim.state, fid, STRUCTURES.pillbox) ? 'pillbox' : 'fire_post', 10, 14), point('supply_cache', -14, -16));
  }
  if (tier >= 3) plan.push(line('trench', 10, -9, 16), point('field_gun', -8, 0));
  return plan;
}
export function settlementDefenseBuild(sim, fid, ai) {
  if (ai.defenseTick === sim.state.tick) return null;
  ai.defenseTick = sim.state.tick;
  const sites = [];
  if (!ai.settlementRisk) ai.settlementRisk = {};
  for (const st of sim.state.structures) if (st.faction === fid && st.built && STRUCTURES[st.type].settlement && !st.evac) {
    const r = settlementRisk(sim, fid, st, ai); ai.settlementRisk[st.id] = r; sites.push({ st, r });
  }
  sites.sort((a, b) => b.r.score - a.r.score || a.st.id - b.st.id);
  ai.defenseReserve = 0;
  for (const { st, r } of sites) {
    // A safe new settlement needs one income host before additional works. One front wire
    // remains first; threatened settlements always finish their defensive arc before expansion.
    const hosted = sim.state.structures.some((s) => s.faction === fid && s.host === st.id);
    const wire = sim.state.structures.some((s) => s.faction === fid && s.type === 'wire' && dist(s.x, s.z, st.x, st.z) < 32);
    if (r.tier < 2 && wire && !hosted) continue;
    for (const item of defensePlan(sim, fid, st, r)) {
      const x = item.x === undefined ? (item.x1 + item.x2) / 2 : item.x, z = item.z === undefined ? (item.z1 + item.z2) / 2 : item.z;
      if (sim.state.structures.some((s) => s.faction === fid && s.type === item.stype && dist(s.x, s.z, x, z) < 8)) continue;
      const valid = validatePlacement(sim, fid, item.stype, item);
      if (valid.ok || valid.reason === 'build.no_resources') ai.defenseReserve = Math.max(ai.defenseReserve, Math.round(350 * r.budget));
      if (valid.ok) return item;
    }
  }
  return null;
}
