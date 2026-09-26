// New Antioch faction logic: HUMAN DEFENSIVE LOGISTICS.
//  - supply / material income from physical structures (depot, bastion workshop)
//  - food from fields (disrupted when enemies are near) -> manpower growth (population)
//  - ammunition: squads carry limited ammo; resupply only near supply points (bastion/depot/cache)
//  - replacements: soldiers walk out from the bastion/depot to depleted squads (no magic refill)
import { STRUCTURES } from '../data/structures.js';
import { unitDef } from '../data/units.js';
import { areHostile } from '../data/factions.js';
import { EV } from '../core/events.js';
import { dist } from '../core/dmath.js';
import { createSoldier } from '../sim/state.js';
import { exitPoint } from '../sim/production.js';
import { distanceToStructure, approachPoint } from '../units/orders.js';
import { isPointPassable } from '../world/nav.js';

const P = [0, 0];

function fieldEfficiency(sim, st) {
  for (const sq of sim.state.squads) {
    if (!areHostile(st.faction, sq.faction)) continue;
    if (dist(sq.cx, sq.cz, st.x, st.z) < 42) return 0.2;
  }
  return 1;
}

function income(sim, fid) {
  const { state } = sim;
  const f = state.factions[fid];
  for (const st of state.structures) {
    if (st.faction !== fid || !st.built) continue;
    const d = STRUCTURES[st.type];
    if (d.supplyRate) f.resources.supply += d.supplyRate;
    if (d.materialRate) f.resources.material += d.materialRate;
    if (d.foodRate) f.resources.food += d.foodRate * fieldEfficiency(sim, st);
  }
  f.timers.food++;
  if (f.timers.food >= 8) {
    // population growth: surplus food becomes new recruits (up to 2 per cycle)
    f.timers.food = 0;
    for (let k = 0; k < 2 && f.resources.food >= 6; k++) {
      f.resources.food -= 6;
      f.resources.manpower += 1;
    }
  }
}

export function supplyPointFor(sim, fid, x, z, radiusKey = 'resupplyRadius') {
  let best = null, bestD = 1e9;
  for (const st of sim.state.structures) {
    if (st.faction !== fid || !st.built) continue;
    const r = STRUCTURES[st.type][radiusKey];
    if (!r) continue;
    const d = distanceToStructure(st, x, z);
    if (d <= r && d < bestD) { bestD = d; best = st; }
  }
  return best;
}

function resupply(sim, fid) {
  const { state } = sim;
  const f = state.factions[fid];
  for (const sq of state.squads) {
    if (sq.faction !== fid || sq.ammo >= sq.ammoMax) continue;
    if (!supplyPointFor(sim, fid, sq.x, sq.z)) continue;
    const want = Math.min(sq.ammoMax - sq.ammo, 6);
    const cost = want * 0.2;
    if (f.resources.supply < cost) continue;
    f.resources.supply -= cost;
    sq.ammo += want;
  }
}

function reinforce(sim, fid) {
  const { state, rt } = sim;
  const f = state.factions[fid];
  for (const sq of state.squads) {
    if (sq.faction !== fid) continue;
    const def = unitDef(sq.type);
    if (sq.members.length >= def.squadSize) continue;
    if (sq.members.some((m) => m.state === 'joining')) continue;
    const idleNearBase = (sq.order.t === 'idle' || sq.order.t === 'hold_trench') && state.tick - sq.lastHitTick > 200;
    if (sq.order.t !== 'reinforce' && !idleNearBase) continue;
    const pt = supplyPointFor(sim, fid, sq.x, sq.z, 'reinforceRadius');
    if (!pt) continue;
    const mp = 1;
    const sup = 6;
    if (f.resources.manpower < mp || f.resources.supply < sup) continue;
    f.resources.manpower -= mp;
    f.resources.supply -= sup;
    // replacements leave the building on the side facing their squad (not through its back wall)
    approachPoint(pt, sq.x, sq.z, P, 1.4);
    if (!isPointPassable(rt.nav, P[0], P[1])) exitPoint(pt, P);
    const m = createSoldier(state, def, sq.members.length, P[0], P[1], sq.rot, 'joining');
    sq.members.push(m);
    rt.soldierIndex.set(m.id, sq);
    sim.events.push({ type: EV.SQUAD_SPAWNED, id: sq.id, faction: fid, unit: sq.type, x: P[0], z: P[1], reinforcement: m.id });
  }
}

export const newAntiochLogic = {
  id: 'new_antioch',
  tick(sim, fid) {
    const t = sim.state.tick;
    if (t % 20 === 0) income(sim, fid);
    if (t % 10 === 5) resupply(sim, fid);
    if (t % 30 === 7) reinforce(sim, fid);
  },
};
