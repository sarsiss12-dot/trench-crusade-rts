// Builders (New Antioch Combat Engineers, Black Grail work gangs) — Phase 3 mobile UX:
//  - AUTO DISPATCH: a BUILD command without selected builders gets the nearest AVAILABLE builder
//    (idle / heading back / ready, not under fire); if every builder is busy, the site joins the
//    shortest build queue instead. A manual selection always wins.
//  - QUEUE: finish the site -> next queued site -> nearby unfinished site -> back to a hub.
//  - RETURN: an idle builder with nothing to do walks back to the nearest hub (settlement centre,
//    workshop, bastion, depot / altar, corpse mound) and waits there READY — never idles in the
//    middle of the map.
//  - SANITIZE AREA (engineers): burn every corpse in an area, then scour infected ground, until
//    the area is clean — one order, no per-corpse micro.
// Plain state: sq.bq = [site ids], order objects on the squad. Deterministic iteration.
import { STRUCTURES } from '../data/structures.js';
import { unitDef, hasRole } from '../data/units.js';
import { ENGINEERING } from '../data/economy.js';
import { FACTIONS } from '../data/factions.js';
import { EV } from '../core/events.js';
import { dist } from '../core/dmath.js';
import { TICK_RATE } from '../sim/constants.js';
import { specValue } from '../sim/specialities.js';
import { setOrder, approachPoint, distanceToStructure, requestPath, clearPath } from './orders.js';
import { cremateCorpse } from '../sim/corpses.js';
import { cleanseInfection, infectionCellAt } from '../factions/pestilence.js';

const P = [0, 0];

export function isBuilderSquad(sq) {
  return hasRole(unitDef(sq.type), 'builder');
}

function aliveCount(sq) {
  let n = 0;
  for (const m of sq.members) if (m.state === 'alive') n++;
  return n;
}

export function inDanger(sim, sq) {
  return sim.state.tick - sq.lastHitTick < ENGINEERING.dangerTicks || (sq.engaged && !!sq.target);
}

/** Idle, heading back to a hub, or ready at one — and not under fire. */
export function isAvailable(sim, sq) {
  if (!isBuilderSquad(sq) || !aliveCount(sq) || inDanger(sim, sq)) return false;
  if (sq.bq && sq.bq.length) return false;
  const o = sq.order;
  return o.t === 'idle' || (o.t === 'move' && !!o.ret);
}

export function queueLimit(state, faction) {
  return Math.round(ENGINEERING.queueMax * specValue(state, faction, 'builderQueue', 1));
}

/**
 * Builder for a new site at (x, z): the nearest available one; else (everyone busy) the one with
 * the shortest queue that is not under fire. Returns { sq, queued } or null.
 */
export function pickBuilder(sim, faction, x, z) {
  const { state } = sim;
  let best = null, bd = Infinity;
  for (const sq of state.squads) {
    if (sq.faction !== faction || !isAvailable(sim, sq)) continue;
    const d = dist(sq.cx, sq.cz, x, z);
    if (d < bd || (d === bd && best && sq.id < best.id)) { bd = d; best = sq; }
  }
  if (best) return { sq: best, queued: false };
  const lim = queueLimit(state, faction);
  let score = Infinity;
  for (const sq of state.squads) {
    if (sq.faction !== faction || !isBuilderSquad(sq) || !aliveCount(sq) || inDanger(sim, sq)) continue;
    const q = sq.bq ? sq.bq.length : 0;
    if (q >= lim) continue;
    const s = q * 1000 + dist(sq.cx, sq.cz, x, z);
    if (s < score || (s === score && best && sq.id < best.id)) { score = s; best = sq; }
  }
  return best ? { sq: best, queued: true } : null;
}

/** Give a builder a site: start now when free, otherwise append to its queue. */
export function assignSite(sim, sq, st, auto) {
  const o = sq.order;
  const busy = o.t === 'build' || o.t === 'repair' || o.t === 'sanitize' || o.t === 'gather';
  if (busy && auto) {
    if (!sq.bq) sq.bq = [];
    if (sq.bq.indexOf(st.id) < 0) sq.bq.push(st.id);
  } else setOrder(sim, sq, { t: 'build', sid: st.id, arrived: 0 });
  if (auto) sim.events.push({ type: EV.ENGINEER_ASSIGNED, faction: sq.faction, squadId: sq.id, sid: st.id, x: st.x, z: st.z, queued: busy ? 1 : 0 });
}

/** Nearest built own hub (settlement / workshop / bastion / depot; altar / corpse mound). */
export function nearestHub(sim, sq) {
  let best = null, bd = Infinity;
  for (const st of sim.state.structures) {
    if (st.faction !== sq.faction || !st.built || st.hp <= 0 || !STRUCTURES[st.type].hub) continue;
    const d = dist(st.x, st.z, sq.cx, sq.cz);
    if (d < bd || (d === bd && best && st.id < best.id)) { bd = d; best = st; }
  }
  return best;
}

function nearestSite(sim, sq, radius) {
  let best = null, bd = radius;
  for (const st of sim.state.structures) {
    if (st.faction !== sq.faction || st.built) continue;
    const d = distanceToStructure(st, sq.x, sq.z);
    if (d < bd) { bd = d; best = st; }
  }
  return best;
}

/** Next job after a finished one: queue, then nearby site, then home to a hub. */
function nextJob(sim, sq) {
  const { rt } = sim;
  while (sq.bq && sq.bq.length) {
    const id = sq.bq.shift();
    const st = rt.structById.get(id);
    if (st && !st.built && st.faction === sq.faction) { setOrder(sim, sq, { t: 'build', sid: st.id, arrived: 0 }); return true; }
  }
  const near = nearestSite(sim, sq, 45);
  if (near) { setOrder(sim, sq, { t: 'build', sid: near.id, arrived: 0 }); return true; }
  const hub = nearestHub(sim, sq);
  if (!hub) return false;
  approachPoint(hub, sq.cx, sq.cz, P, 3);
  if (dist(sq.cx, sq.cz, P[0], P[1]) < 10) { sq.order = { t: 'idle', ready: 1 }; return false; }
  setOrder(sim, sq, { t: 'move', x: P[0], z: P[1], am: 0, trench: 0, ret: 1 });
  return true;
}

// ------------------------------------------------------------------ sanitize

/** Start SANITIZE AREA for an engineer squad. */
export function startSanitize(sim, sq, x, z, r) {
  setOrder(sim, sq, { t: 'sanitize', x, z, r, phase: 'seek', cid: 0, until: 0 });
}

function corpseInArea(sim, sq, o) {
  const bit = 1 << FACTIONS[sq.faction].index;
  let best = null, bd = Infinity;
  for (const c of sim.state.corpses) {
    if (!(c.seenBy & bit)) continue;
    if (dist(c.x, c.z, o.x, o.z) > o.r) continue;
    const d = dist(c.x, c.z, sq.cx, sq.cz) - (c.infected ? 6 : 0) - (c.riseAt ? 10 : 0);
    if (d < bd || (d === bd && best && c.id < best.id)) { bd = d; best = c; }
  }
  return best;
}

function dirtiestCell(sim, o) {
  const inf = sim.state.infection;
  let best = -1, bv = 39;
  const R = Math.ceil(o.r / inf.cs);
  const cx = Math.floor(o.x / inf.cs), cz = Math.floor(o.z / inf.cs);
  for (let dz = -R; dz <= R; dz++) {
    for (let dx = -R; dx <= R; dx++) {
      const gx = cx + dx, gz = cz + dz;
      if (gx < 0 || gz < 0 || gx >= inf.cols || gz >= inf.rows) continue;
      if (dist((gx + 0.5) * inf.cs, (gz + 0.5) * inf.cs, o.x, o.z) > o.r) continue;
      const v = inf.v[gz * inf.cols + gx];
      if (v > bv) { bv = v; best = gz * inf.cols + gx; }
    }
  }
  return best;
}

function updateSanitize(sim, sq, o) {
  const { state, rt } = sim;
  const tick = state.tick;
  const speed = specValue(state, sq.faction, 'sanitizeSpeed', 1);
  if (o.phase === 'seek') {
    const c = corpseInArea(sim, sq, o);
    if (c) {
      o.cid = c.id; o.phase = 'to';
      requestPath(sim, sq, c.x, c.z);
      return;
    }
    const cell = dirtiestCell(sim, o);
    if (cell >= 0) {
      const inf = state.infection;
      o.cx = ((cell % inf.cols) + 0.5) * inf.cs; o.cz = (Math.floor(cell / inf.cols) + 0.5) * inf.cs;
      o.phase = 'to_ground';
      requestPath(sim, sq, o.cx, o.cz);
      return;
    }
    // the area is clean
    sq.order = { t: 'idle', done: 1 };
    clearPath(sq);
    sim.events.push({ type: EV.NOTICE, faction: sq.faction, key: 'sanitize.done', squadId: sq.id, x: o.x, z: o.z });
    return;
  }
  if (o.phase === 'to') {
    const c = rt.corpseById.get(o.cid);
    if (!c) { o.phase = 'seek'; clearPath(sq); return; }
    if (dist(sq.cx, sq.cz, c.x, c.z) < 3.2) { o.phase = 'burn'; o.until = tick + Math.round((3 / speed) * TICK_RATE); clearPath(sq); return; }
    if (sq.pathState === 'none' || sq.pathState === 'done') requestPath(sim, sq, c.x, c.z);
    else if (sq.pathState === 'failed' && tick - sq.pathReqTick > 30) {
      if (sq.pathFails > 4) { o.phase = 'seek'; o.skip = (o.skip || 0) + 1; if (o.skip > 6) { sq.order = { t: 'idle', done: 1 }; } clearPath(sq); }
      else requestPath(sim, sq, c.x, c.z);
    }
    return;
  }
  if (o.phase === 'burn') {
    const c = rt.corpseById.get(o.cid);
    if (!c) { o.phase = 'seek'; return; }
    if (tick < o.until) return;
    const f = state.factions[sq.faction];
    if ((f.resources.supply || 0) >= 1) f.resources.supply -= 1; // lamp oil / fuel
    cremateCorpse(sim, c, sq.faction);
    o.phase = 'seek';
    return;
  }
  if (o.phase === 'to_ground') {
    if (dist(sq.cx, sq.cz, o.cx, o.cz) < 3) { o.phase = 'clean'; o.until = tick + Math.round((2 / speed) * TICK_RATE); clearPath(sq); return; }
    if (sq.pathState === 'none' || sq.pathState === 'done') requestPath(sim, sq, o.cx, o.cz);
    else if (sq.pathState === 'failed' && tick - sq.pathReqTick > 30) { o.phase = 'seek'; clearPath(sq); }
    return;
  }
  if (o.phase === 'clean') {
    if (tick < o.until) return;
    cleanseInfection(sim, o.cx, o.cz, 6, 70);
    const i = infectionCellAt(state, o.cx, o.cz);
    if (i >= 0 && state.infection.v[i] > 39) state.infection.v[i] = 0; // this cell at least is done
    o.phase = 'seek';
  }
}

// ------------------------------------------------------------------ per tick

export function updateEngineers(sim) {
  const { state } = sim;
  const tick = state.tick;
  for (const sq of state.squads) {
    const o = sq.order;
    if (o.t === 'sanitize') { updateSanitize(sim, sq, o); continue; }
    if (!isBuilderSquad(sq) || (tick + sq.id) % 10 !== 0) continue;
    if (!aliveCount(sq)) continue;
    // arrived back at a hub: ready
    if (o.t === 'move' && o.ret && sq.pathState === 'none') continue;
    // a finished job (build / repair / sanitize): queue -> nearby site -> back to a hub.
    // A plain player move ends as a normal idle and is left alone.
    if (o.t === 'idle' && o.done) {
      if (inDanger(sim, sq)) continue;
      if (!nextJob(sim, sq)) sq.order = { t: 'idle', ready: 1 };
    }
  }
}

/** HUD status of a builder squad (for the engineer strip). */
export function builderStatus(sim, sq) {
  const o = sq.order;
  if (inDanger(sim, sq)) return 'danger';
  if (o.t === 'build') return o.arrived && sq.working ? 'building' : 'moving';
  if (o.t === 'repair') return o.arrived && sq.working ? 'repairing' : 'moving';
  if (o.t === 'sanitize') return 'sanitizing';
  if (o.t === 'gather') return 'hauling';
  if (o.t === 'move') return 'moving';
  return 'idle';
}
