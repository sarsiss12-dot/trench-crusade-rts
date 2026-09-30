// Walking replacement reinforcements (New Antioch). The depleted squad STAYS where it is (at the
// front, in its trench posts); a request (REINFORCE command or automatic near a source) makes the
// faction send replacements one by one from a reinforcement source (bastion / supply depot /
// muster point). Each replacement is paid for (manpower + supply) when it leaves the source and
// physically walks to its squad ('joining' state), taking an empty formation slot or free trench
// post. Nothing teleports:
//  - no living, built source            -> request impossible (cancelled, notice)
//  - source destroyed while requested   -> another source is used, else cancelled
//  - route cut (source and squad in different nav components) -> delayed (notice), retried
// Everything here is plain state (sq.reinf) + deterministic iteration: saves / replays agree.
import { lullBonus } from '../sim/lull.js';
import { STRUCTURES } from '../data/structures.js';
import { sideDef } from '../data/factions.js';
import { unitDef } from '../data/units.js';
import { EV } from '../core/events.js';
import { dist } from '../core/dmath.js';
import { createSoldier } from '../sim/state.js';
import { exitPoint } from '../sim/production.js';
import { approachPoint, distanceToStructure } from '../units/orders.js';
import { isPointPassable, cellAt, isPassable, nearestPassable, findPath } from '../world/nav.js';
import { PATH_WORK_PER_TICK } from '../sim/constants.js';
import { specRule, specValue } from '../sim/specialities.js';

const P = [0, 0];

/** Soldiers the squad still misses (members includes walking replacements). */
export function missingMembers(sq) {
  return Math.max(0, Math.max(sq.cap || 0, unitDef(sq.type).squadSize) - sq.members.length);
}

function compAt(nav, x, z) {
  let idx = cellAt(nav, x, z);
  if (idx < 0) return -1;
  if (!isPassable(nav, idx)) idx = nearestPassable(nav, idx, 6);
  return idx < 0 ? -1 : nav.comp[idx];
}

/** Spawn point of a replacement: the source's side facing the squad (never its back wall). */
function spawnPoint(sim, src, sq, out) {
  approachPoint(src, sq.x, sq.z, out, 1.4);
  if (!isPointPassable(sim.rt.nav, out[0], out[1])) exitPoint(src, out);
  return out;
}

/**
 * Reinforcement sources: bastion / supply depot / muster point — and, with the Logistics
 * speciality, every inhabited, non-evacuated settlement (replacements are raised locally).
 */
export function isReinforceSource(st, fid, state) {
  if (st.faction !== fid || !st.built || st.hp <= 0) return false;
  const d = STRUCTURES[st.type];
  if (d.reinforceSource) return true;
  return !!(state && d.settlement && !st.evac && st.pop >= SETTLEMENT_SOURCE_POP && specRule(state, fid, 'settlementReinforce'));
}
const SETTLEMENT_SOURCE_POP = 4;
const SETTLEMENT_REINFORCE_R = 34;

function sourceRadius(st) {
  return STRUCTURES[st.type].reinforceRadius || SETTLEMENT_REINFORCE_R;
}

/**
 * Best source for a squad: reachable sources first (same nav component as the squad anchor), then
 * nearest; ties by id. Returns { st, reachable } or null when the faction has no living source.
 */
export function pickSource(sim, sq) {
  const nav = sim.rt.nav;
  const target = compAt(nav, sq.x, sq.z);
  let best = null, bestD = Infinity, bestR = false;
  for (const st of sim.state.structures) {
    if (!isReinforceSource(st, sq.faction, sim.state)) continue;
    spawnPoint(sim, st, sq, P);
    const reachable = target >= 0 && compAt(nav, P[0], P[1]) === target;
    const d = dist(sq.x, sq.z, st.x, st.z);
    if ((reachable && !bestR) || (reachable === bestR && (d < bestD || (d === bestD && st.id < best.id)))) {
      best = st; bestD = d; bestR = reachable;
    }
  }
  return best ? { st: best, reachable: bestR } : null;
}

/** Validate + register a reinforcement request. Returns null or a reject reason key. */
export function requestReinforcement(sim, sq, auto = false) {
  if (sq.autonomous || sq.civ) return 'reinf.not_available';
  const conf = sideDef(sq.faction).reinforcements;
  if (!conf) return 'reinf.not_available';
  if (!unitDef(sq.type).combatUnit && !unitDef(sq.type).reinforceable) return 'reinf.not_available';
  if (missingMembers(sq) <= 0) return 'reinf.full';
  const pick = pickSource(sim, sq);
  if (!pick) return 'reinf.no_source';
  if (!sq.reinf) sq.reinf = { src: pick.st.id, next: sim.state.tick + 1, cut: 0, wait: 0, auto: auto ? 1 : 0 };
  else { sq.reinf.src = pick.st.id; sq.reinf.auto = sq.reinf.auto && auto ? 1 : 0; }
  return null;
}

function notice(sim, sq, key) {
  sim.events.push({ type: EV.NOTICE, faction: sq.faction, key, squadId: sq.id, x: sq.cx, z: sq.cz });
}

/**
 * POSITIONAL AUTO REINFORCEMENT (Phase 4.1, final design). A squad in the OPEN FIELD never tops
 * itself up (the player asks with REINFORCE). A squad that settles into a real DEFENSIVE POSITION —
 * a trench (hold_trench) or a ruin garrison (inside), later bunkers / wall firing positions —
 * switches it ON by itself; the player may switch it OFF for that squad (kept while it stays in
 * that position). Leaving the position clears the positional state; the next position starts ON
 * again. Replacements already walking are never cancelled — only NEW dispatches stop.
 * State: sq.posId (the position's structure id, 0 = open field), sq.posAuto (1 on / 0 off).
 */
export function positionOf(sq) {
  const o = sq.order;
  if (o.t === 'hold_trench') return o.sid || 0;
  if (o.t === 'garrison' && o.phase === 'inside') return o.sid || 0;
  return 0;
}

/** Auto reinforcement currently on for this squad (in a position and not switched off). */
export function autoReinforceOn(sq) {
  return !!(sq.posId && sq.posAuto);
}

/** Track position entry / exit (positional default ON on entry, cleared on exit). */
export function trackPosition(sq) {
  const pos = positionOf(sq);
  if (pos === (sq.posId || 0)) return;
  if (pos) {
    if (!sq.posId) sq.posAuto = 1; // entering a position from the open field: default ON
    sq.posId = pos; // moving between segments of the same line keeps the player's choice
  } else {
    sq.posId = 0;
    sq.posAuto = 0;
    if (sq.reinf && sq.reinf.auto) sq.reinf = null; // no NEW dispatches; walkers keep walking
  }
}

function autoRequests(sim, fid) {
  const { state } = sim;
  for (const sq of state.squads) {
    if (sq.faction !== fid || !unitDef(sq.type).combatUnit) continue;
    trackPosition(sq);
    if (!autoReinforceOn(sq)) { if (sq.reinf && sq.reinf.auto) sq.reinf = null; continue; }
    if (sq.reinf || missingMembers(sq) <= 0) continue;
    const pick = pickSource(sim, sq);
    if (!pick || !pick.reachable) continue;
    requestReinforcement(sim, sq, true);
  }
}

/** Men missing across squads waiting for resources on an automatic request (the notice's count). */
function waitingMen(state, fid) {
  let n = 0;
  for (const sq of state.squads) if (sq.faction === fid && sq.reinf && sq.reinf.auto && sq.reinf.wait) n += missingMembers(sq);
  return n;
}

/** Dispatch one replacement per requesting squad per interval. */
export function updateReinforcements(sim, fid) {
  const { state, rt } = sim;
  const conf = sideDef(fid).reinforcements;
  if (!conf) return;
  const f = state.factions[fid];
  const interval = Math.max(1, Math.round(conf.intervalTicks * specValue(state, fid, 'reinfInterval', 1)));
  const supplyCost = conf.supply * specValue(state, fid, 'reinfSupply', 1);
  if (state.tick % conf.intervalTicks === 7) autoRequests(sim, fid);
  for (const sq of state.squads) {
    const r = sq.reinf;
    if (!r || sq.faction !== fid) continue;
    if (state.tick < r.next) continue;
    r.next = state.tick + Math.max(1, Math.round(interval * lullBonus(state, 'reinfInterval', sq.lastHitTick)));
    if (missingMembers(sq) <= 0) {
      sq.reinf = null;
      if (!r.auto) notice(sim, sq, 'reinf.complete');
      continue;
    }
    let src = rt.structById.get(r.src);
    if (!src || !isReinforceSource(src, fid, state)) {
      const pick = pickSource(sim, sq);
      if (!pick) { sq.reinf = null; notice(sim, sq, 'reinf.source_lost'); continue; }
      src = pick.st;
      r.src = src.id;
    }
    spawnPoint(sim, src, sq, P);
    const nav = rt.nav;
    const target = compAt(nav, sq.x, sq.z);
    if (target < 0 || compAt(nav, P[0], P[1]) !== target) {
      // try another source that still has a route; otherwise wait (delayed, not cancelled)
      const pick = pickSource(sim, sq);
      if (pick && pick.reachable) { r.src = pick.st.id; r.next = state.tick + 1; continue; }
      if (!r.cut) { r.cut = 1; notice(sim, sq, 'reinf.route_cut'); }
      continue;
    }
    r.cut = 0;
    const need = supplyCost + (r.auto && conf.autoReserve ? conf.autoReserve.supply || 0 : 0); // ammunition first
    if (f.resources.manpower < conf.manpower || f.resources.supply < need) {
      r.wait = 1;
      // ONE meaningful notice ("waiting: supply short · 11 men"), then silence until it flows again
      if (r.auto && !f.reinfWait) {
        f.reinfWait = 1;
        sim.events.push({ type: EV.NOTICE, faction: fid, key: 'reinf.auto_waiting', res: f.resources.supply < need ? 'supply' : 'manpower', n: waitingMen(state, fid), x: sq.cx, z: sq.cz });
      }
      continue;
    }
    f.reinfWait = 0;
    if (rt.pathWork >= PATH_WORK_PER_TICK) continue; // the walk path is budgeted A* work: next tick
    r.wait = 0;
    f.resources.manpower -= conf.manpower;
    f.resources.supply -= supplyCost;
    const def = unitDef(sq.type);
    const m = createSoldier(state, def, sq.members.length, P[0], P[1], sq.rot, 'joining');
    // the walk itself: a squad-style path from the source to the squad (steering follows it)
    const res = findPath(nav, fid, P[0], P[1], sq.x, sq.z);
    rt.pathWork += nav.lastCost;
    if (res && res.points.length) { m.dp = res.points; m.di = 0; m.dgx = sq.x; m.dgz = sq.z; }
    sq.members.push(m);
    rt.soldierIndex.set(m.id, sq);
    sim.events.push({ type: EV.SQUAD_SPAWNED, id: sq.id, faction: fid, unit: sq.type, x: P[0], z: P[1], reinforcement: m.id });
    if (missingMembers(sq) <= 0) { sq.reinf = null; if (!r.auto) notice(sim, sq, 'reinf.dispatched'); }
  }
}
