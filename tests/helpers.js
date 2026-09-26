// Shared test helpers: controlled simulations without AI interference.
import { createSimulation, stepSimulation } from '../src/sim/simulation.js';
import { createSquad, createStructure } from '../src/sim/state.js';
import { structuresChanged } from '../src/sim/runtime.js';

/** New siege sim; both factions player-controlled (no AI) unless overridden. */
export function makeSim(opts = {}) {
  return createSimulation({
    scenarioId: opts.scenarioId || 'siege_default',
    seed: opts.seed !== undefined ? opts.seed : 1234,
    settings: {
      prepSeconds: opts.prepSeconds !== undefined ? opts.prepSeconds : 0,
      warMinutes: opts.warMinutes || 15,
      playerFaction: 'new_antioch',
      controllers: opts.controllers || { new_antioch: 'player', black_grail: 'player' },
      stressSoldiers: opts.stressSoldiers,
    },
  });
}

export function clearUnits(sim) {
  sim.state.squads.length = 0;
  sim.rt.squadById.clear();
  sim.rt.soldierIndex.clear();
}

export function spawn(sim, faction, unit, x, z, rot = 0, opts = {}) {
  const sq = createSquad(sim.state, faction, unit, x, z, rot, opts);
  sim.state.squads.push(sq);
  sim.rt.squadById.set(sq.id, sq);
  for (const m of sq.members) sim.rt.soldierIndex.set(m.id, sq);
  sq.cx = x; sq.cz = z;
  return sq;
}

export function addStructure(sim, type, faction, params) {
  const s = createStructure(sim.state, type, faction, params);
  sim.state.structures.push(s);
  sim.rt.structById.set(s.id, s);
  structuresChanged(sim);
  return s;
}

export function run(sim, seconds, onTick) {
  const n = Math.round(seconds * 20);
  const events = [];
  for (let i = 0; i < n; i++) {
    stepSimulation(sim);
    for (const e of sim.events) events.push(e);
    const stop = onTick && onTick(sim) === false;
    sim.events.length = 0;
    if (stop) break;
  }
  return events;
}

export function alive(sq) {
  return sq.members.filter((m) => m.state === 'alive').length;
}

export function squadAlive(sim, sq) {
  return sim.state.squads.indexOf(sq) >= 0 && alive(sq) > 0;
}
