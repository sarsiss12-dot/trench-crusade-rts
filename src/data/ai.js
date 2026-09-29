// AI settings (Phase 5A). Difficulty only changes how often the AI thinks (reaction speed) —
// never resources, vision or unit stats: the AI plays by the same rules and the same fog.
export const AI_DIFFICULTY = {
  easy: { interval: 20 },
  normal: { interval: 10 },
  hard: { interval: 6 },
};

// STRATEGIC ROLE layer (Phase 5A): how the SAME faction doctrine leans with its starting role. The
// faction AI modules (ai/new_antioch_ai.js, ai/black_grail_ai.js) keep their doctrine (how the
// faction fights); these numbers only decide how early / how hard it goes over to the offensive.
//  NEW ANTIOCH (strike groups from counterattack()):
//   firstStrikeMin: war minutes before the first strike; cooldownMin: between strikes;
//   minCombat: combat squads needed before a group may leave; group: squads per strike group;
//   baseAfter: war progress share after which the enemy HQ itself is a target (0 = always);
//   probe: how far toward the enemy's start a probe goes when nothing is known (0..1);
//   strikeMin: minutes a strike group may stay out; reach: how far from its own HQ a known enemy
//   structure may be to become a strike target (m); pressOn: a probe that finds a target attacks it
//   (and a strike that razed one goes on to the next) instead of coming home; keepHome: combat
//   squads that always stay home — above it, trench holders may join a strike (99 = never)
//  BLACK GRAIL (waves from the organic doctrine):
//   holdHome: waves hold near the own base until the enemy is broken (defender) instead of
//   marching at once; sallyRatio: own/enemy visible strength before a counter-wave sallies out
export const STRATEGY = {
  new_antioch: {
    defender: { firstStrikeMin: 8, cooldownMin: 4, minCombat: 7, group: 4, baseAfter: 0.6, probe: 0.42, strikeMin: 4, reach: 300, pressOn: false, keepHome: 99 },
    attacker: { firstStrikeMin: 4, cooldownMin: 1.5, minCombat: 8, group: 8, baseAfter: 0, probe: 0.95, strikeMin: 6, reach: 1000, pressOn: true, keepHome: 4 },
  },
  black_grail: {
    attacker: { holdHome: false, sallyRatio: 0, bridgePlague: true },
    defender: { holdHome: true, sallyRatio: 1.6, bridgePlague: false },
  },
  iron_sultanate: {
    defender: { holdHome: true, firstPushSec: 150, waveSize: 4, reserve: 4, buildPlan: 'sultanate' },
    attacker: { holdHome: false, firstPushSec: 35, waveSize: 7, reserve: 2, buildPlan: 'sultanate' },
  },
};

export function strategyFor(faction, role) {
  const s = STRATEGY[faction];
  return (s && (s[role] || s.defender)) || {};
}
