// Faction logic registry: maps faction data `logic` ids to logic modules.
// Adding a faction = data entry + logic module + AI module; no engine changes.
import { FACTIONS, FACTION_ORDER } from '../data/factions.js';
import { newAntiochLogic } from './new_antioch.js';
import { blackGrailLogic } from './black_grail.js';

const LOGIC = {
  new_antioch: newAntiochLogic,
  black_grail: blackGrailLogic,
};

export function factionLogic(fid) {
  return LOGIC[FACTIONS[fid].logic];
}

export function updateFactions(sim) {
  if (sim.state.match.phase === 'ENDED') return;
  for (const fid of FACTION_ORDER) {
    const logic = factionLogic(fid);
    if (logic) logic.tick(sim, fid);
  }
}
