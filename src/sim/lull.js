// OPERATIONAL REORGANISATION ("LULL") — Phase 4, reworked in 4.1: NEVER a forced ceasefire.
//   PREPARATION -> WAR (-> reorganisation window -> WAR -> window -> ...) -> END
// The stored phase stays 'WAR'. During a window NOTHING is refused and no targeting rule changes:
// attacks, attack-moves, artillery / fire missions, enemy assaults all work as always. The window
// only rewards reorganising — units / structures OUT OF COMBAT (not hit for LULL.outOfCombatSec):
//  - construction and repair work faster (lullBonus 'build' / 'repair')
//  - replacements walk out more often, resupply flows faster ('reinfInterval' / 'resupply')
//  - suppression wears off faster ('suppressRecover')
// The AI may regroup, but it may also attack and punish an opening.
// Timing: seeded from the match seed (hash, no RNG stream consumed), hidden (an 8-12 s warning):
// the first window LULL.firstMin into the war, then every LULL.everyMin; the plan is computed per
// index (no list), so an endless war simply keeps getting windows. The war clock keeps running.
// Plain state: { idx, active, start, end, warned, endWarned, cap } (saves / replays agree).
import { LULL } from '../data/scenarios.js';
import { hash32 } from '../core/rng.js';
import { EV } from '../core/events.js';
import { TICK_RATE } from './constants.js';

function frac(seed, k) {
  return hash32(seed >>> 0, 0x10ca + k, 0x5eed) / 4294967296;
}

/** Window i of a match: { at, dur, warn } in war ticks (null when the war holds no such window). */
export function lullWindow(seed, warMinutes, endless, cap, i) {
  if (cap !== 'auto' && cap !== undefined && i >= (cap | 0)) return null;
  if (!endless && warMinutes < LULL.minWarMinutes) return null;
  const first = LULL.firstMin[0] + (LULL.firstMin[1] - LULL.firstMin[0]) * frac(seed, 0);
  let atMin = first;
  for (let k = 1; k <= i; k++) atMin += LULL.everyMin[0] + (LULL.everyMin[1] - LULL.everyMin[0]) * frac(seed, k * 3);
  if (!endless && atMin > warMinutes - LULL.lastBeforeEndMin) return null;
  const durSec = LULL.durationSec[0] + (LULL.durationSec[1] - LULL.durationSec[0]) * frac(seed, i * 3 + 1);
  const warnSec = LULL.warnSec[0] + (LULL.warnSec[1] - LULL.warnSec[0]) * frac(seed, i * 3 + 2);
  return { at: Math.round(atMin * 60 * TICK_RATE), dur: Math.round(durSec * TICK_RATE), warn: Math.round(warnSec * TICK_RATE) };
}

/** First n windows (tests / tools). */
export function planLulls(seed, warMinutes, cap, n = 8, endless = false) {
  const out = [];
  for (let i = 0; i < n; i++) { const w = lullWindow(seed, warMinutes, endless, cap, i); if (!w) break; out.push(w); }
  return out;
}

export function createLullState(seed, warMinutes, cap, endless = false) {
  void seed; void warMinutes; void endless;
  return { idx: 0, active: 0, start: 0, end: 0, warned: 0, endWarned: 0, cap: cap === undefined ? 'auto' : cap };
}

export function isLull(state) {
  const l = state.match.lull;
  return !!(l && l.active);
}

/** War ticks elapsed (windows included — the war clock never stops). */
export function warTicks(state) {
  return Math.max(0, state.tick - state.match.prepEndTick);
}

/**
 * Reorganisation bonus multiplier for a unit / structure (1 outside a window or while in combat).
 * lastHitTick: when the unit / structure was last hit (undefined = never).
 */
export function lullBonus(state, key, lastHitTick) {
  const l = state.match.lull;
  if (!l || !l.active) return 1;
  if (lastHitTick !== undefined && state.tick - lastHitTick < LULL.outOfCombatSec * TICK_RATE) return 1;
  return LULL.bonus[key] || 1;
}

function windowOf(state, i) {
  const m = state.match;
  return lullWindow(state.seed, m.warMinutes, !!m.endless, m.lull.cap, i);
}

/** Per tick (WAR only): warning, start, end warning, end. Never touches orders or targeting. */
export function updateLull(sim) {
  const { state } = sim;
  const m = state.match;
  const l = m.lull;
  if (!l || m.phase !== 'WAR') return;
  if (l.active) {
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
  const next = windowOf(state, l.idx);
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
    sim.events.push({ type: EV.PHASE_CHANGED, phase: 'LULL', lull: l.idx + 1, duration: Math.round(next.dur / TICK_RATE) });
  }
}

/** Seconds until the current window ends (HUD). */
export function lullTimeLeft(state) {
  const l = state.match.lull;
  return l && l.active ? Math.max(0, (l.end - state.tick) / TICK_RATE) : 0;
}
