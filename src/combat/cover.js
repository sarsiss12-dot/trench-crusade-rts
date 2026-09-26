// Cover evaluation. Sources: terrain (crater/forest/ruins from world grid) + structures
// (trench corridor from segment data, directional sandbag lines). Data-driven via data/cover.js.
import { COVER_TYPES, COVER_IDS, COVER_INDEX } from '../data/cover.js';
import { STRUCTURES } from '../data/structures.js';
import { structGridQuery } from '../world/structgrid.js';
import { cellIndex } from '../world/terrain.js';
import { pointInTrench, trenchCoverStrength } from '../construction/trench.js';
import { clamp } from '../core/dmath.js';

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

/**
 * Best (non-directional) cover index at a position — used for HUD "active cover" and as the
 * soldier's cover state. Sandbags count when the soldier stands close behind a line.
 */
export function coverAt(sim, x, z) {
  const t = sim.world.terrain;
  const ci = cellIndex(t, x, z);
  let best = ci >= 0 ? t.cover[ci] : 0;
  near.length = 0;
  structGridQuery(sim.rt.structGrid, x, z, 2.5, near);
  for (let i = 0; i < near.length; i++) {
    const s = near[i];
    if (s.type === 'trench') {
      if (pointInTrench(s, x, z) && trenchCoverStrength(s) >= 0.35) {
        if (levelOf(COVER_INDEX.trench) > levelOf(best)) best = COVER_INDEX.trench;
      }
    } else if (s.type === 'sandbags' && structureEffective(s)) {
      const side = Math.abs(lineSide(s, x, z));
      if (side <= STRUCTURES.sandbags.coverRadius && alongSpan(s, x, z, 0.6)) {
        if (levelOf(COVER_INDEX.sandbag) > levelOf(best)) best = COVER_INDEX.sandbag;
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
  near.length = 0;
  structGridQuery(sim.rt.structGrid, x, z, 2.5, near);
  for (let i = 0; i < near.length; i++) {
    const s = near[i];
    if (s.type === 'trench') {
      if (!pointInTrench(s, x, z)) continue;
      const k = trenchCoverStrength(s);
      const c = COVER_TYPES.trench;
      if (c.dmgReduction * k > dmg) { dmg = c.dmgReduction * k; acc = Math.max(acc, c.accPenalty * k); cov = COVER_INDEX.trench; }
    } else if (s.type === 'sandbags' && structureEffective(s)) {
      const sv = lineSide(s, x, z);
      if (Math.abs(sv) > STRUCTURES.sandbags.coverRadius || !alongSpan(s, x, z, 0.6)) continue;
      const sa = lineSide(s, ax, az);
      if (sv * sa >= 0) continue; // attacker on the same side: no protection
      const k = clamp(s.hp / s.maxHp + 0.3, 0.3, 1);
      const c = COVER_TYPES.sandbag;
      if (c.dmgReduction * k > dmg) { dmg = c.dmgReduction * k; acc = Math.max(acc, c.accPenalty * k); cov = COVER_INDEX.sandbag; }
    }
  }
  out.dmg = dmg;
  out.acc = acc;
  out.cover = cov;
  return out;
}
