// New Antioch faction logic: HUMAN DEFENSIVE LOGISTICS + (Phase 3) EXPANSION ECONOMY.
//  - supply / material income from physical structures (depot, bastion workshop)
//  - food from the home fields and, above all, from settlements' farms / pens on resource sectors
//  - POPULATION (never spent) + food -> manpower (economy/settlements.js); remote settlements ship
//    their output home in convoys (economy/convoys.js); civilians work, shelter, evacuate
//    (factions/civilians.js)
//  - ammunition: squads carry limited ammo; resupply only near supply points (flamers burn fuel)
//  - replacements walk from a source to depleted squads (factions/reinforcement.js)
//  - support: aid stations, workshops, muster levy; Combat Medics heal, revive the wounded and
//    treat EARLY infection; Trench Clerics purify corpses near them (consecration is an aura)
import { lullBonus } from '../sim/lull.js';
import { auraOfKindAt } from '../sim/auras.js';
import { STRUCTURES } from '../data/structures.js';
import { unitDef } from '../data/units.js';
import { WEAPONS } from '../data/weapons.js';
import { WOUNDED } from '../data/economy.js';
import { PESTILENCE } from '../data/specialities.js';
import { areHostile } from '../data/factions.js';
import { dist } from '../core/dmath.js';
import { TICK_RATE } from '../sim/constants.js';
import { distanceToStructure, setOrder } from '../units/orders.js';
import { reviveSoldier, flamerPurge } from '../combat/combat.js';
import { cremateCorpse } from '../sim/corpses.js';
import { specValue } from '../sim/specialities.js';
import { pestLoss } from './pestilence.js';
import { updateReinforcements } from './reinforcement.js';
import { updateSettlements } from '../economy/settlements.js';
import { dispatchConvoys, updateConvoys } from '../economy/convoys.js';
import { updateCivilians, setupCivilians } from './civilians.js';

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
  const k = specValue(state, fid, 'ammoCost', 1);
  for (const sq of state.squads) {
    if (sq.faction !== fid || sq.ammo >= sq.ammoMax) continue;
    if (!supplyPointFor(sim, fid, sq.x, sq.z)) continue;
    const def = unitDef(sq.type);
    const fuel = def.weapon && WEAPONS[def.weapon].fuel ? WEAPONS[def.weapon].fuel : 1;
    // reorganisation window: resupply flows faster to squads out of combat (sim/lull.js)
    const want = Math.min(sq.ammoMax - sq.ammo, Math.round(6 * lullBonus(state, 'resupply', sq.lastHitTick)));
    const cost = want * 0.2 * fuel * k;
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
    if (f.resources.supply >= lv.supply) { f.resources.supply -= lv.supply; f.resources.manpower += 1; f.stats.manpowerGained++; }
  }
}

/**
 * Aid station: wounded soldiers nearby slowly recover; one infection stack is treated every
 * cureEveryTicks. Workshop: damaged friendly structures nearby are patched up. Runs every 10 ticks.
 */
function support(sim, fid) {
  const { state } = sim;
  const aidCure = specValue(state, fid, 'aidCure', 1);
  for (const st of state.structures) {
    if (st.faction !== fid || !st.built) continue;
    const d = STRUCTURES[st.type];
    if (d.heal) {
      const r = d.heal.radius, cure = (state.tick + st.id) % Math.round(d.heal.cureEveryTicks / aidCure) < 10;
      for (const sq of state.squads) {
        if (sq.faction !== fid || dist(sq.cx, sq.cz, st.x, st.z) > r + 12) continue;
        const hpMax = unitDef(sq.type).hp;
        for (const m of sq.members) {
          if (m.state !== 'alive' || dist(m.x, m.z, st.x, st.z) > r) continue;
          if (m.hp < hpMax) m.hp = Math.min(hpMax, m.hp + d.heal.hpPerSec * 0.5);
          if (cure && m.infection > 0) { m.infection--; pestLoss(sim, PESTILENCE.loss.cureStack, 'cured', m.infBy || undefined); }
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

/**
 * Combat Medics (every 10 ticks): heal around them, treat EARLY infection (<= cureMaxStacks
 * stacks), slow late infection, and go to the wounded to revive them. No area immunity.
 */
function medics(sim, fid) {
  const { state } = sim;
  const tick = state.tick;
  for (const sq of state.squads) {
    if (sq.faction !== fid) continue;
    const md = unitDef(sq.type).medic;
    if (!md) continue;
    const alive = sq.members.filter((m) => m.state === 'alive');
    if (!alive.length) continue;
    // heal nearby soldiers
    for (const o of state.squads) {
      if (o.faction !== fid || dist(o.cx, o.cz, sq.cx, sq.cz) > md.radius + 10) continue;
      const hpMax = unitDef(o.type).hp;
      for (const m of o.members) {
        if (m.state !== 'alive' || m.hp >= hpMax || dist(m.x, m.z, sq.cx, sq.cz) > md.radius) continue;
        m.hp = Math.min(hpMax, m.hp + md.hpPerSec * 0.5);
      }
    }
    // treat one infected soldier every cureEverySec
    if ((tick + sq.id) % Math.round(md.cureEverySec * TICK_RATE) < 10) {
      let best = null, bi = 0;
      for (const o of state.squads) {
        if (o.faction !== fid || dist(o.cx, o.cz, sq.cx, sq.cz) > md.radius + 10) continue;
        for (const m of o.members) {
          if (m.state !== 'alive' || m.infection <= 0 || dist(m.x, m.z, sq.cx, sq.cz) > md.radius) continue;
          if (m.infection > bi) { bi = m.infection; best = m; }
        }
      }
      if (best) {
        if (best.infection <= md.cureMaxStacks) { best.infection--; pestLoss(sim, PESTILENCE.loss.cureStack, 'cured', best.infBy || undefined); }
        best.slow = tick + Math.round(md.slowSec * TICK_RATE); // late infection: progression slowed
      }
    }
    // the wounded: go to the nearest, then work on him until he stands
    let wound = null, wsq = null, wd = md.reviveRadius;
    for (const o of state.squads) {
      if (o.faction !== fid) continue;
      for (const m of o.members) {
        if (m.state !== 'wounded') continue;
        const d = dist(m.x, m.z, sq.cx, sq.cz);
        if (d < wd) { wd = d; wound = m; wsq = o; }
      }
    }
    if (!wound) continue;
    if (wd < 2.6) {
      wound.rev += 10;
      if (wound.rev >= WOUNDED.reviveSec * TICK_RATE) reviveSoldier(sim, wsq, wound, WOUNDED.reviveHpFrac);
    } else if (sq.order.t === 'idle' || (sq.order.t === 'move' && sq.order.aid)) {
      if (!(sq.order.t === 'move' && sq.order.aid === wound.id)) setOrder(sim, sq, { t: 'move', x: wound.x, z: wound.z, am: 0, trench: 0, aid: wound.id });
    }
  }
}

/**
 * Trench Clerics (SANCTIFIED PRESENCE, passive): every few seconds each cleric burns one infected
 * body near him (an action of that man, so two clerics burn two bodies); and, non-stacking by
 * kind, every cureEverySec a soldier inside ANY cleric's area with light infection (<= cureMax
 * stacks) loses one stack — two clerics over the same trench cure no faster.
 */
function clerics(sim, fid) {
  const { state } = sim;
  let cure = null;
  for (const sq of state.squads) {
    if (sq.faction !== fid) continue;
    const a = unitDef(sq.type).aura;
    if (!a || !sq.members.some((m) => m.state === 'alive')) continue;
    if (a.cureEverySec && !cure) cure = a;
    if (!a.purifyEverySec || (state.tick + sq.id) % Math.round(a.purifyEverySec * TICK_RATE) !== 0) continue;
    let best = null, bd = a.purifyRadius;
    for (const c of state.corpses) {
      if (!c.infected) continue;
      const d = dist(c.x, c.z, sq.cx, sq.cz);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) cremateCorpse(sim, best, fid);
  }
  if (!cure || state.tick % Math.round(cure.cureEverySec * TICK_RATE) !== 0) return;
  for (const sq of state.squads) {
    if (sq.faction !== fid) continue;
    for (const m of sq.members) {
      if (m.state !== 'alive' || m.infection <= 0 || m.infection > cure.cureMax) continue;
      if (auraOfKindAt(sim, fid, cure.kind, m.x, m.z)) m.infection--;
    }
  }
}

export const newAntiochLogic = {
  id: 'new_antioch',
  setup(sim, fid) {
    setupCivilians(sim, fid);
  },
  tick(sim, fid) {
    const t = sim.state.tick;
    if (t % 20 === 0) {
      income(sim, fid);
      updateSettlements(sim, fid);
      dispatchConvoys(sim, fid);
    }
    updateConvoys(sim);
    if (t % 10 === 5) resupply(sim, fid);
    updateReinforcements(sim, fid);
    if (t % 10 === 3) { support(sim, fid); medics(sim, fid); }
    if (t % 10 === 6) for (const sq of sim.state.squads) if (sq.faction === fid) flamerPurge(sim, sq);
    clerics(sim, fid);
    levy(sim, fid);
    updateCivilians(sim, fid);
  },
};
