// Phase 3 structure models (model-local: +z = front, footprint centred): the civilian settlement,
// farm, livestock pen, quarry and the concrete pillbox. Settlements are farmsteads of the
// principality — stone house, barn, well, bell frame — not a second fortress.
import { MeshBuilder, MAT } from './meshbuilder.js';
import { C, mix, scale } from './palette.js';
import { hash32 } from '../../core/rng.js';

function rnd(seed, i) {
  return hash32(seed, i, 911) / 4294967296;
}

/** Gable roof over a w x d rectangle (ridge along z), overhang o, height h, at the current frame. */
function gableRoof(mb, w, d, h, o = 0.3) {
  mb.push(0, 0, -d / 2 - o);
  mb.extrude([[-w / 2 - o, 0], [w / 2 + o, 0], [0, h]], d + o * 2);
  mb.pop();
}

function house(mb, w, d, wallH, roofH, wallCol, roofCol, lod) {
  mb.col(wallCol, MAT.STONE).vary(0.06);
  mb.push(0, wallH / 2, 0).box(w, wallH, d, { bevel: lod ? 0 : 0.04 }).pop();
  mb.vary(0);
  mb.col(roofCol, MAT.DARKMETAL).push(0, wallH, 0);
  gableRoof(mb, w, d, roofH, 0.35);
  mb.pop();
  if (lod) return;
  // door + windows (+z face), chimney
  mb.col(C.woodDark, MAT.WOOD).push(0, 0.95, d / 2 + 0.02).box(0.9, 1.9, 0.06).pop();
  mb.col([0.05, 0.05, 0.045], MAT.GLASS);
  for (const x of [-w / 3, w / 3]) mb.push(x, wallH * 0.6, d / 2 + 0.02).box(0.6, 0.7, 0.05).pop();
  mb.col(C.brick, MAT.STONE).push(w / 3, wallH + roofH * 0.7, -d / 4).box(0.45, roofH * 1.1, 0.45).pop();
}

function lowWall(mb, x0, z0, x1, z1, h, seed) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.round(len / 0.9));
  mb.col(C.stone, MAT.STONE).vary(0.12);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const hh = h * (0.75 + rnd(seed, i) * 0.4);
    mb.push(x0 + dx * t, hh / 2, z0 + dz * t, 0, Math.atan2(dx, dz), 0).box(0.55, hh, len / n + 0.05, { bevel: 0.06 }).pop();
  }
  mb.vary(0);
}

function post(mb, x, z, h, seed) {
  mb.push(x, h / 2, z, (rnd(seed, 1) - 0.5) * 0.12, 0, (rnd(seed, 2) - 0.5) * 0.12).box(0.12, h, 0.12).pop();
}

// ------------------------------------------------------------------ settlement

/** Civilian settlement (12 x 10): farmhouse, barn, well, bell frame, a low stone wall. */
export function buildSettlement(lod) {
  const mb = new MeshBuilder({ lod, seed: 801 });
  // farmhouse (back left) and barn (back right)
  mb.push(-2.4, 0, -1.6);
  house(mb, 5.2, 4.2, 2.6, 2.1, C.plaster, C.slate, lod);
  mb.pop();
  mb.push(3.3, 0, -1.9);
  mb.col(C.woodDark, MAT.WOOD).vary(0.1);
  mb.push(0, 1.4, 0).box(3.8, 2.8, 3.6).pop();
  mb.vary(0);
  mb.col(C.plank, MAT.WOOD).push(0, 2.8, 0);
  gableRoof(mb, 3.8, 3.6, 1.6, 0.3);
  mb.pop();
  if (!lod) mb.col([0.06, 0.05, 0.04], MAT.WOOD).push(0, 1.1, 1.82).box(1.8, 2.1, 0.05).pop();
  mb.pop();
  // well
  mb.push(-4.4, 0, 3.2);
  mb.col(C.stone, MAT.STONE).lathe([[0.75, 0], [0.75, 0.8], [0.55, 0.8], [0.55, 0.1]], lod ? 8 : 14).pop();
  if (!lod) {
    mb.push(-4.4, 0, 3.2);
    mb.col(C.woodDark, MAT.WOOD);
    for (const s of [1, -1]) mb.push(0.65 * s, 1.1, 0).box(0.1, 2.2, 0.1).pop();
    mb.push(0, 2.2, 0).box(1.5, 0.1, 0.1).pop();
    mb.col(C.plank, MAT.WOOD).push(0, 2.25, 0);
    gableRoof(mb, 1.6, 1.2, 0.6, 0.1);
    mb.pop();
    mb.pop();
  }
  // bell frame with the principality's cross
  mb.push(4.6, 0, 3.4);
  mb.col(C.woodDark, MAT.WOOD);
  for (const s of [1, -1]) mb.push(0.5 * s, 1.6, 0).box(0.14, 3.2, 0.14).pop();
  mb.push(0, 3.2, 0).box(1.3, 0.14, 0.2).pop();
  mb.col(C.bronze, MAT.METAL).push(0, 2.75, 0).lathe([[0.22, -0.3], [0.2, -0.15], [0.12, 0.05], [0.0, 0.08]], lod ? 8 : 12).pop();
  mb.col(C.crossRed, MAT.ACCENT).push(0, 3.75, 0).box(0.08, 0.7, 0.05).pop();
  mb.push(0, 3.85, 0).box(0.4, 0.08, 0.05).pop();
  mb.pop();
  // low stone wall with a gate gap at the front
  lowWall(mb, -6, -5, 6, -5, 1.0, 1);
  lowWall(mb, -6, -5, -6, 5, 1.0, 2);
  lowWall(mb, 6, -5, 6, 5, 1.0, 3);
  lowWall(mb, -6, 5, -1.6, 5, 0.9, 4);
  lowWall(mb, 1.6, 5, 6, 5, 0.9, 5);
  if (!lod) {
    // stores: sacks, crates, a leaning cart wheel, firewood
    mb.col(C.sandbag, MAT.CLOTH).vary(0.1);
    for (let i = 0; i < 5; i++) mb.push(0.2 + (i % 3) * 0.6, 0.25 + Math.floor(i / 3) * 0.35, 1.2, 0, i * 0.4, 0).sphere(0.3, 0.22, 0.26, 7, 5).pop();
    mb.vary(0);
    mb.col(C.wood, MAT.WOOD).push(-0.6, 0.35, 2.0).box(0.7, 0.7, 0.7, { bevel: 0.03 }).pop();
    mb.col(C.woodDark, MAT.WOOD).push(1.8, 0.62, 0.4, 0, 0.3, 1.35).lathe([[0.6, -0.04], [0.6, 0.04], [0.52, 0.04], [0.52, -0.04]], 14).pop();
    mb.col(C.woodDark, MAT.WOOD);
    for (let i = 0; i < 6; i++) mb.push(-5.2, 0.12 + Math.floor(i / 3) * 0.2, -3.2 + (i % 3) * 0.22, 0, 0, Math.PI / 2).cyl(0.1, 0.1, 1.2, 6).pop();
  }
  return mb.finish();
}

// ------------------------------------------------------------------ farm

/** Farm (22 x 16 area): ploughed furrows and crop rows, fence posts, a scarecrow, a tool hut. */
export function buildFarm(lod) {
  const mb = new MeshBuilder({ lod, seed: 811 });
  const w = 22, d = 16;
  const rows = lod ? 6 : 12;
  for (let i = 0; i < rows; i++) {
    const z = -d / 2 + 1.2 + (i * (d - 2.4)) / (rows - 1);
    mb.col(mix(C.soil, C.char, 0.15), MAT.SOIL).push(0, 0.08, z).box(w - 2, 0.16, 0.5, { taper: [0.7, 1] }).pop();
    if (!lod) {
      // crop tufts along the ridge
      mb.col(i % 3 === 0 ? mix(C.dryGrass, C.soil, 0.2) : [0.3, 0.33, 0.16], MAT.CLOTH).vary(0.15);
      for (let k = 0; k < 9; k++) mb.push(-w / 2 + 2 + k * ((w - 4) / 8) + (rnd(i, k) - 0.5) * 0.6, 0.3, z, 0, rnd(k, i) * 3, 0).box(0.35, 0.3 + rnd(i + 7, k) * 0.25, 0.3, { taper: [0.3, 0.5] }).pop();
      mb.vary(0);
    }
  }
  mb.col(C.woodDark, MAT.WOOD);
  const step = lod ? 11 : 5.5;
  for (let x = -w / 2; x <= w / 2 + 0.01; x += step) { post(mb, x, -d / 2, 1.1, x * 7); post(mb, x, d / 2, 1.1, x * 11); }
  for (let z = -d / 2 + 4; z < d / 2; z += 4) { post(mb, -w / 2, z, 1.1, z * 13); post(mb, w / 2, z, 1.1, z * 17); }
  // tool hut
  mb.push(w / 2 - 1.6, 0, -d / 2 + 1.6);
  mb.col(C.plank, MAT.WOOD).push(0, 0.9, 0).box(2.2, 1.8, 2.0).pop();
  mb.col(C.woodDark, MAT.WOOD).push(0, 1.8, 0);
  gableRoof(mb, 2.2, 2.0, 0.9, 0.2);
  mb.pop();
  mb.pop();
  if (!lod) {
    // scarecrow in an old greatcoat with a cross
    mb.push(-w / 2 + 3, 0, 0);
    mb.col(C.woodDark, MAT.WOOD).push(0, 1.1, 0).box(0.1, 2.2, 0.1).pop();
    mb.push(0, 1.7, 0).box(1.3, 0.08, 0.08).pop();
    mb.col(C.coatDark, MAT.CLOTH).push(0, 1.35, 0).box(0.5, 0.75, 0.25, { taper: [1.3, 1] }).pop();
    mb.col(C.canvas, MAT.CLOTH).push(0, 2.0, 0).sphere(0.16, 0.18, 0.16, 7, 5).pop();
    mb.col(C.crossRed, MAT.ACCENT).push(0, 1.45, 0.13).box(0.06, 0.25, 0.01).pop();
    mb.pop();
  }
  return mb.finish();
}

// ------------------------------------------------------------------ livestock pen

/** Livestock pen (12 x 10): post-and-rail fence with a gate, trough, hay, a lean-to shelter. */
export function buildPen(lod) {
  const mb = new MeshBuilder({ lod, seed: 821 });
  const w = 12, d = 10;
  mb.col(C.woodDark, MAT.WOOD);
  const step = lod ? 4 : 2;
  for (let x = -w / 2; x <= w / 2 + 0.01; x += step) { post(mb, x, -d / 2, 1.3, x * 3); if (Math.abs(x) > 1.2) post(mb, x, d / 2, 1.3, x * 5); }
  for (let z = -d / 2 + step; z < d / 2; z += step) { post(mb, -w / 2, z, 1.3, z * 7); post(mb, w / 2, z, 1.3, z * 9); }
  mb.col(C.wood, MAT.WOOD);
  for (const y of lod ? [0.8] : [0.5, 1.0]) {
    mb.push(0, y, -d / 2).box(w, 0.08, 0.06).pop();
    mb.push(-w / 2, y, 0).box(0.06, 0.08, d).pop();
    mb.push(w / 2, y, 0).box(0.06, 0.08, d).pop();
    mb.push(-w / 4 - 0.6, y, d / 2).box(w / 2 - 1.2, 0.08, 0.06).pop();
    mb.push(w / 4 + 0.6, y, d / 2).box(w / 2 - 1.2, 0.08, 0.06).pop();
  }
  // gate swung open
  if (!lod) mb.col(C.plank, MAT.WOOD).push(1.2, 0.7, d / 2 + 0.9, 0, 1.2, 0).box(0.06, 0.9, 2.0).pop();
  // lean-to shelter at the back
  mb.push(-2.5, 0, -d / 2 + 1.4);
  mb.col(C.woodDark, MAT.WOOD);
  for (const x of [-2, 2]) { mb.push(x, 1.1, 1.1).box(0.12, 2.2, 0.12).pop(); mb.push(x, 0.7, -1.1).box(0.12, 1.4, 0.12).pop(); }
  mb.col(C.plank, MAT.WOOD).push(0, 1.8, 0, -0.32, 0, 0).box(4.6, 0.08, 2.8).pop();
  mb.pop();
  // trough + hay
  mb.col(C.woodDark, MAT.WOOD).push(3, 0.25, 1.5).box(2.2, 0.5, 0.6, { bevel: 0.03 }).pop();
  mb.col(mix(C.dryGrass, C.soil, 0.1), MAT.CLOTH).vary(0.1);
  for (let i = 0; i < (lod ? 2 : 4); i++) mb.push(3.4 + (i % 2) * 1.1, 0.35 + Math.floor(i / 2) * 0.6, -3.2, 0, 0.2 * i, 0).box(1.0, 0.6, 0.7, { bevel: 0.08 }).pop();
  mb.vary(0);
  return mb.finish();
}

// ------------------------------------------------------------------ quarry

/** Quarry (10 x 9): a cut rock face in steps, dressed blocks, rubble, a timber derrick. */
export function buildQuarry(lod) {
  const mb = new MeshBuilder({ lod, seed: 831 });
  // the outcrop: a rough rock mass (reads as rock from every side), cut in steps toward the front
  mb.col(C.stoneDark, MAT.STONE).jitter(lod ? 0.12 : 0.3, 1.1, 7);
  mb.push(0, 0.1, -2.3).sphere(4.7, 3.1, 2.1, lod ? 8 : 12, lod ? 5 : 7).pop();
  mb.push(-3.3, 0, -1.4).sphere(1.6, 2.0, 1.5, lod ? 6 : 9, 5).pop();
  mb.push(3.5, 0, -1.7).sphere(1.4, 1.5, 1.4, lod ? 6 : 9, 5).pop();
  mb.noJitter();
  mb.col(C.stone, MAT.STONE);
  mb.push(0, 1.25, -0.7).box(6.4, 2.5, 1.2, { bevel: 0.04 }).pop();
  mb.push(0, 0.9, 0.3).box(7.4, 1.8, 1.2, { bevel: 0.03 }).pop();
  mb.push(0, 0.4, 1.4).box(6.6, 0.8, 1.2, { bevel: 0.03 }).pop();
  // rubble and spoil at the foot of the cut
  mb.col(mix(C.stone, C.soil, 0.35), MAT.STONE).vary(0.1);
  for (let i = 0; i < (lod ? 3 : 9); i++) mb.push(-3.6 + rnd(i, 9) * 7.2, 0.1, 2.1 + rnd(i, 10) * 1.6, rnd(i, 11), rnd(i, 12) * 3, 0).box(0.3 + rnd(i, 13) * 0.4, 0.22, 0.3 + rnd(i, 14) * 0.3, { bevel: 0.05 }).pop();
  mb.vary(0);
  // dressed blocks
  mb.col(mix(C.stone, C.plaster, 0.3), MAT.STONE).vary(0.08);
  for (let i = 0; i < (lod ? 3 : 7); i++) mb.push(-3.4 + (i % 4) * 1.1, 0.3 + Math.floor(i / 4) * 0.6, 3.3, 0, rnd(i, 5) * 0.4, 0).box(0.95, 0.58, 0.7, { bevel: 0.03 }).pop();
  mb.vary(0);
  if (!lod) {
    mb.col(C.stoneDark, MAT.STONE).jitter(0.08, 3, 9);
    mb.push(3.4, 0.35, 2.8).sphere(1.0, 0.45, 0.9, 8, 5).pop();
    mb.noJitter();
  }
  // derrick: A-frame + boom + rope
  mb.push(-3.2, 0, 1.8);
  mb.col(C.woodDark, MAT.WOOD);
  for (const s of [1, -1]) mb.cylBetween([0.9 * s, 0, 0], [0, 4.6, -0.4], 0.09, 0.07, lod ? 5 : 7);
  mb.cylBetween([0, 0, -1.6], [0, 4.6, -0.4], 0.08, 0.07, lod ? 5 : 7);
  mb.cylBetween([0, 1.2, -0.2], [2.8, 3.6, 0.4], 0.07, 0.05, lod ? 5 : 7);
  if (!lod) {
    mb.col(C.rope, MAT.CLOTH).cylBetween([2.8, 3.6, 0.4], [2.8, 1.2, 0.4], 0.015, 0.015, 4);
    mb.col(C.stone, MAT.STONE).push(2.8, 0.9, 0.4).box(0.6, 0.5, 0.6, { bevel: 0.03 }).pop();
  }
  mb.pop();
  // tool shed
  mb.push(3.4, 0, -0.2);
  mb.col(C.plank, MAT.WOOD).push(0, 0.9, 0).box(1.8, 1.8, 1.6).pop();
  mb.col(C.slate, MAT.DARKMETAL).push(0, 1.8, 0);
  gableRoof(mb, 1.8, 1.6, 0.7, 0.2);
  mb.pop();
  mb.pop();
  return mb.finish();
}

// ------------------------------------------------------------------ pillbox

/** Concrete pillbox (5 x 5): hexagonal casemate, firing slits to the front, soil on the roof. */
export function buildPillbox(lod) {
  const mb = new MeshBuilder({ lod, seed: 841 });
  const concrete = mix(C.stone, C.plaster, 0.35);
  mb.col(concrete, MAT.STONE).vary(0.04);
  mb.push(0, 0, 0, 0, Math.PI / 6, 0).lathe([[2.4, 0], [2.35, 1.5], [2.2, 1.65], [0, 1.66]], 6, { capTop: true }).pop();
  mb.vary(0);
  // slits
  mb.col([0.03, 0.03, 0.028], MAT.DARKMETAL);
  for (const a of [0, 1.05, -1.05]) mb.push(Math.sin(a) * 2.08, 1.05, Math.cos(a) * 2.08, 0, a, 0).box(1.0, 0.18, 0.12).pop();
  if (!lod) {
    // soil + sandbag cap, entrance at the back
    mb.col(C.soil, MAT.SOIL).jitter(0.06, 2, 3).push(0, 1.75, 0).sphere(2.1, 0.28, 2.1, 10, 4, { hemi: 0 }).pop().noJitter();
    mb.col(C.sandbag, MAT.CLOTH).vary(0.12);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      mb.push(Math.sin(a) * 1.9, 1.85, Math.cos(a) * 1.9, 0, a + Math.PI / 2, 0).box(0.56, 0.2, 0.34, { bevel: 0.06 }).pop();
    }
    mb.vary(0);
    mb.col([0.04, 0.035, 0.03], MAT.DARKMETAL).push(0, 0.8, -2.15).box(0.9, 1.6, 0.2).pop();
    mb.col(C.crossRed, MAT.ACCENT).push(0.9, 1.35, 2.02).box(0.05, 0.3, 0.02).pop();
    mb.push(0.9, 1.4, 2.02).box(0.22, 0.05, 0.02).pop();
  }
  return mb.finish();
}

export const STRUCTURE_MODELS_P3 = {
  settlement: (lod) => buildSettlement(lod),
  farm: (lod) => buildFarm(lod),
  livestock_pen: (lod) => buildPen(lod),
  quarry: (lod) => buildQuarry(lod),
  pillbox: (lod) => buildPillbox(lod),
};
