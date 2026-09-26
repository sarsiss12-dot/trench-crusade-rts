// Ground clutter (render-only decoration): dead grass clumps, weeds, pebbles, plank debris and spent
// shell casings scattered deterministically from the world seed by terrain type and map band.
// Chunked (32 m) for culling, distance-limited, never casts shadows, hidden under structures
// (re-filtered when structures change). Never affects gameplay.
import { createBuffer, createVAO, drawElements } from './gl.js';
import { VERTEX_STRIDE } from './models/meshbuilder.js';
import { CLUTTER_MODELS } from './models/props.js';
import { TERRAIN } from '../data/terrain_types.js';
import { STRUCTURES } from '../data/structures.js';
import { CELL_FLAG, baseHeightAt } from '../world/terrain.js';
import { hash32 } from '../core/rng.js';
import { aabbInFrustum } from './math3d.js';
import { pointSegment } from '../core/dmath.js';

const CHUNK = 32;
const KEYS = Object.keys(CLUTTER_MODELS);
const KI = Object.fromEntries(KEYS.map((k, i) => [k, i]));

// per terrain type: [grass_s, grass_b, weeds, pebbles, planks, shell] probabilities per 2 m cell
const RULES = {
  [TERRAIN.GRASS]: [0.42, 0.2, 0.05, 0.01, 0, 0],
  [TERRAIN.EARTH]: [0.16, 0.05, 0.03, 0.05, 0.004, 0.004],
  [TERRAIN.FOREST]: [0.22, 0.08, 0.06, 0.02, 0.02, 0.004],
  [TERRAIN.FIELD]: [0.05, 0.01, 0.02, 0.02, 0, 0],
  [TERRAIN.MUD]: [0.02, 0, 0.01, 0.02, 0.012, 0.012],
  [TERRAIN.RUBBLE]: [0.04, 0.01, 0.03, 0.3, 0.1, 0.004],
  [TERRAIN.ROAD]: [0, 0, 0, 0.08, 0.004, 0],
  [TERRAIN.INFECTED]: [0, 0, 0.02, 0.02, 0.01, 0.006],
  [TERRAIN.SHALLOW]: [0, 0, 0, 0.02, 0.01, 0],
};

function rnd(a, b, c) {
  return hash32(a, b, c) / 4294967296;
}

function uploadModel(gl, mesh, instBuf) {
  const vbo = createBuffer(gl, gl.ARRAY_BUFFER, mesh.vertices);
  const ibo = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, mesh.indices);
  const vao = createVAO(gl, [
    {
      buffer: vbo, stride: VERTEX_STRIDE, attribs: [
        { loc: 0, size: 3, type: gl.FLOAT, offset: 0 },
        { loc: 1, size: 4, type: gl.BYTE, normalized: true, offset: 12 },
        { loc: 2, size: 4, type: gl.UNSIGNED_BYTE, normalized: true, offset: 16 },
      ],
    },
    {
      buffer: instBuf, stride: 32, attribs: [
        { loc: 4, size: 4, type: gl.FLOAT, offset: 0, divisor: 1 },
        { loc: 5, size: 4, type: gl.FLOAT, offset: 16, divisor: 1 },
      ],
    },
  ], ibo);
  return { vao, count: mesh.indexCount, type: mesh.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, height: mesh.height };
}

export function createClutter(gl, world, opts = {}) {
  const density = opts.density !== undefined ? opts.density : 1;
  const maxDist = opts.quality === 'low' ? 55 : opts.quality === 'high' ? 110 : 85;
  const t = world.terrain;
  const seed = world.seed ^ 0x5eed;
  const ccols = Math.ceil(world.width / CHUNK), crows = Math.ceil(world.height / CHUNK);
  // generate instances: chunk -> flat Float32 list of [key, x, y, z, rot, scale, tint, visible]
  const chunks = [];
  for (let i = 0; i < ccols * crows; i++) chunks.push({ list: [], ymin: 1e9, ymax: -1e9 });
  const noMansLand = world.map.bands ? world.map.bands.noMansLand : [290, 400];
  if (density > 0) {
    for (let cz = 0; cz < t.rows; cz++) {
      for (let cx = 0; cx < t.cols; cx++) {
        const ci = cz * t.cols + cx;
        if (t.blocked && t.blocked[ci]) continue;
        const flags = t.flags[ci];
        if (flags & CELL_FLAG.WATER) continue;
        const rule = RULES[t.types[ci]];
        if (!rule) continue;
        const zc = cz * t.cell;
        const nml = zc > noMansLand[0] && zc < noMansLand[1];
        for (let k = 0; k < rule.length; k++) {
          let p = rule[k] * density;
          if (k <= 2 && (flags & (CELL_FLAG.ROAD | CELL_FLAG.FIELD))) p *= 0.15;
          if (k >= 4 && nml) p *= 2.5; // battlefield debris concentrates in no man's land
          if (k <= 1 && (flags & CELL_FLAG.CRATER)) p *= 0.3;
          if (p <= 0 || rnd(ci, k, seed) >= p) continue;
          const x = cx * t.cell + rnd(ci, k + 10, seed) * t.cell;
          const z = cz * t.cell + rnd(ci, k + 20, seed) * t.cell;
          const y = baseHeightAt(t, x, z) - 0.03;
          const key = KEYS[k === 0 ? KI.grass_s : k === 1 ? KI.grass_b : k === 2 ? KI.weeds : k === 3 ? KI.pebbles : k === 4 ? KI.planks : KI.shell];
          const s = k <= 2 ? 0.75 + rnd(ci, k + 30, seed) * 0.6 : 0.8 + rnd(ci, k + 30, seed) * 0.45;
          const ch = chunks[Math.floor(z / CHUNK) * ccols + Math.floor(x / CHUNK)];
          ch.list.push(KI[key], x, y, z, rnd(ci, k + 40, seed) * 6.2832, s, rnd(ci, k + 50, seed), 1);
          if (y < ch.ymin) ch.ymin = y;
          if (y > ch.ymax) ch.ymax = y;
        }
      }
    }
  }
  let total = 0;
  for (const ch of chunks) { ch.data = new Float32Array(ch.list); total += ch.list.length / 8; ch.list = null; }

  // per-model GPU state (LOD0 near, LOD1 far)
  const cap = Math.min(Math.max(256, Math.ceil(total * 0.45)), 20000);
  const models = KEYS.map((key) => {
    const lods = [];
    for (let l = 0; l < 2; l++) {
      const inst = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(8 * cap), gl.DYNAMIC_DRAW);
      const m = uploadModel(gl, CLUTTER_MODELS[key](l), inst);
      m.inst = inst;
      m.data = new Float32Array(8 * cap);
      m.n = 0;
      lods.push(m);
    }
    return { key, lods };
  });
  const stats = { total, drawn: 0 };

  /** Hide clutter under trenches / buildings / sandbags (called when structures change). */
  const near = [];
  const SEG = [0, 0];
  function refilter(structGrid, structGridQuery) {
    for (const ch of chunks) {
      const d = ch.data;
      for (let o = 0; o < d.length; o += 8) {
        const x = d[o + 1], z = d[o + 3];
        near.length = 0;
        structGridQuery(structGrid, x, z, 1.5, near);
        let vis = 1;
        for (let i = 0; i < near.length && vis; i++) {
          const s = near[i];
          const def = STRUCTURES[s.type];
          if (def.kind === 'linear') {
            if (s.type === 'wire') continue;
            pointSegment(SEG, x, z, s.x1, s.z1, s.x2, s.z2);
            if (SEG[0] < def.width * 0.5 + (s.type === 'trench' ? 1.3 : 0.4)) vis = 0;
          } else if (def.footprint && s.type !== 'field') {
            const r = Math.max(def.footprint.w, def.footprint.d) * 0.55;
            if (Math.abs(x - s.x) < r && Math.abs(z - s.z) < r) vis = 0;
          }
        }
        d[o + 7] = vis;
      }
    }
  }

  function update(camera) {
    for (const m of models) for (const l of m.lods) l.n = 0;
    stats.drawn = 0;
    if (!total) return;
    const tx = camera.tx, tz = camera.tz;
    const ex = camera.eye[0], ey = camera.eye[1], ez = camera.eye[2];
    const lodD2 = (maxDist * 0.45) * (maxDist * 0.45);
    const r0x = Math.max(0, Math.floor((tx - maxDist) / CHUNK)), r1x = Math.min(ccols - 1, Math.floor((tx + maxDist) / CHUNK));
    const r0z = Math.max(0, Math.floor((tz - maxDist) / CHUNK)), r1z = Math.min(crows - 1, Math.floor((tz + maxDist) / CHUNK));
    const md2 = maxDist * maxDist;
    for (let cz = r0z; cz <= r1z; cz++) {
      for (let cx = r0x; cx <= r1x; cx++) {
        const ch = chunks[cz * ccols + cx];
        if (!ch.data.length) continue;
        if (!aabbInFrustum(camera.planes, cx * CHUNK, ch.ymin - 0.5, cz * CHUNK, (cx + 1) * CHUNK, ch.ymax + 1.5, (cz + 1) * CHUNK)) continue;
        const d = ch.data;
        for (let o = 0; o < d.length; o += 8) {
          if (!d[o + 7]) continue;
          const x = d[o + 1], z = d[o + 3];
          const dx = x - tx, dz = z - tz;
          if (dx * dx + dz * dz > md2) continue;
          const ddx = x - ex, ddy = d[o + 2] - ey, ddz = z - ez;
          const l = models[d[o]].lods[ddx * ddx + ddy * ddy + ddz * ddz < lodD2 * 4 ? 0 : 1];
          if (l.n >= cap) continue;
          const w = l.n * 8;
          l.data[w] = x; l.data[w + 1] = d[o + 2]; l.data[w + 2] = z; l.data[w + 3] = d[o + 4];
          l.data[w + 4] = d[o + 5]; l.data[w + 5] = d[o + 6]; l.data[w + 6] = 1; l.data[w + 7] = 0;
          l.n++;
        }
      }
    }
    for (const m of models) {
      for (const l of m.lods) {
        if (!l.n) continue;
        stats.drawn += l.n;
        gl.bindBuffer(gl.ARRAY_BUFFER, l.inst);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, l.data, 0, l.n * 8);
      }
    }
  }

  /** Draw with the static program already bound (setCommon done by the caller). */
  function draw(p, depth) {
    if (depth) return;
    for (const m of models) {
      for (const l of m.lods) {
        if (!l.n) continue;
        gl.uniform1f(p.u.uModelHeight, l.height || 1);
        gl.bindVertexArray(l.vao);
        drawElements(gl, gl.TRIANGLES, l.count, l.type, l.n);
      }
    }
  }

  return { update, draw, refilter, stats };
}
