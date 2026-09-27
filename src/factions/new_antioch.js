// New Antioch faction logic: HUMAN DEFENSIVE LOGISTICS.
//  - supply / material income from physical structures (depot, bastion workshop)
//  - food from fields (disrupted when enemies are near) -> manpower growth (population)
//  - ammunition: squads carry limited ammo; resupply only near supply points (bastion/depot/cache)
//  - replacements: requested squads stay at the front; soldiers walk out from a source
//    (bastion / depot / muster point) to them (factions/reinforcement.js, no magic refill)
//  - support buildings: aid station (heal / treat infection), workshop (repair aura), muster levy
import { STRUCTURES } from '../data/structures.js';
import { unitDef } from '../data/units.js';
import { areHostile } from '../data/factions.js';
import { EV } from '../core/events.js';
import { dist } from '../core/dmath.js';
import { distanceToStructure } from '../units/orders.js';
import { updateReinforcements } from './reinforcement.js';

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

/** Muster point levy: supply is turned into fresh recruits (manpower) at a fixed rate. */
function levy(sim, fid) {
  const { state } = sim;
  const f = state.factions[fid];
  for (const st of state.structures) {
    if (st.faction !== fid || !st.built) continue;
    const lv = STRUCTURES[st.type].levy;
    if (!lv || (state.tick + st.id) % lv.everyTicks !== 0) continue;
    if (f.resources.supply >= lv.supply) { f.resources.supply -= lv.supply; f.resources.manpower += 1; }
  }
}

/**
 * Aid station: wounded soldiers nearby slowly recover; one infection stack is treated every
 * cureEveryTicks. Workshop: damaged friendly structures nearby are patched up. Runs every 10 ticks.
 */
function support(sim, fid) {
  const { state } = sim;
  for (const st of state.structures) {
    if (st.faction !== fid || !st.built) continue;
    const d = STRUCTURES[st.type];
    if (d.heal) {
      const r = d.heal.radius, cure = (state.tick + st.id) % d.heal.cureEveryTicks < 10;
      for (const sq of state.squads) {
        if (sq.faction !== fid || dist(sq.cx, sq.cz, st.x, st.z) > r + 12) continue;
        const hpMax = unitDef(sq.type).hp;
        for (const m of sq.members) {
          if (m.state !== 'alive' || dist(m.x, m.z, st.x, st.z) > r) continue;
          if (m.hp < hpMax) m.hp = Math.min(hpMax, m.hp + d.heal.hpPerSec * 0.5);
          if (cure && m.infection > 0) m.infection--;
        }
      }
    }
    if (d.repairAura) {
      for (const o of state.structures) {
        if (o.faction !== fid || !o.built || o.hp >= o.maxHp || o === st) continue;
        if (state.tick - o.lastDamageTick < 100) continue; // not while under fire
        if (distanceToStructure(o, st.x, st.z) > d.repairAura.radius) continue;
        o.hp = Math.min(o.maxHp, o.hp + d.repairAura.hpPerSec * 0.5);
      }
    }
  }
}

export const newAntiochLogic = {
  id: 'new_antioch',
  tick(sim, fid) {
    const t = sim.state.tick;
    if (t % 20 === 0) income(sim, fid);
    if (t % 10 === 5) resupply(sim, fid);
    updateReinforcements(sim, fid);
    if (t % 10 === 3) support(sim, fid);
    levy(sim, fid);
  },
};
