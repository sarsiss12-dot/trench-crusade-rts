// Presentation of shell craters: the viewer's memory of the craters it has seen (sim craters carry
// seenBy bits; a crater changed out of sight keeps its last seen shape), the carved bowl profile
// used by the terrain mesh and by the presentation ground height (soldiers, corpses, decals).
// Pure data (no GL): unit-testable, bounded.
import { isCraterKnownTo } from '../sim/perception.js';

export const CRATER_MEMORY_MAX = 96;
const REACH = 1.55; // influence radius in crater radii (bowl + raised rim)

/** Irregular radius around the bowl (deterministic from the crater id). */
function radiusAt(c, ang) {
  return c.r * (1 + 0.16 * Math.sin(3 * ang + c.id * 1.7) + 0.09 * Math.sin(5 * ang + c.id * 0.61));
}

/** Height offset of one crater at (x, z): deep dark bowl, raised irregular rim. */
export function craterOffset(c, x, z) {
  const dx = x - c.x, dz = z - c.z;
  const d2 = dx * dx + dz * dz;
  const reach = c.r * REACH * 1.2;
  if (d2 > reach * reach) return 0;
  const d = Math.sqrt(d2);
  const rr = radiusAt(c, Math.atan2(dz, dx));
  const t = d / rr;
  const D = 0.42 + 0.22 * Math.min(3, c.d || 1);
  let off = 0;
  if (t < 1) { const u = 1 - t * t; off -= D * u * Math.sqrt(u); }
  const rim = (t - 1.02) / 0.22;
  off += 0.32 * D * Math.exp(-rim * rim);
  return off;
}

/** Bowl weight 0..1 (1 at the centre) — terrain colour (dark churned centre). */
export function craterBowl(c, x, z) {
  const d = Math.hypot(x - c.x, z - c.z);
  const rr = radiusAt(c, Math.atan2(z - c.z, x - c.x));
  return d < rr ? 1 - d / rr : 0;
}

export function craterReach(c) {
  return c.r * REACH * 1.2;
}

/**
 * The viewer's crater knowledge. update() copies craters currently known to the viewer; the list
 * is bounded (oldest remembered first out). signature() changes whenever the carved ground must.
 */
export function createCraterMemory(saved = null) {
  const mem = new Map(); // id -> { id, x, z, r, d, t }
  let serial = 0;
  let sig = 0;
  if (saved) for (const c of saved) { mem.set(c.id, { id: c.id, x: c.x, z: c.z, r: c.r, d: c.d, t: ++serial }); }
  const bucket = new Map(); // coarse 16 m grid -> craters (for ground height queries)
  let dirty = true;
  function rebuildBuckets() {
    bucket.clear();
    for (const c of mem.values()) {
      const R = craterReach(c);
      for (let gz = Math.floor((c.z - R) / 16); gz <= Math.floor((c.z + R) / 16); gz++) {
        for (let gx = Math.floor((c.x - R) / 16); gx <= Math.floor((c.x + R) / 16); gx++) {
          const k = gx * 4096 + gz;
          let b = bucket.get(k);
          if (!b) { b = []; bucket.set(k, b); }
          b.push(c);
        }
      }
    }
    dirty = false;
  }
  return {
    update(sim, viewer, fogEnabled = true) {
      const list = sim.state.craters || [];
      let changed = false;
      for (const c of list) {
        if (fogEnabled && !isCraterKnownTo(c, viewer)) continue;
        const m = mem.get(c.id);
        if (m && m.x === c.x && m.z === c.z && m.r === c.r && m.d === c.d) continue;
        mem.set(c.id, { id: c.id, x: c.x, z: c.z, r: c.r, d: c.d, t: ++serial });
        changed = true;
      }
      while (mem.size > CRATER_MEMORY_MAX) {
        let oldest = null;
        for (const m of mem.values()) if (!oldest || m.t < oldest.t) oldest = m;
        mem.delete(oldest.id);
        changed = true;
      }
      if (changed) { sig = (sig + 1) >>> 0; dirty = true; }
      return changed;
    },
    signature: () => sig,
    list: () => [...mem.values()],
    size: () => mem.size,
    /** Summed carve offset at (x, z) from remembered craters (0 when none nearby). */
    offsetAt(x, z) {
      if (!mem.size) return 0;
      if (dirty) rebuildBuckets();
      const b = bucket.get(Math.floor(x / 16) * 4096 + Math.floor(z / 16));
      if (!b) return 0;
      let off = 0;
      for (let i = 0; i < b.length; i++) off += craterOffset(b[i], x, z);
      return off;
    },
    exportState: () => [...mem.values()].map((c) => ({ id: c.id, x: c.x, z: c.z, r: c.r, d: c.d })),
  };
}
