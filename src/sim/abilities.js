// Area-effect faction abilities (data in data/abilities.js). Effects are plain data in
// state.effects and are resolved deterministically by the simulation.
import { ABILITIES } from '../data/abilities.js';
import { STRUCTURES } from '../data/structures.js';
import { FACTIONS, areHostile } from '../data/factions.js';
import { EV } from '../core/events.js';
import { rngFloat } from '../core/rng.js';
import { dist, dsin, dcos } from '../core/dmath.js';
import { TICK_RATE, INFECTION_MAX, MAX_CRATERS, MAX_CRATER_R } from './constants.js';
import { COVER_TYPES, COVER_IDS } from '../data/cover.js';
import { canAfford, pay } from '../economy/economy.js';
import { isVisibleAt, isExploredAt } from '../world/fog.js';
import { damageSoldier, damageStructure } from '../combat/combat.js';
import { distanceToStructure } from '../units/orders.js';
import { cremateCorpse } from './corpses.js';
import { animalsBlast } from './wildlife.js';
import { specValue, specRule, unlockedBySpec } from './specialities.js';
import { addInfection, pestSpend, pestLoss, swarmDpsMult, swarmCooldownMult, cleanseInfection, seedInfection } from '../factions/pestilence.js';

export function validateAbility(sim, faction, abilityId, x, z) {
  const { state } = sim;
  const def = ABILITIES[abilityId];
  if (!def || def.faction !== faction) return 'ability.invalid';
  const fs = state.factions[faction];
  if (!fs.abilities[abilityId]) return 'ability.invalid';
  if (!unlockedBySpec(state, faction, def)) return 'ability.spec';
  if (state.match.phase !== 'WAR') return 'ability.not_war';
  if (fs.abilities[abilityId].readyTick > state.tick) return 'ability.cooldown';
  if (def.requiresPestilence && (fs.pestilence || 0) < def.requiresPestilence - 1e-9) return 'ability.pestilence';
  if (!canAfford(fs.resources, def.cost)) return 'ability.no_resources';
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 'ability.invalid';
  const fIdx = FACTIONS[faction].index;
  // Heavy Artillery Doctrine: map fire on ground seen before (explored), not only in sight
  const seen = def.effect === 'barrage' && specRule(state, faction, 'artilleryExplored') ? isExploredAt(state.fog, fIdx, x, z) : false;
  if (def.requiresVision && !seen && !isVisibleAt(state.fog, fIdx, x, z)) return 'ability.no_vision';
  if (def.castRange) {
    let ok = false;
    for (const sq of state.squads) {
      if (sq.faction !== faction) continue;
      if (dist(sq.cx, sq.cz, x, z) <= def.castRange) { ok = true; break; }
    }
    if (!ok) return 'ability.out_of_range';
  }
  return null;
}

/**
 * Cooldown multiplier from support structures (fly nest -> swarm, signal post -> artillery):
 * the best standing, built structure applies; several do not stack.
 */
export function supportMult(sim, faction, key) {
  if (!key) return 1;
  let m = 1;
  for (const st of sim.state.structures) {
    if (st.faction !== faction || !st.built || st.hp <= 0) continue;
    const sp = STRUCTURES[st.type].support;
    if (sp && sp[key] && sp[key] < m) m = sp[key];
  }
  return m;
}

/** Effective cooldown in seconds (data cooldown x support structures x specialities / plague tier). */
export function abilityCooldown(sim, faction, abilityId) {
  const def = ABILITIES[abilityId];
  let cd = def.cooldown * supportMult(sim, faction, def.supportKey);
  if (abilityId === 'artillery_barrage') cd *= specValue(sim.state, faction, 'artilleryCooldown', 1);
  if (abilityId === 'fly_swarm') cd *= swarmCooldownMult(sim.state);
  return cd;
}

/** Ability numbers after specialities (shells, radius, duration). Plain object. */
export function abilityParams(state, faction, abilityId) {
  const def = ABILITIES[abilityId];
  const p = { radius: def.radius, shells: def.shells || 0, duration: def.duration || 0 };
  if (abilityId === 'artillery_barrage') {
    p.shells = def.shells + Math.round(specValue(state, faction, 'artilleryShells', 0));
    p.radius = def.radius + specValue(state, faction, 'artilleryRadius', 0);
  } else if (abilityId === 'fly_swarm') {
    p.radius = def.radius + specValue(state, faction, 'swarmRadius', 0);
    p.duration = def.duration + specValue(state, faction, 'swarmDuration', 0);
  } else if (abilityId === 'great_pestilence') {
    p.radius = def.radius + specValue(state, faction, 'greatRadius', 0);
  }
  return p;
}

export function castAbility(sim, faction, abilityId, x, z) {
  const { state } = sim;
  const def = ABILITIES[abilityId];
  const fs = state.factions[faction];
  pay(fs.resources, def.cost);
  fs.abilities[abilityId].readyTick = state.tick + Math.round(abilityCooldown(sim, faction, abilityId) * TICK_RATE);
  const prm = abilityParams(state, faction, abilityId);
  const e = { id: state.nextId++, kind: def.effect, ability: abilityId, faction, x, z, radius: prm.radius, start: state.tick };
  if (def.effect === 'swarm' || def.effect === 'plague_cloud' || def.effect === 'tide') {
    e.end = state.tick + Math.round(prm.duration * TICK_RATE);
    e.next = state.tick;
  } else if (def.effect === 'barrage') {
    e.next = state.tick + Math.round(def.delay * TICK_RATE);
    e.shells = prm.shells;
  } else if (def.effect === 'purge') {
    e.end = state.tick + Math.round(def.duration * TICK_RATE);
    e.next = state.tick + 10;
  }
  if (def.effect === 'plague_cloud') {
    // the Great Pestilence spends most of the meter: no permanent snowball
    pestSpend(sim, specValue(state, faction, 'greatCost', def.pestilenceCost));
    fs.stats.greatPestilence++;
    seedInfection(sim, x, z, prm.radius, def.groundInfect);
  }
  if (def.effect === 'tide') {
    for (const sq of state.squads) {
      if (sq.faction !== faction || dist(sq.cx, sq.cz, x, z) > prm.radius) continue;
      sq.tideUntil = e.end;
    }
  }
  state.effects.push(e);
  const dur = prm.duration || (def.delay || 0) + (prm.shells || 0) * (def.interval || 0);
  sim.events.push({ type: EV.ABILITY_CAST, faction, ability: abilityId, x, z, radius: prm.radius, duration: dur, effectId: e.id, size: def.size || '' });
}

const SWARM = { kind: 'swarm', infect: 0 };
const PLAGUE_CLOUD = { kind: 'plague', infect: 0 };

/** Great Pestilence: a drifting plague cloud — sickness, damage, infected ground, panic. */
function plagueCloudTick(sim, e, def) {
  const { state } = sim;
  const r2 = e.radius * e.radius;
  const doInfect = (state.tick - e.start) % Math.round(def.infectInterval * TICK_RATE) < 10;
  for (const sq of state.squads) {
    if (!areHostile(e.faction, sq.faction)) continue;
    if (dist(sq.cx, sq.cz, e.x, e.z) > e.radius + 12) continue;
    for (const m of sq.members) {
      if (m.state !== 'alive' && m.state !== 'joining' && m.state !== 'wounded') continue;
      const dx = m.x - e.x, dz = m.z - e.z;
      if (dx * dx + dz * dz > r2) continue;
      // the cloud sickens up to maxStacks — the rest is the infection's own course (medics, clerics,
      // leaving the cloud and clean ground still save a squad caught in it)
      if (doInfect && m.infection < (def.maxStacks || INFECTION_MAX)) addInfection(sim, sq, m, 1);
      damageSoldier(sim, sq, m, def.dps * 0.5, e.faction, PLAGUE_CLOUD, 0, 0);
    }
    sq.debuffUntil = state.tick + 14;
  }
}
const BLAST = { kind: 'explosive', infect: 0 };

function swarmTick(sim, e, def) {
  const { state } = sim;
  const r2 = e.radius * e.radius;
  const doInfect = (state.tick - e.start) % Math.round(def.infectInterval * TICK_RATE) < 10;
  const dps = def.dps * swarmDpsMult(state);
  for (const sq of state.squads) {
    if (!areHostile(e.faction, sq.faction)) continue;
    if (dist(sq.cx, sq.cz, e.x, e.z) > e.radius + 12) continue;
    let touched = false;
    for (const m of sq.members) {
      if (m.state !== 'alive' && m.state !== 'joining' && m.state !== 'wounded') continue;
      const dx = m.x - e.x, dz = m.z - e.z;
      if (dx * dx + dz * dz > r2) continue;
      touched = true;
      if (doInfect) addInfection(sim, sq, m, 1);
      damageSoldier(sim, sq, m, dps * 0.5, e.faction, SWARM, 0, 0); // ignores cover
    }
    if (touched) sq.debuffUntil = state.tick + 14;
  }
}

/** Purge rite: bodies in the circle burn, the ground is scoured, the plague loses momentum. */
function purgeTick(sim, e, def) {
  const { state } = sim;
  for (let i = state.corpses.length - 1; i >= 0; i--) {
    const c = state.corpses[i];
    if (dist(c.x, c.z, e.x, e.z) <= e.radius) cremateCorpse(sim, c, e.faction);
  }
  cleanseInfection(sim, e.x, e.z, e.radius, def.cleanse);
  for (const sq of state.squads) {
    if (!areHostile(e.faction, sq.faction) || dist(sq.cx, sq.cz, e.x, e.z) > e.radius + 10) continue;
    for (const m of sq.members) {
      if (m.state !== 'alive' || dist(m.x, m.z, e.x, e.z) > e.radius) continue;
      m.burn = Math.max(m.burn || 0, state.tick + 40);
    }
  }
}

/**
 * One detonation. def: { blastRadius, damage, structureDamage, size, craters, suppress }.
 * force (1 at the centre -> 0 at the edge) travels with damage so presentation can scale gore.
 */
export function explode(sim, faction, def, x, z, ability = '') {
  const { state } = sim;
  const R = def.blastRadius;
  sim.events.push({ type: EV.EXPLOSION, x, z, size: def.size || 'heavy', faction, ability, r: R });
  if (def.craters) addCrater(sim, x, z, R * 0.62);
  animalsBlast(sim, x, z, R, def.damage, faction);
  for (const sq of state.squads) {
    if (dist(sq.cx, sq.cz, x, z) > R + 10) continue;
    const friendly = !def.indiscriminate && !areHostile(faction, sq.faction);
    for (const m of sq.members) {
      if (m.state !== 'alive' && m.state !== 'joining') continue;
      const d = dist(m.x, m.z, x, z);
      if (d > R) continue;
      const force = 1 - d / R;
      let dmg = def.damage * force * (0.8 + 0.4 * rngFloat(state.rng.main));
      if (m.postId) dmg *= 0.45; // trench protects against blast
      else if (m.cover >= 7) dmg *= 1 - 0.3 * (COVER_TYPES[COVER_IDS[m.cover]].level / 3); // walls absorb part
      if (friendly) dmg *= 0.5;
      const dd = d || 1;
      damageSoldier(sim, sq, m, dmg, faction, BLAST, (m.x - x) / dd, (m.z - z) / dd, 0, force);
    }
    if (def.suppress && !friendly && dist(sq.cx, sq.cz, x, z) <= R + 4) {
      sq.suppressUntil = Math.max(sq.suppressUntil || 0, state.tick + Math.round(def.suppress.seconds * TICK_RATE));
    }
  }
  for (const st of state.structures.slice()) {
    if (!def.indiscriminate && !areHostile(faction, st.faction)) continue;
    const d = distanceToStructure(st, x, z);
    if (d > R) continue;
    const sd = STRUCTURES[st.type];
    let mult = sd.kind === 'linear' ? 0.6 : 1;
    if (sd.blastResist) mult *= 1 - sd.blastResist;
    damageStructure(sim, st, def.structureDamage * (1 - d / R) * mult, faction);
  }
}

/**
 * Persistent shell craters (gameplay: light cover; presentation: carved ground). Bounded: a new
 * crater close to an old one deepens / widens it instead; past MAX_CRATERS the oldest is recycled.
 */
export function addCrater(sim, x, z, r) {
  const { state } = sim;
  const list = state.craters || (state.craters = []);
  for (const c of list) {
    if (dist(c.x, c.z, x, z) < (c.r + r) * 0.55) {
      c.r = Math.min(MAX_CRATER_R, Math.max(c.r, r) + 0.35);
      c.d = Math.min(3, c.d + 1);
      c.tick = state.tick;
      c.seenBy = 0; // changed: every side has to look again
      return c;
    }
  }
  const c = { id: state.nextId++, x, z, r: Math.min(MAX_CRATER_R, r), d: 1, tick: state.tick, seenBy: 0 };
  if (list.length >= MAX_CRATERS) {
    let oldest = 0;
    for (let i = 1; i < list.length; i++) if (list[i].tick < list[oldest].tick) oldest = i;
    list.splice(oldest, 1);
  }
  list.push(c);
  return c;
}

export function updateEffects(sim) {
  const { state } = sim;
  for (let i = state.effects.length - 1; i >= 0; i--) {
    const e = state.effects[i];
    const def = ABILITIES[e.ability];
    if (e.kind === 'swarm') {
      if (state.tick >= e.end) { state.effects.splice(i, 1); continue; }
      if (state.tick >= e.next) {
        e.next = state.tick + 10;
        swarmTick(sim, e, def);
      }
    } else if (e.kind === 'plague_cloud') {
      if (state.tick >= e.end) { state.effects.splice(i, 1); continue; }
      if (state.tick >= e.next) {
        e.next = state.tick + 10;
        plagueCloudTick(sim, e, def);
      }
    } else if (e.kind === 'purge') {
      if (state.tick >= e.next && !e.done) {
        e.done = 1;
        purgeTick(sim, e, def);
        pestLoss(sim, def.pestilenceDrain, 'purge');
      }
      if (state.tick >= e.end) { state.effects.splice(i, 1); continue; }
    } else if (e.kind === 'tide') {
      if (state.tick >= e.end) { state.effects.splice(i, 1); continue; }
    } else if (e.kind === 'detonation') {
      if (state.tick >= e.next) {
        explode(sim, e.faction, e.blast, e.x, e.z, 'detonation');
        state.effects.splice(i, 1);
      }
    } else if (e.kind === 'barrage') {
      if (state.tick >= e.next && e.shells > 0) {
        const a = rngFloat(state.rng.main) * 6.283185307179586;
        const r = e.radius * Math.sqrt(rngFloat(state.rng.main));
        explode(sim, e.faction, def, e.x + dsin(a) * r, e.z + dcos(a) * r, e.ability);
        e.shells--;
        e.next = state.tick + Math.round(def.interval * TICK_RATE);
      }
      if (e.shells <= 0) state.effects.splice(i, 1);
    }
  }
}
