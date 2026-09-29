// New Antioch expansion economy (Phase 3): settlements, population, food and manpower.
//  - a CIVILIAN SETTLEMENT founded on a resource sector hosts economic buildings inside its
//    econRadius (farms, a livestock pen, a quarry); the fortress (bastion / depots) hosts the home
//    fields and anything built close to it
//  - production depends on the sector kind + per-match richness + the settlement's labour (its
//    population) and stops while the settlement is threatened or evacuated
//  - remote settlements store their output locally and send it home by convoy (economy/convoys.js);
//    settlements near the fortress deliver directly
//  - POPULATION is never spent. It eats food and sets manpower regeneration:
//      manpower/min = passive + perPop * SAFE population * food factor (* specialities)
//    each recruit raised from the population also costs food. Lost civilians / settlements =
//    slower manpower. Runs at 1 Hz; everything is plain state (deterministic, saved).
import { STRUCTURES } from '../data/structures.js';
import { SECTOR_KINDS, POPULATION, CONVOY } from '../data/economy.js';
import { areHostile, sideBit } from '../data/factions.js';
import { EV } from '../core/events.js';
import { dist, clamp } from '../core/dmath.js';
import { TICK_RATE } from '../sim/constants.js';
import { sectorOfSettlement, sectorRichness } from './sectors.js';
import { penFoodRate } from '../sim/wildlife.js';
import { specValue } from '../sim/specialities.js';
import { distanceToStructure } from '../units/orders.js';

const T = TICK_RATE;

export function isSettlement(st) {
  return !!STRUCTURES[st.type].settlement;
}

/** Home economy anchors (bastion / depots): structures with a homeEcon radius. */
function homeAnchor(sim, fid, x, z) {
  let best = null, bd = Infinity;
  for (const st of sim.state.structures) {
    if (st.faction !== fid || !st.built) continue;
    const r = STRUCTURES[st.type].homeEcon;
    if (!r) continue;
    const d = dist(st.x, st.z, x, z);
    if (d <= r && d < bd) { bd = d; best = st; }
  }
  return best;
}

/**
 * Economic host for a point: the nearest own settlement (built or under construction) whose
 * econRadius contains it, else a home anchor. Returns the structure or null.
 */
export function econHostAt(sim, fid, x, z) {
  let best = null, bd = Infinity;
  for (const st of sim.state.structures) {
    if (st.faction !== fid) continue;
    const s = STRUCTURES[st.type].settlement;
    if (!s) continue;
    const d = dist(st.x, st.z, x, z);
    if (d <= s.econRadius && d < bd) { bd = d; best = st; }
  }
  return best || homeAnchor(sim, fid, x, z);
}

/** Visible hostile presence near a point (what the settlement's people can see coming). */
export function threatNear(sim, fid, x, z, r) {
  const bit = sideBit(fid);
  for (const sq of sim.state.squads) {
    if (!areHostile(fid, sq.faction) || !(sq.visibleTo & bit)) continue;
    if (dist(sq.cx, sq.cz, x, z) > r) continue;
    for (const m of sq.members) if (m.state === 'alive') return true;
  }
  for (const e of sim.state.effects) {
    if (e.kind === 'plague_cloud' && areHostile(fid, e.faction) && dist(e.x, e.z, x, z) < r + e.radius) return true;
  }
  return false;
}

export function settlementSafe(sim, st) {
  return sim.state.tick - st.threat > POPULATION.safeAfterSec * T;
}

/** Nearest built home drop-off (bastion / depot — never a settlement) for convoys and evacuees. */
export function homeDropOff(sim, fid, x, z) {
  let best = null, bd = Infinity;
  for (const st of sim.state.structures) {
    if (st.faction !== fid || !st.built || st.hp <= 0) continue;
    const def = STRUCTURES[st.type];
    if (!def.dropOff || def.settlement) continue;
    const d = dist(st.x, st.z, x, z);
    if (d < bd) { bd = d; best = st; }
  }
  return best;
}

export function isRemote(sim, st) {
  const home = homeDropOff(sim, st.faction, st.x, st.z);
  return !home || distanceToStructure(home, st.x, st.z) > CONVOY.homeRadius;
}

export function popCap(sim, st) {
  const sec = sectorOfSettlement(sim.state, st.id);
  const kind = sec ? SECTOR_KINDS[sec.kind] : null;
  return STRUCTURES[st.type].settlement.popCap + (kind && kind.popBonus ? kind.popBonus : 0);
}

/** Total civilian population of a faction (fortress quarter + settlements + evacuees on the road). */
export function totalPopulation(sim, fid) {
  const { state } = sim;
  let n = state.factions[fid].population || 0;
  for (const st of state.structures) if (st.faction === fid && st.pop) n += st.pop;
  for (const sq of state.squads) if (sq.faction === fid && sq.civ && sq.civ.pop) n += sq.civ.pop;
  return n;
}

function fieldDisrupted(sim, fid, st) {
  for (const sq of sim.state.squads) {
    if (!areHostile(fid, sq.faction)) continue;
    if (dist(sq.cx, sq.cz, st.x, st.z) < 42) return true;
  }
  return false;
}

const PROD = { food: 0, material: 0, supply: 0 };

/** One second of production for settlement st (writes PROD). */
function settlementProduction(sim, st, hosted) {
  PROD.food = 0; PROD.material = 0; PROD.supply = 0;
  const sec = sectorOfSettlement(sim.state, st.id);
  const kind = sec ? SECTOR_KINDS[sec.kind] : SECTOR_KINDS.hamlet;
  const rich = sec ? sectorRichness(sec) : 1;
  const labour = Math.min(1, st.pop / 8);
  if (labour <= 0) return PROD;
  for (const k in kind.base) PROD[k] += kind.base[k] * rich * labour;
  for (const b of hosted) {
    const d = STRUCTURES[b.type];
    if (d.farm) PROD.food += d.farm.foodRate * kind.farmMult * rich * labour * (fieldDisrupted(sim, st.faction, b) ? 0.2 : 1);
    else if (d.quarry) PROD.material += d.quarry.materialRate * (kind.quarryMult || 0.4) * rich * labour;
    else if (d.pen) PROD.food += penFoodRate(sim.state, b.id) * Math.max(0.5, labour);
  }
  return PROD;
}

/**
 * Current production of a settlement per second { food, material, supply } (read-only; HUD / AI).
 * Zero while it is threatened, evacuated or empty — exactly what updateSettlements would add.
 */
export function settlementRates(sim, st, out = { food: 0, material: 0, supply: 0 }) {
  out.food = 0; out.material = 0; out.supply = 0;
  if (!isSettlement(st) || !st.built || st.evac || !(st.pop > 0) || !settlementSafe(sim, st)) return out;
  const hosted = [];
  for (const b of sim.state.structures) if (b.host === st.id && b.built && b.faction === st.faction) hosted.push(b);
  const p = settlementProduction(sim, st, hosted);
  out.food = p.food; out.material = p.material; out.supply = p.supply;
  return out;
}

const HOSTED = new Map();

export function updateSettlements(sim, fid) {
  const { state } = sim;
  const f = state.factions[fid];
  const P = POPULATION;
  const tick = state.tick;
  // hosting: economic buildings keep their host; orphans look for a new one
  HOSTED.clear();
  for (const b of state.structures) {
    if (b.faction !== fid || b.host === undefined) continue;
    let host = b.host ? sim.rt.structById.get(b.host) : null;
    if (!host || host.hp <= 0) {
      host = econHostAt(sim, fid, b.x, b.z);
      b.host = host ? host.id : 0;
    }
    if (!host || !b.built) continue;
    let list = HOSTED.get(host.id);
    if (!list) { list = []; HOSTED.set(host.id, list); }
    list.push(b);
  }
  let safePop = f.population || 0;
  for (const st of state.structures) {
    if (st.faction !== fid || !isSettlement(st) || !st.built) continue;
    if (threatNear(sim, fid, st.x, st.z, P.threatRadius)) st.threat = tick;
    const safe = settlementSafe(sim, st);
    if (safe && !st.evac) safePop += st.pop;
    if (!safe || st.evac || st.pop <= 0) continue;
    const prod = settlementProduction(sim, st, HOSTED.get(st.id) || []);
    if (isRemote(sim, st)) {
      st.stock.food += prod.food; st.stock.material += prod.material; st.stock.supply += prod.supply;
    } else {
      f.resources.food += prod.food; f.resources.material += prod.material; f.resources.supply += prod.supply;
    }
  }
  // home-hosted economic buildings (farms / pens / quarries near the fortress)
  for (const [hid, list] of HOSTED) {
    const host = sim.rt.structById.get(hid);
    if (!host || isSettlement(host)) continue;
    const labour = Math.min(1, (f.population || 0) / 20);
    for (const b of list) {
      const d = STRUCTURES[b.type];
      if (d.farm) f.resources.food += d.farm.foodRate * labour * (fieldDisrupted(sim, fid, b) ? 0.2 : 1);
      else if (d.quarry) f.resources.material += d.quarry.materialRate * 0.4 * labour;
      else if (d.pen) f.resources.food += penFoodRate(state, b.id) * Math.max(0.5, labour);
    }
  }
  // population upkeep
  const pop = totalPopulation(sim, fid);
  f.resources.food -= pop * P.foodPerPopSec;
  if (f.resources.food < 0) {
    f.resources.food = 0;
    f.econ.starveAcc++;
    if (f.econ.starveAcc >= P.starveEverySec) { f.econ.starveAcc = 0; losePopulation(sim, fid, 1); }
  } else f.econ.starveAcc = 0;
  // manpower: light passive trickle + safe population x food factor
  const food = f.resources.food;
  const ff = clamp(food / P.foodFactorFull, 0.25, 1.2) * (food <= 0 ? 0 : 1);
  const regen = specValue(state, fid, 'manpowerRegen', 1);
  const popPerMin = safePop * P.manpowerPerPopMin * ff * regen;
  f.econ.mpAcc += P.manpowerPassivePerMin / 60;
  while (f.econ.mpAcc >= 1) { f.econ.mpAcc -= 1; f.resources.manpower += 1; f.stats.manpowerGained++; }
  f.econ.mpPopAcc = (f.econ.mpPopAcc || 0) + popPerMin / 60;
  while (f.econ.mpPopAcc >= 1 && f.resources.food >= P.foodPerManpower) {
    f.econ.mpPopAcc -= 1;
    f.resources.food -= P.foodPerManpower;
    f.resources.manpower += 1;
    f.stats.manpowerGained++;
  }
  if (f.econ.mpPopAcc > 3) f.econ.mpPopAcc = 3; // no hoarding while starving
  f.econ.lastManpowerRate = P.manpowerPassivePerMin + popPerMin;
  f.econ.safePop = safePop;
  f.econ.pop = pop;
  // growth
  f.econ.growAcc++;
  if (f.econ.growAcc >= P.growthEverySec) {
    f.econ.growAcc = 0;
    if ((f.population || 0) < P.baseCap && f.resources.food >= P.growthMinFood) {
      f.population++;
      f.resources.food -= P.growthFood;
    }
    for (const st of state.structures) {
      if (st.faction !== fid || !isSettlement(st) || !st.built || st.evac || st.pop <= 0) continue;
      if (!settlementSafe(sim, st) || st.pop >= popCap(sim, st)) continue;
      const sec = sectorOfSettlement(state, st.id);
      st.grow += sec && SECTOR_KINDS[sec.kind].growthMult ? SECTOR_KINDS[sec.kind].growthMult : 1;
      while (st.grow >= 1 && st.pop < popCap(sim, st) && f.resources.food >= P.growthMinFood) {
        st.grow -= 1;
        st.pop++;
        f.resources.food -= P.growthFood;
      }
      if (st.grow > 2) st.grow = 2;
    }
  }
}

/** Starvation / losses: take population from the largest settlement, else the fortress quarter. */
export function losePopulation(sim, fid, n) {
  const { state } = sim;
  for (let k = 0; k < n; k++) {
    let best = null;
    for (const st of state.structures) if (st.faction === fid && st.pop > 0 && (!best || st.pop > best.pop)) best = st;
    if (best && best.pop >= (state.factions[fid].population || 0)) best.pop--;
    else if ((state.factions[fid].population || 0) > 0) state.factions[fid].population--;
    else if (best) best.pop--;
  }
}

/** A settlement is destroyed: its stock is lost, sheltered people die with it, the sector frees up. */
export function onSettlementLost(sim, st) {
  const { state } = sim;
  const f = state.factions[st.faction];
  f.stats.settlementsLost++;
  for (const s of state.sectors) if (s.sid === st.id) s.sid = 0;
  sim.events.push({ type: EV.NOTICE, faction: st.faction, key: 'settle.lost', x: st.x, z: st.z });
}

/** The first settlement a faction completes (balance statistics) and sector bookkeeping. */
export function onSettlementCompleted(sim, st) {
  const f = sim.state.factions[st.faction];
  f.stats.settlementsBuilt++;
  if (f.stats.firstSettlementTick < 0) f.stats.firstSettlementTick = sim.state.tick;
  st.found = 1; // settlers are on their way from the fortress (factions/civilians.js)
}
