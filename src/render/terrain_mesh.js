// Terrain rendering data: chunked heightfield meshes (frustum-culled), trench carving from trench
// segment data (single source of truth), baked AO / wetness / color blending, outer skirt,
// river water surface, and the ground height texture used by water + decals.
import { createBuffer, createVAO, createTexture2D } from './gl.js';
import { TERRAIN_TYPES, TERRAIN } from '../data/terrain_types.js';
import { STRUCTURES } from '../data/structures.js';
import { CELL_FLAG } from '../world/terrain.js';
import { valueNoise } from '../core/noise.js';
import { trenchDepth } from '../construction/trench.js';
import { pointSegment } from '../core/dmath.js';

export const CHUNK = 32; // cells per chunk side
const STRIDE = 24;
const tmp2 = [0, 0];
// dead-grass coverage per terrain type (render-only shading weight)
const GRASS_WEIGHT = {
  [TERRAIN.EARTH]: 0.35, [TERRAIN.GRASS]: 1.0, [TERRAIN.FOREST]: 0.45, [TERRAIN.FIELD]: 0.15,
  [TERRAIN.RUBBLE]: 0.1, [TERRAIN.ROCK]: 0.12, [TERRAIN.MUD]: 0.05,
};

function vtxHeight(t, vx, vz) {
  vx = vx < 0 ? 0 : vx > t.vcols - 1 ? t.vcols - 1 : vx;
  vz = vz < 0 ? 0 : vz > t.vrows - 1 ? t.vrows - 1 : vz;
  return t.heights[vz * t.vcols + vx];
}

function cellAt(t, cx, cz) {
  cx = cx < 0 ? 0 : cx > t.cols - 1 ? t.cols - 1 : cx;
  cz = cz < 0 ? 0 : cz > t.rows - 1 ? t.rows - 1 : cz;
  return cz * t.cols + cx;
}

/** Vertex-space box a structure influences in the terrain fields (null: none). */
export function terrainInfluenceBox(t, s) {
  const def = STRUCTURES[s.type];
  let x0, z0, x1, z1;
  if (s.type === 'trench') {
    const reach = def.width * 0.5 + 3.2;
    x0 = Math.min(s.x1, s.x2) - reach; x1 = Math.max(s.x1, s.x2) + reach;
    z0 = Math.min(s.z1, s.z2) - reach; z1 = Math.max(s.z1, s.z2) + reach;
  } else if (def.kind === 'building') {
    const r = Math.max(def.footprint.w, def.footprint.d) * 0.5 + 3.5;
    x0 = s.x - r; x1 = s.x + r; z0 = s.z - r; z1 = s.z + r;
  } else return null;
  return {
    x0: Math.max(0, Math.floor(x0 / t.cell)), z0: Math.max(0, Math.floor(z0 / t.cell)),
    x1: Math.min(t.vcols - 1, Math.ceil(x1 / t.cell)), z1: Math.min(t.vrows - 1, Math.ceil(z1 / t.cell)),
  };
}

/**
 * Per-vertex attribute fields (colors, wetness, AO, flags) + carve depth. The whole map at first;
 * later only `region` (vertex box) is recomputed into the existing fields `f` — digging a trench
 * touches a few dozen vertices, not the 46k of the map (no hitch on phones).
 */
export function computeTerrainFields(world, structures, f = null, region = null) {
  const t = world.terrain;
  const nv = t.vcols * t.vrows;
  if (!f) {
    f = {
      height: new Float32Array(nv),
      color: new Uint8Array(nv * 4),
      extra: new Uint8Array(nv * 4),
      normal: new Int8Array(nv * 4),
    };
  }
  const R = region || { x0: 0, z0: 0, x1: t.vcols - 1, z1: t.vrows - 1 };
  const RW = R.x1 - R.x0 + 1;
  const seed = world.seed;
  // carve + churn from trenches (same segment data as gameplay), within the region
  const rn = RW * (R.z1 - R.z0 + 1);
  const carve = new Float32Array(rn);
  const churn = new Float32Array(rn);
  const contact = new Float32Array(rn);
  const ri = (vx, vz) => (vz - R.z0) * RW + (vx - R.x0);
  for (const s of structures) {
    const def = STRUCTURES[s.type];
    if (s.type === 'trench') {
      const depth = trenchDepth(s);
      const hw = def.width * 0.5;
      const reach = hw + 3.2;
      const x0 = Math.max(R.x0, Math.floor((Math.min(s.x1, s.x2) - reach) / t.cell)), x1 = Math.min(R.x1, Math.ceil((Math.max(s.x1, s.x2) + reach) / t.cell));
      const z0 = Math.max(R.z0, Math.floor((Math.min(s.z1, s.z2) - reach) / t.cell)), z1 = Math.min(R.z1, Math.ceil((Math.max(s.z1, s.z2) + reach) / t.cell));
      for (let vz = z0; vz <= z1; vz++) {
        for (let vx = x0; vx <= x1; vx++) {
          pointSegment(tmp2, vx * t.cell, vz * t.cell, s.x1, s.z1, s.x2, s.z2);
          const d = tmp2[0];
          const i = ri(vx, vz);
          if (depth > 0.02 && d < hw + 1.1) carve[i] = Math.max(carve[i], depth + 0.35);
          if (d < reach) churn[i] = Math.max(churn[i], (1 - d / reach) * Math.min(1, s.progress * 2));
        }
      }
    } else if (def.kind === 'building' && s.built) {
      const r = Math.max(def.footprint.w, def.footprint.d) * 0.5 + 3.5;
      const x0 = Math.max(R.x0, Math.floor((s.x - r) / t.cell)), x1 = Math.min(R.x1, Math.ceil((s.x + r) / t.cell));
      const z0 = Math.max(R.z0, Math.floor((s.z - r) / t.cell)), z1 = Math.min(R.z1, Math.ceil((s.z + r) / t.cell));
      for (let vz = z0; vz <= z1; vz++) for (let vx = x0; vx <= x1; vx++) {
        const d = Math.hypot(vx * t.cell - s.x, vz * t.cell - s.z);
        if (d < r) contact[ri(vx, vz)] = Math.max(contact[ri(vx, vz)], 1 - d / r);
      }
    }
  }
  for (const h of world.houses) {
    const r = Math.max(h.w, h.d) * 0.5 + 2.5;
    const x0 = Math.max(R.x0, Math.floor((h.x - r) / t.cell)), x1 = Math.min(R.x1, Math.ceil((h.x + r) / t.cell));
    const z0 = Math.max(R.z0, Math.floor((h.z - r) / t.cell)), z1 = Math.min(R.z1, Math.ceil((h.z + r) / t.cell));
    for (let vz = z0; vz <= z1; vz++) for (let vx = x0; vx <= x1; vx++) {
      const d = Math.hypot(vx * t.cell - h.x, vz * t.cell - h.z);
      if (d < r) contact[ri(vx, vz)] = Math.max(contact[ri(vx, vz)], (1 - d / r) * 0.8);
    }
  }
  for (let vz = R.z0; vz <= R.z1; vz++) {
    for (let vx = R.x0; vx <= R.x1; vx++) {
      const i = vz * t.vcols + vx;
      const li = ri(vx, vz);
      const h = t.heights[i];
      f.height[i] = h - carve[li];
      // normal from base heights (carved band is hidden under trench geometry)
      const hl = vtxHeight(t, vx - 1, vz), hr = vtxHeight(t, vx + 1, vz);
      const hd = vtxHeight(t, vx, vz - 1), hu = vtxHeight(t, vx, vz + 1);
      let nx = hl - hr, ny = 2 * t.cell, nz = hd - hu;
      const nl = Math.hypot(nx, ny, nz);
      nx /= nl; ny /= nl; nz /= nl;
      f.normal[i * 4] = Math.round(nx * 127);
      f.normal[i * 4 + 1] = Math.round(ny * 127);
      f.normal[i * 4 + 2] = Math.round(nz * 127);
      // blend the 4 surrounding cells
      let r = 0, g = 0, b = 0, wet = 0, field = 0, road = 0, crater = 0, rock = 0, grass = 0;
      for (let k = 0; k < 4; k++) {
        const ci = cellAt(t, vx - 1 + (k & 1), vz - 1 + (k >> 1));
        const ty = t.types[ci];
        const def = TERRAIN_TYPES[ty];
        r += def.color[0]; g += def.color[1]; b += def.color[2];
        grass += (GRASS_WEIGHT[ty] || 0) * (t.flags[ci] & CELL_FLAG.ROAD ? 0.1 : 1);
        let w = def.wet;
        const fl = t.flags[ci];
        if (fl & CELL_FLAG.PUDDLE) w = 1;
        if (fl & CELL_FLAG.CRATER) { crater += 1; w = Math.max(w, def.wet + 0.2); }
        if (fl & CELL_FLAG.FIELD) field += 1;
        if (fl & CELL_FLAG.ROAD) road += 1;
        if (ty === TERRAIN.ROCK) rock += 1;
        wet += w;
      }
      r /= 4; g /= 4; b /= 4; wet /= 4; field /= 4; road /= 4; crater /= 4; rock /= 4; grass /= 4;
      if (churn[li] > 0) grass *= 1 - churn[li];
      f.normal[i * 4 + 3] = Math.round(Math.min(1, grass) * 127);
      // macro tint noise (baked) + slope darkening on rock faces
      const n = valueNoise(vx * 0.09, vz * 0.09, seed + 5);
      const n2 = valueNoise(vx * 0.31, vz * 0.31, seed + 9);
      let k = 0.9 + 0.2 * n;
      if (crater > 0) k *= 0.86;
      r *= k; g *= k * (0.98 + 0.04 * n2); b *= k;
      // churned soil near trenches: darker, wetter
      if (churn[li] > 0) {
        const c = churn[li];
        r = r * (1 - c * 0.35) + 0.16 * c * 0.35;
        g = g * (1 - c * 0.35) + 0.13 * c * 0.35;
        b = b * (1 - c * 0.35) + 0.1 * c * 0.35;
        wet = Math.min(1, wet + c * 0.35);
      }
      // concavity AO (crater bowls, ditches) + contact shadow of buildings
      const avg = (hl + hr + hd + hu) * 0.25;
      let ao = 1 + (h - avg) * 0.35;
      ao -= contact[li] * 0.35;
      ao = Math.max(0.45, Math.min(1.08, ao));
      if (rock > 0) ao *= 0.95 + 0.1 * n2;
      f.color[i * 4] = Math.round(Math.min(1, r) * 255);
      f.color[i * 4 + 1] = Math.round(Math.min(1, g) * 255);
      f.color[i * 4 + 2] = Math.round(Math.min(1, b) * 255);
      f.color[i * 4 + 3] = Math.round(Math.min(1, wet) * 255);
      f.extra[i * 4] = Math.round((ao / 1.1) * 255);
      f.extra[i * 4 + 1] = Math.round(field * 255);
      f.extra[i * 4 + 2] = Math.round(crater * 255);
      f.extra[i * 4 + 3] = Math.round(road * 255);
    }
  }
  return f;
}

function chunkGeometry(world, fields, cx0, cz0, step) {
  const t = world.terrain;
  const cols = Math.min(CHUNK, t.cols - cx0), rows = Math.min(CHUNK, t.rows - cz0);
  const nx = Math.floor(cols / step) + 1, nz = Math.floor(rows / step) + 1;
  const buf = new ArrayBuffer(nx * nz * STRIDE);
  const fv = new Float32Array(buf), iv = new Int8Array(buf), uv = new Uint8Array(buf);
  let ymin = 1e9, ymax = -1e9;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const vx = cx0 + i * step, vz = cz0 + j * step;
      const src = vz * t.vcols + vx;
      const o = (j * nx + i) * STRIDE;
      const y = fields.height[src];
      fv[o / 4] = vx * t.cell;
      fv[o / 4 + 1] = y;
      fv[o / 4 + 2] = vz * t.cell;
      iv[o + 12] = fields.normal[src * 4];
      iv[o + 13] = fields.normal[src * 4 + 1];
      iv[o + 14] = fields.normal[src * 4 + 2];
      iv[o + 15] = fields.normal[src * 4 + 3];
      for (let k = 0; k < 4; k++) {
        uv[o + 16 + k] = fields.color[src * 4 + k];
        uv[o + 20 + k] = fields.extra[src * 4 + k];
      }
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
    }
  }
  const idx = new Uint16Array((nx - 1) * (nz - 1) * 6);
  let p = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      // alternate diagonal for less directional artifacts
      if ((i + j) & 1) { idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d; }
      else { idx[p++] = a; idx[p++] = c; idx[p++] = d; idx[p++] = a; idx[p++] = d; idx[p++] = b; }
    }
  }
  return {
    vertices: buf, indices: idx,
    bounds: [cx0 * t.cell, ymin - 1, cz0 * t.cell, (cx0 + cols) * t.cell, ymax + 1, (cz0 + rows) * t.cell],
  };
}

function terrainLayout(buffer) {
  return {
    buffer, stride: STRIDE, attribs: [
      { loc: 0, size: 3, type: 0x1406, offset: 0 },
      { loc: 1, size: 4, type: 0x1400, normalized: true, offset: 12 },
      { loc: 2, size: 4, type: 0x1401, normalized: true, offset: 16 },
      { loc: 3, size: 4, type: 0x1401, normalized: true, offset: 20 },
    ],
  };
}

/** What of a structure shapes the terrain (changes of anything else never trigger a rebuild). */
function terrainKey(s) {
  if (s.type === 'trench') return 't' + Math.round(trenchDepth(s) * 50) + ':' + Math.round(Math.min(1, s.progress * 2) * 20);
  return STRUCTURES[s.type].kind === 'building' ? (s.built ? 'B' : 'b') : null;
}

export function createTerrainRenderer(gl, world, structures, quality) {
  const t = world.terrain;
  const step = quality === 'low' ? 2 : 1;
  const tr = { chunks: [], fields: null, step, lastRegion: null };
  tr.fields = computeTerrainFields(world, structures);
  let seen = new Map(); // structure id -> { key, box }
  for (const s of structures) {
    const k = terrainKey(s);
    if (k) seen.set(s.id, { key: k, box: terrainInfluenceBox(t, s) });
  }
  for (let cz = 0; cz < t.rows; cz += CHUNK) {
    for (let cx = 0; cx < t.cols; cx += CHUNK) {
      const geo = chunkGeometry(world, tr.fields, cx, cz, step);
      const vbo = createBuffer(gl, gl.ARRAY_BUFFER, geo.vertices, gl.DYNAMIC_DRAW);
      const ibo = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, geo.indices);
      const vao = createVAO(gl, [terrainLayout(vbo)], ibo);
      tr.chunks.push({ cx, cz, vbo, ibo, vao, count: geo.indices.length, bounds: geo.bounds });
    }
  }
  const grow = (r, b) => (!b ? r : !r ? { ...b } : { x0: Math.min(r.x0, b.x0), z0: Math.min(r.z0, b.z0), x1: Math.max(r.x1, b.x1), z1: Math.max(r.z1, b.z1) });
  /** Re-shape only where known structures changed (added, removed, dug deeper, completed). */
  tr.update = (structs) => {
    const now = new Map();
    let region = null;
    for (const s of structs) {
      const k = terrainKey(s);
      if (!k) continue;
      const prev = seen.get(s.id);
      const box = prev && prev.key === k ? prev.box : terrainInfluenceBox(t, s);
      now.set(s.id, { key: k, box });
      if (!prev || prev.key !== k) region = grow(grow(region, box), prev && prev.box);
    }
    for (const [id, prev] of seen) if (!now.has(id)) region = grow(region, prev.box);
    seen = now;
    tr.lastRegion = region;
    if (!region) return 0;
    computeTerrainFields(world, structs, tr.fields, region);
    let rebuilt = 0;
    for (const ch of tr.chunks) {
      if (region.x1 < ch.cx || region.x0 > ch.cx + CHUNK || region.z1 < ch.cz || region.z0 > ch.cz + CHUNK) continue;
      const geo = chunkGeometry(world, tr.fields, ch.cx, ch.cz, step);
      gl.bindBuffer(gl.ARRAY_BUFFER, ch.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, geo.vertices);
      ch.bounds = geo.bounds;
      rebuilt++;
    }
    return rebuilt;
  };
  return tr;
}

/** Ground heights (uncarved base + bridge-free) as R16F texture for water depth and decals. */
export function createHeightTexture(gl, world) {
  const t = world.terrain;
  const data = new Uint16Array(t.vcols * t.vrows);
  for (let i = 0; i < data.length; i++) data[i] = toHalf(t.heights[i]);
  return createTexture2D(gl, t.vcols, t.vrows, { internal: gl.R16F, format: gl.RED, type: gl.HALF_FLOAT, data, filter: gl.LINEAR });
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
export function toHalf(v) {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >> 16) & 0x8000;
  let exp = ((x >> 23) & 0xff) - 127 + 15;
  const mant = x & 0x7fffff;
  if (exp <= 0) return sign;
  if (exp >= 31) return sign | 0x7c00;
  return sign | (exp << 10) | (mant >> 13);
}

/** River surface strip following the river centerline. */
export function createWaterMesh(gl, world) {
  const wl = world.map.waterLevel;
  const s = world.riverSamples;
  const across = 6;
  const verts = [];
  for (const [x, cz, hw] of s) {
    const half = hw + world.map.river.bankWidth + 2;
    for (let k = 0; k <= across; k++) verts.push(x, wl, cz - half + (2 * half * k) / across);
  }
  const idx = [];
  const row = across + 1;
  for (let i = 0; i < s.length - 1; i++) {
    for (let k = 0; k < across; k++) {
      const a = i * row + k, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const vbo = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(verts));
  const ibo = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx));
  const vao = createVAO(gl, [{ buffer: vbo, stride: 12, attribs: [{ loc: 0, size: 3, type: gl.FLOAT, offset: 0 }] }], ibo);
  return { vao, count: idx.length };
}

/** Low-detail outer terrain ring so the battlefield fades into haze instead of ending abruptly. */
export function createSkirtMesh(gl, world) {
  const W = world.width, H = world.height;
  const ext = 520, cs = 16;
  const x0 = -ext, z0 = -ext, x1 = W + ext, z1 = H + ext;
  const nx = Math.ceil((x1 - x0) / cs) + 1, nz = Math.ceil((z1 - z0) / cs) + 1;
  const t = world.terrain;
  const buf = new ArrayBuffer(nx * nz * STRIDE);
  const fv = new Float32Array(buf), iv = new Int8Array(buf), uv = new Uint8Array(buf);
  const heights = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * cs, z = z0 + j * cs;
      const cx = Math.max(0, Math.min(W, x)), czz = Math.max(0, Math.min(H, z));
      const edgeH = t.heights[Math.round(czz / t.cell) * t.vcols + Math.round(cx / t.cell)];
      const out = Math.max(Math.max(0, -x), Math.max(0, x - W), Math.max(0, -z), Math.max(0, z - H));
      const hill = (valueNoise(x * 0.012, z * 0.012, 77) - 0.35) * 26 + (valueNoise(x * 0.04, z * 0.04, 78) - 0.5) * 6;
      const k = Math.min(1, out / 60);
      let y = edgeH * (1 - k) + (hill + 6) * k;
      if (out <= 0.5) y = -30; // hidden under the real terrain
      heights[j * nx + i] = y;
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const o = (j * nx + i) * STRIDE;
      const y = heights[j * nx + i];
      fv[o / 4] = x0 + i * cs; fv[o / 4 + 1] = y; fv[o / 4 + 2] = z0 + j * cs;
      const hl = heights[j * nx + Math.max(0, i - 1)], hr = heights[j * nx + Math.min(nx - 1, i + 1)];
      const hd = heights[Math.max(0, j - 1) * nx + i], hu = heights[Math.min(nz - 1, j + 1) * nx + i];
      let a = hl - hr, b = 2 * cs, c = hd - hu;
      const l = Math.hypot(a, b, c);
      iv[o + 12] = Math.round((a / l) * 127); iv[o + 13] = Math.round((b / l) * 127); iv[o + 14] = Math.round((c / l) * 127); iv[o + 15] = 40;
      const n = valueNoise(i * 0.3, j * 0.3, 91);
      uv[o + 16] = Math.round((0.3 + n * 0.08) * 255); uv[o + 17] = Math.round((0.27 + n * 0.06) * 255); uv[o + 18] = Math.round((0.22 + n * 0.05) * 255); uv[o + 19] = 30;
      uv[o + 20] = 230; uv[o + 21] = 0; uv[o + 22] = 0; uv[o + 23] = 0;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let p = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
  }
  const vbo = createBuffer(gl, gl.ARRAY_BUFFER, buf);
  const ibo = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, idx);
  const vao = createVAO(gl, [terrainLayout(vbo)], ibo);
  return { vao, count: idx.length, indexType: gl.UNSIGNED_INT };
}
