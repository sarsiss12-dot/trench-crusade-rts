// Ruin garrison geometry (Phase 4) — pure, deterministic, derived ONLY from the map ruin record
// (x, z, w, d, rot, kind) + its wall pieces (world/mapgen.js ruinPieces, the single source for nav,
// rendering and this). Gives every garrisonable ruin:
//  - ENTRANCES: doorway gaps in the walls (front door; the chapel also has a back door) with an
//    outside point (where a squad paths to) and an inside point (where soldiers step through)
//  - SLOTS: interior positions 0.9 m inside the walls; FIRING slots look out through broken wall /
//    window height, the rest are sheltered interior slots (safer, cannot shoot)
//  - inside test (cover, collapse casualties)
// Local frame (same as ruinPieces): world = (x - lx*c + lz*s, z + lx*s + lz*c); side 0 (front) is
// local z = -d/2, its outward normal is local -z.
import { dsin, dcos, dist, clamp, datan2 } from '../core/dmath.js';

export const GARRISON_KINDS = { house: true, chapel: true };
export const DOOR_OUT = 2.4; // m outside the wall line
export const DOOR_IN = 1.7; // m inside
const SLOT_INSET = 0.95;
const SLOT_SPACING = 1.45;

/** Which door pieces a ruin has: side 0 middle (all), side 2 middle (chapel back door). */
export function isDoorPiece(kind, side, k, nseg) {
  if (kind === 'wall') return false;
  if (k !== Math.floor(nseg / 2)) return false;
  return side === 0 || (side === 2 && kind === 'chapel');
}

function toWorld(r, lx, lz, out) {
  const s = dsin(r.rot), c = dcos(r.rot);
  out[0] = r.x - lx * c + lz * s;
  out[1] = r.z + lx * s + lz * c;
  return out;
}

function toLocal(r, x, z, out) {
  const s = dsin(r.rot), c = dcos(r.rot);
  const dx = x - r.x, dz = z - r.z;
  out[0] = -(c * dx - s * dz);
  out[1] = s * dx + c * dz;
  return out;
}

const L = [0, 0];

/** Point inside the ruin's walls (inset metres from the wall line; negative = a little outside). */
export function insideRuin(r, x, z, inset = 0.25) {
  toLocal(r, x, z, L);
  return Math.abs(L[0]) <= r.w / 2 - inset && Math.abs(L[1]) <= r.d / 2 - inset;
}

/**
 * Entrances of a ruin: [{ ox, oz, ix, iz, cx, cz }] (outside / inside / door centre), front first.
 * The door centre is the middle of the doorway piece (same rule as ruinPieces).
 */
export function ruinEntrances(r) {
  const out = [];
  const sides = r.kind === 'chapel' ? [0, 2] : [0];
  const hw = r.w / 2, hd = r.d / 2;
  for (const side of sides) {
    // the doorway piece of that side (ruinPieces: k = floor(nseg / 2) along the corner-to-corner edge)
    const len = r.w; // sides 0 and 2 run along the width
    const nseg = Math.max(2, Math.round(len / 2.2));
    const k = Math.floor(nseg / 2);
    const t = (k + 0.5) / nseg;
    // side 0: (-hw,-hd) -> (hw,-hd); side 2: (hw,hd) -> (-hw,hd)
    const lx = side === 0 ? -hw + t * r.w : hw - t * r.w;
    const nz = side === 0 ? -1 : 1; // outward normal (local z)
    const lz = side === 0 ? -hd : hd;
    const c = toWorld(r, lx, lz, [0, 0]);
    const o = toWorld(r, lx, lz + nz * DOOR_OUT, [0, 0]);
    const i = toWorld(r, lx, lz - nz * DOOR_IN, [0, 0]);
    out.push({ side, cx: c[0], cz: c[1], ox: o[0], oz: o[1], ix: i[0], iz: i[1] });
  }
  return out;
}

/** Nearest entrance to a point (deterministic: first wins ties). */
export function nearestEntrance(entrances, x, z) {
  let best = entrances[0], bd = Infinity;
  for (const e of entrances) {
    const d = dist(x, z, e.ox, e.oz);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/** Height of the wall piece nearest a local point (for firing-slot classification). */
function wallHeightNear(r, wx, wz) {
  let best = 0, bd = Infinity;
  for (const p of r.pieces) {
    const mx = (p.ax + p.bx) / 2, mz = (p.az + p.bz) / 2;
    const d = dist(mx, mz, wx, wz);
    if (d < bd) { bd = d; best = p.h; }
  }
  return best;
}

/**
 * Interior slots, deterministic order: [{ x, z, face, fire }]. Walks the inner rectangle
 * (SLOT_INSET inside the walls) side by side, skipping the doorways. face = outward heading
 * (datan2 convention of the sim: heading = atan2(dx, dz)); fire = a soldier there can shoot (the
 * wall next to him is broken or window height, or every second slot along a tall wall).
 */
export function ruinSlots(r) {
  const slots = [];
  const hw = r.w / 2 - SLOT_INSET, hd = r.d / 2 - SLOT_INSET;
  if (hw <= 0.3 || hd <= 0.3) return slots;
  const doors = ruinEntrances(r);
  // [ax, az, bx, bz, outward local nx, nz] for the 4 inner sides
  const sides = [[-hw, -hd, hw, -hd, 0, -1], [hw, -hd, hw, hd, 1, 0], [hw, hd, -hw, hd, 0, 1], [-hw, hd, -hw, -hd, -1, 0]];
  const W = [0, 0], N = [0, 0], O = [0, 0];
  let n = 0;
  for (const [ax, az, bx, bz, nx, nz] of sides) {
    const len = dist(ax, az, bx, bz);
    const cnt = Math.max(1, Math.floor(len / SLOT_SPACING));
    for (let k = 0; k < cnt; k++) {
      const t = (k + 0.5) / cnt;
      const lx = ax + (bx - ax) * t, lz = az + (bz - az) * t;
      toWorld(r, lx, lz, W);
      let nearDoor = false;
      for (const d of doors) if (dist(W[0], W[1], d.ix, d.iz) < 1.3) nearDoor = true;
      if (nearDoor) continue;
      toWorld(r, lx + nx, lz + nz, N);
      toWorld(r, lx + nx * (SLOT_INSET + 0.1), lz + nz * (SLOT_INSET + 0.1), O);
      const h = wallHeightNear(r, O[0], O[1]);
      const fire = h < 3.1 || n % 2 === 0;
      slots.push({ x: W[0], z: W[1], face: datan2(N[0] - W[0], N[1] - W[1]), fire: fire ? 1 : 0 });
      n++;
    }
  }
  // firing slots first (a squad fills the loopholes before the sheltered corners), stable order
  return slots.map((s, i) => ({ ...s, i })).sort((a, b) => b.fire - a.fire || a.i - b.i).map(({ i, ...s }) => s);
}

/** Garrison capacity (squads) of a ruin: chapel / large house 2, small house 1. */
export function ruinCapacity(r) {
  if (r.kind === 'chapel') return 2;
  return r.w * r.d >= 110 ? 2 : 1;
}

/** Hit points of a garrison ruin (collapse threshold), by size. */
export function ruinHp(r) {
  return Math.round(clamp(r.w * r.d * 11, 520, 1500));
}
