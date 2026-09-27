// Unit production queues on structures (New Antioch: training at the Bastion;
// Black Grail: raising at Altars of Beelzebub — different costs/sources, same queue mechanics).
import { unitDef } from '../data/units.js';
import { STRUCTURES } from '../data/structures.js';
import { EV } from '../core/events.js';
import { TICK_RATE } from './constants.js';
import { dsin, dcos } from '../core/dmath.js';
import { canAfford, pay, refund } from '../economy/economy.js';
import { createSquad } from './state.js';
import { setOrder } from '../units/orders.js';
import { unlockedBySpec, specHas, unitCost, unitTrainTime, unitSquadSize, unitMaxSquads } from './specialities.js';

export const MAX_QUEUE = 5;

export function exitPoint(st, out) {
  const def = STRUCTURES[st.type];
  const d = (def.footprint ? def.footprint.d * 0.5 : 2) + 5;
  out[0] = st.x + dsin(st.rot) * d;
  out[1] = st.z + dcos(st.rot) * d;
  return out;
}

export function canTrain(sim, faction, st, unitType) {
  if (!st || st.faction !== faction || !st.built) return 'train.invalid';
  const def = STRUCTURES[st.type];
  if (!def.trains || def.trains.indexOf(unitType) < 0) return 'train.invalid';
  const u = unitDef(unitType);
  if (u.faction !== faction || !u.cost) return 'train.invalid';
  const state = sim.state;
  // speciality-gated units / trainers, structure-gated units (flamer teams need a workshop)
  if (!unlockedBySpec(state, faction, u)) return 'train.spec';
  if (def.trainsSpec && def.trainsSpec[unitType] && !specHas(state, faction, def.trainsSpec[unitType])) return 'train.spec';
  if (u.requiresStructure && !state.structures.some((s) => s.faction === faction && s.type === u.requiresStructure && s.built)) return 'train.requires';
  if (st.queue.length >= MAX_QUEUE) return 'train.queue_full';
  const cap = unitMaxSquads(state, faction, unitType);
  if (cap && squadCount(sim, faction, unitType) >= cap) return 'train.cap';
  if (!canAfford(state.factions[faction].resources, unitCost(state, faction, unitType))) return 'train.no_resources';
  if (state.match.phase === 'ENDED') return 'train.invalid';
  return null;
}

/** Squads of a type a faction fields or has queued (force cap, e.g. Grail work gangs). */
export function squadCount(sim, faction, unitType) {
  let n = 0;
  for (const sq of sim.state.squads) if (sq.faction === faction && sq.type === unitType) n++;
  for (const st of sim.state.structures) {
    if (st.faction !== faction || !st.queue) continue;
    for (const q of st.queue) if (q.unit === unitType) n++;
  }
  return n;
}

export function queueTraining(sim, faction, st, unitType) {
  const cost = unitCost(sim.state, faction, unitType);
  pay(sim.state.factions[faction].resources, cost);
  const ticks = Math.round(unitTrainTime(sim.state, faction, unitType) * TICK_RATE);
  st.queue.push({ unit: unitType, remaining: ticks, total: ticks, paid: { ...cost } });
  sim.events.push({ type: EV.TRAIN_QUEUED, id: st.id, faction, unit: unitType });
}

export function cancelTraining(sim, st) {
  if (!st.queue || !st.queue.length) return false;
  const item = st.queue.pop();
  refund(sim.state.factions[st.faction].resources, item.paid || unitDef(item.unit).cost, 1);
  return true;
}

const P = [0, 0];

export function updateProduction(sim) {
  const { state, rt } = sim;
  if (state.match.phase === 'ENDED') return;
  for (const st of state.structures) {
    if (!st.queue || !st.queue.length || !st.built) continue;
    const item = st.queue[0];
    item.remaining--;
    if (item.remaining > 0) continue;
    st.queue.shift();
    exitPoint(st, P);
    const u = unitDef(item.unit);
    const emerging = st.faction === 'black_grail';
    const size = unitSquadSize(state, st.faction, item.unit);
    const sq = createSquad(state, st.faction, item.unit, P[0], P[1], st.rot, { soldierState: emerging ? 'rising' : 'alive', size });
    state.squads.push(sq);
    rt.squadById.set(sq.id, sq);
    for (const m of sq.members) rt.soldierIndex.set(m.id, sq);
    state.factions[st.faction].stats.trained++;
    sim.events.push({ type: EV.TRAIN_COMPLETED, id: st.id, faction: st.faction, unit: item.unit, squadId: sq.id });
    sim.events.push({ type: EV.SQUAD_SPAWNED, id: sq.id, faction: sq.faction, unit: u.id, x: sq.x, z: sq.z, emerging });
    if (st.rally) setOrder(sim, sq, { t: 'move', x: st.rally.x, z: st.rally.z, am: 1 });
  }
}
