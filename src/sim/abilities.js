// Area-effect faction abilities (data in data/abilities.js). Effects are plain data in
// state.effects and are resolved deterministically by the simulation.
import { ABILITIES } from '../data/abilities.js';
import { STRUCTURES } from '../data/structures.js';
import { FACTIONS, areHostile } from '../data/factions.js';
import { EV } from '../core/events.js';
import { rngFloat } from '../core/rng.js';
import { dist, dsin, dcos } from '../core/dmath.js';
import { TICK_RATE, INFECTION_MAX } from './constants.js';
import { canAfford, pay } from '../economy/economy.js';
import { isVisibleAt } from '../world/fog.js';
import { damageSoldier, damageStructure } from '../combat/combat.js';
import { distanceToStructure } from '../units/orders.js';

export function validateAbility(sim, faction, abilityId, x, z) {
  const { state } = sim;
  const def = ABILITIES[abilityId];
  if (!def || def.faction !== faction) return 'ability.invalid';
  const fs = state.factions[faction];
  if (!fs.abilities[abilityId]) return 'ability.invalid';
  if (state.match.phase !== 'WAR') return 'ability.not_war';
  if (fs.abilities[abilityId].readyTick > state.tick) return 'ability.cooldown';
  if (!canAfford(fs.resources, def.cost)) return 'ability.no_resources';
  const fIdx = FACTIONS[faction].index;
  if (def.requiresVision && !isVisibleAt(state.fog, fIdx, x, z)) return 'ability.no_vision';
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

export function castAbility(sim, faction, abilityId, x, z) {
  const { state } = sim;
  const def = ABILITIES[abilityId];
  const fs = state.factions[faction];
  pay(fs.resources, def.cost);
  fs.abilities[abilityId].readyTick = state.tick + Math.round(def.cooldown * TICK_RATE);
  const e = { id: state.nextId++, kind: def.effect, ability: abilityId, faction, x, z, radius: def.radius, start: state.tick };
  if (def.effect === 'swarm') {
    e.end = state.tick + Math.round(def.duration * TICK_RATE);
    e.next = state.tick;
  } else if (def.effect === 'barrage') {
    e.next = state.tick + Math.round(def.delay * TICK_RATE);
    e.shells = def.shells;
  }
  state.effects.push(e);
  sim.events.push({ type: EV.ABILITY_CAST, faction, ability: abilityId, x, z, radius: def.radius, duration: def.duration || def.delay + def.shells * def.interval, effectId: e.id });
}

function swarmTick(sim, e, def) {
  const { state } = sim;
  const r2 = e.radius * e.radius;
  const doInfect = (state.tick - e.start) % Math.round(def.infectInterval * TICK_RATE) < 10;
  for (const sq of state.squads) {
    if (!areHostile(e.faction, sq.faction)) continue;
    if (dist(sq.cx, sq.cz, e.x, e.z) > e.radius + 12) continue;
    let touched = false;
    for (const m of sq.members) {
      if (m.state !== 'alive') continue;
      const dx = m.x - e.x, dz = m.z - e.z;
      if (dx * dx + dz * dz > r2) continue;
      touched = true;
      if (doInfect) m.infection = Math.min(INFECTION_MAX, m.infection + 1);
      damageSoldier(sim, sq, m, def.dps * 0.5, e.faction, null, 0, 0); // ignores cover
    }
    if (touched) sq.debuffUntil = state.tick + 14;
  }
}

function explode(sim, e, def, x, z) {
  const { state } = sim;
  const R = def.blastRadius;
  sim.events.push({ type: EV.EXPLOSION, x, z, size: 'heavy', faction: e.faction, ability: e.ability });
  for (const sq of state.squads) {
    if (dist(sq.cx, sq.cz, x, z) > R + 10) continue;
    const friendly = !areHostile(e.faction, sq.faction);
    for (const m of sq.members) {
      if (m.state !== 'alive') continue;
      const d = dist(m.x, m.z, x, z);
      if (d > R) continue;
      let dmg = def.damage * (1 - d / R) * (0.8 + 0.4 * rngFloat(state.rng.main));
      if (m.postId) dmg *= 0.45; // trench protects against blast
      if (friendly) dmg *= 0.5;
      const dd = d || 1;
      damageSoldier(sim, sq, m, dmg, e.faction, null, (m.x - x) / dd, (m.z - z) / dd);
    }
  }
  for (const st of state.structures.slice()) {
    if (!areHostile(e.faction, st.faction)) continue;
    const d = distanceToStructure(st, x, z);
    if (d > R) continue;
    const sd = STRUCTURES[st.type];
    const mult = sd.kind === 'linear' ? 0.6 : 1;
    damageStructure(sim, st, def.structureDamage * (1 - d / R) * mult, e.faction);
  }
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
    } else if (e.kind === 'barrage') {
      if (state.tick >= e.next && e.shells > 0) {
        const a = rngFloat(state.rng.main) * 6.283185307179586;
        const r = e.radius * Math.sqrt(rngFloat(state.rng.main));
        explode(sim, e, def, e.x + dsin(a) * r, e.z + dcos(a) * r);
        e.shells--;
        e.next = state.tick + Math.round(def.interval * TICK_RATE);
      }
      if (e.shells <= 0) state.effects.splice(i, 1);
    }
  }
}
