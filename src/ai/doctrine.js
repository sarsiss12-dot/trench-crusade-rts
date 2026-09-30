import { DOCTRINES, POLICY_DEFAULTS } from '../data/doctrines.js';
import { SPEC_BY_ID } from '../data/specialities.js';
import { baseFaction, areHostile, sideBit } from '../data/factions.js';
import { rngFloat } from '../core/rng.js';
import { clamp, dist } from '../core/dmath.js';
import { homeStructure } from '../sim/sides.js';

export function ensureDoctrine(sim, fid, ai) {
  const profiles = DOCTRINES[baseFaction(fid)] || [];
  if (!ai.doctrine && profiles.length) ai.doctrine = profiles[Math.floor(rngFloat(sim.state.rng.ai) * profiles.length)].id;
}
export function doctrineProfile(state, fid) {
  const id = state.ai[fid] && state.ai[fid].doctrine;
  return (DOCTRINES[baseFaction(fid)] || []).find((d) => d.id === id);
}
// Cached policy is runtime only. Recomputed only after a doctrine/choice change, never per soldier.
const CACHE = new WeakMap();
export function policyFor(state, fid) {
  let bySide = CACHE.get(state);
  if (!bySide) { bySide = new Map(); CACHE.set(state, bySide); }
  const f = state.factions[fid], profile = doctrineProfile(state, fid);
  const key = (profile ? profile.id : '') + ':' + (f.spec || []).join(',');
  const old = bySide.get(fid);
  if (old && old.key === key) return old.policy;
  const policy = { ...POLICY_DEFAULTS };
  const apply = (mods) => { if (mods) for (const k in mods) if (k in policy) policy[k] *= mods[k]; };
  apply(profile && profile.mods);
  for (const id of f.spec || []) apply(SPEC_BY_ID[id] && SPEC_BY_ID[id].ai);
  for (const k in policy) policy[k] = clamp(policy[k], 0.5, 3);
  bySide.set(fid, { key, policy });
  return policy;
}

// Visible information only. Recent losses, economy and damaged home oppose late-war pressure.
export function aggressionScore(sim, fid, ai) {
  const state = sim.state, bit = sideBit(fid), f = state.factions[fid];
  let own = 0, enemy = 0;
  const home = homeStructure(state, fid);
  for (const q of state.squads) {
    if (q.civ || q.autonomous) continue;
    let n = 0; for (const m of q.members) if (m.state === 'alive') n++;
    if (q.faction === fid) own += n;
    else if (areHostile(fid, q.faction) && (q.visibleTo & bit)) enemy += n;
  }
  const old = ai.strengthSample;
  if (!old || state.tick - old.tick >= 200) {
    ai.recentLosses = old ? Math.max(0, old.own - own) : 0;
    ai.strengthSample = { tick: state.tick, own };
  }
  ai.knownEnemyPeak = Math.max(enemy, (ai.knownEnemyPeak || 0) * 0.995);
  const known = Math.max(enemy, (ai.knownEnemyPeak || 0) * 0.65, 12);
  const damage = home && home.maxHp ? 1 - home.hp / home.maxHp : 1;
  let wealth = 0; for (const k in f.resources) wealth += f.resources[k];
  const pressure = clamp((state.tick - state.match.prepEndTick) / (20 * 60 * Math.max(5, state.match.warMinutes || 15)), 0, 1);
  const score = own / known + (f.role === 'attacker' ? 0.35 : 0) + pressure * 0.6 + (f.pestilence || 0) / 200
    - damage * 1.2 - (ai.recentLosses || 0) / Math.max(20, own) - (wealth < 60 ? 0.2 : 0);
  return clamp(score / policyFor(state, fid).sally, 0, 4);
}
