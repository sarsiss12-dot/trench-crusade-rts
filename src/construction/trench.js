// TRENCH SINGLE SOURCE OF TRUTH.
// A trench segment is stored in GameState as plain data:
//   { id, type:'trench', faction, x1, z1, x2, z2, front:(+1|-1), progress:0..1, built, hp, occ:[soldierId|0...] }
// Everything else is DERIVED here from those numbers:
//   - rendered geometry (render/models/fortifications.js calls trenchFrame/trenchDepth/trenchSlots)
//   - cover (combat/cover.js calls pointInTrench / trenchCoverStrength)
//   - occupancy slots (trenchSlots + occ array)
//   - collision/terrain (world/ground.js uses trenchFloorAt; nav uses trenchCellsVisit)
//   - minimap (ui/minimap.js draws trenchFrame endpoints)
// Rotation is implicit in the endpoints, so every consumer sees the same orientation.
import { STRUCTURES } from '../data/structures.js';
import { dist, clamp, pointSegment, datan2 } from '../core/dmath.js';
import { baseHeightAt } from '../world/terrain.js';

const TRENCH = STRUCTURES.trench;
const tmp = [0, 0];

/** Geometric frame of a segment. Writes into (and returns) `out`. */
export function trenchFrame(seg, out = {}) {
  const dx = seg.x2 - seg.x1, dz = seg.z2 - seg.z1;
  const len = Math.sqrt(dx * dx + dz * dz) || 1e-6;
  const ux = dx / len, uz = dz / len;
  // left normal of direction (-uz, ux); `front` picks which side faces the enemy
  const f = seg.front === -1 ? -1 : 1;
  out.cx = (seg.x1 + seg.x2) * 0.5;
  out.cz = (seg.z1 + seg.z2) * 0.5;
  out.len = len;
  out.ux = ux; out.uz = uz;
  out.nx = -uz * f; out.nz = ux * f;
  out.halfWidth = TRENCH.width * 0.5;
  return out;
}

/** Current dug depth (meters). Digging deepens the trench progressively. */
export function trenchDepth(seg) {
  const p = clamp(seg.progress, 0, 1);
  const base = TRENCH.depth * (seg.variant === 'old' ? 0.72 : 1);
  // first 20% of work is marking + scraping; depth grows afterwards
  return base * clamp((p - 0.05) / 0.95, 0, 1);
}

/** Cover multiplier 0..1 provided by this segment given its dig progress. */
export function trenchCoverStrength(seg) {
  const d = trenchDepth(seg) / TRENCH.depth;
  return clamp(d * 1.15, 0, 1);
}

/** Is point (x,z) inside the trench corridor? */
export function pointInTrench(seg, x, z, margin = 0) {
  pointSegment(tmp, x, z, seg.x1, seg.z1, seg.x2, seg.z2);
  return tmp[0] <= TRENCH.width * 0.5 + margin;
}

/** Distance from point to trench centerline. */
export function trenchDistance(seg, x, z) {
  pointSegment(tmp, x, z, seg.x1, seg.z1, seg.x2, seg.z2);
  return tmp[0];
}

/**
 * Trench floor height at (x,z), or NaN if outside the corridor. The floor is flat across the
 * corridor: base terrain height at the centerline point minus the dug depth (the rendered
 * trench floor uses the exact same rule).
 */
export function trenchFloorAt(seg, x, z, terrain) {
  pointSegment(tmp, x, z, seg.x1, seg.z1, seg.x2, seg.z2);
  const hw = TRENCH.width * 0.5;
  if (tmp[0] > hw) return NaN;
  const depth = trenchDepth(seg);
  if (depth <= 0.01) return NaN;
  const t = tmp[1];
  return baseHeightAt(terrain, seg.x1 + (seg.x2 - seg.x1) * t, seg.z1 + (seg.z2 - seg.z1) * t) - depth;
}

export function trenchSlotCount(seg) {
  const len = dist(seg.x1, seg.z1, seg.x2, seg.z2);
  return Math.max(1, Math.floor((len - 1.2) / TRENCH.slotSpacing) + 1);
}

/**
 * Occupancy slot k of a segment: position on the fire-step (front half) and facing heading.
 * out = { x, z, facing }
 */
export function trenchSlot(seg, k, out = {}) {
  const fr = trenchFrame(seg, SLOT_FRAME);
  const n = trenchSlotCount(seg);
  const usable = Math.max(0, fr.len - 1.2);
  const t = n > 1 ? -usable / 2 + (usable * k) / (n - 1) : 0;
  const inset = 0.32; // toward the front wall (fire-step)
  out.x = fr.cx + fr.ux * t + fr.nx * inset;
  out.z = fr.cz + fr.uz * t + fr.nz * inset;
  out.facing = headingFromVec(fr.nx, fr.nz);
  return out;
}
const SLOT_FRAME = {};

// heading convention: forward = (sin h, cos h)
function headingFromVec(x, z) {
  return datan2(x, z);
}

export function trenchSlots(seg) {
  const n = trenchSlotCount(seg);
  const res = [];
  for (let k = 0; k < n; k++) res.push(trenchSlot(seg, k, {}));
  return res;
}

/** Ensure occ array length matches slot count (e.g. after load/migration). */
export function ensureOccupancy(seg) {
  const n = trenchSlotCount(seg);
  if (!seg.occ || seg.occ.length !== n) {
    const old = seg.occ || [];
    seg.occ = new Array(n).fill(0);
    for (let i = 0; i < Math.min(n, old.length); i++) seg.occ[i] = old[i];
  }
  return seg.occ;
}

/** Are two segments connected (share an endpoint within tolerance)? */
export function trenchConnected(a, b, tol = 0.75) {
  return (
    dist(a.x1, a.z1, b.x1, b.z1) < tol || dist(a.x1, a.z1, b.x2, b.z2) < tol ||
    dist(a.x2, a.z2, b.x1, b.z1) < tol || dist(a.x2, a.z2, b.x2, b.z2) < tol
  );
}

/**
 * Snap a point to the nearest trench endpoint of `faction` within radius.
 * Returns [x,z] snapped or null. Used by placement UI and AI (same rule).
 */
export function snapToTrenchEndpoint(structures, faction, x, z, radius = 3) {
  let best = null, bestD = radius;
  for (const s of structures) {
    if (s.type !== 'trench' || (s.faction !== faction && faction !== 'any')) continue;
    const d1 = dist(x, z, s.x1, s.z1);
    if (d1 < bestD) { bestD = d1; best = [s.x1, s.z1]; }
    const d2 = dist(x, z, s.x2, s.z2);
    if (d2 < bestD) { bestD = d2; best = [s.x2, s.z2]; }
  }
  return best;
}

/**
 * Visit every terrain cell overlapped by a linear structure corridor (trench/sandbags/wire).
 * fn(cellIndex, distanceToCenterline). Used by nav + terrain carving: same footprint everywhere.
 */
export function linearCellsVisit(terrain, seg, halfWidth, fn) {
  const cell = terrain.cell;
  const minX = Math.min(seg.x1, seg.x2) - halfWidth, maxX = Math.max(seg.x1, seg.x2) + halfWidth;
  const minZ = Math.min(seg.z1, seg.z2) - halfWidth, maxZ = Math.max(seg.z1, seg.z2) + halfWidth;
  const cx0 = Math.max(0, Math.floor(minX / cell)), cx1 = Math.min(terrain.cols - 1, Math.floor(maxX / cell));
  const cz0 = Math.max(0, Math.floor(minZ / cell)), cz1 = Math.min(terrain.rows - 1, Math.floor(maxZ / cell));
  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const x = cx * cell + cell * 0.5, z = cz * cell + cell * 0.5;
      pointSegment(tmp, x, z, seg.x1, seg.z1, seg.x2, seg.z2);
      // cell overlaps corridor if center within halfWidth + half cell diagonal-ish
      if (tmp[0] <= halfWidth + cell * 0.5) fn(cz * terrain.cols + cx, tmp[0]);
    }
  }
}

/** Choose the front side so that the trench parapet faces `enemyDirZ` (e.g. -1 = north). */
export function chooseFront(x1, z1, x2, z2, towardX, towardZ) {
  const dx = x2 - x1, dz = z2 - z1;
  // left normal (-dz, dx)
  const dot = -dz * towardX + dx * towardZ;
  return dot >= 0 ? 1 : -1;
}
