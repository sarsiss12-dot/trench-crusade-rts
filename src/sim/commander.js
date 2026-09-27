// COMMANDERS (Phase 4). Each faction fields ONE commander (New Antioch: a Lieutenant; Black Grail:
// the Lord of Tumours — both official leaders): an aura and one command ability, not a MOBA hero.
//  - limit 1: he cannot be trained while he lives or is queued
//  - HOLD THE LINE / PLAGUE BLESSING: a timed area that follows him (effect kind 'command'; the
//    aura values reach combat through sim/auras.js)
//  - DEATH: aura and ability gone; a morale shock around him (suppression); for a minute every
//    faction ability recharges slower; a replacement only after a long wait, at double cost, and
//    only once per match (data: units.js commander)
// Plain state: faction.cmdr = { sq, unit, deaths, readyTick, lostUntil, abReady, lastX, lastZ }.
import { UNITS, unitDef } from '../data/units.js';
import { ABILITIES } from '../data/abilities.js';
import { FACTIONS } from '../data/factions.js';
import { EV } from '../core/events.js';
import { TICK_RATE } from './constants.js';
import { dist } from '../core/dmath.js';
import { canAfford, pay } from '../economy/economy.js';

/** The commander unit type of a faction (null if it has none). */
export function commanderUnit(fid) {
  for (const id in UNITS) if (UNITS[id].faction === fid && UNITS[id].commander) return id;
  return null;
}

export function createCommanderState(fid) {
  return { sq: 0, unit: commanderUnit(fid) || '', deaths: 0, readyTick: 0, lostUntil: 0, abReady: 0, lastX: 0, lastZ: 0 };
}

function aliveOf(sq) {
  if (!sq) return false;
  for (const m of sq.members) if (m.state === 'alive' || m.state === 'rising') return true;
  return false;
}

/** The living commander squad of a faction, or null. */
export function commanderSquad(sim, fid) {
  const c = sim.state.factions[fid] && sim.state.factions[fid].cmdr;
  if (!c || !c.sq) return null;
  const sq = sim.rt.squadById.get(c.sq);
  return aliveOf(sq) ? sq : null;
}

/** Why a commander unit cannot be queued ('' = it can). Called by sim/production.js canTrain. */
export function commanderTrainRefusal(sim, fid, unitType) {
  const u = unitDef(unitType);
  if (!u.commander) return '';
  const c = sim.state.factions[fid].cmdr;
  if (!c) return '';
  if (commanderSquad(sim, fid)) return 'train.commander_limit';
  for (const st of sim.state.structures) if (st.faction === fid && st.queue && st.queue.some((q) => q.unit === unitType)) return 'train.commander_limit';
  if (c.deaths > u.commander.maxReplacements) return 'train.commander_lost';
  if (sim.state.tick < c.readyTick) return 'train.commander_wait';
  return '';
}

/** Cost multiplier for a commander replacement (after his first death). */
export function commanderCostMult(state, fid, unitType) {
  const u = UNITS[unitType];
  const c = state.factions[fid] && state.factions[fid].cmdr;
  return u && u.commander && c && c.deaths > 0 ? u.commander.replaceCostMult : 1;
}

/** Ability recharge multiplier while the faction mourns its commander. */
export function commanderCooldownMult(state, fid) {
  const c = state.factions[fid] && state.factions[fid].cmdr;
  if (!c || state.tick >= c.lostUntil) return 1;
  const u = UNITS[c.unit];
  return u && u.commander ? u.commander.penalty.cooldownMult : 1;
}

/** Why the commander ability cannot be used now ('' = it can). */
export function commanderAbilityRefusal(sim, fid) {
  const c = sim.state.factions[fid].cmdr;
  const sq = commanderSquad(sim, fid);
  if (!c || !sq) return 'cmdr.none';
  if (sim.state.match.phase !== 'WAR') return 'ability.not_war';
  if (sim.state.tick < c.abReady) return 'ability.cooldown';
  const ab = ABILITIES[unitDef(sq.type).commander.ability];
  if (!canAfford(sim.state.factions[fid].resources, ab.cost)) return 'ability.no_resources';
  return '';
}

/** Cast the commander ability (validated by the caller). */
export function castCommanderAbility(sim, fid) {
  const { state } = sim;
  const c = state.factions[fid].cmdr;
  const sq = commanderSquad(sim, fid);
  const id = unitDef(sq.type).commander.ability;
  const ab = ABILITIES[id];
  pay(state.factions[fid].resources, ab.cost);
  c.abReady = state.tick + Math.round(ab.cooldown * TICK_RATE);
  state.effects.push({
    id: state.nextId++, kind: 'command', ability: id, faction: fid, sq: sq.id,
    x: sq.cx, z: sq.cz, radius: ab.radius, start: state.tick, end: state.tick + Math.round(ab.duration * TICK_RATE),
  });
  sim.events.push({ type: EV.ABILITY_CAST, faction: fid, ability: id, x: sq.cx, z: sq.cz, radius: ab.radius, duration: ab.duration, commander: 1 });
}

/**
 * Per tick: follow the commander, detect his fall (penalties + replacement timer), adopt a newly
 * trained replacement.
 */
export function updateCommanders(sim) {
  const { state, rt } = sim;
  for (const fid in FACTIONS) {
    const f = state.factions[fid];
    const c = f && f.cmdr;
    if (!c || !c.unit) continue;
    if (c.sq) {
      const sq = rt.squadById.get(c.sq);
      if (aliveOf(sq)) { c.lastX = sq.cx; c.lastZ = sq.cz; continue; }
      // the commander has fallen
      const u = UNITS[c.unit].commander;
      c.sq = 0;
      c.deaths++;
      c.readyTick = state.tick + Math.round(u.replaceSec * TICK_RATE);
      c.lostUntil = state.tick + Math.round(u.penalty.sec * TICK_RATE);
      f.stats.commanderDeaths = (f.stats.commanderDeaths || 0) + 1;
      if (f.stats.commanderDeathTick === undefined) f.stats.commanderDeathTick = state.tick;
      for (const o of state.squads) {
        if (o.faction !== fid || dist(o.cx, o.cz, c.lastX, c.lastZ) > u.penalty.shockR) continue;
        o.suppressUntil = Math.max(o.suppressUntil || 0, state.tick + Math.round(u.penalty.shockSec * TICK_RATE));
      }
      sim.events.push({ type: EV.COMMANDER_FALLEN, faction: fid, x: c.lastX, z: c.lastZ, deaths: c.deaths, replaceable: c.deaths <= u.maxReplacements ? 1 : 0, readyTick: c.readyTick });
      continue;
    }
    // a replacement walked out of the bastion / altar
    for (const sq of state.squads) {
      if (sq.faction === fid && sq.type === c.unit && aliveOf(sq)) { c.sq = sq.id; c.lastX = sq.cx; c.lastZ = sq.cz; break; }
    }
  }
  // command areas follow their commander; they end with him
  for (let i = state.effects.length - 1; i >= 0; i--) {
    const e = state.effects[i];
    if (e.kind !== 'command') continue;
    const sq = rt.squadById.get(e.sq);
    if (!aliveOf(sq) || state.tick >= e.end) { state.effects.splice(i, 1); continue; }
    e.x = sq.cx; e.z = sq.cz;
  }
}

/** Claim the starting commander squads (scenario setup). */
export function claimStartingCommanders(sim) {
  const { state } = sim;
  for (const fid in FACTIONS) {
    const f = state.factions[fid];
    if (!f) continue;
    if (!f.cmdr) f.cmdr = createCommanderState(fid);
    if (!f.cmdr.unit) continue;
    const sq = state.squads.find((q) => q.faction === fid && q.type === f.cmdr.unit);
    if (sq) { f.cmdr.sq = sq.id; f.cmdr.lastX = sq.cx; f.cmdr.lastZ = sq.cz; }
  }
}

/** HUD data for the commander slot (own faction only). */
export function commanderView(sim, fid) {
  const c = sim.state.factions[fid] && sim.state.factions[fid].cmdr;
  if (!c || !c.unit) return null;
  const sq = commanderSquad(sim, fid);
  const u = UNITS[c.unit];
  const ab = ABILITIES[u.commander.ability];
  const tick = sim.state.tick;
  let hp = 0;
  if (sq) for (const m of sq.members) if (m.state === 'alive') hp += Math.max(0, m.hp);
  return {
    unit: c.unit, alive: !!sq, sqId: sq ? sq.id : 0, hp: sq ? hp / u.hp : 0,
    ability: u.commander.ability, abilityCost: ab.cost, abilityCd: Math.max(0, (c.abReady - tick) / TICK_RATE),
    abilityActive: sim.state.effects.some((e) => e.kind === 'command' && e.faction === fid),
    deaths: c.deaths, replaceIn: Math.max(0, (c.readyTick - tick) / TICK_RATE),
    replaceable: c.deaths <= u.commander.maxReplacements, mourning: tick < c.lostUntil,
  };
}
