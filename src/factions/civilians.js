// Civilians of New Antioch (Phase 3). Population is AGGREGATE (settlement.pop / faction.population);
// what walks on the map is each settlement's small visible WORKFORCE: autonomous crews of the
// 'civilians' unit (never commanded by the player, never in "All"). Bounded: one crew per
// settlement (<= 6 people), two for the fortress, one 2-man drover team per livestock pen.
//  work     : go to a farm / quarry / pen / field, work there, walk back ("porters carry loads")
//  threat   : visible enemies close -> shelter inside their settlement (or flee to a safe one)
//  hidden   : sheltered people are safe until the building falls — then they die with it
//  evacuate : EVACUATE command — the crew carries the settlement's whole population to a safe
//             settlement / the fortress; whoever arrives is preserved (population moves with them)
//  settle   : settlers walk out from the fortress to a new (or abandoned, now safe) settlement
//  drovers  : find nearby livestock, drive it alive into their pen (no per-animal orders)
// Losses: every civilian who dies takes his share of the settlement's population with him.
// Everything is plain state on the squad (sq.civ) + normal MOVE orders; decisions are staggered.
import { cellOwner } from './pestilence.js';
import { isPlagueImmune } from '../data/factions.js';
import { STRUCTURES } from '../data/structures.js';
import { POPULATION } from '../data/economy.js';
import { WILDLIFE } from '../data/animals.js';
import { unitDef } from '../data/units.js';
import { EV } from '../core/events.js';
import { dist, dsin, dcos } from '../core/dmath.js';
import { rngFloat, hash32 } from '../core/rng.js';
import { TICK_RATE } from '../sim/constants.js';
import { createSquad, createSoldier } from '../sim/state.js';
import { exitPoint } from '../sim/production.js';
import { setOrder, approachPoint, clearPath } from '../units/orders.js';
import { killSoldier } from '../combat/combat.js';
import { herdableAnimal, pennedCount, animalById } from '../sim/wildlife.js';
import { isSettlement, threatNear, settlementSafe, homeDropOff, popCap, econHostAt } from '../economy/settlements.js';

const T = TICK_RATE;
const P = [0, 0];

function aliveMembers(sq) {
  let n = 0;
  for (const m of sq.members) if (m.state === 'alive' || m.state === 'sheltered') n++;
  return n;
}

function register(sim, sq) {
  const { state, rt } = sim;
  state.squads.push(sq);
  rt.squadById.set(sq.id, sq);
  for (const m of sq.members) rt.soldierIndex.set(m.id, sq);
  sim.events.push({ type: EV.SQUAD_SPAWNED, id: sq.id, faction: sq.faction, unit: sq.type, x: sq.x, z: sq.z, civilian: 1 });
}

/** Remove a crew without deaths (evacuees absorbed at their destination, drovers disbanded). */
function disband(sim, sq) {
  const { state, rt } = sim;
  const i = state.squads.indexOf(sq);
  if (i >= 0) state.squads.splice(i, 1);
  rt.squadById.delete(sq.id);
  for (const m of sq.members) rt.soldierIndex.delete(m.id);
  sim.events.push({ type: EV.SQUAD_DESTROYED, id: sq.id, faction: sq.faction, unit: sq.type, x: sq.cx, z: sq.cz, quiet: 1 });
}

function spawnCrew(sim, fid, at, size, civ) {
  exitPoint(at, P);
  const sq = createSquad(sim.state, fid, 'civilians', P[0], P[1], at.rot || 0, { size: Math.max(1, Math.min(POPULATION.crewMax, size)) });
  sq.civ = { home: 0, role: 'work', mode: 'work', phase: 'rest', site: 0, t: sim.state.tick + 40, pop: 0, dest: 0, pen: 0, aid: 0, start: 0, n: 0, carry: 0, ...civ };
  sq.civ.n = sq.members.length;
  sq.cx = P[0]; sq.cz = P[1];
  register(sim, sq);
  return sq;
}

function moveTo(sim, sq, x, z) {
  setOrder(sim, sq, { t: 'move', x, z, am: 0, trench: 0 });
}

function structOf(sim, id) {
  const st = id ? sim.rt.structById.get(id) : null;
  return st && st.hp > 0 ? st : null;
}

/** Nearest place a civilian can be safe at: a safe own settlement (not `except`) or the fortress. */
function safeHaven(sim, fid, x, z, except, needRoom) {
  const { state } = sim;
  let best = null, bd = Infinity;
  for (const st of state.structures) {
    if (st.faction !== fid || !st.built || st.hp <= 0 || st.id === except) continue;
    const def = STRUCTURES[st.type];
    if (!def.shelter && !(def.dropOff && !def.settlement)) continue;
    if (def.settlement && (!settlementSafe(sim, st) || st.evac)) continue;
    if (needRoom && def.settlement && st.pop >= popCap(sim, st)) continue;
    const d = dist(st.x, st.z, x, z) * (def.settlement ? 1 : 0.8); // the fortress is a little preferred
    if (d < bd) { bd = d; best = st; }
  }
  return best;
}

// ------------------------------------------------------------------ setup

/** The home quarter's population (starting package: fortress city 40, field HQ 26) and its two working crews. */
export function setupCivilians(sim, fid) {
  const { state } = sim;
  const f = state.factions[fid];
  f.population = f.popStart !== undefined ? f.popStart : POPULATION.baseStart; // starting package (faction + role)
  const home = state.structures.find((s) => s.faction === fid && STRUCTURES[s.type].hq);
  if (!home) return;
  spawnCrew(sim, fid, home, 5, { home: home.id });
  spawnCrew(sim, fid, home, 4, { home: home.id, t: state.tick + 200 });
}

// ------------------------------------------------------------------ commands

/** EVACUATE: the settlement's people leave for safety, carrying its population. */
export function evacuateSettlement(sim, st) {
  const { state } = sim;
  const fid = st.faction;
  const dest = safeHaven(sim, fid, st.x, st.z, st.id, true) || homeDropOff(sim, fid, st.x, st.z);
  if (!dest) return 'evac.no_haven';
  let crew = null;
  for (const sq of state.squads) if (sq.civ && sq.civ.home === st.id && sq.civ.role === 'work') { crew = sq; break; }
  if (!crew && st.pop > 0) crew = spawnCrew(sim, fid, st, Math.ceil(st.pop / POPULATION.popPerCrew), { home: st.id });
  if (crew) {
    emerge(sim, crew, st);
    crew.civ.mode = 'evac';
    crew.civ.pop = st.pop;
    crew.civ.start = aliveMembers(crew);
    crew.civ.dest = dest.id;
    crew.civ.n = crew.civ.start;
    approachPoint(dest, crew.cx, crew.cz, P, 2.5);
    moveTo(sim, crew, P[0], P[1]);
  }
  // drovers of the settlement's pens go too
  for (const sq of state.squads) {
    if (!sq.civ || sq.civ.role !== 'drover' || sq.civ.home !== st.id) continue;
    releaseHerd(sim, sq);
    sq.civ.mode = 'evac'; sq.civ.pop = 0; sq.civ.dest = dest.id; sq.civ.start = aliveMembers(sq);
    approachPoint(dest, sq.cx, sq.cz, P, 2.5);
    moveTo(sim, sq, P[0], P[1]);
  }
  st.pop = 0;
  st.evac = 1;
  st.evacAt = state.tick;
  st.crew = 0;
  state.factions[fid].stats.evacuations++;
  sim.events.push({ type: EV.EVACUATION, faction: fid, sid: st.id, x: st.x, z: st.z, dest: dest.id });
  return null;
}

// ------------------------------------------------------------------ helpers

function infectionAt(state, x, z) {
  const inf = state.infection;
  const cx = Math.floor(x / inf.cs), cz = Math.floor(z / inf.cs);
  if (cx < 0 || cz < 0 || cx >= inf.cols || cz >= inf.rows) return 0;
  return inf.v[cz * inf.cols + cx];
}

function hide(sim, sq, st) {
  for (const m of sq.members) {
    if (m.state !== 'alive') continue;
    m.state = 'sheltered';
    m.x = st.x; m.z = st.z; m.vx = 0; m.vz = 0;
    m.working = 0;
  }
  sq.x = st.x; sq.z = st.z; sq.cx = st.x; sq.cz = st.z;
  clearPath(sq);
  sq.order = { t: 'idle' };
  sq.civ.mode = 'hidden';
}

function emerge(sim, sq, st) {
  if (sq.civ.mode !== 'hidden') return;
  exitPoint(st, P);
  let k = 0;
  for (const m of sq.members) {
    if (m.state !== 'sheltered') continue;
    m.state = 'alive';
    m.x = P[0] + ((k % 3) - 1) * 0.9; m.z = P[1] + Math.floor(k / 3) * 0.9;
    m.wx = m.x; m.wz = m.z;
    k++;
  }
  sq.x = P[0]; sq.z = P[1]; sq.cx = P[0]; sq.cz = P[1];
  sq.civ.mode = 'work';
  sq.civ.phase = 'rest';
  sq.civ.t = sim.state.tick + 40;
}

function releaseHerd(sim, sq) {
  for (const a of sim.state.animals) if (a.st === 'herded' && a.by === sq.id) { a.st = 'wild'; a.by = 0; }
  sq.civ.aid = 0;
}

/** Work sites of a home: hosted farms / quarry / pen; the fortress also works the map fields. */
function workSites(sim, home, out) {
  out.length = 0;
  for (const st of sim.state.structures) {
    if (st.faction !== home.faction || !st.built) continue;
    const def = STRUCTURES[st.type];
    if (def.farm || def.quarry || def.pen) {
      if (st.host === home.id) out.push(st);
    } else if (st.type === 'field' && !isSettlement(home) && dist(st.x, st.z, home.x, home.z) < 150) out.push(st);
  }
  return out;
}
const SITES = [];

function workPoint(sim, st, sq, out) {
  const def = STRUCTURES[st.type];
  if (def.kind === 'area') {
    // somewhere inside the field
    const u = rngFloat(sim.state.rng.eco) - 0.5, v = rngFloat(sim.state.rng.eco) - 0.5;
    const lx = u * def.footprint.w * 0.7, lz = v * def.footprint.d * 0.7;
    const s = dsin(st.rot), c = dcos(st.rot);
    out[0] = st.x - lx * c + lz * s;
    out[1] = st.z + lx * s + lz * c;
    return out;
  }
  return approachPoint(st, sq.cx, sq.cz, out, 1.6);
}

// ------------------------------------------------------------------ per crew

function updateWorkCrew(sim, sq, home) {
  const { state } = sim;
  const c = sq.civ;
  const tick = state.tick;
  const o = sq.order;
  if (c.phase === 'rest') {
    if (tick < c.t) return;
    const sites = workSites(sim, home, SITES);
    const rng = state.rng.eco;
    if (sites.length) {
      const st = sites[Math.floor(rngFloat(rng) * sites.length)];
      c.site = st.id;
      workPoint(sim, st, sq, P);
    } else {
      c.site = 0;
      const a = rngFloat(rng) * 6.2832, r = 6 + rngFloat(rng) * 8;
      approachPoint(home, home.x + dsin(a) * 30, home.z + dcos(a) * 30, P, 1.5);
      P[0] += dsin(a) * r * 0.5; P[1] += dcos(a) * r * 0.5;
    }
    c.phase = 'go';
    c.carry = 0;
    moveTo(sim, sq, P[0], P[1]);
    return;
  }
  if (c.phase === 'go') {
    if (o.t === 'move') return;
    const site = structOf(sim, c.site);
    if (site) {
      setOrder(sim, sq, { t: 'civwork', sid: site.id });
      c.phase = 'work';
      c.t = tick + Math.round((18 + rngFloat(state.rng.eco) * 17) * T);
    } else { c.phase = 'rest'; c.t = tick + 4 * T; }
    return;
  }
  if (c.phase === 'work') {
    if (!structOf(sim, c.site)) c.t = tick;
    if (tick < c.t) return;
    c.phase = 'back';
    c.carry = 1; // porters carry the yield home (presentation: sacks / baskets)
    approachPoint(home, sq.cx, sq.cz, P, 1.8);
    moveTo(sim, sq, P[0], P[1]);
    return;
  }
  if (c.phase === 'back') {
    if (o.t === 'move') return;
    c.phase = 'rest';
    c.carry = 0;
    c.t = tick + Math.round((6 + rngFloat(state.rng.eco) * 6) * T);
  }
}

function updateDrover(sim, sq, home) {
  const { state } = sim;
  const c = sq.civ;
  const pen = structOf(sim, c.pen);
  if (!pen) { releaseHerd(sim, sq); c.pen = 0; c.mode = 'return'; approachPoint(home, sq.cx, sq.cz, P, 1.8); moveTo(sim, sq, P[0], P[1]); return; }
  const tick = state.tick;
  const cap = STRUCTURES[pen.type].pen.capacity;
  const herd = STRUCTURES[pen.type].pen.herdRadius;
  if (c.phase === 'rest' || c.phase === 'wait') {
    if (tick < c.t) return;
    if (pennedCount(state, pen.id) >= cap) { c.phase = 'wait'; c.t = tick + 5 * T; return; }
    const taken = TAKEN;
    taken.clear();
    for (const a of state.animals) if (a.st === 'herded') taken.add(a.id);
    const a = herdableAnimal(sim, sq.faction, pen.herdX, pen.herdZ, herd, taken);
    if (!a || threatNear(sim, sq.faction, a.x, a.z, 25)) { c.phase = 'wait'; c.t = tick + 4 * T; return; }
    c.aid = a.id;
    c.phase = 'catch';
    c.t = tick;
    moveTo(sim, sq, a.x, a.z);
    return;
  }
  if (c.phase === 'catch') {
    const a = animalById(state, c.aid);
    if (!a || a.st !== 'wild') { c.phase = 'rest'; c.t = tick + T; return; }
    if (dist(sq.cx, sq.cz, a.x, a.z) <= WILDLIFE.herdCatchR + 1) {
      a.st = 'herded'; a.by = sq.id; a.panic = 0;
      c.phase = 'lead';
      approachPoint(pen, sq.cx, sq.cz, P, -1.5);
      moveTo(sim, sq, pen.x, pen.z);
      return;
    }
    // the animal wanders: re-aim every two seconds
    if (tick - c.t > 2 * T || sq.order.t !== 'move') { c.t = tick; moveTo(sim, sq, a.x, a.z); }
    return;
  }
  if (c.phase === 'lead') {
    const a = animalById(state, c.aid);
    if (!a || a.st !== 'herded' || a.by !== sq.id) { c.phase = 'rest'; c.t = tick + T; return; }
    if (sq.order.t === 'move') return;
    if (dist(a.x, a.z, pen.x, pen.z) < 7) {
      a.st = 'penned'; a.pen = pen.id; a.by = 0;
      c.aid = 0;
      c.phase = 'rest';
      c.t = tick + 3 * T;
    } else if (tick - c.t > 3 * T) { c.t = tick; moveTo(sim, sq, pen.x, pen.z); }
  }
}
const TAKEN = new Set();

function updateCrew(sim, sq) {
  const { state } = sim;
  const c = sq.civ;
  const fid = sq.faction;
  const tick = state.tick;
  let home = structOf(sim, c.home);
  // population bookkeeping: each dead civilian takes his share of the population
  const n = aliveMembers(sq);
  if (n < c.n) {
    const lost = c.n - n;
    state.factions[fid].stats.civLost += lost;
    if (c.mode === 'evac' || c.mode === 'settle') {
      const share = c.start > 0 ? c.pop / c.start : 0;
      c.pop = Math.max(0, c.pop - share * lost);
      c.start = Math.max(0, c.start - lost);
    } else if (home && home.pop !== undefined && home.pop > 0) {
      const share = Math.max(1, home.pop / Math.max(1, c.n));
      home.pop = Math.max(0, home.pop - Math.round(share * lost));
    } else if (home && !isSettlement(home)) {
      const f = state.factions[fid];
      f.population = Math.max(0, (f.population || 0) - lost * 2);
    }
  }
  c.n = n;
  if (n === 0) return; // the squad is removed when its last body falls (combat.updateDeaths)
  // home destroyed
  if (!home && c.mode !== 'evac' && c.mode !== 'settle') {
    if (c.mode === 'hidden') {
      // Phase 4.1: they were inside when it fell — a deterministic share dies under the rubble
      // (hash of the person, no RNG stream), the survivors crawl out of the wreck and run for the
      // nearest safe settlement / bastion. On rotten ground they may carry the plague with them —
      // at most one stack (never enough to turn where they fall: no exploit for the Grail).
      const k = POPULATION.collapse;
      let survivors = 0, j = 0;
      for (const m of sq.members) {
        if (m.state !== 'sheltered') continue;
        m.state = 'alive';
        if (hash32(m.id, 0xc011a) / 4294967296 < k.killShare) { killSoldier(sim, sq, m, '', 'collapse', 0, 0); continue; }
        const a = (j++ * 2.399963) % 6.283185307179586; // golden-angle spread around the wreck
        m.x = sq.x + dsin(a) * k.spread; m.z = sq.z + dcos(a) * k.spread; m.wx = m.x; m.wz = m.z;
        if (infectionAt(state, m.x, m.z) > k.infectGround && !isPlagueImmune(sq.faction)) {
          m.infection = Math.max(m.infection || 0, 1);
          const inf = state.infection;
          const i = Math.floor(m.z / inf.cs) * inf.cols + Math.floor(m.x / inf.cs);
          m.infBy = cellOwner(state, i) || m.infBy || ''; // the ground's plague owns the stack
        }
        survivors++;
      }
      if (!survivors) return;
      sim.events.push({ type: EV.NOTICE, faction: fid, key: 'civ.survivors', n: survivors, x: sq.x, z: sq.z });
      const haven = safeHaven(sim, fid, sq.x, sq.z, 0, false) || homeDropOff(sim, fid, sq.x, sq.z);
      if (!haven) { c.mode = 'flee'; return; }
      c.mode = 'evac'; c.dest = haven.id; c.pop = 0; c.start = survivors;
      approachPoint(haven, sq.x, sq.z, P, 2.5);
      moveTo(sim, sq, P[0], P[1]);
      return;
    }
    const haven = safeHaven(sim, fid, sq.cx, sq.cz, 0, false) || homeDropOff(sim, fid, sq.cx, sq.cz);
    if (!haven) return;
    c.mode = 'evac'; c.dest = haven.id; c.pop = 0; c.start = n;
    releaseHerd(sim, sq);
    approachPoint(haven, sq.cx, sq.cz, P, 2.5);
    moveTo(sim, sq, P[0], P[1]);
    return;
  }
  // journeys: evacuation / settling / going home
  if (c.mode === 'evac' || c.mode === 'settle' || c.mode === 'return') {
    const dest = structOf(sim, c.mode === 'return' ? c.home : c.dest);
    if (!dest) {
      const haven = safeHaven(sim, fid, sq.cx, sq.cz, 0, c.mode === 'evac') || homeDropOff(sim, fid, sq.cx, sq.cz);
      if (!haven) return;
      c.mode = 'evac'; c.dest = haven.id;
      approachPoint(haven, sq.cx, sq.cz, P, 2.5);
      moveTo(sim, sq, P[0], P[1]);
      return;
    }
    if (sq.order.t === 'move') return;
    approachPoint(dest, sq.cx, sq.cz, P, 2.5);
    if (dist(sq.cx, sq.cz, P[0], P[1]) > 6) { moveTo(sim, sq, P[0], P[1]); return; }
    if (c.mode === 'return') {
      // back home after fleeing: drovers whose pen is gone rejoin the population, the rest go back to work
      if (c.role === 'drover' && !structOf(sim, c.pen)) { disband(sim, sq); return; }
      c.mode = 'work'; c.phase = 'rest'; c.t = tick + 2 * T;
      return;
    }
    const f = state.factions[fid];
    if (c.mode === 'settle') {
      dest.pop = (dest.pop || 0) + Math.round(c.pop);
      dest.found = 0; dest.evac = 0; dest.crew = sq.id; dest.threat = -100000;
      c.home = dest.id; c.mode = 'work'; c.phase = 'rest'; c.t = tick + 3 * T; c.pop = 0;
      return;
    }
    if (c.mode === 'evac' && c.pop > 0) {
      if (isSettlement(dest)) dest.pop = (dest.pop || 0) + Math.round(c.pop);
      else f.population = (f.population || 0) + Math.round(c.pop);
      sim.events.push({ type: EV.NOTICE, faction: fid, key: 'evac.arrived', x: dest.x, z: dest.z });
    }
    c.pop = 0;
    disband(sim, sq);
    return;
  }
  const homeThreat = isSettlement(home) ? !settlementSafe(sim, home) : threatNear(sim, fid, home.x, home.z, 30);
  if (c.mode === 'hidden') {
    if (homeThreat) return;
    emerge(sim, sq, home);
    return;
  }
  // threats: shelter at home, else flee to a safe haven
  const danger = threatNear(sim, fid, sq.cx, sq.cz, 20);
  if (danger || homeThreat) {
    if (c.mode !== 'shelter' && c.mode !== 'flee') {
      releaseHerd(sim, sq);
      const def = STRUCTURES[home.type];
      if (def.shelter && home.hp > home.maxHp * 0.35 && (!homeThreat || dist(sq.cx, sq.cz, home.x, home.z) < 40)) {
        c.mode = 'shelter';
        approachPoint(home, sq.cx, sq.cz, P, 1.2);
      } else {
        const haven = safeHaven(sim, fid, sq.cx, sq.cz, home.id, false) || home;
        c.mode = 'flee';
        c.dest = haven.id;
        approachPoint(haven, sq.cx, sq.cz, P, 1.2);
      }
      moveTo(sim, sq, P[0], P[1]);
      // ALARM (Phase 4): one alarm per home per half minute — HUD notice, bell, marker (own side only)
      const lastAlarm = home.alarmT === undefined ? -1e9 : home.alarmT;
      if (state.tick - lastAlarm > 30 * T) {
        home.alarmT = state.tick;
        sim.events.push({ type: EV.CIVILIAN_ALARM, faction: fid, sid: home.id, x: home.x, z: home.z, mode: c.mode });
      }
      return;
    }
  }
  if (c.mode === 'shelter' || c.mode === 'flee') {
    const target = c.mode === 'shelter' ? home : structOf(sim, c.dest) || home;
    if (sq.order.t === 'move') return;
    approachPoint(target, sq.cx, sq.cz, P, 1.2);
    if (dist(sq.cx, sq.cz, P[0], P[1]) > 5) { moveTo(sim, sq, P[0], P[1]); return; }
    if (target === home && STRUCTURES[home.type].shelter) { hide(sim, sq, home); return; }
    // reached another haven: wait there until home is safe again, then walk back
    if (!homeThreat && !danger) { c.mode = 'return'; approachPoint(home, sq.cx, sq.cz, P, 1.8); moveTo(sim, sq, P[0], P[1]); }
    return;
  }
  if (c.role === 'drover') updateDrover(sim, sq, home);
  else updateWorkCrew(sim, sq, home);
}

// ------------------------------------------------------------------ settlements: crews, settlers

function crewFor(state, sid, role) {
  for (const sq of state.squads) if (sq.civ && sq.civ.home === sid && sq.civ.role === role && sq.civ.mode !== 'evac') return sq;
  return null;
}

function settlersFor(state, sid) {
  for (const sq of state.squads) if (sq.civ && sq.civ.mode === 'settle' && sq.civ.dest === sid) return sq;
  return null;
}

function updateSettlementPeople(sim, fid) {
  const { state } = sim;
  const f = state.factions[fid];
  const P0 = POPULATION;
  const tick = state.tick;
  for (const st of state.structures) {
    if (st.faction !== fid || !isSettlement(st) || !st.built) continue;
    const safe = settlementSafe(sim, st);
    // settlers: new settlements (found) and abandoned ones that are safe again (resettle)
    if ((st.found || (st.evac && safe && tick - Math.max(st.threat, st.evacAt || 0) > P0.resettleAfterSec * T)) && !settlersFor(state, st.id)) {
      const from = homeDropOff(sim, fid, st.x, st.z);
      if (from && (st.found || (f.population || 0) >= P0.resettleMinBasePop)) {
        const pop = P0.settlementStartPop;
        if (!st.found) f.population -= pop; // resettling moves people out of the fortress
        const sq = spawnCrew(sim, fid, from, Math.ceil(pop / P0.popPerCrew) + 1, { mode: 'settle', dest: st.id, pop, home: st.id });
        sq.civ.start = aliveMembers(sq);
        approachPoint(st, sq.cx, sq.cz, P, 2.5);
        moveTo(sim, sq, P[0], P[1]);
        st.found = 0;
      }
      continue;
    }
    if (st.evac || st.pop <= 0) continue;
    // the working crew exists and is topped up from the population
    let crew = crewFor(state, st.id, 'work');
    const want = Math.max(1, Math.min(P0.crewMax, Math.ceil(st.pop / P0.popPerCrew)));
    if (!crew) {
      if (safe && tick - st.lastCrew > P0.crewRefillSec * T) { crew = spawnCrew(sim, fid, st, Math.min(want, 2), { home: st.id }); st.crew = crew.id; st.lastCrew = tick; }
    } else if (safe && crew.civ.mode === 'work' && aliveMembers(crew) < want && tick - st.lastCrew > P0.crewRefillSec * T) {
      exitPoint(st, P);
      const m = createSoldier(state, unitDef('civilians'), crew.members.length, P[0], P[1], st.rot || 0, 'alive');
      crew.members.push(m);
      sim.rt.soldierIndex.set(m.id, crew);
      crew.civ.n++;
      st.lastCrew = tick;
    }
    // drovers for the settlement's pens
    for (const pen of state.structures) {
      if (pen.faction !== fid || !pen.built || !STRUCTURES[pen.type].pen || pen.host !== st.id) continue;
      if (pen.drover && sim.rt.squadById.get(pen.drover)) continue;
      if (!safe || st.pop < 4 || tick - pen.droverT < P0.crewRefillSec * T) continue;
      const d = spawnCrew(sim, fid, st, 2, { home: st.id, role: 'drover', pen: pen.id, t: tick + 20 });
      pen.drover = d.id; pen.droverT = tick;
    }
  }
  // fortress-hosted pens get drovers from the fortress quarter
  for (const pen of state.structures) {
    if (pen.faction !== fid || !pen.built || !STRUCTURES[pen.type].pen) continue;
    const host = structOf(sim, pen.host);
    if (!host || isSettlement(host)) continue;
    if (pen.drover && sim.rt.squadById.get(pen.drover)) continue;
    if ((f.population || 0) < 10 || tick - pen.droverT < P0.crewRefillSec * T) continue;
    if (threatNear(sim, fid, host.x, host.z, 30)) continue;
    const d = spawnCrew(sim, fid, host, 2, { home: host.id, role: 'drover', pen: pen.id, t: tick + 20 });
    pen.drover = d.id; pen.droverT = tick;
  }
}

export function updateCivilians(sim, fid) {
  const { state } = sim;
  const tick = state.tick;
  if (tick % 20 === 9) updateSettlementPeople(sim, fid);
  for (let i = state.squads.length - 1; i >= 0; i--) {
    const sq = state.squads[i];
    if (!sq.civ || sq.faction !== fid) continue;
    if ((tick + sq.id) % 10 !== 0) continue;
    updateCrew(sim, sq);
  }
}

/** Pen host: pens built near the fortress are worked by the fortress quarter. */
export function penHost(sim, pen) {
  return econHostAt(sim, pen.faction, pen.x, pen.z);
}
