// OPERATIONAL LULL / REORGANIZATION (Phase 4). The match flow becomes
//   PREPARATION -> WAR I -> LULL -> WAR II (-> LULL -> WAR III) -> END
// while the stored phase stays 'WAR' for every war mechanic (damage, economy, production go on);
// state.match.lull.active marks the lull. During a lull:
//  - new attack orders, attack-moves and offensive abilities are refused (plain moves, building,
//    repair, reinforcement, training, foraging, sanitation all work)
//  - fights already joined are settled for LULL.graceSec, then nobody starts a new engagement except
//    on its OWN ground (deployment zone or next to its structures) — troops left inside the enemy's
//    lines are NOT immortal: they are shot and may shoot back in self-defence while they withdraw
//  - the war timer is frozen (the lull's length is added to the war end): no free time for either side
// Timing: seeded from the match seed (hash, no RNG stream consumed), hidden from the players; a
// PHASE_WARNING event gives 8-12 s notice. Everything is plain state (saves / replays agree).
import { LULL, lullsFor } from '../data/scenarios.js';
import { ABILITIES } from '../data/abilities.js';
import { hash32 } from '../core/rng.js';
import { EV } from '../core/events.js';
import { TICK_RATE } from './constants.js';

const OFFENSIVE = new Set(['artillery_barrage', 'mortar_barrage', 'fly_swarm', 'great_pestilence', 'black_tide']);

function frac(seed, k) {
  return hash32(seed >>> 0, 0x10ca + k, 0x5eed) / 4294967296;
}

/** Plan for a match: [{ at, dur, warn }] in ticks; `at` counts war time without lulls. */
export function planLulls(seed, warMinutes, count) {
  const n = count === 'auto' || count === undefined ? lullsFor(warMinutes) : Math.max(0, Math.min(2, count | 0));
  const warTicks = warMinutes * 60 * TICK_RATE;
  const plan = [];
  const k = Math.max(0, Math.min(1, (warMinutes - 10) / 50)); // longer wars: longer lulls
  for (let i = 0; i < n; i++) {
    const w = LULL.windows[n === 1 ? 0 : i];
    const at = Math.round(warTicks * (w[0] + (w[1] - w[0]) * frac(seed, i * 3)));
    const durSec = LULL.durationSec[0] + (LULL.durationSec[1] - LULL.durationSec[0]) * (0.6 * k + 0.4 * frac(seed, i * 3 + 1));
    const warnSec = LULL.warnSec[0] + (LULL.warnSec[1] - LULL.warnSec[0]) * frac(seed, i * 3 + 2);
    plan.push({ at, dur: Math.round(durSec * TICK_RATE), warn: Math.round(warnSec * TICK_RATE) });
  }
  return plan;
}

export function createLullState(seed, warMinutes, count) {
  return { plan: planLulls(seed, warMinutes, count), idx: 0, active: 0, start: 0, end: 0, warned: 0, endWarned: 0, elapsed: 0, ext: 0 };
}

export function isLull(state) {
  const l = state.match.lull;
  return !!(l && l.active);
}

/** Past the grace period of the current lull: no new engagements off one's own ground. */
export function lullQuiet(state) {
  const l = state.match.lull;
  return !!(l && l.active && state.tick - l.start >= LULL.graceSec * TICK_RATE);
}

/** War ticks elapsed, lull time excluded (drives the lull schedule and match progress). */
export function warTicks(state) {
  const m = state.match;
  const l = m.lull;
  return Math.max(0, state.tick - m.prepEndTick - (l ? l.elapsed : 0));
}

/** Own ground of a faction: its deployment zone, or close to one of its standing structures. */
export function inOwnGround(sim, fid, x, z) {
  const zone = sim.world.zones && sim.world.zones[fid];
  if (zone && x >= zone.x0 && x <= zone.x1 && z >= zone.z0 && z <= zone.z1) return true;
  const r2 = LULL.ownRadius * LULL.ownRadius;
  for (const st of sim.state.structures) {
    if (st.faction !== fid || st.hp <= 0 || !st.built) continue;
    const dx = st.x - x, dz = st.z - z;
    if (dx * dx + dz * dz <= r2) return true;
  }
  return false;
}

/** May a squad (or structure, fid) engage a target standing at (x, z) right now? */
export function lullAllowsTarget(sim, fid, x, z, lastHitTick) {
  if (!lullQuiet(sim.state)) return true;
  if (inOwnGround(sim, fid, x, z)) return true;
  return lastHitTick !== undefined && sim.state.tick - lastHitTick < LULL.selfDefenseTicks;
}

/** Commands refused during a lull (reason key) — attacks, attack-moves, offensive abilities. */
export function lullRefusal(sim, cmd) {
  if (!isLull(sim.state)) return null;
  if (cmd.type === 'ATTACK') return 'lull.no_attack';
  if (cmd.type === 'MOVE' && cmd.attackMove) return 'lull.no_attack';
  if (cmd.type === 'USE_ABILITY' && (OFFENSIVE.has(cmd.ability) || (ABILITIES[cmd.ability] && ABILITIES[cmd.ability].offensive))) return 'lull.no_attack';
  if (cmd.type === 'FIRE_MISSION') return 'lull.no_attack';
  return null;
}

/** Per tick (WAR only): warnings, start, grace-end clean-up, end. */
export function updateLull(sim) {
  const { state } = sim;
  const m = state.match;
  const l = m.lull;
  if (!l || m.phase !== 'WAR') return;
  if (l.active) {
    l.elapsed++;
    if (state.tick === l.start + LULL.graceSec * TICK_RATE) settleFights(sim);
    if (!l.endWarned && state.tick >= l.end - LULL.endWarnSec * TICK_RATE) {
      l.endWarned = 1;
      sim.events.push({ type: EV.PHASE_WARNING, phase: 'WAR', inSec: LULL.endWarnSec });
    }
    if (state.tick >= l.end) {
      l.active = 0;
      l.idx++;
      l.warned = 0; l.endWarned = 0;
      sim.events.push({ type: EV.PHASE_CHANGED, phase: 'WAR', afterLull: l.idx });
    }
    return;
  }
  const next = l.plan[l.idx];
  if (!next) return;
  const w = warTicks(state);
  if (!l.warned && w >= next.at - next.warn) {
    l.warned = 1;
    sim.events.push({ type: EV.PHASE_WARNING, phase: 'LULL', inSec: Math.round(next.warn / TICK_RATE) });
  }
  if (w >= next.at) {
    l.active = 1;
    l.start = state.tick;
    l.end = state.tick + next.dur;
    l.ext += next.dur;
    m.warEndTick += next.dur; // the war clock stands still during the lull
    sim.events.push({ type: EV.PHASE_CHANGED, phase: 'LULL', lull: l.idx + 1, duration: Math.round(next.dur / TICK_RATE) });
  }
}

/** Grace over: explicit attacks on targets off one's own ground end (the squads hold). */
function settleFights(sim) {
  const { state, rt } = sim;
  for (const sq of state.squads) {
    const o = sq.order;
    if (o.t === 'attack') {
      const tgt = o.tk === 'squad' ? rt.squadById.get(o.tid) : rt.structById.get(o.tid);
      const x = tgt ? (o.tk === 'squad' ? tgt.cx : tgt.x) : sq.x, z = tgt ? (o.tk === 'squad' ? tgt.cz : tgt.z) : sq.z;
      if (!tgt || !inOwnGround(sim, sq.faction, x, z)) { sq.order = { t: 'idle' }; sq.target = null; sq.engaged = false; sq.melee = false; }
    } else if (o.t === 'move' && o.am) o.am = 0;
  }
}
