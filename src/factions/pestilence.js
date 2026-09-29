// PESTILENCE (Black Grail, Phase 3): a faction-wide 0..100 momentum meter, separate from biomass.
// Biomass is matter (units, buildings); Pestilence is how well the plague is spreading right now.
//  gains: infection stacks on enemies / civilians, animals killed by the Grail, infected corpses,
//         risen Thralls, standing plague pits, infected territory
//  losses: burned corpses, sanitation / cleansed ground, cured stacks, destroyed plague
//          structures, long stretches without any success
//  tiers (data): DORMANT / FESTERING / OUTBREAK / PLAGUE TIDE / GREAT PESTILENCE READY — each tier
//  strengthens the plague systems (spread, reanimation speed, swarm); the Great Pestilence spends
//  most of the meter, so it never snowballs permanently.
// Also home of addInfection(): the single entry point for infection stacks (auras / specialities /
// statistics apply uniformly, whatever the source: blades, swarm, ground, heralds, clouds).
//
// Phase 5A — PER SIDE: every meter call names the plague SIDE it belongs to (a Black Grail mirror
// match has two separate meters). Infection stacks remember who laid them (soldier m.infBy), an
// infected corpse remembers who claimed it (corpse c.plague) and every infected ground cell has an
// owner layer (state.infection.o: sideIndex + 1, 0 = nobody) — so reanimation, harvest, territory
// credit, cures and burning always hit the right side. Omitting the side falls back to the first
// plague side (single-plague matches, tests).
import { PESTILENCE } from '../data/specialities.js';
import { sideDef, sideIndex } from '../data/factions.js';
import { STRUCTURES } from '../data/structures.js';
import { EV } from '../core/events.js';
import { rngFloat } from '../core/rng.js';
import { dist } from '../core/dmath.js';
import { INFECTION_MAX, TICK_RATE } from '../sim/constants.js';
import { specValue } from '../sim/specialities.js';

/** Does this side own a Pestilence meter (faction data flag)? */
export function isPlagueSide(state, side) {
  const d = side && sideDef(side);
  return !!(d && d.pestilence && state.factions[side]);
}

/** Plague sides of the match, in slot order. */
export function plagueSides(state) {
  const out = [];
  for (const s of state.sides || []) if (isPlagueSide(state, s.id)) out.push(s.id);
  if (!state.sides) for (const id in state.factions) if (isPlagueSide(state, id)) out.push(id);
  return out;
}

/** The first plague side (single-plague convenience), or null. */
export function plagueFaction(state) {
  for (const s of state.sides || []) if (isPlagueSide(state, s.id)) return s.id;
  if (!state.sides) for (const id in state.factions) if (isPlagueSide(state, id)) return id;
  return null;
}

function ps(state, side) {
  return side && isPlagueSide(state, side) ? side : side ? null : plagueFaction(state);
}

/** Soldiers of this side cannot carry infection stacks (faction data flag). */
export function plagueImmune(side) {
  const d = sideDef(side);
  return !!(d && d.plagueImmune);
}

/** The side whose plague layer owns ground cell i (null when nobody). */
export function cellOwner(state, i) {
  const o = state.infection.o;
  const layer = o ? o[i] - 1 : -1;
  if (layer < 0) return o ? null : plagueFaction(state);
  for (const s of state.sides || []) if (sideIndex(s.id) === layer) return s.id;
  return null;
}

export function pestTierOf(value) {
  let t = 0;
  PESTILENCE.tiers.forEach((tier, i) => { if (value >= tier.at - 1e-9) t = i; });
  return t;
}

/** Current tier index of a plague side (0 when none). */
export function pestTier(state, side) {
  const fid = ps(state, side);
  return fid ? pestTierOf(state.factions[fid].pestilence || 0) : 0;
}

function setPest(sim, f, v) {
  const before = pestTierOf(f.pestilence || 0);
  f.pestilence = v < 0 ? 0 : v > PESTILENCE.max ? PESTILENCE.max : v;
  if (f.pestilence > (f.stats.pestMax || 0)) f.stats.pestMax = f.pestilence;
  const after = pestTierOf(f.pestilence);
  if (after !== before) {
    f.pestTier = after;
    const first = f.stats.pestTierTick;
    if (after > before && first && first[after] < 0) first[after] = sim.state.tick;
    sim.events.push({ type: EV.PESTILENCE_TIER, faction: f.id, tier: after, up: after > before ? 1 : 0, value: f.pestilence });
  }
}

/** Gain pacing: harder at higher tiers, slower in long wars (data: PESTILENCE.tierGain / pace*). */
export function pestPace(state, value) {
  const k = PESTILENCE.tierGain[pestTierOf(value)];
  const war = state.match.warMinutes || PESTILENCE.paceRefMinutes;
  const p = PESTILENCE.paceRefMinutes / war;
  return (k === undefined ? 1 : k) * (p < PESTILENCE.paceMin ? PESTILENCE.paceMin : p > PESTILENCE.paceMax ? PESTILENCE.paceMax : p);
}

/** Meter gain; `src` tags the statistic (stats.pestBy: what fed the plague). */
export function pestGain(sim, amount, src = 'other', side) {
  const fid = ps(sim.state, side);
  if (!fid || amount <= 0) return;
  const f = sim.state.factions[fid];
  const before = f.pestilence || 0;
  setPest(sim, f, before + amount * specValue(sim.state, fid, 'pestGain', 1) * pestPace(sim.state, before));
  const by = f.stats.pestBy || (f.stats.pestBy = {});
  by[src] = (by[src] || 0) + (f.pestilence - before);
  f.pestLastGain = sim.state.tick;
}

/** Meter loss; `src` tags the statistic (stats.pestLostBy). */
export function pestLoss(sim, amount, src = 'other', side) {
  const fid = ps(sim.state, side);
  if (!fid || amount <= 0) return;
  const f = sim.state.factions[fid];
  const before = f.pestilence || 0;
  setPest(sim, f, before - amount);
  const by = f.stats.pestLostBy || (f.stats.pestLostBy = {});
  by[src] = (by[src] || 0) + (before - f.pestilence);
}

/** Spend meter (Great Pestilence). */
export function pestSpend(sim, amount, side) {
  pestLoss(sim, amount, 'spent', side);
}

// ------------------------------------------------------------------ tier effects (read by plague systems)

export function spreadMult(state, side) {
  const fid = ps(state, side);
  const t = pestTier(state, fid);
  let k = t >= 1 ? PESTILENCE.festering.spread : 1;
  if (fid) k *= specValue(state, fid, 'infectSpread', 1);
  return k;
}

export function reanimDelayMult(state, side) {
  const fid = ps(state, side);
  const t = pestTier(state, fid);
  let k = t >= 2 ? PESTILENCE.outbreak.reanimDelay : 1;
  if (fid) k *= specValue(state, fid, 'reanimDelay', 1);
  return k;
}

export function swarmDpsMult(state, side) {
  return pestTier(state, ps(state, side)) >= 2 ? PESTILENCE.outbreak.swarmDps : 1;
}

export function claimBonus(state, side) {
  return pestTier(state, ps(state, side)) >= 2 ? PESTILENCE.outbreak.claimBonus : 0;
}

export function swarmCooldownMult(state, side) {
  const fid = ps(state, side);
  let k = pestTier(state, fid) >= 3 ? PESTILENCE.tide.swarmCooldown : 1;
  if (fid) k *= specValue(state, fid, 'swarmCooldown', 1);
  return k;
}

export function turnDelayTicks(state, side) {
  const fid = ps(state, side);
  const k = (pestTier(state, fid) >= 3 ? PESTILENCE.tide.turnDelay : 1) * reanimDelayMult(state, fid);
  return Math.round(PESTILENCE.turnDelaySec * TICK_RATE * k);
}

// ------------------------------------------------------------------ infection entry point

/**
 * Add n infection stacks to soldier m of squad sq (never to a plague-immune faction). Clerics'
 * auras and the Faith speciality resist stacks (resistance, never immunity); every stack that
 * lands feeds the Pestilence meter of `by` (the infecting side; the soldier remembers it as
 * m.infBy). Returns the stacks actually added.
 */
export function addInfection(sim, sq, m, n, by) {
  if (n <= 0 || plagueImmune(sq.faction)) return 0;
  if (m.state !== 'alive' && m.state !== 'joining' && m.state !== 'wounded') return 0;
  const { state } = sim;
  let resist = specValue(state, sq.faction, 'infectResist', 1) * auraResist(sim, m.x, m.z, sq.faction);
  if (m.slow > state.tick) resist *= 0.5; // under a medic's care: the plague progresses slower
  let added = 0;
  for (let k = 0; k < n; k++) {
    if (m.infection >= INFECTION_MAX) break;
    if (resist < 1 && rngFloat(state.rng.eco) >= resist) continue;
    m.infection++;
    added++;
  }
  if (added) {
    const src = ps(state, by);
    if (src) m.infBy = src;
    pestGain(sim, added * (sq.type === 'civilians' ? PESTILENCE.gain.civilianStack : PESTILENCE.gain.soldierStack), 'stacks', src || m.infBy);
  }
  return added;
}

/** Infection resistance multiplier from own support auras (Trench Cleric) at a point. */
export function auraResist(sim, x, z, faction) {
  const list = sim.rt.auras && sim.rt.auras[faction];
  if (!list) return 1;
  let k = 1;
  for (const a of list) {
    if (!a.infectResist) continue;
    if (dist(a.x, a.z, x, z) <= a.r) k = Math.min(k, a.infectResist);
  }
  return k;
}

// ------------------------------------------------------------------ ground

export function infectionCellAt(state, x, z) {
  const inf = state.infection;
  const cx = Math.floor(x / inf.cs), cz = Math.floor(z / inf.cs);
  if (cx < 0 || cz < 0 || cx >= inf.cols || cz >= inf.rows) return -1;
  return cz * inf.cols + cx;
}

/** Scour infected ground (fire, sanitation, purge): lowers cells within r; the owners lose momentum. */
export function cleanseInfection(sim, x, z, r, amount) {
  const inf = sim.state.infection;
  let lost = null;
  const R = Math.ceil(r / inf.cs);
  const cx = Math.floor(x / inf.cs), cz = Math.floor(z / inf.cs);
  let cleaned = 0;
  for (let dz = -R; dz <= R; dz++) {
    for (let dx = -R; dx <= R; dx++) {
      const gx = cx + dx, gz = cz + dz;
      if (gx < 0 || gz < 0 || gx >= inf.cols || gz >= inf.rows) continue;
      const wx = (gx + 0.5) * inf.cs, wz = (gz + 0.5) * inf.cs;
      if (dist(wx, wz, x, z) > r + inf.cs * 0.5) continue;
      const i = gz * inf.cols + gx;
      const v = inf.v[i];
      if (!v) continue;
      const nv = v > amount ? v - amount : 0;
      if (v >= 60 && nv < 60) {
        cleaned++;
        const owner = cellOwner(sim.state, i);
        if (owner) { if (!lost) lost = {}; lost[owner] = (lost[owner] || 0) + 1; }
      }
      inf.v[i] = nv;
      if (!nv && inf.o) inf.o[i] = 0;
    }
  }
  // deterministic order: the match's side order
  if (lost) for (const s of plagueSides(sim.state)) if (lost[s]) pestLoss(sim, lost[s] * PESTILENCE.loss.cleanCell, 'cleansed', s);
  return cleaned;
}

/** Plague burst on the ground (Great Pestilence) — the ground becomes `side`'s. */
export function seedInfection(sim, x, z, r, amount, side) {
  const inf = sim.state.infection;
  const layer = inf.o ? sideIndex(ps(sim.state, side) || '') + 1 : 0;
  const R = Math.ceil(r / inf.cs);
  const cx = Math.floor(x / inf.cs), cz = Math.floor(z / inf.cs);
  for (let dz = -R; dz <= R; dz++) {
    for (let dx = -R; dx <= R; dx++) {
      const gx = cx + dx, gz = cz + dz;
      if (gx < 0 || gz < 0 || gx >= inf.cols || gz >= inf.rows) continue;
      const d = dist((gx + 0.5) * inf.cs, (gz + 0.5) * inf.cs, x, z);
      if (d > r) continue;
      const i = gz * inf.cols + gx;
      const v = inf.v[i] + Math.round(amount * (1 - d / (r + 1)));
      inf.v[i] = v > 255 ? 255 : v;
      if (layer > 0 && inf.v[i]) inf.o[i] = layer;
    }
  }
}

// ------------------------------------------------------------------ periodic (1 Hz)

/**
 * Plague structures and infected territory keep the meter fed; long failure lets it drain.
 * `infectedCells`: cells >= 120 counted by the infection update (passed in to avoid a rescan).
 */
export function updatePestilence(sim, fid, infectedCells) {
  const { state } = sim;
  const f = state.factions[fid];
  if (!isPlagueSide(state, fid) || state.match.phase !== 'WAR') return;
  const G = PESTILENCE.gain;
  let pits = 0;
  for (const st of state.structures) {
    if (st.faction !== fid || !st.built) continue;
    if (STRUCTURES[st.type].infectionSource && st.type !== 'grail_altar') pits++;
  }
  let gain = pits * G.pitPerSec;
  if (infectedCells) gain += Math.min(G.territoryMax, infectedCells * G.territoryPerCell);
  if (gain > 0) {
    // territory / pits sustain the meter but do not count as "success" for the idle drain
    const last = f.pestLastGain;
    pestGain(sim, gain, 'ground', fid);
    f.pestLastGain = last;
  }
  // long plague failure: no infection / infected dead / rising for a while -> the meter drains
  const L = PESTILENCE.loss;
  if (state.tick - (f.pestLastGain || 0) > L.idleAfterSec * TICK_RATE && state.tick % (10 * TICK_RATE) < TICK_RATE) {
    pestLoss(sim, L.idleDecayPer10s * specValue(state, fid, 'pestDecay', 1), 'idle', fid);
  }
}

/** A plague structure / altar lost: the plague loses momentum. */
export function onGrailStructureLost(sim, st) {
  if (!isPlagueSide(sim.state, st.faction) || !st.built) return;
  const L = PESTILENCE.loss;
  const s = st.faction;
  if (st.type === 'grail_altar') pestLoss(sim, L.altarDestroyed, 'structures', s);
  else if (st.type === 'plague_pit') pestLoss(sim, L.pitDestroyed, 'structures', s);
  else pestLoss(sim, L.structDestroyed, 'structures', s);
}
