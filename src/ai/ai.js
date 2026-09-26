// AI dispatcher. Each faction has its OWN strategy module (not one behaviour tree with
// different unit lists). AIs read only information their faction can perceive and act only
// through the normal command pipeline — no scripted theatre, no cheating.
import { FACTIONS, FACTION_ORDER } from '../data/factions.js';
import { blackGrailAI } from './black_grail_ai.js';
import { newAntiochAI } from './new_antioch_ai.js';

export const AI_INTERVAL = 10; // ticks between strategic thinks (staggered per faction)

const AIS = {
  black_grail: blackGrailAI,
  new_antioch: newAntiochAI,
};

export function aiModuleFor(fid) {
  return AIS[FACTIONS[fid].ai] || null;
}

export function runAI(sim) {
  const { state } = sim;
  for (const fid of FACTION_ORDER) {
    const f = state.factions[fid];
    if (f.controller !== 'ai') continue;
    const ai = aiModuleFor(fid);
    if (!ai) continue;
    if (!state.ai[fid]) state.ai[fid] = ai.init(sim, fid);
    const offset = FACTIONS[fid].index * 5;
    if ((state.tick + offset) % AI_INTERVAL === 0) ai.think(sim, fid, state.ai[fid]);
  }
}
