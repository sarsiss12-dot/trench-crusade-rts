// Deterministic battlefield generator: layout data (data/maps.js) + seed -> static world.
// Produces the heightfield, terrain types/cover/flags, river, bridge, craters, ruins (with wall
// pieces shared by nav blocking AND rendering), houses, forests, props and anchors.
import { createTerrain, deriveTerrainCells, CELL_FLAG } from './terrain.js';
import { TERRAIN } from '../data/terrain_types.js';
import { COVER_INDEX } from '../data/cover.js';
import { STRUCTURES } from '../data/structures.js';
import { fbm, valueNoise, ridged } from '../core/noise.js';
import { createRngState, rngFloat, rngRange, rngInt, hashFloat, hashString } from '../core/rng.js';
import { dsin, dcos, clamp, lerp, smoothstep, dist, pointSegment } from '../core/dmath.js';

const tmp2 = [0, 0];

export function riverCenterZ(river, x) {
  return river.baseZ + river.amp1 * dsin(x * river.freq1 + river.phase1) + river.amp2 * dsin(x * river.freq2 + river.phase2);
}

export function riverHalfWidth(river, x) {
  return river.halfWidth + river.halfWidthVar * dsin(x * 0.037 + 2.1);
}

export function generateWorld(map, seed) {
  const t = createTerrain(map.width, map.height, map.cell);
  t.waterLevel = map.waterLevel;
  const s = (seed ^ hashString(map.id)) >>> 0;
  const rng = createRngState(s);
  const world = {
    map, seed: s, terrain: t,
    width: map.width, height: map.height,
    props: [], ruins: [], houses: [], craters: [], bridges: [], riverSamples: [],
    graveyards: map.graveyards || [],
    anchors: map.anchors, zones: map.zones, lanes: map.lanes, defensePlan: map.defensePlan || [],
  };
  buildBaseHeights(world);
  carveRiver(world);
  placeCraters(world, rng);
  flattenPads(world);
  assignTypes(world);
  placeRuins(world);
  placeHouses(world);
  placeForests(world, rng);
  scatterProps(world, rng);
  deriveTerrainCells(t);
  return world;
}

// ---------------------------------------------------------------- heights

function buildBaseHeights(world) {
  const { terrain: t, map } = world;
  const s = world.seed;
  const rw = map.edges.ridgeWidth, rh = map.edges.ridgeHeight;
  for (let vz = 0; vz < t.vrows; vz++) {
    for (let vx = 0; vx < t.vcols; vx++) {
      const x = vx * t.cell, z = vz * t.cell;
      let h = (fbm(x / 95, z / 95, s + 11, 4) - 0.5) * 3.4 + (fbm(x / 26, z / 26, s + 23, 3) - 0.5) * 1.0;
      h += (z / map.height - 0.5) * 1.6;
      let edgeT = 0;
      const ex = Math.min(x, map.width - x);
      if (ex < rw) edgeT = (rw - ex) / rw;
      const ez = Math.min(z, map.height - z);
      const rwz = rw * 0.8;
      if (ez < rwz) {
        let e = (rwz - ez) / rwz;
        for (const g of map.edges.roadGaps) {
          if (x > g[0] - 8 && x < g[1] + 8) {
            const inside = Math.min(x - (g[0] - 8), g[1] + 8 - x);
            e *= clamp(1 - inside / 8, 0, 1);
          }
        }
        if (e > edgeT) edgeT = e;
      }
      if (edgeT > 0) {
        const r = ridged(x / 34, z / 34, s + 31, 3);
        const n = fbm(x / 12, z / 12, s + 37, 2);
        h += rh * edgeT * edgeT * (0.5 + 0.75 * r) + edgeT * (n - 0.5) * 2.5;
      }
      t.heights[vz * t.vcols + vx] = h;
    }
  }
}

function fordFactor(river, x) {
  // returns depth override blend (1 = fully ford)
  let best = 0;
  let depth = river.deep;
  for (const f of river.fords) {
    let k;
    if (x >= f.x0 && x <= f.x1) k = 1;
    else if (x < f.x0) k = clamp(1 - (f.x0 - x) / 8, 0, 1);
    else k = clamp(1 - (x - f.x1) / 8, 0, 1);
    if (k > best) {
      best = k;
      depth = lerp(river.deep, f.depth, k);
    }
  }
  return depth;
}

function carveRiver(world) {
  const { terrain: t, map } = world;
  const R = map.river;
  const wl = map.waterLevel;
  for (let vz = 0; vz < t.vrows; vz++) {
    for (let vx = 0; vx < t.vcols; vx++) {
      const x = vx * t.cell, z = vz * t.cell;
      const cz = riverCenterZ(R, x), hw = riverHalfWidth(R, x);
      const d = Math.abs(z - cz);
      if (d > hw + R.bankWidth) continue;
      const i = vz * t.vcols + vx;
      const h0 = t.heights[i];
      const bed = fordFactor(R, x);
      let h;
      if (d < hw) {
        const q = d / hw;
        h = lerp(bed, wl - 0.28, q * q);
        // irregular riverbed
        h += (valueNoise(x / 5, z / 5, world.seed + 71) - 0.5) * 0.35;
      } else {
        const q = (d - hw) / R.bankWidth;
        h = lerp(wl - 0.28, h0, smoothstep(0, 1, q));
      }
      t.heights[i] = Math.min(h0, h);
    }
  }
  for (let x = -24; x <= map.width + 24; x += 4) {
    world.riverSamples.push([x, riverCenterZ(R, x), riverHalfWidth(R, x)]);
  }
  for (const b of R.bridges) {
    const cz = riverCenterZ(R, b.x), hw = riverHalfWidth(R, b.x);
    const z0 = cz - hw - R.bankWidth * 0.8, z1 = cz + hw + R.bankWidth * 0.8;
    const hA = sampleVertexHeight(t, b.x, z0 - 2), hB = sampleVertexHeight(t, b.x, z1 + 2);
    world.bridges.push({ x: b.x, z0, z1, width: b.width, hA, hB, deck: Math.max(hA, hB, wl + 0.6) + 0.35 });
  }
}

function sampleVertexHeight(t, x, z) {
  const vx = clamp(Math.round(x / t.cell), 0, t.vcols - 1);
  const vz = clamp(Math.round(z / t.cell), 0, t.vrows - 1);
  return t.heights[vz * t.vcols + vx];
}

/** Deck height of a bridge at z (ramps at both ends). */
export function bridgeDeckHeight(b, z) {
  const ramp = 5;
  if (z < b.z0 + ramp) return lerp(b.hA + 0.1, b.deck, clamp((z - b.z0) / ramp, 0, 1));
  if (z > b.z1 - ramp) return lerp(b.hB + 0.1, b.deck, clamp((b.z1 - z) / ramp, 0, 1));
  return b.deck;
}

function nearRiver(world, x, z, margin) {
  const R = world.map.river;
  return Math.abs(z - riverCenterZ(R, x)) < riverHalfWidth(R, x) + R.bankWidth + margin;
}

function nearRoad(world, x, z, margin) {
  for (const road of world.map.roads) {
    const p = road.points;
    for (let k = 0; k < p.length - 1; k++) {
      pointSegment(tmp2, x, z, p[k][0], p[k][1], p[k + 1][0], p[k + 1][1]);
      if (tmp2[0] < road.width + margin) return true;
    }
  }
  return false;
}

function nearStructurePad(world, x, z, margin) {
  for (const sd of world.map.structures) {
    if (sd.x1 !== undefined) continue;
    const def = STRUCTURES[sd.type];
    const r = Math.max(def.footprint.w, def.footprint.d) * 0.5 + margin;
    if (dist(x, z, sd.x, sd.z) < r) return true;
  }
  for (const r of world.map.ruins) if (dist(x, z, r.x, r.z) < Math.max(r.w, r.d) * 0.6 + margin) return true;
  for (const h of world.map.houses) if (dist(x, z, h.x, h.z) < Math.max(h.w, h.d) * 0.6 + margin) return true;
  return false;
}

function placeCraters(world, rng) {
  const { terrain: t, map } = world;
  for (const band of map.craterBands) {
    let placed = 0, tries = 0;
    while (placed < band.count && tries < band.count * 12) {
      tries++;
      const x = rngRange(rng, map.edges.ridgeWidth + 4, map.width - map.edges.ridgeWidth - 4);
      const z = rngRange(rng, band.z0, band.z1);
      const r = rngRange(rng, band.rMin, band.rMax);
      if (nearRiver(world, x, z, r + 2)) continue;
      if (nearRoad(world, x, z, r * 0.6)) continue;
      if (nearStructurePad(world, x, z, r + 3)) continue;
      let overlap = false;
      for (const c of world.craters) if (dist(x, z, c.x, c.z) < (c.r + r) * 0.8) { overlap = true; break; }
      if (overlap) continue;
      world.craters.push({ x, z, r, wet: z > 120 && z < 400 && rngFloat(rng) < 0.45 });
      placed++;
    }
  }
  for (const c of world.craters) {
    const depth = 0.2 * c.r + 0.2;
    const rimH = 0.1 * c.r;
    const ext = c.r * 1.7;
    const vx0 = Math.max(0, Math.floor((c.x - ext) / t.cell)), vx1 = Math.min(t.vcols - 1, Math.ceil((c.x + ext) / t.cell));
    const vz0 = Math.max(0, Math.floor((c.z - ext) / t.cell)), vz1 = Math.min(t.vrows - 1, Math.ceil((c.z + ext) / t.cell));
    for (let vz = vz0; vz <= vz1; vz++) {
      for (let vx = vx0; vx <= vx1; vx++) {
        const d = dist(vx * t.cell, vz * t.cell, c.x, c.z);
        const i = vz * t.vcols + vx;
        if (d < c.r) {
          const q = d / c.r;
          t.heights[i] -= depth * (1 - q * q);
        } else if (d < ext) {
          const q = (d - c.r) / (ext - c.r); // 0..1
          const bump = q < 0.35 ? q / 0.35 : 1 - (q - 0.35) / 0.65;
          t.heights[i] += rimH * bump * bump * (3 - 2 * bump);
        }
      }
    }
  }
}

function flattenArea(t, cx, cz, radius, blend) {
  let sum = 0, n = 0;
  const vx0 = Math.max(0, Math.floor((cx - radius) / t.cell)), vx1 = Math.min(t.vcols - 1, Math.ceil((cx + radius) / t.cell));
  const vz0 = Math.max(0, Math.floor((cz - radius) / t.cell)), vz1 = Math.min(t.vrows - 1, Math.ceil((cz + radius) / t.cell));
  for (let vz = vz0; vz <= vz1; vz++) for (let vx = vx0; vx <= vx1; vx++) {
    if (dist(vx * t.cell, vz * t.cell, cx, cz) < radius) { sum += t.heights[vz * t.vcols + vx]; n++; }
  }
  if (!n) return;
  const avg = sum / n;
  const outer = radius + blend;
  const ox0 = Math.max(0, Math.floor((cx - outer) / t.cell)), ox1 = Math.min(t.vcols - 1, Math.ceil((cx + outer) / t.cell));
  const oz0 = Math.max(0, Math.floor((cz - outer) / t.cell)), oz1 = Math.min(t.vrows - 1, Math.ceil((cz + outer) / t.cell));
  for (let vz = oz0; vz <= oz1; vz++) for (let vx = ox0; vx <= ox1; vx++) {
    const d = dist(vx * t.cell, vz * t.cell, cx, cz);
    const i = vz * t.vcols + vx;
    if (d < radius) t.heights[i] = avg;
    else if (d < outer) t.heights[i] = lerp(avg, t.heights[i], smoothstep(0, 1, (d - radius) / blend));
  }
}

function flattenPads(world) {
  const t = world.terrain;
  for (const sd of world.map.structures) {
    if (sd.x1 !== undefined) continue;
    const def = STRUCTURES[sd.type];
    if (def.kind === 'area') continue;
    const r = Math.max(def.footprint.w, def.footprint.d) * 0.62;
    flattenArea(t, sd.x, sd.z, r, 8);
  }
  for (const h of world.map.houses) flattenArea(t, h.x, h.z, Math.max(h.w, h.d) * 0.62, 5);
  for (const r of world.map.ruins) flattenArea(t, r.x, r.z, Math.max(r.w, r.d) * 0.55, 4);
}

// ---------------------------------------------------------------- types

function inBlob(world, x, z, cx, cz, r, seedOff) {
  const d = dist(x, z, cx, cz);
  if (d > r * 1.3) return false;
  const n = fbm(x / 14, z / 14, world.seed + seedOff, 3);
  return d < r * (0.72 + 0.55 * n);
}

function inRotRect(x, z, cx, cz, w, d, rot, margin) {
  const dx = x - cx, dz = z - cz;
  const s = dsin(rot), c = dcos(rot);
  // local right=(-c, s), forward=(s, c)
  const lx = -dx * c + dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= w / 2 + margin && Math.abs(lz) <= d / 2 + margin;
}

function assignTypes(world) {
  const { terrain: t, map } = world;
  const s = world.seed;
  const wl = map.waterLevel;
  const bands = map.bands;
  const fields = map.structures.filter((sd) => sd.type === 'field');
  for (let cz = 0; cz < t.rows; cz++) {
    for (let cx = 0; cx < t.cols; cx++) {
      const idx = cz * t.cols + cx;
      const x = cx * t.cell + t.cell * 0.5, z = cz * t.cell + t.cell * 0.5;
      const v0 = cz * t.vcols + cx;
      const h00 = t.heights[v0], h10 = t.heights[v0 + 1], h01 = t.heights[v0 + t.vcols], h11 = t.heights[v0 + t.vcols + 1];
      const h = (h00 + h10 + h01 + h11) * 0.25;
      const slope = Math.max(h00, h10, h01, h11) - Math.min(h00, h10, h01, h11);
      let type;
      let flags = 0;
      const ex = Math.min(x, map.width - x), ez = Math.min(z, map.height - z);
      const edgeBand = ex < map.edges.ridgeWidth * 0.9 || ez < map.edges.ridgeWidth * 0.7;
      if (ex < 3 || ez < 3) {
        type = TERRAIN.ROCK; flags |= CELL_FLAG.EDGE;
      } else if (h < wl - 0.02) {
        type = h < wl - 0.9 ? TERRAIN.DEEP : TERRAIN.SHALLOW;
        flags |= CELL_FLAG.WATER;
      } else if ((edgeBand && (slope > 1.25 || h > 5.2)) || slope > 2.4) {
        type = TERRAIN.ROCK; flags |= CELL_FLAG.EDGE;
      } else {
        // base soil
        const g = fbm(x / 30, z / 30, s + 41, 3);
        const inNoMansLand = z > bands.noMansLand[0] && z < bands.noMansLand[1];
        type = g > (inNoMansLand ? 0.66 : 0.5) ? TERRAIN.GRASS : TERRAIN.EARTH;
        // mud
        if (z > map.mud.z0 && z < map.mud.z1) {
          let m = fbm(x / 38, z / 38, s + 53, 3);
          if (nearRiver(world, x, z, 10)) m += map.mud.riverBoost;
          if (m > map.mud.threshold) type = TERRAIN.MUD;
        }
        for (const f of map.forests) if (inBlob(world, x, z, f.x, f.z, f.r, 61)) { type = TERRAIN.FOREST; break; }
        for (const inf of map.infected) if (inBlob(world, x, z, inf.x, inf.z, inf.r, 67)) { type = TERRAIN.INFECTED; break; }
        for (const f of fields) {
          const def = STRUCTURES.field;
          if (inRotRect(x, z, f.x, f.z, def.footprint.w, def.footprint.d, f.rot || 0, 0)) { type = TERRAIN.FIELD; flags |= CELL_FLAG.FIELD; }
        }
        for (const road of map.roads) {
          const p = road.points;
          for (let k = 0; k < p.length - 1; k++) {
            pointSegment(tmp2, x, z, p[k][0], p[k][1], p[k + 1][0], p[k + 1][1]);
            if (tmp2[0] < road.width) { type = TERRAIN.ROAD; flags |= CELL_FLAG.ROAD; }
          }
        }
      }
      for (const b of world.bridges) {
        if (Math.abs(x - b.x) < b.width / 2 && z > b.z0 && z < b.z1) { type = TERRAIN.BRIDGE; flags &= ~CELL_FLAG.WATER; flags |= CELL_FLAG.ROAD; }
      }
      t.types[idx] = type;
      t.flags[idx] |= flags;
    }
  }
  // crater cover + wet bottoms
  for (const c of world.craters) {
    const c0x = Math.max(0, Math.floor((c.x - c.r) / t.cell)), c1x = Math.min(t.cols - 1, Math.floor((c.x + c.r) / t.cell));
    const c0z = Math.max(0, Math.floor((c.z - c.r) / t.cell)), c1z = Math.min(t.rows - 1, Math.floor((c.z + c.r) / t.cell));
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      const x = cx * t.cell + 1, z = cz * t.cell + 1;
      const d = dist(x, z, c.x, c.z);
      const idx = cz * t.cols + cx;
      const ty = t.types[idx];
      if (ty === TERRAIN.ROCK || ty === TERRAIN.DEEP || ty === TERRAIN.SHALLOW) continue;
      if (d < c.r * 0.9) {
        t.cover[idx] = COVER_INDEX.crater;
        t.flags[idx] |= CELL_FLAG.CRATER;
        if (c.wet && d < c.r * 0.55) { t.types[idx] = TERRAIN.MUD; t.flags[idx] |= CELL_FLAG.PUDDLE; }
      }
    }
  }
}

// ---------------------------------------------------------------- ruins / houses

/**
 * Deterministic wall pieces for a ruin. SINGLE SOURCE for both nav blocking and rendering.
 * Returns [{ax, az, bx, bz, h, thick, side}] in world coordinates.
 */
export function ruinPieces(r, index, seed) {
  const pieces = [];
  const hw = r.w / 2, hd = r.d / 2;
  const s = dsin(r.rot), c = dcos(r.rot);
  const toWorld = (lx, lz) => [r.x - lx * c + lz * s, r.z + lx * s + lz * c];
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  const baseH = r.kind === 'chapel' ? 7.2 : r.kind === 'wall' ? 2.8 : 4.4;
  const sides = r.kind === 'wall' ? 1 : 4;
  for (let side = 0; side < sides; side++) {
    const a = corners[side], b = corners[(side + 1) % 4];
    const len = dist(a[0], a[1], b[0], b[1]);
    const nseg = Math.max(2, Math.round(len / 2.2));
    for (let k = 0; k < nseg; k++) {
      const q = hashFloat(seed, index * 131 + side * 17 + k, 977);
      const q2 = hashFloat(seed, index * 131 + side * 17 + k, 1471);
      const cornerBoost = k === 0 || k === nseg - 1 ? 0.25 : 0;
      let h = baseH * clamp(0.22 + 0.85 * q + cornerBoost, 0, 1.05);
      if (q < 0.2 && cornerBoost === 0) h = 0.35 + q2 * 0.4; // collapsed to a low stub
      // doorway on the front side
      if (side === 0 && r.kind !== 'wall' && k === Math.floor(nseg / 2)) h = Math.min(h, 0.3);
      const t0 = k / nseg, t1 = (k + 1) / nseg;
      const p0 = toWorld(lerp(a[0], b[0], t0), lerp(a[1], b[1], t0));
      const p1 = toWorld(lerp(a[0], b[0], t1), lerp(a[1], b[1], t1));
      pieces.push({ ax: p0[0], az: p0[1], bx: p1[0], bz: p1[1], h, thick: r.kind === 'chapel' ? 0.8 : 0.55, side, q: q2 });
    }
  }
  return pieces;
}

function markSegmentCells(t, ax, az, bx, bz, fn) {
  const len = dist(ax, az, bx, bz);
  const steps = Math.max(1, Math.ceil(len / 0.5));
  for (let k = 0; k <= steps; k++) {
    const x = lerp(ax, bx, k / steps), z = lerp(az, bz, k / steps);
    const cx = Math.floor(x / t.cell), cz = Math.floor(z / t.cell);
    if (cx < 0 || cz < 0 || cx >= t.cols || cz >= t.rows) continue;
    fn(cz * t.cols + cx);
  }
}

function placeRuins(world) {
  const t = world.terrain;
  world.map.ruins.forEach((r, index) => {
    const pieces = ruinPieces(r, index, world.seed);
    world.ruins.push({ ...r, index, pieces });
    // rubble + ruins cover around footprint
    const ext = Math.max(r.w, r.d) * 0.5 + 3;
    const c0x = Math.max(0, Math.floor((r.x - ext) / t.cell)), c1x = Math.min(t.cols - 1, Math.floor((r.x + ext) / t.cell));
    const c0z = Math.max(0, Math.floor((r.z - ext) / t.cell)), c1z = Math.min(t.rows - 1, Math.floor((r.z + ext) / t.cell));
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      const x = cx * t.cell + 1, z = cz * t.cell + 1;
      if (inRotRect(x, z, r.x, r.z, r.w, r.d, r.rot, 2.2)) {
        const idx = cz * t.cols + cx;
        if (t.types[idx] === TERRAIN.DEEP || t.types[idx] === TERRAIN.ROCK) continue;
        t.types[idx] = TERRAIN.RUBBLE;
        t.flags[idx] |= CELL_FLAG.RUIN;
        t.cover[idx] = COVER_INDEX.ruins;
      }
    }
    for (const p of pieces) {
      if (p.h > 1.4) markSegmentCells(t, p.ax, p.az, p.bx, p.bz, (idx) => { t.blocked[idx] = 1; });
    }
  });
}

function placeHouses(world) {
  const t = world.terrain;
  world.map.houses.forEach((hs, index) => {
    world.houses.push({ ...hs, index, seed: world.seed + index * 7919 });
    const ext = Math.max(hs.w, hs.d) * 0.75;
    const c0x = Math.max(0, Math.floor((hs.x - ext) / t.cell)), c1x = Math.min(t.cols - 1, Math.floor((hs.x + ext) / t.cell));
    const c0z = Math.max(0, Math.floor((hs.z - ext) / t.cell)), c1z = Math.min(t.rows - 1, Math.floor((hs.z + ext) / t.cell));
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      const x = cx * t.cell + 1, z = cz * t.cell + 1;
      if (inRotRect(x, z, hs.x, hs.z, hs.w, hs.d, hs.rot, -0.2)) t.blocked[cz * t.cols + cx] = 1;
    }
  });
}

// ---------------------------------------------------------------- vegetation / props

function placeForests(world, rng) {
  const map = world.map;
  const occ = new Map();
  const key = (x, z) => Math.floor(x / 3) + ',' + Math.floor(z / 3);
  const free = (x, z) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const list = occ.get(Math.floor(x / 3) + dx + ',' + (Math.floor(z / 3) + dz));
      if (list) for (const p of list) if (dist(x, z, p[0], p[1]) < 2.6) return false;
    }
    return true;
  };
  const add = (x, z) => {
    const k = key(x, z);
    if (!occ.has(k)) occ.set(k, []);
    occ.get(k).push([x, z]);
  };
  for (const f of map.forests) {
    const want = Math.round(f.density * Math.PI * f.r * f.r);
    let n = 0, tries = 0;
    while (n < want && tries < want * 8) {
      tries++;
      const a = rngFloat(rng) * 6.283185307179586;
      const rr = f.r * 1.2 * Math.sqrt(rngFloat(rng));
      const x = f.x + dcos(a) * rr, z = f.z + dsin(a) * rr;
      if (!inBlob(world, x, z, f.x, f.z, f.r, 61)) continue;
      if (nearRiver(world, x, z, 1) || nearRoad(world, x, z, 1)) continue;
      if (!free(x, z)) continue;
      add(x, z);
      const roll = rngFloat(rng);
      const variant = roll < 0.12 ? 3 : rngInt(rng, 3); // 3 = snapped trunk
      world.props.push({ type: 'tree', v: variant, x, z, rot: rngFloat(rng) * 6.2832, s: rngRange(rng, 0.8, 1.25), seed: (rngFloat(rng) * 1e9) | 0 });
      n++;
    }
  }
  // splintered trunks and stumps across no man's land / craters band
  for (let i = 0; i < 46; i++) {
    const x = rngRange(rng, 26, map.width - 26), z = rngRange(rng, 120, 400);
    if (nearRiver(world, x, z, 2) || nearRoad(world, x, z, 2) || nearStructurePad(world, x, z, 2) || !free(x, z)) continue;
    add(x, z);
    world.props.push({ type: rngFloat(rng) < 0.5 ? 'stump' : 'tree', v: 3, x, z, rot: rngFloat(rng) * 6.2832, s: rngRange(rng, 0.7, 1.15), seed: (rngFloat(rng) * 1e9) | 0 });
  }
}

function scatterProps(world, rng) {
  const map = world.map;
  const t = world.terrain;
  const push = (type, x, z, s = 1, v = 0) => world.props.push({ type, v, x, z, rot: rngFloat(rng) * 6.2832, s, seed: (rngFloat(rng) * 1e9) | 0 });
  const landAt = (x, z) => {
    const cx = Math.floor(x / t.cell), cz = Math.floor(z / t.cell);
    if (cx < 0 || cz < 0 || cx >= t.cols || cz >= t.rows) return false;
    const ty = t.types[cz * t.cols + cx];
    return ty !== TERRAIN.DEEP && ty !== TERRAIN.SHALLOW && ty !== TERRAIN.ROCK && !t.blocked[cz * t.cols + cx];
  };
  // graveyards: rows of crosses
  for (const g of world.graveyards) {
    for (let gz = -g.d / 2 + 1.5; gz < g.d / 2; gz += 2.4) {
      for (let gx = -g.w / 2 + 1.2; gx < g.w / 2; gx += 1.9) {
        const x = g.x + gx + rngRange(rng, -0.25, 0.25), z = g.z + gz + rngRange(rng, -0.25, 0.25);
        if (rngFloat(rng) < 0.12) continue;
        world.props.push({ type: 'cross', v: rngInt(rng, 3), x, z, rot: rngRange(rng, -0.15, 0.15) + 3.14159, s: rngRange(rng, 0.85, 1.1), seed: (rngFloat(rng) * 1e9) | 0 });
      }
    }
  }
  // debris around ruins
  for (const r of world.ruins) {
    const n = 4 + rngInt(rng, 4);
    for (let i = 0; i < n; i++) {
      const a = rngFloat(rng) * 6.2832, rr = Math.max(r.w, r.d) * rngRange(rng, 0.2, 0.8);
      const x = r.x + dcos(a) * rr, z = r.z + dsin(a) * rr;
      if (!landAt(x, z)) continue;
      push(rngFloat(rng) < 0.6 ? 'rubble' : 'beam', x, z, rngRange(rng, 0.7, 1.3), rngInt(rng, 3));
    }
  }
  // settlement props near New Antioch base
  const naBand = map.bands.naArea;
  for (let i = 0; i < 34; i++) {
    const x = rngRange(rng, 30, map.width - 30), z = rngRange(rng, naBand[0] + 8, naBand[1] - 16);
    if (!landAt(x, z) || nearStructurePad(world, x, z, 1.5)) continue;
    const roll = rngFloat(rng);
    push(roll < 0.4 ? 'crate' : roll < 0.75 ? 'barrel' : 'cart', x, z, rngRange(rng, 0.85, 1.15), rngInt(rng, 3));
  }
  // telegraph poles along main road (some broken)
  const mainRoad = map.roads[0].points;
  for (let k = 0; k < mainRoad.length - 1; k++) {
    const [ax, az] = mainRoad[k], [bx, bz] = mainRoad[k + 1];
    const len = dist(ax, az, bx, bz);
    for (let d = 0; d < len; d += 26) {
      const q = d / len;
      const x = lerp(ax, bx, q) + 5.5, z = lerp(az, bz, q);
      if (!landAt(x, z)) continue;
      world.props.push({ type: 'pole', v: rngFloat(rng) < 0.35 ? 1 : 0, x, z, rot: rngRange(rng, -0.2, 0.2), s: 1, seed: (rngFloat(rng) * 1e9) | 0 });
    }
  }
  // no man's land remains: old sandbag piles, stakes, battlefield remains
  for (let i = 0; i < 60; i++) {
    const x = rngRange(rng, 26, map.width - 26), z = rngRange(rng, 290, 405);
    if (!landAt(x, z) || nearRoad(world, x, z, 1)) continue;
    const roll = rngFloat(rng);
    push(roll < 0.3 ? 'sandbag_pile' : roll < 0.62 ? 'stake' : roll < 0.8 ? 'remains' : 'helmet_cross', x, z, rngRange(rng, 0.8, 1.2), rngInt(rng, 3));
  }
  // Black Grail approach: bone piles, organic growths, spikes
  for (const inf of map.infected) {
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = rngFloat(rng) * 6.2832, rr = inf.r * Math.sqrt(rngFloat(rng)) * 0.95;
      const x = inf.x + dcos(a) * rr, z = inf.z + dsin(a) * rr;
      if (!landAt(x, z) || nearStructurePad(world, x, z, 2)) continue;
      const roll = rngFloat(rng);
      push(roll < 0.45 ? 'growth' : roll < 0.75 ? 'bone_spike' : 'remains', x, z, rngRange(rng, 0.7, 1.4), rngInt(rng, 3));
    }
  }
  // boulders on ridges
  for (let i = 0; i < 70; i++) {
    const side = rngInt(rng, 4);
    let x, z;
    if (side === 0) { x = rngRange(rng, 4, 22); z = rngRange(rng, 10, map.height - 10); }
    else if (side === 1) { x = rngRange(rng, map.width - 22, map.width - 4); z = rngRange(rng, 10, map.height - 10); }
    else if (side === 2) { x = rngRange(rng, 10, map.width - 10); z = rngRange(rng, 3, 16); }
    else { x = rngRange(rng, 10, map.width - 10); z = rngRange(rng, map.height - 16, map.height - 3); }
    push('rock', x, z, rngRange(rng, 0.8, 2.4), rngInt(rng, 3));
  }
  // dry shrubs on grass / earth
  for (let i = 0; i < 180; i++) {
    const x = rngRange(rng, 24, map.width - 24), z = rngRange(rng, 12, map.height - 12);
    const cx = Math.floor(x / t.cell), cz = Math.floor(z / t.cell);
    const ty = t.types[cz * t.cols + cx];
    if (ty !== TERRAIN.GRASS && ty !== TERRAIN.EARTH && ty !== TERRAIN.FOREST) continue;
    if (nearRoad(world, x, z, 0.5) || nearStructurePad(world, x, z, 1)) continue;
    push('shrub', x, z, rngRange(rng, 0.6, 1.3), rngInt(rng, 3));
  }
}

/** Point inside a named deployment zone? */
export function inZone(zone, x, z) {
  return x >= zone.x0 && x <= zone.x1 && z >= zone.z0 && z <= zone.z1;
}

export function clampToZone(zone, x, z, out) {
  out[0] = clamp(x, zone.x0 + 1, zone.x1 - 1);
  out[1] = clamp(z, zone.z0 + 1, zone.z1 - 1);
  return out;
}
