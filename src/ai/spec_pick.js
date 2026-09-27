// AI speciality choice (Phase 3). When a tier opens, the faction picks one of its three options
// with situational weights (what the faction itself perceives) and a seeded roll (state.rng.ai),
// so matches differ but replays agree. Acts only through CHOOSE_SPECIALITY (plain command).
import { SPECIALITIES } from '../data/specialities.js';
import { availableTier } from '../sim/specialities.js';
import { rngFloat } from '../core/rng.js';
import { CMD } from '../sim/commands.js';
import { aiIssue } from './issue.js';

/**
 * weightsFor(tier, ids) -> { id: weight } (missing / negative = 0). One command per open tier;
 * a command still in flight (resolved next tick) is not repeated.
 */
export function aiPickSpeciality(sim, fid, ai, weightsFor) {
  const { state } = sim;
  const tier = availableTier(state, fid);
  if (tier < 0) return null;
  if (ai.specTier === tier && state.tick - (ai.specTick || 0) < 60) return null;
  const opts = SPECIALITIES[fid] && SPECIALITIES[fid][tier];
  if (!opts || !opts.length) return null;
  const w = weightsFor(tier, opts.map((o) => o.id)) || {};
  let total = 0;
  for (const o of opts) total += Math.max(0, w[o.id] || 0);
  let pick = opts[0].id;
  if (total > 0) {
    let r = rngFloat(state.rng.ai) * total;
    for (const o of opts) {
      r -= Math.max(0, w[o.id] || 0);
      if (r <= 0) { pick = o.id; break; }
    }
  }
  ai.specTier = tier;
  ai.specTick = state.tick;
  aiIssue(sim, { type: CMD.CHOOSE_SPECIALITY, faction: fid, tier, spec: pick });
  return pick;
}
