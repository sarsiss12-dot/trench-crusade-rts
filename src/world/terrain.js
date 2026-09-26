// Terrain grid: base heightfield (vertices) + per-cell terrain type / cover / flags.
// Static after map generation; dynamic battlefield changes (trenches, structures) live in the
// simulation state and are layered on top via world/ground.js queries.
import { TERRAIN_TYPES, TERRAIN } from '../data/terrain_types.js';
import { COVER_INDEX } from '../data/cover.js';

export const CELL_FLAG = Object.freeze({
  WATER: 1,
  CRATER: 2,
  ROAD: 4,
  FIELD: 8,
  RUIN: 16,
  PUDDLE: 32,
  EDGE: 64,
});

export function createTerrain(width, height, cell) {
  const cols = Math.floor(width / cell);
  const rows = Math.floor(height / cell);
  const vcols = cols + 1, vrows = rows + 1;
  return {
    width, height, cell, cols, rows, vcols, vrows,
    heights: new Float32Array(vcols * vrows),
    types: new Uint8Array(cols * rows),
    cover: new Uint8Array(cols * rows), // COVER_INDEX from terrain features (crater/forest/ruins)
    flags: new Uint8Array(cols * rows),
    blocked: new Uint8Array(cols * rows), // static blockers (standing ruin walls, houses)
    speed: new Float32Array(cols * rows), // derived terrain speed multiplier (0 = impassable)
    waterLevel: 0,
  };
}

export function cellIndex(t, x, z) {
  const cx = Math.floor(x / t.cell), cz = Math.floor(z / t.cell);
  if (cx < 0 || cz < 0 || cx >= t.cols || cz >= t.rows) return -1;
  return cz * t.cols + cx;
}

export function cellCenterX(t, idx) {
  return (idx % t.cols) * t.cell + t.cell * 0.5;
}

export function cellCenterZ(t, idx) {
  return Math.floor(idx / t.cols) * t.cell + t.cell * 0.5;
}

/** Bilinear base height (no trenches/bridges). */
export function baseHeightAt(t, x, z) {
  let fx = x / t.cell, fz = z / t.cell;
  if (fx < 0) fx = 0; else if (fx > t.cols - 0.0001) fx = t.cols - 0.0001;
  if (fz < 0) fz = 0; else if (fz > t.rows - 0.0001) fz = t.rows - 0.0001;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const ux = fx - ix, uz = fz - iz;
  const i0 = iz * t.vcols + ix;
  const h00 = t.heights[i0], h10 = t.heights[i0 + 1];
  const h01 = t.heights[i0 + t.vcols], h11 = t.heights[i0 + t.vcols + 1];
  return (h00 * (1 - ux) + h10 * ux) * (1 - uz) + (h01 * (1 - ux) + h11 * ux) * uz;
}

export function typeAt(t, x, z) {
  const i = cellIndex(t, x, z);
  return i < 0 ? TERRAIN.ROCK : t.types[i];
}

/** Recompute derived per-cell data (speed, cover defaults) after types change. */
export function deriveTerrainCells(t) {
  const n = t.cols * t.rows;
  for (let i = 0; i < n; i++) {
    const def = TERRAIN_TYPES[t.types[i]];
    t.speed[i] = t.blocked[i] ? 0 : def.speed;
    if (def.cover && t.cover[i] === 0) t.cover[i] = COVER_INDEX[def.cover];
  }
}

export function isCellPassable(t, idx) {
  return idx >= 0 && t.speed[idx] > 0;
}
