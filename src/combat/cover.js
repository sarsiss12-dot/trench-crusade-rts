// Cover evaluation. Sources: terrain (crater/forest/ruins from world grid) + structures
// (trench corridor from segment data, directional sandbag lines). Data-driven via data/cover.js.
import { COVER_TYPES, COVER_IDS, COVER_INDEX } from '../data/cover.js';
import { STRUCTURES } from '../data/structures.js';
import { structGridQuery } from '../world/structgrid.js';
import { cellIndex } from '../world/terrain.js';
import { pointInTrench, trenchCoverStrength } from '../construction/trench.js';
import { clamp } from '../core/dmath.js';
import { insideRuin } from '../world/ruin_geometry.js';

const near = [];

function levelOf(idx) {
  return COVER_TYPES[COVER_IDS[idx]].level;
}

/** Sandbag line side test: returns signed distance of point to the line (left normal). */
function lineSide(s, x, z) {
  const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
  const len = Math.sqrt(dx * dx + dz * dz) || 1e-6;
  return ((x - s.x1) * -dz + (z - s.z1) * dx) / len;
}

function alongSpan(s, x, z, margin) {
  const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? ((x - s.x1) * dx + (z - s.z1) * dz) / len2 : 0;
  const len = Math.sqrt(len2);
  return t * len >= -margin && t * len <= len + margin;
}

function structureEffective(s) {
  return s.built || s.progress >= 0.5;
}

/** Cover index a soldier standing in a (known) shell crater gets. Bounded list (MAX_CRATERS). */
function craterCover(sim, x, z) {
  const cr = sim.state.craters;
  if (!cr || !cr.length) return 0;
  for (let i = 0; i < cr.length; i++) {
    const c = cr[i];
    const dx = x - c.x, dz = z - c.z;
    const rr = c.r * 0.85;
    if (dx * dx + dz * dz <= rr * rr) return COVER_INDEX.crater;
  }
  return 0;
}

/**
 * Ruin garrison cover (Phase 4) at a point: strength 0..1 (0 = not inside a standing garrison
 * ruin). Scales with the ruin's remaining hit points (a battered ruin shelters less).
 */
export function garrisonCoverAt(sim, s, x, z) {
  const d = STRUCTURES[s.type];
  if (!d.garrison || s.collapsed || s.ruin === undefined) return 0;
  const r = sim.world.ruins[s.ruin];
  if (!r || !insideRuin(r, x, z, 0.2)) return 0;
  return clamp(s.hp / s.maxHp + 0.35, 0.4, 1);
}

/** A wall-family line (sandbags, low sandbags, breastwork, timber / fortified wall, bone barricade). */
function wallDef(s) {
  const d = STRUCTURES[s.type];
  return d.kind === 'linear' && d.cover && d.cover !== 'trench' ? d : null;
}

/**
 * Best (non-directional) cover index at a position — used for HUD "active cover" and as the
 * soldier's cover state. Wall lines count when the soldier stands close behind one.
 */
export function coverAt(sim, x, z) {
  const t = sim.world.terrain;
  const ci = cellIndex(t, x, z);
  let best = ci >= 0 ? t.cover[ci] : 0;
  const cc = craterCover(sim, x, z);
  if (cc && levelOf(cc) > levelOf(best)) best = cc;
  near.length = 0;
  structGridQuery(sim.rt.structGrid, x, z, 2.5, near);
  for (let i = 0; i < near.length; i++) {
    const s = near[i];
    if (STRUCTURES[s.type].garrison && garrisonCoverAt(sim, s, x, z) > 0) {
      if (levelOf(COVER_INDEX.garrison) >= levelOf(best)) best = COVER_INDEX.garrison;
      continue;
    }
    if (s.type === 'trench') {
      if (pointInTrench(s, x, z) && trenchCoverStrength(s) >= 0.35) {
        if (levelOf(COVER_INDEX.trench) > levelOf(best)) best = COVER_INDEX.trench;
      }
      continue;
    }
    const wd = wallDef(s);
    if (wd && structureEffective(s)) {
      const side = Math.abs(lineSide(s, x, z));
      if (side <= (wd.coverRadius || 1.8) && alongSpan(s, x, z, 0.6)) {
        const idx = COVER_INDEX[wd.cover];
        if (levelOf(idx) > levelOf(best)) best = idx;
      }
    }
  }
  return best;
}

/**
 * Effective protection of a soldier at (x,z) against an attacker at (ax,az).
 * out.dmg = damage reduction, out.acc = accuracy penalty for the attacker, out.cover = index.
 */
export function protectionAgainst(sim, x, z, ax, az, out) {
  const t = sim.world.terrain;
  const ci = cellIndex(t, x, z);
  let dmg = 0, acc = 0, cov = 0;
  if (ci >= 0 && t.cover[ci]) {
    const c = COVER_TYPES[COVER_IDS[t.cover[ci]]];
    dmg = c.dmgReduction; acc = c.accPenalty; cov = t.cover[ci];
  }
  const cc = craterCover(sim, x, z);
  if (cc) {
    const c = COVER_TYPES.crater;
    if (c.dmgReduction > dmg) { dmg = c.dmgReduction; acc = Math.max(acc, c.accPenalty); cov = cc; }
  }
  near.length = 0;
  structGridQuery(sim.rt.structGrid, x, z, 2.5, near);
  for (let i = 0; i < near.length; i++) {
    const s = near[i];
    if (STRUCTURES[s.type].garrison) {
      // inside a garrison ruin; an attacker inside the same walls gets no benefit from them
      const k = garrisonCoverAt(sim, s, x, z);
      if (k > 0 && garrisonCoverAt(sim, s, ax, az) === 0) {
        const c = COVER_TYPES.garrison;
        if (c.dmgReduction * k > dmg) { dmg = c.dmgReduction * k; acc = Math.max(acc, c.accPenalty * k); cov = COVER_INDEX.garrison; }
      }
      continue;
    }
    if (s.type === 'trench') {
      if (!pointInTrench(s, x, z)) continue;
      const k = trenchCoverStrength(s);
      const c = COVER_TYPES.trench;
      if (c.dmgReduction * k > dmg) { dmg = c.dmgReduction * k; acc = Math.max(acc, c.accPenalty * k); cov = COVER_INDEX.trench; }
      continue;
    }
    const wd = wallDef(s);
    if (!wd || !structureEffective(s)) continue;
    const sv = lineSide(s, x, z);
    if (Math.abs(sv) > (wd.coverRadius || 1.8) || !alongSpan(s, x, z, 0.6)) continue;
    const sa = lineSide(s, ax, az);
    if (sv * sa >= 0) continue; // attacker on the same side: no protection
    const k = clamp(s.hp / s.maxHp + 0.3, 0.3, 1);
    const c = COVER_TYPES[wd.cover];
    if (c.dmgReduction * k > dmg) { dmg = c.dmgReduction * k; acc = Math.max(acc, c.accPenalty * k); cov = COVER_INDEX[wd.cover]; }
  }
  out.dmg = dmg;
  out.acc = acc;
  out.cover = cov;
  return out;
}
