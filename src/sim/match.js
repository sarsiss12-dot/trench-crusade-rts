// Match flow: PREPARATION -> WAR -> ENDED (victory/defeat). Victory rules by scenario contract
// (state.match.victory) and ROLE / SIDE — see checkVictory.
import { EV } from '../core/events.js';
import { UNITS, unitDef } from '../data/units.js';
import { STRUCTURES } from '../data/structures.js';
import { updateLull } from './lull.js';
import { baseFaction } from '../data/factions.js';

/** The SIDE holding a starting role (slot order), or null. */
export function factionByRole(state, role) {
  for (const sd of state.sides) if (sd.role === role) return sd.id;
  return null;
}

export function endMatch(sim, winner, reason) {
  const { state } = sim;
  if (state.match.phase === 'ENDED') return;
  state.match.phase = 'ENDED';
  state.match.winner = winner;
  state.match.reason = reason;
  state.match.endTick = state.tick;
  sim.events.push({ type: EV.MATCH_ENDED, winner, reason });
}

export function updateMatch(sim) {
  const { state } = sim;
  const m = state.match;
  if (m.phase === 'PREPARATION' && state.tick >= m.prepEndTick) {
    m.phase = 'WAR';
    sim.events.push({ type: EV.PHASE_CHANGED, phase: 'WAR' });
  }
  updateLull(sim);
}

function cheapestUnitCost(fid, resource) {
  let best = Infinity;
  for (const id in UNITS) {
    const u = UNITS[id];
    if (u.faction !== baseFaction(fid) || !u.cost || u.cost[resource] === undefined) continue;
    if (u.cost[resource] < best) best = u.cost[resource];
  }
  return best;
}

/**
 * VICTORY (Phase 5A: by ROLE / SIDE capability, never by faction id).
 *  SIEGE: the side holding the objective (the defender) loses it -> its enemy wins; the war
 *    timer runs out with the objective standing -> its holder wins (never in an endless war);
 *    the attacker spent (no forces, nothing to rebuild with) -> the defender wins.
 *  ANNIHILATION (both modes): a side with no HQ-capable structure and no meaningful fighting
 *    force left loses — the defender can march out and burn the attacker's base, the attacker
 *    can break a defender whose HQ is gone. Open battle has no timer winner: at the end of the
 *    war clock the side with more strength left wins (a draw is possible only when equal).
 */
export function checkVictory(sim) {
  const { state } = sim;
  const m = state.match;
  if (m.phase !== 'WAR') return;
  const mode = m.victory || 'siege';
  if (mode === 'siege') {
    for (const o of state.objectives || []) {
      if (!o.side) continue;
      const alive = state.structures.some((s) => s.objective && s.faction === o.side && s.hp > 0);
      if (!alive) { endMatch(sim, firstEnemy(state, o.side), 'objective_destroyed'); return; }
    }
    if (!m.endless && m.warEndTick > 0 && state.tick >= m.warEndTick) {
      endMatch(sim, objectiveHolder(state) || factionByRole(state, 'defender'), 'time_held');
      return;
    }
  } else if (!m.endless && m.warEndTick > 0 && state.tick >= m.warEndTick) {
    endMatch(sim, strongest(state), 'time_strength');
    return;
  }
  if (state.tick % 20 !== 0) return;
  // attacker spent: no forces, nothing in production, no income or production left to rebuild
  // with, cannot afford more, no bodies waiting to rise
  if (mode === 'siege') {
    const attacker = factionByRole(state, 'attacker');
    if (attacker && attackerSpent(state, attacker)) { endMatch(sim, firstEnemy(state, attacker), 'attacker_spent'); return; }
  }
  for (const sd of state.sides) {
    if (sideBroken(state, sd.id)) { endMatch(sim, firstEnemy(state, sd.id), 'base_destroyed'); return; }
  }
}

/** The holder of a standing objective (first in slot order), or null. */
function objectiveHolder(state) {
  for (const o of state.objectives || []) {
    if (o.side && state.structures.some((s) => s.objective && s.faction === o.side && s.hp > 0)) return o.side;
  }
  return null;
}

/** First side hostile to `id` (2-side matches: the enemy). */
export function firstEnemy(state, id) {
  for (const sd of state.sides) if (sd.id !== id) return sd.id;
  return null;
}

/** No HQ-capable structure left AND no fighting force (alive / rising / joining combat soldiers). */
export function sideBroken(state, id) {
  if (state.structures.some((s) => s.faction === id && s.hp > 0 && s.built && STRUCTURES[s.type].hq)) return false;
  // a meaningful fighting force: combat squads (engineers / work gangs / civilians do not hold a front)
  return !state.squads.some((sq) => sq.faction === id && !sq.civ && unitDef(sq.type).combatUnit && sq.members.some((mm) => mm.state === 'alive' || mm.state === 'rising' || mm.state === 'joining'));
}

/** Side with the most living soldiers + HQ weight at the end of an open battle (null = equal). */
function strongest(state) {
  let best = null, bestV = -1, tie = false;
  for (const sd of state.sides) {
    let v = 0;
    for (const sq of state.squads) if (sq.faction === sd.id && !sq.civ) for (const mm of sq.members) if (mm.state === 'alive') v++;
    for (const s of state.structures) if (s.faction === sd.id && s.hp > 0 && STRUCTURES[s.type].hq) v += 20;
    if (v > bestV) { best = sd.id; bestV = v; tie = false; } else if (v === bestV) tie = true;
  }
  return tie ? null : best;
}

/**
 * An objective structure was destroyed (combat): its holder's enemy wins — the destroyer if it is
 * hostile to the holder, else the holder's first enemy.
 */
export function onObjectiveLost(sim, st, by) {
  const winner = by && by !== st.faction && by !== 'neutral' && sim.state.factions[by] ? by : firstEnemy(sim.state, st.faction);
  endMatch(sim, winner, 'objective_destroyed');
}

function attackerSpent(state, attacker) {
  if (state.squads.some((sq) => sq.faction === attacker)) return false;
  if (state.structures.some((s) => s.faction === attacker && s.queue && s.queue.length)) return false;
  const rebuilding = state.structures.some((s) => {
    if (s.faction !== attacker || !s.built) return false;
    const d = STRUCTURES[s.type];
    return !!(d.trains && d.trains.length) || d.biomassRate > 0 || d.supplyRate > 0 || d.materialRate > 0;
  });
  if (rebuilding) return false;
  const f = state.factions[attacker];
  const res = Object.keys(f.resources)[0];
  const canBuy = f.resources[res] >= cheapestUnitCost(attacker, res);
  const pendingRise = state.corpses.some((c) => c.riseAt > 0 && (!c.plague || c.plague === attacker));
  return !canBuy && !pendingRise;
}
