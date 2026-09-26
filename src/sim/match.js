// Match flow: PREPARATION -> WAR -> ENDED (victory/defeat). Siege rules:
//  - defender wins if the objective survives until the war timer ends (or the attacker is spent)
//  - attacker wins if the objective is destroyed before the timer ends
import { EV } from '../core/events.js';
import { UNITS } from '../data/units.js';
import { STRUCTURES } from '../data/structures.js';
import { FACTION_ORDER } from '../data/factions.js';

export function factionByRole(state, role) {
  for (const fid of FACTION_ORDER) if (state.factions[fid].role === role) return fid;
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
}

function cheapestUnitCost(fid, resource) {
  let best = Infinity;
  for (const id in UNITS) {
    const u = UNITS[id];
    if (u.faction !== fid || !u.cost || u.cost[resource] === undefined) continue;
    if (u.cost[resource] < best) best = u.cost[resource];
  }
  return best;
}

export function checkVictory(sim) {
  const { state } = sim;
  const m = state.match;
  if (m.phase !== 'WAR') return;
  const defender = factionByRole(state, 'defender');
  const attacker = factionByRole(state, 'attacker');
  const objective = state.structures.find((s) => s.objective);
  if (!objective) { endMatch(sim, attacker, 'objective_destroyed'); return; }
  if (state.tick >= m.warEndTick) { endMatch(sim, defender, 'time_held'); return; }
  // attacker spent: no forces, nothing in production, no income or production left to rebuild
  // with, cannot afford more, no bodies waiting to rise
  if (state.tick % 20 === 0) {
    const hasSquads = state.squads.some((sq) => sq.faction === attacker);
    if (hasSquads) return;
    const producing = state.structures.some((s) => s.faction === attacker && s.queue && s.queue.length);
    if (producing) return;
    const rebuilding = state.structures.some((s) => {
      if (s.faction !== attacker || !s.built) return false;
      const d = STRUCTURES[s.type];
      return !!(d.trains && d.trains.length) || d.biomassRate > 0 || d.supplyRate > 0 || d.materialRate > 0;
    });
    if (rebuilding) return;
    const f = state.factions[attacker];
    const res = Object.keys(f.resources)[0];
    const canBuy = f.resources[res] >= cheapestUnitCost(attacker, res);
    const pendingRise = state.corpses.some((c) => c.riseAt > 0);
    if (!canBuy && !pendingRise) endMatch(sim, defender, 'attacker_spent');
  }
}
