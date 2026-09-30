#!/usr/bin/env node
// CPU projection of the actual procedural rest meshes for geometry review. Not a WebGL smoke.
import { mkdirSync, writeFileSync } from 'node:fs';
import { UNIT_MODELS_SULTANATE } from '../src/render/models/humans_sultanate.js';
import { STRUCTURE_MODELS_SULTANATE } from '../src/render/models/structures_sultanate.js';
import { MeshBuilder } from '../src/render/models/meshbuilder.js';
import { buildIronWall } from '../src/render/models/walls.js';
const models = [];
for (const [id, fn] of Object.entries(UNIT_MODELS_SULTANATE)) models.push([id.replace('is_', ''), fn(0).mesh]);
models.push(['Citadel', STRUCTURE_MODELS_SULTANATE.sultanate_citadel(0)]);
const wall = new MeshBuilder(); buildIronWall(wall, { id: 1, x1: -18, z1: 0, x2: 18, z2: 0, hp: 10000, maxHp: 10000, front: 1 }, () => 0);
models.push(['Iron Wall / local span', wall.finish()]);
const W = 1080, H = 730, cw = 360, ch = 340, yaw = -0.65, pitch = 0.4;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#141817"/><text x="20" y="27" fill="#cbd4cb" font-family="sans-serif" font-size="17">Phase 05C — procedural rest meshes / CPU projection (not a browser screenshot)</text>`;
for (let n = 0; n < models.length; n++) {
  const [name, m] = models[n], f = new Float32Array(m.vertices), u = new Uint8Array(m.vertices), pts = [];
  for (let i = 0; i < m.vertexCount; i++) {
    const x = f[i * 6], y = f[i * 6 + 1], z = f[i * 6 + 2];
    const xx = x * Math.cos(yaw) + z * Math.sin(yaw), zz = -x * Math.sin(yaw) + z * Math.cos(yaw);
    pts.push([xx, -y * Math.cos(pitch) + zz * Math.sin(pitch), y * Math.sin(pitch) + zz * Math.cos(pitch)]);
  }
  const minx = Math.min(...pts.map((p) => p[0])), maxx = Math.max(...pts.map((p) => p[0]));
  const miny = Math.min(...pts.map((p) => p[1])), maxy = Math.max(...pts.map((p) => p[1]));
  const scale = Math.min(300 / (maxx - minx), 255 / (maxy - miny));
  const ox = (n % 3) * cw + cw / 2 - (maxx + minx) * scale / 2, oy = Math.floor(n / 3) * ch + 50 + (290 - (maxy - miny) * scale) / 2 - miny * scale;
  const tri = [];
  for (let i = 0; i < m.indexCount; i += 3) { const ids = [m.indices[i], m.indices[i + 1], m.indices[i + 2]]; tri.push({ ids, d: ids.reduce((s, k) => s + pts[k][2], 0) }); }
  tri.sort((a, b) => a.d - b.d);
  for (const t of tri) {
    const k = t.ids[0], norm = new Int8Array(m.vertices, k * 24 + 12, 3);
    const light = 0.62 + Math.max(0, (norm[0] * -0.4 + norm[1] * 0.8 + norm[2] * 0.45) / 127) * 0.45;
    const color = [0, 1, 2].map((c) => Math.min(255, Math.round(u[k * 24 + 16 + c] * light)));
    svg += `<polygon points="${t.ids.map((j) => [(ox + pts[j][0] * scale).toFixed(1), (oy + pts[j][1] * scale).toFixed(1)].join(',')).join(' ')}" fill="rgb(${color.join(',')})"/>`;
  }
  svg += `<text x="${n % 3 * cw + cw / 2}" y="${Math.floor(n / 3) * ch + 367}" text-anchor="middle" fill="#d6ccb2" font-family="sans-serif" font-size="18">${name}</text>`;
}
svg += '</svg>'; mkdirSync('test-output', { recursive: true }); writeFileSync('test-output/phase5c-models.svg', svg);
console.log('Wrote test-output/phase5c-models.svg');
