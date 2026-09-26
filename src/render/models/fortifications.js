// Fortification geometry generated from the SAME structure data the simulation uses:
// trench segment endpoints/front/progress -> walls, revetment, duckboards, parapet, parados;
// sandbag lines and barbed-wire belts from their segment data. Rebuilt only when data changes.
import { MAT } from './meshbuilder.js';
import { C, mix } from './palette.js';
import { STRUCTURES } from '../../data/structures.js';
import { trenchFrame, trenchDepth } from '../../construction/trench.js';
import { hash32 } from '../../core/rng.js';

const FR = {};

function rnd(seed, i) {
  return hash32(seed, i, 29) / 4294967296;
}

/** Trench: ground(x,z) must be the BASE terrain height (uncarved). */
export function buildTrench(mb, seg, ground) {
  const v0 = mb.count();
  buildTrenchGeometry(mb, seg, ground);
  shadeTrench(mb, v0, seg, ground);
}

const RIM = [0.35, 0.315, 0.235]; // close to the surrounding earth/grass albedo

/**
 * Baked shading for a trench cut: the walls and floor only see a slit of sky, so vertices below
 * the surrounding surface darken with depth (reads as dug *into* the ground from the high RTS
 * camera, not as a box standing on it); the outer rims of parapet / parados fade into the terrain.
 */
function shadeTrench(mb, v0, seg, ground) {
  const fr = trenchFrame(seg, FR);
  const depth = Math.max(0.6, trenchDepth(seg));
  const rimOff = fr.halfWidth + 2.2; // parapet / parados crests sit inside this, the outer toes beyond
  const P = mb.P, C = mb.C;
  for (let v = v0, n = mb.count(); v < n; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const below = ground(x, z) - y;
    let k = 1;
    if (below > 0.02) k = 1 - 0.5 * Math.min(1, below / depth);
    const off = Math.abs((x - fr.cx) * fr.nx + (z - fr.cz) * fr.nz);
    const rim = off > rimOff ? Math.min(1, (off - rimOff) / 0.8) * 0.65 : 0;
    for (let c = 0; c < 3; c++) C[v * 4 + c] = (C[v * 4 + c] * (1 - rim) + RIM[c] * rim) * k;
  }
}

function buildTrenchGeometry(mb, seg, ground) {
  const fr = trenchFrame(seg, FR);
  const depth = trenchDepth(seg);
  const hw = fr.halfWidth;
  const old = seg.variant === 'old';
  const prog = Math.min(1, seg.progress);
  const n = Math.max(2, Math.ceil(fr.len / 1.0));
  const soil = old ? mix(C.soil, C.stoneDark, 0.2) : C.soil;
  const pH = (old ? 0.22 : 0.48) * Math.min(1, prog * 1.6); // parapet height grows with excavation
  const bH = (old ? 0.12 : 0.26) * Math.min(1, prog * 1.6);
  const outF = hw + 3.4, outB = hw + 3.0;
  // cross-section offsets (along the front normal): back outer ... front outer
  const prof = [
    [-outB, 0, 0], [-hw - 1.1, bH, 0], [-hw, bH * 0.6, 0], [-hw, -depth, 1],
    [hw, -depth, 1], [hw, pH * 0.5, 0], [hw + 0.9, pH, 0], [outF, 0, 0],
  ];
  const st = [];
  for (let i = 0; i <= n; i++) {
    const t = -fr.len / 2 + (fr.len * i) / n;
    const cx = fr.cx + fr.ux * t, cz = fr.cz + fr.uz * t;
    const base = ground(cx, cz);
    const row = [];
    for (let k = 0; k < prof.length; k++) {
      const off = prof[k][0];
      const x = cx + fr.nx * off, z = cz + fr.nz * off;
      let y;
      if (prof[k][2]) y = base + prof[k][1]; // floor follows the centerline surface (== trenchFloorAt)
      else y = ground(x, z) + prof[k][1] - (k === 0 || k === 7 ? 0.08 : 0);
      row.push([x, y, z]);
    }
    st.push(row);
  }
  if (depth > 0.02 || prog > 0) {
    for (let i = 0; i < n; i++) {
      const a = st[i], b = st[i + 1];
      for (let k = 0; k < prof.length - 1; k++) {
        let col = soil, mat = MAT.SOIL;
        if (k === 3) { col = old ? mix(C.soil, C.ichor, 0.4) : mix(C.soil, C.ichor, 0.25); mat = MAT.MUD; }
        else if (k === 2 || k === 4) col = mix(soil, C.char, 0.25);
        mb.col(col, mat);
        mb.face([a[k], b[k], b[k + 1], a[k + 1]]);
      }
    }
    // end caps
    for (const e of [0, n]) {
      const r = st[e];
      mb.col(mix(soil, C.char, 0.25), MAT.SOIL);
      const pts = [r[2], r[3], r[4], r[5]];
      mb.face(e === 0 ? pts : pts.slice().reverse());
    }
  }
  if (depth < 0.3 && !old) {
    // construction markers: stakes and taped outline
    mb.col(C.plank, MAT.WOOD);
    for (const s of [-1, 1]) for (const e of [-1, 1]) {
      const x = fr.cx + fr.ux * (fr.len / 2) * e + fr.nx * hw * s, z = fr.cz + fr.uz * (fr.len / 2) * e + fr.nz * hw * s;
      mb.push(x, ground(x, z) + 0.35, z).box(0.06, 0.7, 0.06).pop();
    }
    mb.col([0.72, 0.68, 0.6], MAT.CLOTH);
    for (const s of [-1, 1]) {
      const x = fr.cx + fr.nx * hw * s, z = fr.cz + fr.nz * hw * s;
      mb.push(x, ground(x, z) + 0.6, z, 0, Math.atan2(fr.ux, fr.uz), 0).box(0.02, 0.04, fr.len).pop();
    }
  }
  if (depth > 0.3) {
    const yaw = Math.atan2(fr.ux, fr.uz);
    // revetment posts + planks on both walls
    const posts = Math.max(2, Math.floor(fr.len / 1.6));
    for (let i = 0; i <= posts; i++) {
      const t = -fr.len / 2 + 0.3 + ((fr.len - 0.6) * i) / posts;
      for (const s of [-1, 1]) {
        if (old && rnd(seg.id, i * 3 + s + 5) < 0.45) continue;
        const x = fr.cx + fr.ux * t + fr.nx * (hw - 0.05) * s, z = fr.cz + fr.uz * t + fr.nz * (hw - 0.05) * s;
        const base = ground(fr.cx + fr.ux * t, fr.cz + fr.uz * t);
        mb.col(C.woodDark, MAT.WOOD);
        mb.push(x, base - depth / 2 + 0.15, z, old ? (rnd(seg.id, i) - 0.5) * 0.4 : 0, yaw, 0).box(0.1, depth + 0.3, 0.1).pop();
      }
    }
    if (!old) {
      mb.col(C.plank, MAT.WOOD).vary(0.15);
      for (const s of [-1, 1]) {
        for (let r = 0; r < 3; r++) {
          const yOff = -depth + 0.25 + r * ((depth - 0.3) / 2.2);
          if (yOff > 0.05) continue;
          const base = ground(fr.cx, fr.cz);
          const x = fr.cx + fr.nx * (hw - 0.02) * s, z = fr.cz + fr.nz * (hw - 0.02) * s;
          mb.push(x, base + yOff, z, 0, yaw, 0).box(0.04, 0.22, fr.len - 0.3).pop();
        }
      }
      // duckboards
      mb.col(mix(C.plank, C.soil, 0.3), MAT.WOOD);
      const slats = Math.floor(fr.len / 0.45);
      for (let i = 0; i < slats; i++) {
        const t = -fr.len / 2 + 0.3 + (i * (fr.len - 0.6)) / Math.max(1, slats - 1);
        const x = fr.cx + fr.ux * t, z = fr.cz + fr.uz * t;
        mb.push(x, ground(x, z) - depth + 0.06, z, 0, yaw + Math.PI / 2, 0).box(0.12, 0.05, hw * 1.4).pop();
      }
      mb.vary(0);
      // sandbag crest on the parapet (built trenches)
      if (prog >= 0.99) {
        const bags = Math.floor(fr.len / 0.55);
        mb.col(C.sandbag, MAT.CLOTH).vary(0.12);
        for (let l = 0; l < 2; l++) {
          for (let i = 0; i < bags; i++) {
            const t = -fr.len / 2 + 0.35 + ((i + (l % 2) * 0.5) * (fr.len - 0.7)) / Math.max(1, bags - 1);
            if (t > fr.len / 2 - 0.3) continue;
            const off = hw + 0.35;
            const x = fr.cx + fr.ux * t + fr.nx * off, z = fr.cz + fr.uz * t + fr.nz * off;
            mb.push(x, ground(x, z) + pH * 0.55 + 0.1 + l * 0.18, z, (rnd(seg.id, i + l * 40) - 0.5) * 0.1, yaw + (rnd(seg.id, i * 7 + l) - 0.5) * 0.25, 0);
            mb.box(0.34, 0.18, 0.54, { bevel: 0.06 });
            mb.pop();
          }
        }
        mb.vary(0);
      }
    }
  }
}

export function buildSandbags(mb, s, ground) {
  const def = STRUCTURES.sandbags;
  const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
  const len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  const yaw = Math.atan2(ux, uz);
  const nx = -uz, nz = ux;
  const layersTotal = 4;
  const layers = Math.max(1, Math.ceil(layersTotal * Math.min(1, s.progress + 0.001)));
  const damaged = s.hp / s.maxHp;
  const n = Math.max(1, Math.round(len / 0.56));
  mb.col(C.sandbag, MAT.CLOTH).vary(0.13);
  for (let l = 0; l < layers; l++) {
    for (const row of [-0.2, 0.2]) {
      if (l >= 2 && row < 0) continue; // stepped profile
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5 + (l % 2) * 0.5) / (n + 0.5);
        if (t > 1) continue;
        if (damaged < 0.6 && rnd(s.id, i * 11 + l * 3 + (row > 0 ? 1 : 0)) > damaged + 0.35) continue;
        const x = s.x1 + dx * t + nx * row, z = s.z1 + dz * t + nz * row;
        mb.push(x, ground(x, z) + 0.1 + l * 0.19, z, (rnd(s.id, i + l * 50) - 0.5) * 0.12, yaw + Math.PI / 2 + (rnd(s.id, i * 3 + l) - 0.5) * 0.18, 0);
        mb.box(0.56, 0.19, 0.34, { bevel: mb.lod ? 0 : 0.07 });
        mb.pop();
      }
    }
  }
  mb.vary(0);
  void def;
}

export function buildWire(mb, s, ground) {
  const def = STRUCTURES.wire;
  const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
  const len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  const nx = -uz, nz = ux;
  const old = s.variant === 'old';
  const prog = Math.min(1, s.progress);
  const hw = def.width * 0.36;
  // screw pickets
  const posts = Math.max(2, Math.floor(len / 2.4));
  mb.col(C.steelDark, MAT.DARKMETAL);
  for (let i = 0; i <= posts; i++) {
    const t = i / posts;
    for (const side of [-1, 1]) {
      if (old && rnd(s.id, i * 2 + side + 3) < 0.35) continue;
      const x = s.x1 + dx * t + nx * hw * side, z = s.z1 + dz * t + nz * hw * side;
      const lean = old ? (rnd(s.id, i + 9) - 0.5) * 0.6 : (rnd(s.id, i + 9) - 0.5) * 0.12;
      mb.push(x, ground(x, z), z, lean, 0, lean * 0.5).cyl(0.025, 0.02, 1.25, 4, { caps: false }).pop();
    }
  }
  if (prog < 0.35) return;
  // concertina coil (helix) along the belt
  mb.col(C.wire, MAT.METAL);
  const turns = Math.floor((len / 0.32) * Math.min(1, (prog - 0.35) / 0.65 + 0.001));
  const pts = [];
  for (let k = 0; k <= turns * 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const t = (k / 8) * 0.32;
    if (t > len) break;
    const sag = old ? Math.sin(t * 0.7 + s.id) * 0.18 : 0;
    const r = 0.46;
    const x = s.x1 + ux * t + nx * Math.cos(a) * r, z = s.z1 + uz * t + nz * Math.cos(a) * r;
    pts.push([x, ground(x, z) + 0.48 + Math.sin(a) * r - sag, z]);
  }
  for (let start = 0; start < pts.length - 1; start += 40) {
    const chunk = pts.slice(start, Math.min(pts.length, start + 41));
    if (chunk.length > 1) mb.tube(chunk, 0.008, 3);
  }
  // straight strands between pickets
  for (const side of [-1, 1]) for (const h of [0.35, 0.8, 1.15]) {
    if (old && h > 1) continue;
    const x0 = s.x1 + nx * hw * side, z0 = s.z1 + nz * hw * side;
    const x1 = s.x2 + nx * hw * side, z1 = s.z2 + nz * hw * side;
    const mid = [(x0 + x1) / 2, 0, (z0 + z1) / 2];
    mid[1] = ground(mid[0], mid[2]) + h - 0.12;
    mb.tube([[x0, ground(x0, z0) + h, z0], mid, [x1, ground(x1, z1) + h, z1]], 0.006, 3);
  }
}
