// Faction logic registry: maps faction data `logic` ids to logic modules.
// Adding a faction = data entry + logic module + AI module; no engine changes. Logic runs per
// SIDE (a mirror match ticks the same module twice, each on its own side state).
import { sideDef } from '../data/factions.js';
import { newAntiochLogic } from './new_antioch.js';
import { blackGrailLogic } from './black_grail.js';
import { ironSultanateLogic } from './iron_sultanate.js';

const LOGIC = {
  new_antioch: newAntiochLogic,
  black_grail: blackGrailLogic,
  iron_sultanate: ironSultanateLogic,
};

export function factionLogic(fid) {
  return LOGIC[sideDef(fid).logic];
}

/** One-time faction setup when a match is created (e.g. New Antioch's civilian population). */
export function setupFactions(sim) {
  for (const { id: fid } of sim.state.sides) {
    const logic = factionLogic(fid);
    if (logic && logic.setup) logic.setup(sim, fid);
  }
}

export function updateFactions(sim) {
  if (sim.state.match.phase === 'ENDED') return;
  for (const { id: fid } of sim.state.sides) {
    const logic = factionLogic(fid);
    if (logic) logic.tick(sim, fid);
  }
}
