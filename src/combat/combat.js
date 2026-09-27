// Combat: squad-level target acquisition (throttled, fog-aware), soldier-level staggered fire,
// melee, damage with cover/armor, death -> dying -> corpse (bounded), structure fire/damage.
import { removeCorpse } from '../sim/corpses.js';
import { unitDef } from '../data/units.js';
import { WEAPONS } from '../data/weapons.js';
import { STRUCTURES } from '../data/structures.js';
import { FACTIONS, areHostile } from '../data/factions.js';
import { EV, IMPACT } from '../core/events.js';
import { rngFloat, hash32 } from '../core/rng.js';
import { dist, dist2, clamp, lerp, dsin, dcos, headingOf, wrapAngle } from '../core/dmath.js';
import {
  TICK_RATE, TARGET_INTERVAL, DYING_TICKS, RISING_TICKS, MAX_CORPSES, CORPSE_DECAY_TICKS,
  MELEE_CHARGE_RANGE, ACQUIRE_EXTRA, INFECTION_MAX,
} from '../sim/constants.js';
import { protectionAgainst, coverAt } from './cover.js';
import { soldierDetectedBy } from '../sim/perception.js';
import { distanceToStructure, releaseSoldierPost, engageRange } from '../units/orders.js';
import { structuresChanged } from '../sim/runtime.js';
import { endMatch, factionByRole } from '../sim/match.js';
import { cellIndex } from '../world/terrain.js';
import { TERRAIN } from '../data/terrain_types.js';

const PROT = { dmg: 0, acc: 0, cover: 0 };
const STRUCT_EFFECTIVE = 0.3; // weapons below this structure multiplier do not auto-engage structures
const ticks = (sec) => Math.max(1, Math.round(sec * TICK_RATE));

const SUPPRESS_ACC = 0.6;

function fbit(faction) {
  return FACTIONS[faction] ? 1 << FACTIONS[faction].index : 0;
}

/** A soldier that can be shot / struck: fighting members and replacements walking up to them. */
export function targetable(e) {
  return e.state === 'alive' || e.state === 'joining';
}

function hasAlive(sq) {
  for (let i = 0; i < sq.members.length; i++) if (sq.members[i].state === 'alive') return true;
  return false;
}

// --------------------------------------------------------------- targeting

function acquireTarget(sim, sq) {
  const { state, rt } = sim;
  const def = unitDef(sq.type);
  if (!hasAlive(sq)) { sq.target = null; sq.engaged = false; sq.melee = false; return; }
  const myBit = fbit(sq.faction);
  const ranged = def.weapon ? WEAPONS[def.weapon] : null;
  const o = sq.order;
  if (o.t === 'attack') {
    const tgt = o.tk === 'squad' ? rt.squadById.get(o.tid) : rt.structById.get(o.tid);
    // a target that slipped into the fog is hunted at its last known position (units/orders.js),
    // never shot at blind
    if (!tgt || !(tgt.visibleTo & myBit)) { sq.target = null; sq.engaged = false; sq.melee = false; return; }
    const d = o.tk === 'squad' ? dist(sq.x, sq.z, tgt.cx, tgt.cz) : distanceToStructure(tgt, sq.x, sq.z);
    sq.target = { k: o.tk, id: o.tid };
    sq.engaged = ranged ? d <= ranged.range : d <= MELEE_CHARGE_RANGE;
    sq.melee = !ranged && sq.engaged;
    if (sq.melee && o.tk === 'squad') assignMeleeTargets(sq, tgt);
    return;
  }
  if (o.t === 'build' || o.t === 'repair' || o.t === 'gather' || o.t === 'reinforce') {
    // workers defend themselves only (handled by melee fallback / close targets)
  }
  const passive = (o.t === 'move' && !o.am) || o.t === 'gather' || o.t === 'build' || o.t === 'repair' || o.t === 'reinforce';
  let range;
  if (ranged) range = passive ? ranged.range * 0.8 : ranged.range + ACQUIRE_EXTRA;
  else range = passive ? 4 : MELEE_CHARGE_RANGE;
  let best = null, bestD = 1e9;
  for (const e of state.squads) {
    if (!areHostile(sq.faction, e.faction)) continue;
    if (!(e.visibleTo & myBit)) continue;
    if (!hasAlive(e)) continue;
    const d = dist(sq.x, sq.z, e.cx, e.cz);
    if (d > range + 3) continue;
    // prefer threats already shooting at us, then proximity
    const score = d - (state.tick - sq.lastHitTick < 60 && e.target && e.target.id === sq.id ? 10 : 0);
    if (score < bestD) { bestD = score; best = e; }
  }
  if (best) {
    sq.target = { k: 'squad', id: best.id };
    const d = dist(sq.x, sq.z, best.cx, best.cz);
    sq.engaged = ranged ? d <= ranged.range + 2 : d <= range;
    sq.melee = !ranged && sq.engaged;
    if (sq.melee) assignMeleeTargets(sq, best);
    return;
  }
  // structures (fortifications and the objective) — never while on a plain move / work order, and
  // only with a weapon that actually hurts them: a rifle squad that would plink at a wall for
  // minutes keeps advancing instead, or storms it with its melee weapon (explicit orders still work)
  let bestS = null, bestSD = 1e9;
  const meleeW = def.melee ? WEAPONS[def.melee] : null;
  let sRange = -1, sMelee = !ranged;
  if (!passive) {
    if (ranged && (ranged.structureMult || 0) >= STRUCT_EFFECTIVE) sRange = ranged.range;
    else if (meleeW && (meleeW.structureMult || 0) >= STRUCT_EFFECTIVE) { sRange = MELEE_CHARGE_RANGE; sMelee = true; }
    else if (!ranged) sRange = MELEE_CHARGE_RANGE;
  }
  for (const st of state.structures) {
    if (!areHostile(sq.faction, st.faction)) continue;
    if (!(st.visibleTo & myBit)) continue;
    if (st.type === 'field') continue;
    const d = distanceToStructure(st, sq.x, sq.z);
    if (d > sRange) continue;
    const score = d - (st.objective ? 25 : 0) - (st.type === 'wire' && d < 4 ? 8 : 0);
    if (score < bestSD) { bestSD = score; bestS = st; }
  }
  if (bestS) {
    sq.target = { k: 'struct', id: bestS.id };
    sq.engaged = true;
    sq.melee = sMelee;
    return;
  }
  sq.target = null;
  sq.engaged = false;
  sq.melee = false;
  for (const m of sq.members) m.targetId = 0;
}

function assignMeleeTargets(sq, esq) {
  for (const m of sq.members) {
    if (m.state !== 'alive') continue;
    let best = 0, bestD = 1e18;
    for (const e of esq.members) {
      if (!targetable(e)) continue;
      const d = dist2(m.x, m.z, e.x, e.z);
      if (d < bestD) { bestD = d; best = e.id; }
    }
    m.targetId = best;
  }
}

// --------------------------------------------------------------- damage & death

/**
 * src: who dealt it — a squad id (> 0), minus a structure id (< 0), or 0 (plague, barrage). Carried on
 * HIT / DEATH so presentation can tell whether the direction may be shown (hidden shooters stay hidden).
 */
export function damageSoldier(sim, vsq, v, amount, attackerFaction, weapon, dx, dz, src = 0, force = 0) {
  if (v.state !== 'alive' && v.state !== 'joining') return;
  const vdef = unitDef(vsq.type);
  let d = amount * (1 - vdef.armor);
  if (vsq.hordeBonus) d *= 1 - vsq.hordeBonus * 0.6;
  v.hp -= d;
  vsq.lastHitTick = sim.state.tick;
  if (weapon && weapon.infect && vsq.faction !== 'black_grail') {
    v.infection = Math.min(INFECTION_MAX, v.infection + weapon.infect);
  }
  const cause = weapon ? weapon.kind : 'other';
  // overkill relative to the victim's max hp: presentation picks collapse vs. trauma from it
  if (v.hp <= 0) killSoldier(sim, vsq, v, attackerFaction, cause, dx, dz, src, Math.round((-v.hp / vdef.hp) * 100) / 100, force);
  else sim.events.push({ type: EV.HIT, id: v.id, sq: vsq.id, faction: vsq.faction, x: v.x, z: v.z, dx, dz, dmg: d, src, cause });
}

/**
 * ov: overkill (fraction of max hp beyond zero), force: blast closeness (0..1). Both are sim facts
 * carried on DEATH for presentation only (gore never feeds back into the simulation).
 */
export function killSoldier(sim, vsq, v, attackerFaction, cause, dx, dz, src = 0, ov = 0, force = 0) {
  const { state } = sim;
  v.hp = 0;
  v.state = 'dying';
  v.stateTick = state.tick;
  v.cooldown = 0; v.burst = 0; v.targetId = 0; v.working = 0;
  v.killer = attackerFaction || '';
  releaseSoldierPost(sim, v);
  state.factions[vsq.faction].stats.losses++;
  if (attackerFaction && state.factions[attackerFaction]) state.factions[attackerFaction].stats.kills++;
  sim.events.push({
    type: EV.DEATH, id: v.id, sq: vsq.id, faction: vsq.faction, unit: vsq.type, x: v.x, z: v.z,
    dx: dx || 0, dz: dz || 0, cause, src, ov, force, inf: v.infection,
  });
}

function impactFor(sim, vsq, hit, x, z) {
  if (!hit) {
    const ci = cellIndex(sim.world.terrain, x, z);
    const ty = ci >= 0 ? sim.world.terrain.types[ci] : 0;
    return ty === TERRAIN.SHALLOW || ty === TERRAIN.DEEP ? IMPACT.WATER : IMPACT.GROUND;
  }
  const def = unitDef(vsq.type);
  if (def.heavy && (hash32(x * 100 | 0, z * 100 | 0) & 1)) return IMPACT.METAL;
  return vsq.faction === 'black_grail' ? IMPACT.ORGANIC : IMPACT.FLESH;
}

/** A living member of esq in range that the shooter's side actually sees (never a soldier in the fog). */
function pickTargetSoldier(sim, esq, m, range, j) {
  const n = esq.members.length;
  if (!n) return null;
  const r2 = range * range;
  const start = (m.id + m.shots) % n;
  for (let k = 0; k < n; k++) {
    const e = esq.members[(start + k) % n];
    if (targetable(e) && dist2(m.x, m.z, e.x, e.z) <= r2 && soldierDetectedBy(sim, e, j)) return e;
  }
  return null;
}

function nearestEnemyAdjacent(sim, m, faction, r) {
  const g = sim.rt.soldierGrid;
  const cs = g.cs;
  const x0 = Math.max(0, Math.floor((m.x - r) / cs)), x1 = Math.min(g.cols - 1, Math.floor((m.x + r) / cs));
  const z0 = Math.max(0, Math.floor((m.z - r) / cs)), z1 = Math.min(g.rows - 1, Math.floor((m.z + r) / cs));
  let best = null, bestSq = null, bestD = r * r;
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      for (let j = g.head[cz * g.cols + cx]; j !== -1; j = g.next[j]) {
        const e = g.refs[j];
        if (!targetable(e)) continue;
        const esq = g.owners[j];
        if (!areHostile(faction, esq.faction)) continue;
        const d = dist2(m.x, m.z, e.x, e.z);
        if (d < bestD || (d === bestD && best && e.id < best.id)) { bestD = d; best = e; bestSq = esq; }
      }
    }
  }
  if (best) { NEAR.e = best; NEAR.sq = bestSq; return NEAR; }
  return null;
}
const NEAR = { e: null, sq: null };

function meleeStrike(sim, sq, m, weapon, esq, e) {
  const { state } = sim;
  let acc = weapon.acc;
  if (e.postId) acc *= 0.85; // defenders fighting from the trench
  const hit = rngFloat(state.rng.main) < acc;
  m.targetId = e.id;
  const dx = e.x - m.x, dz = e.z - m.z;
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  sim.events.push({
    type: EV.MELEE, attacker: m.id, sq: sq.id, faction: sq.faction, weapon: weapon.id,
    x: m.x, z: m.z, tx: e.x, tz: e.z, hit, target: e.id, tsq: esq.id, impact: impactFor(sim, esq, hit, e.x, e.z),
  });
  if (hit) {
    const dmg = weapon.damage * (0.85 + 0.3 * rngFloat(state.rng.main)) * (1 + (sq.hordeBonus || 0));
    damageSoldier(sim, esq, e, dmg, sq.faction, weapon, dx / d, dz / d, sq.id);
    if (weapon.cleave && weapon.cleave > 1) {
      for (const o of esq.members) {
        if (o === e || !targetable(o)) continue;
        if (dist2(m.x, m.z, o.x, o.z) <= (weapon.range + 0.6) * (weapon.range + 0.6)) {
          damageSoldier(sim, esq, o, dmg * 0.6, sq.faction, weapon, dx / d, dz / d, sq.id);
          break;
        }
      }
    }
  }
}

function rangedShot(sim, sq, m, weapon, esq, e) {
  const { state } = sim;
  const d = dist(m.x, m.z, e.x, e.z);
  let acc = lerp(weapon.accNear, weapon.accFar, clamp((d - 6) / Math.max(1, weapon.range - 6), 0, 1));
  protectionAgainst(sim, e.x, e.z, m.x, m.z, PROT);
  acc *= 1 - PROT.acc;
  if (e.vx * e.vx + e.vz * e.vz > 0.0004) acc *= 0.9;
  if (sq.debuffUntil > state.tick) acc *= 0.65;
  if (sq.suppressUntil > state.tick) acc *= SUPPRESS_ACC; // under mortar fire
  const hit = rngFloat(state.rng.main) < acc;
  m.shots++;
  m.targetId = e.id;
  sq.lastFireTick = state.tick;
  if (FACTIONS[sq.faction].usesAmmo && weapon.ammoPerShot) sq.ammo = Math.max(0, sq.ammo - weapon.ammoPerShot);
  let tx = e.x, tz = e.z;
  if (!hit) {
    const a = rngFloat(state.rng.main) * 6.283185307179586;
    const r = 0.8 + rngFloat(state.rng.main) * 2.6;
    tx += dsin(a) * r;
    tz += dcos(a) * r;
  }
  sim.events.push({
    type: EV.FIRE, shooter: m.id, sq: sq.id, faction: sq.faction, weapon: weapon.id,
    x: m.x, z: m.z, tx, tz, hit, target: e.id, tsq: esq.id, impact: impactFor(sim, esq, hit, tx, tz),
  });
  if (hit) {
    const dmg = weapon.damage * (0.85 + 0.3 * rngFloat(state.rng.main)) * (1 - PROT.dmg);
    const dd = d || 1;
    damageSoldier(sim, esq, e, dmg, sq.faction, weapon, (e.x - m.x) / dd, (e.z - m.z) / dd, sq.id);
  }
}

function shotAtStructure(sim, sq, m, weapon, st, isMelee) {
  const { state } = sim;
  const def = STRUCTURES[st.type];
  m.shots++;
  m.targetId = 0;
  sq.lastFireTick = state.tick;
  if (!isMelee && FACTIONS[sq.faction].usesAmmo && weapon.ammoPerShot) sq.ammo = Math.max(0, sq.ammo - weapon.ammoPerShot);
  // aim point on the structure
  let tx = st.x, tz = st.z;
  if (def.kind === 'linear') {
    const dx = st.x2 - st.x1, dz = st.z2 - st.z1;
    const len2 = dx * dx + dz * dz;
    const t = clamp(len2 > 0 ? ((m.x - st.x1) * dx + (m.z - st.z1) * dz) / len2 : 0.5, 0, 1);
    tx = st.x1 + dx * t; tz = st.z1 + dz * t;
  }
  const hit = isMelee || rngFloat(state.rng.main) < 0.8;
  const impact = st.type === 'fire_post' ? IMPACT.METAL : IMPACT.WALL;
  sim.events.push({
    type: isMelee ? EV.MELEE : EV.FIRE, shooter: m.id, attacker: m.id, sq: sq.id, faction: sq.faction, weapon: weapon.id,
    x: m.x, z: m.z, tx, tz, hit, target: 0, tsq: 0, struct: st.id, impact,
  });
  if (hit) {
    const dmg = weapon.damage * (weapon.structureMult || 0.1) * (1 + (sq.hordeBonus || 0));
    damageStructure(sim, st, dmg, sq.faction);
  }
}

// --------------------------------------------------------------- per squad firing

function squadFire(sim, sq) {
  const { state, rt } = sim;
  const def = unitDef(sq.type);
  const ranged = def.weapon ? WEAPONS[def.weapon] : null;
  const melee = def.melee ? WEAPONS[def.melee] : null;
  let tsq = null, tst = null;
  if (sq.target) {
    if (sq.target.k === 'squad') tsq = rt.squadById.get(sq.target.id) || null;
    else tst = rt.structById.get(sq.target.id) || null;
  }
  const fj = FACTIONS[sq.faction].index;
  const noAmmo = FACTIONS[sq.faction].usesAmmo && ranged && ranged.ammoPerShot && sq.ammo <= 0;
  const hasTarget = !!(tsq || tst);
  for (const m of sq.members) {
    if (m.state !== 'alive') continue;
    if (!hasTarget) m.ready = 0;
    else if (!m.ready) {
      // deterministic reaction stagger: soldiers do not open fire on the same tick
      m.ready = 1;
      m.cooldown = Math.max(m.cooldown, 3 + (hash32(m.id, sq.target.id, 5) % 28));
    }
    if (m.cooldown > 0) { m.cooldown--; continue; }
    // 1) melee when an enemy is adjacent (melee units, and ranged units' bayonets)
    if (melee) {
      const n = nearestEnemyAdjacent(sim, m, sq.faction, melee.range + def.radius * 0.5);
      if (n) {
        meleeStrike(sim, sq, m, melee, n.sq, n.e);
        m.cooldown = ticks(melee.reload * (1 + (rngFloat(state.rng.main) - 0.5) * (melee.reloadJitter || 0)));
        m.burst = 0;
        continue;
      }
    }
    // 2) structure target in melee reach
    if (tst && melee && (!ranged || sq.melee) && distanceToStructure(tst, m.x, m.z) <= melee.range + 0.5) {
      shotAtStructure(sim, sq, m, melee, tst, true);
      m.cooldown = ticks(melee.reload);
      continue;
    }
    if (!ranged) continue;
    // 3) ranged
    const moving = m.vx * m.vx + m.vz * m.vz > 0.0004;
    if (moving && !ranged.fireWhileMoving) { m.burst = 0; continue; }
    let e = null;
    if (tsq) e = pickTargetSoldier(sim, tsq, m, ranged.range, fj);
    if (!e && !tst) { m.burst = 0; continue; }
    if (noAmmo && m.burst === 0 && rngFloat(state.rng.main) < 0.8) {
      // out of supply: scavenging rounds, fire rate collapses
      m.cooldown = ticks(ranged.reload * 1.5);
      continue;
    }
    if (e) rangedShot(sim, sq, m, ranged, tsq, e);
    else if (tst && distanceToStructure(tst, m.x, m.z) <= ranged.range) shotAtStructure(sim, sq, m, ranged, tst, false);
    else { m.burst = 0; continue; }
    const burst = ranged.burst || 1;
    if (burst > 1) {
      if (m.burst <= 0) m.burst = burst - 1;
      else m.burst--;
      if (m.burst > 0) { m.cooldown = ticks(ranged.burstInterval); continue; }
    }
    m.cooldown = ticks(ranged.reload * (1 + (rngFloat(state.rng.main) - 0.5) * (ranged.reloadJitter || 0)));
  }
}

// --------------------------------------------------------------- structures

export function damageStructure(sim, st, amount, attackerFaction) {
  if (st.hp <= 0) return;
  st.hp -= amount;
  const tick = sim.state.tick;
  if (tick - (st.lastDamageTick || -1000) >= 6 || st.hp <= 0) {
    st.lastDamageTick = tick;
    sim.events.push({ type: EV.STRUCTURE_DAMAGED, id: st.id, stype: st.type, faction: st.faction, x: st.x, z: st.z, hp: st.hp, maxHp: st.maxHp });
  }
  if (st.hp <= 0) destroyStructure(sim, st, attackerFaction);
}

export function destroyStructure(sim, st, attackerFaction) {
  const { state, rt } = sim;
  st.hp = 0;
  for (const sq of state.squads) for (const m of sq.members) if (m.postId === st.id) { m.postId = 0; m.postSlot = -1; }
  const i = state.structures.indexOf(st);
  if (i >= 0) state.structures.splice(i, 1);
  rt.structById.delete(st.id);
  structuresChanged(sim);
  sim.events.push({
    type: EV.STRUCTURE_DESTROYED, id: st.id, stype: st.type, faction: st.faction, x: st.x, z: st.z,
    x1: st.x1, z1: st.z1, x2: st.x2, z2: st.z2, rot: st.rot, organic: STRUCTURES[st.type].organic ? 1 : 0,
  });
  // a stocked ammunition dump goes up when destroyed (only once built): a queued detonation,
  // resolved next tick by sim/abilities.js (plain data, deterministic, saved like any effect)
  const ex = STRUCTURES[st.type].explodes;
  if (ex && st.built) {
    state.effects.push({
      id: state.nextId++, kind: 'detonation', ability: '', faction: attackerFaction || '', owner: st.faction,
      x: st.x, z: st.z, radius: ex.radius, start: state.tick, next: state.tick + 1,
      blast: { blastRadius: ex.radius, damage: ex.damage, structureDamage: ex.structureDamage, size: 'heavy', craters: true, indiscriminate: true },
    });
  }
  if (st.objective) {
    const attacker = factionByRole(state, 'attacker') || attackerFaction;
    endMatch(sim, attacker, 'objective_destroyed');
  }
}

function structureFire(sim, st) {
  const { state, rt } = sim;
  const def = STRUCTURES[st.type];
  const w = WEAPONS[def.weapon];
  if (st.cooldown > 0) { st.cooldown--; return; }
  const myBit = fbit(st.faction);
  const fx = dsin(st.rot), fz = dcos(st.rot);
  const gx = st.x + fx * 1.4, gz = st.z + fz * 1.4;
  const halfArc = ((def.arc || 360) * Math.PI) / 360;
  let tsq = st.targetId ? rt.squadById.get(st.targetId) : null;
  if (!tsq || (state.tick + st.id) % TARGET_INTERVAL === 0 || !hasAlive(tsq) || !(tsq.visibleTo & myBit)) {
    tsq = null;
    let bestD = w.range + 2;
    for (const e of state.squads) {
      if (!areHostile(st.faction, e.faction) || !(e.visibleTo & myBit) || !hasAlive(e)) continue;
      const d = dist(gx, gz, e.cx, e.cz);
      if (d > bestD) continue;
      const ang = Math.abs(wrapAngle(headingOf(e.cx - gx, e.cz - gz) - st.rot));
      if (ang > halfArc) continue;
      bestD = d; tsq = e;
    }
    st.targetId = tsq ? tsq.id : 0;
  }
  if (!tsq) { st.burst = 0; return; }
  const n = tsq.members.length;
  let e = null;
  const fj = FACTIONS[st.faction].index;
  for (let k = 0; k < n; k++) {
    const c = tsq.members[(st.shots + k) % n];
    if (targetable(c) && dist2(gx, gz, c.x, c.z) <= w.range * w.range && soldierDetectedBy(sim, c, fj)) { e = c; break; }
  }
  if (!e) { st.burst = 0; return; }
  st.shots++;
  const d = dist(gx, gz, e.x, e.z);
  let acc = lerp(w.accNear, w.accFar, clamp((d - 6) / (w.range - 6), 0, 1));
  protectionAgainst(sim, e.x, e.z, gx, gz, PROT);
  acc *= 1 - PROT.acc;
  const hit = rngFloat(state.rng.main) < acc;
  let tx = e.x, tz = e.z;
  if (!hit) {
    const a = rngFloat(state.rng.main) * 6.283185307179586;
    const r = 0.8 + rngFloat(state.rng.main) * 2.4;
    tx += dsin(a) * r; tz += dcos(a) * r;
  }
  sim.events.push({
    type: EV.STRUCTURE_FIRE, struct: st.id, faction: st.faction, weapon: w.id,
    x: gx, z: gz, tx, tz, hit, target: e.id, tsq: tsq.id, impact: impactFor(sim, tsq, hit, tx, tz),
  });
  if (hit) {
    const dmg = w.damage * (0.85 + 0.3 * rngFloat(state.rng.main)) * (1 - PROT.dmg);
    damageSoldier(sim, tsq, e, dmg, st.faction, w, (e.x - gx) / (d || 1), (e.z - gz) / (d || 1), -st.id);
  }
  const burst = w.burst || 1;
  if (burst > 1) {
    if (st.burst <= 0) st.burst = burst - 1; else st.burst--;
    if (st.burst > 0) { st.cooldown = ticks(w.burstInterval); return; }
  }
  st.cooldown = ticks(w.reload * (1 + (rngFloat(state.rng.main) - 0.5) * (w.reloadJitter || 0)));
}

// --------------------------------------------------------------- periodic squad status

function updateStatus(sim) {
  const { state } = sim;
  for (const sq of state.squads) {
    const def = unitDef(sq.type);
    for (const m of sq.members) if (m.state === 'alive') m.cover = coverAt(sim, m.x, m.z);
    if (def.hordeBonus) {
      let count = 0;
      for (const o of state.squads) {
        if (o === sq || o.type !== sq.type || o.faction !== sq.faction) continue;
        if (dist(sq.cx, sq.cz, o.cx, o.cz) <= def.hordeBonus.radius) count++;
      }
      sq.hordeBonus = Math.min(def.hordeBonus.max, count * def.hordeBonus.perSquad);
    }
  }
}

// --------------------------------------------------------------- deaths / corpses

/**
 * The plague claims most of the Grail's victims, not all: a data-driven share of the bodies stays
 * uninfected (harvestable biomass instead of a new Thrall). Deterministic per soldier id.
 */
export function plagueClaims(soldierId) {
  const R = FACTIONS.black_grail && FACTIONS.black_grail.reanimation;
  if (!R || R.chance === undefined) return true;
  return hash32(soldierId, 131) % 1000 < R.chance * 1000;
}

export function addCorpse(sim, sq, v) {
  const { state, rt } = sim;
  const infected = sq.faction !== 'black_grail' && (v.infection > 0 || v.killer === 'black_grail') && plagueClaims(v.id);
  const c = {
    id: state.nextId++, x: v.x, z: v.z, rot: v.rot, faction: sq.faction, unit: sq.type,
    pose: hash32(v.id, 77) & 1023, tick: state.tick, infected,
    biomass: 6, seenBy: sq.visibleTo | fbit(sq.faction), riseAt: 0, soldierId: v.id,
  };
  state.corpses.push(c);
  rt.corpseById.set(c.id, c);
  sim.events.push({ type: EV.CORPSE_CREATED, id: c.id, soldierId: v.id, x: c.x, z: c.z, faction: c.faction, unit: c.unit, infected });
  while (state.corpses.length > MAX_CORPSES) removeCorpse(sim, state.corpses[0], 'decay');
  return c;
}

export { removeCorpse };

export function updateDeaths(sim) {
  const { state, rt } = sim;
  const tick = state.tick;
  for (let si = state.squads.length - 1; si >= 0; si--) {
    const sq = state.squads[si];
    for (let mi = sq.members.length - 1; mi >= 0; mi--) {
      const m = sq.members[mi];
      if (m.state === 'dying' && tick - m.stateTick >= DYING_TICKS) {
        addCorpse(sim, sq, m);
        sq.members.splice(mi, 1);
        rt.soldierIndex.delete(m.id);
      } else if (m.state === 'rising' && tick - m.stateTick >= RISING_TICKS) {
        m.state = 'alive';
      }
    }
    if (sq.members.length === 0) {
      state.squads.splice(si, 1);
      rt.squadById.delete(sq.id);
      sim.events.push({ type: EV.SQUAD_DESTROYED, id: sq.id, faction: sq.faction, unit: sq.type, x: sq.x, z: sq.z });
    }
  }
  // gameplay corpse decay (bounded lifetime; the list is in creation order). Bodies already
  // claimed for reanimation are skipped, never allowed to block the decay of later ones.
  if (tick % 40 === 0) {
    for (let i = 0; i < state.corpses.length;) {
      const c = state.corpses[i];
      if (tick - c.tick <= CORPSE_DECAY_TICKS) break;
      if (c.riseAt) { i++; continue; }
      removeCorpse(sim, c, 'decay');
    }
  }
}

// --------------------------------------------------------------- entry

export function updateCombat(sim) {
  const { state } = sim;
  for (const sq of state.squads) {
    if ((state.tick + sq.id) % TARGET_INTERVAL === 0) acquireTarget(sim, sq);
  }
  if (state.tick % 10 === 0) updateStatus(sim);
  if (state.match.phase !== 'WAR') return; // PREPARATION: no attacks, no damage
  for (const sq of state.squads) squadFire(sim, sq);
  for (const st of state.structures) {
    if (st.built && STRUCTURES[st.type].weapon) structureFire(sim, st);
  }
}

export { engageRange };
