// Real construction: placement -> construction site -> engineer work -> progress -> completed.
// Placement validation is shared by player UI (ghost preview reasons) and AI.
import { STRUCTURES } from '../data/structures.js';
import { unitDef, hasRole } from '../data/units.js';
import { TERRAIN } from '../data/terrain_types.js';
import { EV } from '../core/events.js';
import { dist, clamp, lerp } from '../core/dmath.js';
import { DT } from '../sim/constants.js';
import { canAfford, pay, linearCost, workEfficiency } from '../economy/economy.js';
import { createStructure } from '../sim/state.js';
import { structuresChanged } from '../sim/runtime.js';
import { inZone } from '../world/mapgen.js';
import { cellAt } from '../world/nav.js';
import { footprintCellsVisit } from '../world/nav.js';
import { snapToTrenchEndpoint, chooseFront } from './trench.js';
import { WALL_TYPES } from '../data/structures.js';
import { FACTIONS } from '../data/factions.js';
import { POPULATION } from '../data/economy.js';
import { infectionAt } from '../factions/black_grail.js';
import { specValue, specRule, specAny } from '../sim/specialities.js';
import { sectorAt } from '../economy/sectors.js';
import { econHostAt, isSettlement, onSettlementCompleted } from '../economy/settlements.js';

function fail(reason) {
  return { ok: false, reason };
}

function segSegDistance(a, b) {
  // min distance between two segments (sampled; segments are short)
  let best = 1e9;
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const px = lerp(a.x1, a.x2, t), pz = lerp(a.z1, a.z2, t);
    const dx = b.x2 - b.x1, dz = b.z2 - b.z1;
    const len2 = dx * dx + dz * dz;
    const u = clamp(len2 > 0 ? ((px - b.x1) * dx + (pz - b.z1) * dz) / len2 : 0, 0, 1);
    const d = dist(px, pz, b.x1 + dx * u, b.z1 + dz * u);
    if (d < best) best = d;
  }
  return best;
}

export function enemyDirection(sim, faction, x, z, out) {
  // toward the opposing deployment zone center
  const zones = sim.world.zones;
  let tx = x, tz = 0;
  for (const fid in zones) {
    if (fid === faction) continue;
    const zn = zones[fid];
    tx = (zn.x0 + zn.x1) * 0.5; tz = (zn.z0 + zn.z1) * 0.5;
  }
  const dx = tx - x, dz = tz - z;
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  out[0] = dx / d; out[1] = dz / d;
  return out;
}

const DIR = [0, 0];
const JOINT = [0, 0, 0, 0, 0, 0];

/**
 * Do segments a and b share an endpoint (within 0.8 m)? Writes [jx, jz, aFarX, aFarZ, bFarX, bFarZ]
 * (the joint and the far end of each segment) into out.
 */
function endToEnd(a, b, out) {
  const ends = [[a.x1, a.z1, a.x2, a.z2], [a.x2, a.z2, a.x1, a.z1]];
  const others = [[b.x1, b.z1, b.x2, b.z2], [b.x2, b.z2, b.x1, b.z1]];
  for (const e of ends) {
    for (const o of others) {
      if (dist(e[0], e[1], o[0], o[1]) < 0.8) {
        out[0] = e[0]; out[1] = e[1]; out[2] = e[2]; out[3] = e[3]; out[4] = o[2]; out[5] = o[3];
        return true;
      }
    }
  }
  return false;
}

/**
 * Validate a placement. params: linear {x1,z1,x2,z2} | building {x,z,rot}.
 * Returns { ok, reason, cost, params } — params are normalized (snapped, front chosen).
 */
/**
 * Where a faction may build: its deployment zone; the Black Grail also on ground its corruption has
 * claimed (infection >= FACTIONS[f].buildOnInfection) — organic structures grow where it festers.
 */
export function canBuildAt(sim, faction, x, z) {
  if (inZone(sim.world.zones[faction], x, z)) return true;
  const base = FACTIONS[faction].buildOnInfection;
  if (!base) return false;
  const th = specValue(sim.state, faction, 'buildOnInfection', base);
  return infectionAt(sim.state, x, z) >= th;
}

/**
 * Heavy defenses (fire posts, walls, bunkers) need a logistics anchor nearby (bastion, depot,
 * muster point, workshop) — or a settlement with the Fortified Settlements speciality. A small
 * outpost is not a second fortress for free.
 */
export function heavyDefenseAllowed(sim, faction, x, z) {
  const { state } = sim;
  const settlements = specRule(state, faction, 'settlementHeavyDefense');
  for (const s of state.structures) {
    if (s.faction !== faction || s.hp <= 0) continue;
    const d = STRUCTURES[s.type];
    if (d.fortAnchor && s.built && dist(s.x, s.z, x, z) <= d.anchorRadius) return true;
    if (settlements && d.settlement && dist(s.x, s.z, x, z) <= d.settlement.econRadius) return true;
  }
  return false;
}

/** Own settlements (built or under construction). */
function settlementCount(state, faction) {
  let n = 0;
  for (const s of state.structures) if (s.faction === faction && isSettlement(s)) n++;
  return n;
}

/** Economy placement rules (Phase 3). Returns a reject reason or null; writes EXTRA.host. */
function economyRules(sim, faction, def, x, z) {
  const { state } = sim;
  EXTRA.host = 0;
  if (def.requiresSector) {
    const sec = sectorAt(state, x, z);
    if (!sec) return 'build.needs_sector';
    if (sec.sid) return 'build.sector_taken';
    if (state.match.phase === 'PREPARATION' && settlementCount(state, faction) >= POPULATION.prepSettlementCap) return 'build.prep_settlement_cap';
  }
  if (def.requiresSettlement) {
    const host = econHostAt(sim, faction, x, z);
    if (!host) return 'build.needs_settlement';
    const max = POPULATION.maxEconomyBuildings[def.id];
    if (max) {
      let n = 0;
      for (const s of state.structures) if (s.faction === faction && s.type === def.id && s.host === host.id) n++;
      if (n >= max) return 'build.econ_limit';
    }
    EXTRA.host = host.id;
  }
  if (def.requiresSectorKind) {
    const sec = sectorAt(state, x, z);
    if (!sec || def.requiresSectorKind.indexOf(sec.kind) < 0) return 'build.needs_sector_kind';
  }
  return null;
}
const EXTRA = { host: 0 };

/** Resource cost of a structure after speciality modifiers. */
export function structureCost(state, faction, type, length) {
  const def = STRUCTURES[type];
  let cost;
  if (def.kind === 'linear') {
    const k = type === 'wire' ? specValue(state, faction, 'wireCost', 1) : 1;
    const per = {};
    for (const r in def.costPerM) per[r] = def.costPerM[r] * k;
    cost = linearCost(per, length);
  } else cost = { ...def.cost };
  return cost;
}

/** Linear types that may not cross each other (the wall family counts as one kind). */
function lineGroup(type) {
  return WALL_TYPES.indexOf(type) >= 0 ? 'wall' : type;
}

export function validatePlacement(sim, faction, type, params) {
  const { state, world, rt } = sim;
  const def = STRUCTURES[type];
  if (!def || !def.buildable) return fail('build.invalid');
  if (def.builder !== faction) return fail('build.not_faction');
  if (state.match.phase === 'ENDED') return fail('build.match_over');
  if (def.requiresSpec && !specAny(state, faction, def.requiresSpec)) return fail('build.spec');
  const needs = def.requires && !(type === 'fortified_wall' && specRule(state, faction, 'fortifiedNoWorkshop'));
  if (needs && !state.structures.some((s) => s.faction === faction && s.type === def.requires && s.built)) return fail('build.requires');
  const t = world.terrain;
  const f = state.factions[faction];
  if (def.kind === 'linear') {
    let { x1, z1, x2, z2 } = params;
    if (type === 'trench') {
      const s1 = snapToTrenchEndpoint(state.structures, faction, x1, z1, 2.5);
      if (s1) { x1 = s1[0]; z1 = s1[1]; }
      const s2 = snapToTrenchEndpoint(state.structures, faction, x2, z2, 2.5);
      if (s2) { x2 = s2[0]; z2 = s2[1]; }
    }
    const len = dist(x1, z1, x2, z2);
    if (len < def.minLen - 1e-6) return fail('build.too_short');
    if (len > def.maxLen + 1e-6) return fail('build.too_long');
    const steps = Math.max(2, Math.ceil(len));
    for (let k = 0; k <= steps; k++) {
      const x = lerp(x1, x2, k / steps), z = lerp(z1, z2, k / steps);
      if (!canBuildAt(sim, faction, x, z)) return fail('build.out_of_zone');
      const ci = cellAt(rt.nav, x, z);
      if (ci < 0) return fail('build.out_of_zone');
      const ty = t.types[ci];
      if (ty === TERRAIN.DEEP || ty === TERRAIN.SHALLOW || ty === TERRAIN.ROCK || ty === TERRAIN.BRIDGE) return fail('build.bad_terrain');
      if (t.blocked[ci] || rt.nav.blocked[ci]) return fail('build.blocked');
    }
    const cand = { x1, z1, x2, z2 };
    for (const s of state.structures) {
      if (STRUCTURES[s.type].kind !== 'linear' || lineGroup(s.type) !== lineGroup(type)) continue;
      const d = segSegDistance(cand, s);
      if (d >= def.width * 0.7) continue;
      // lines of the same kind may be chained end to end (trench networks, wire belts, sandbag
      // walls) at any angle except folding back over each other
      if (!endToEnd(cand, s, JOINT)) return fail('build.overlap');
      const ax = JOINT[2] - JOINT[0], az = JOINT[3] - JOINT[1];
      const bx = JOINT[4] - JOINT[0], bz = JOINT[5] - JOINT[1];
      const cos = (ax * bx + az * bz) / Math.max(1e-6, Math.sqrt((ax * ax + az * az) * (bx * bx + bz * bz)));
      if (cos > 0.77) return fail('build.overlap'); // < ~40 degrees apart: running on top of each other
    }
    // buildings in the way
    for (const s of state.structures) {
      const sd = STRUCTURES[s.type];
      if (sd.kind !== 'building') continue;
      let hitB = false;
      for (let k = 0; k <= steps && !hitB; k++) {
        const x = lerp(x1, x2, k / steps), z = lerp(z1, z2, k / steps);
        if (dist(x, z, s.x, s.z) < Math.max(sd.footprint.w, sd.footprint.d) * 0.5 + 0.8) hitB = true;
      }
      if (hitB) return fail('build.blocked');
    }
    if (def.heavyDefense && !heavyDefenseAllowed(sim, faction, (x1 + x2) / 2, (z1 + z2) / 2)) return fail('build.needs_anchor');
    const cost = structureCost(state, faction, type, len);
    if (!canAfford(f.resources, cost)) return { ok: false, reason: 'build.no_resources', cost };
    enemyDirection(sim, faction, (x1 + x2) / 2, (z1 + z2) / 2, DIR);
    const front = chooseFront(x1, z1, x2, z2, DIR[0], DIR[1]);
    return { ok: true, cost, params: { x1, z1, x2, z2, front } };
  }
  // building
  const { x, z } = params;
  const rot = params.rot || 0;
  if (!canBuildAt(sim, faction, x, z)) return fail('build.out_of_zone');
  if (def.heavyDefense && !heavyDefenseAllowed(sim, faction, x, z)) return fail('build.needs_anchor');
  const econ = economyRules(sim, faction, def, x, z);
  if (econ) return fail(econ);
  const host = EXTRA.host;
  let bad = null;
  const probe = { type, x, z, rot };
  footprintCellsVisit(rt.nav, probe, (ci) => {
    if (bad) return;
    const ty = t.types[ci];
    if (ty === TERRAIN.DEEP || ty === TERRAIN.SHALLOW || ty === TERRAIN.ROCK || ty === TERRAIN.BRIDGE) bad = 'build.bad_terrain';
    else if (t.blocked[ci] || rt.nav.blocked[ci]) bad = 'build.blocked';
    else if (rt.nav.linear[ci]) bad = 'build.overlap';
  });
  if (bad) return fail(bad);
  for (const s of state.structures) {
    const sd = STRUCTURES[s.type];
    if (sd.kind === 'building' || sd.kind === 'area') {
      // fields may border each other and sit next to buildings: only a real overlap is refused
      const k = sd.kind === 'area' || def.kind === 'area' ? 0.8 : 0.85;
      const minD = (Math.max(sd.footprint.w, sd.footprint.d) + Math.max(def.footprint.w, def.footprint.d)) * 0.5;
      if (dist(x, z, s.x, s.z) < minD * k) return fail('build.overlap');
    } else if (sd.kind === 'linear' && s.progress < 0.3 && !s.built) {
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
      const len2 = dx * dx + dz * dz;
      const u = clamp(len2 > 0 ? ((x - s.x1) * dx + (z - s.z1) * dz) / len2 : 0, 0, 1);
      if (dist(x, z, s.x1 + dx * u, s.z1 + dz * u) < Math.max(def.footprint.w, def.footprint.d) * 0.5 + sd.width * 0.5) return fail('build.overlap');
    }
  }
  const cost = structureCost(state, faction, type, 0);
  if (!canAfford(f.resources, cost)) return { ok: false, reason: 'build.no_resources', cost };
  return { ok: true, cost, params: host ? { x, z, rot, host } : { x, z, rot } };
}

/** Place a validated construction site; pay; return the structure. */
export function placeStructure(sim, faction, type, v) {
  const { state, rt } = sim;
  const f = state.factions[faction];
  pay(f.resources, v.cost);
  const s = createStructure(state, type, faction, { ...v.params, built: false, progress: 0 });
  s.paid = { ...v.cost };
  // speciality modifiers on the new site: digging / wall work, sturdier settlements
  const def = STRUCTURES[type];
  let wk = 1;
  if (type === 'trench') wk = specValue(state, faction, 'trenchWork', 1);
  else if (WALL_TYPES.indexOf(type) >= 0) wk = specValue(state, faction, 'wallWork', 1);
  if (wk !== 1) { s.workRequired *= wk; }
  if (def.settlement) {
    const hk = specValue(state, faction, 'settlementHp', 1);
    if (hk !== 1) { s.maxHp = Math.round(def.hp * hk); s.hp = Math.max(1, Math.round(s.maxHp * 0.12)); }
    const sec = sectorAt(state, s.x, s.z);
    if (sec) sec.sid = s.id;
  }
  state.structures.push(s);
  rt.structById.set(s.id, s);
  structuresChanged(sim);
  sim.events.push({ type: EV.STRUCTURE_PLACED, id: s.id, stype: type, faction, x: s.x, z: s.z });
  return s;
}

export function isBuilder(sq) {
  return hasRole(unitDef(sq.type), 'builder');
}

const WORK = new Map();

/** Engineer work: diminishing returns across all working engineers on the same site. */
export function updateConstruction(sim) {
  const { state, rt } = sim;
  // count working engineers per structure (deterministic: squads in array order)
  const work = WORK;
  work.clear();
  for (const sq of state.squads) {
    const o = sq.order;
    if ((o.t !== 'build' && o.t !== 'repair') || !o.arrived || !sq.working) continue;
    const def = unitDef(sq.type);
    const cur = work.get(o.sid);
    if (cur) { cur.n += sq.working; cur.rate = Math.max(cur.rate, def.buildRate || 1); }
    else work.set(o.sid, { n: sq.working, rate: def.buildRate || 1, repair: o.t === 'repair', faction: sq.faction });
  }
  for (const [sid, w] of work) {
    const s = rt.structById.get(sid);
    if (!s) continue;
    const def = STRUCTURES[s.type];
    const eff = workEfficiency(w.n) * w.rate * DT * specValue(state, w.faction, 'builderSpeed', 1);
    if (!s.built) {
      const before = s.progress;
      s.work = Math.min(s.workRequired, s.work + eff);
      s.progress = s.workRequired > 0 ? s.work / s.workRequired : 1;
      s.hp = Math.min(s.maxHp, s.hp + s.maxHp * (s.progress - before));
      const b10 = Math.floor(before * 10), a10 = Math.floor(s.progress * 10);
      if (a10 !== b10) sim.events.push({ type: EV.STRUCTURE_PROGRESS, id: s.id, stype: s.type, faction: s.faction, progress: s.progress, x: s.x, z: s.z });
      if (def.kind === 'linear' && before < 0.3 && s.progress >= 0.3) structuresChanged(sim);
      if (s.progress >= 1 - 1e-9) completeStructure(sim, s);
    } else if (w.repair && s.hp < s.maxHp) {
      const f = state.factions[s.faction] || state.factions[w.faction]; // a neutral ruin: the repairing side pays
      if (s.collapsed) continue;
      const hp = Math.min(s.maxHp - s.hp, eff * 14);
      const cost = hp * 0.05;
      if ((f.resources.material || 0) >= cost) {
        f.resources.material -= cost;
        s.hp += hp;
      }
    }
  }
}

export function completeStructure(sim, s) {
  const { state } = sim;
  s.built = true;
  s.progress = 1;
  s.work = s.workRequired;
  s.hp = s.maxHp;
  state.factions[s.faction].stats.built++;
  if (STRUCTURES[s.type].settlement) onSettlementCompleted(sim, s);
  structuresChanged(sim);
  sim.events.push({ type: EV.STRUCTURE_COMPLETED, id: s.id, stype: s.type, faction: s.faction, x: s.x, z: s.z });
}

export function cancelStructure(sim, s) {
  const { state, rt } = sim;
  if (s.built) return false;
  const f = state.factions[s.faction];
  if (s.paid) for (const k in s.paid) f.resources[k] = (f.resources[k] || 0) + Math.floor(s.paid[k] * 0.75);
  for (const sec of state.sectors || []) if (sec.sid === s.id) sec.sid = 0;
  for (const sq of state.squads) for (const m of sq.members) if (m.postId === s.id) { m.postId = 0; m.postSlot = -1; }
  const i = state.structures.indexOf(s);
  if (i >= 0) state.structures.splice(i, 1);
  rt.structById.delete(s.id);
  structuresChanged(sim);
  sim.events.push({ type: EV.STRUCTURE_DESTROYED, id: s.id, stype: s.type, faction: s.faction, x: s.x, z: s.z, cancelled: true, x1: s.x1, z1: s.z1, x2: s.x2, z2: s.z2 });
  return true;
}
