// AI dispatcher. Each FACTION has its own DOCTRINE module (economy, production, faction play);
// the side's STRATEGIC ROLE (attacker / defender, state.factions[side].role) steers what that
// doctrine does with its army (ai/strategy.js). AIs read only what their SIDE can perceive and act
// only through the normal command pipeline — no scripted theatre, no cheating. Every AI memory
// (state.ai[side]) is per SIDE, so a mirror match runs two independent AIs of the same doctrine.
import { sideDef, sideIndex } from '../data/factions.js';
import { AI_DIFFICULTY } from '../data/ai.js';
import { blackGrailAI } from './black_grail_ai.js';
import { newAntiochAI } from './new_antioch_ai.js';
import { ironSultanateAI } from './iron_sultanate_ai.js';
import { ensureDoctrine } from './doctrine.js';

export const AI_INTERVAL = 10; // ticks between strategic thinks (staggered per faction)

const AIS = {
  black_grail: blackGrailAI,
  new_antioch: newAntiochAI,
  iron_sultanate: ironSultanateAI,
};

export function aiModuleFor(fid) {
  return AIS[sideDef(fid).ai] || null;
}

export function runAI(sim) {
  const { state } = sim;
  const diff = AI_DIFFICULTY[state.settings.aiDifficulty] || AI_DIFFICULTY.normal;
  const interval = diff.interval || AI_INTERVAL;
  for (const sd of state.sides) {
    const fid = sd.id;
    const f = state.factions[fid];
    if (f.controller !== 'ai') continue;
    const ai = aiModuleFor(fid);
    if (!ai) continue;
    if (!state.ai[fid]) state.ai[fid] = ai.init(sim, fid);
    ensureDoctrine(sim, fid, state.ai[fid]);
    const offset = sideIndex(fid) * 5;
    if ((state.tick + offset) % interval === 0) ai.think(sim, fid, state.ai[fid]);
  }
}
