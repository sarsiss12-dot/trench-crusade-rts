// Structure models (model-local: +z = front, footprint centered). Gothic-military New Antioch
// works; organic, grotesque Black Grail altars. Plus unique world meshes (houses, ruins, bridge).
import { MeshBuilder, MAT } from './meshbuilder.js';
import { C, mix } from './palette.js';
import { hash32 } from '../../core/rng.js';
import { STRUCTURE_MODELS_P2 } from './structures_p2.js';

function rnd(seed, i) {
  return hash32(seed, i, 313) / 4294967296;
}

function gothicArch(w, h) {
  const hw = w / 2;
  const pts = [[-hw, 0], [hw, 0], [hw, h - hw * 1.2]];
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    pts.push([hw * (1 - t) * (1 - t * 0.2), h - hw * 1.2 + hw * 1.2 * Math.sin(t * Math.PI / 2)]);
  }
  pts.push([0, h]);
  for (let i = 5; i >= 1; i--) {
    const t = i / 6;
    pts.push([-hw * (1 - t) * (1 - t * 0.2), h - hw * 1.2 + hw * 1.2 * Math.sin(t * Math.PI / 2)]);
  }
  pts.push([-hw, h - hw * 1.2]);
  return pts;
}

function pyramid(mb, w, h, d) {
  mb.lathe([[Math.SQRT1_2 * w, 0], [0, h]], 4, { capBottom: false, sx: 1, sz: d / w });
}

function roofPrism(mb, w, h, len, overhang = 0.4) {
  mb.push(0, 0, 0, 0, 0, 0);
  mb.extrude([[-w / 2 - overhang, 0], [w / 2 + overhang, 0], [0, h]], len + overhang * 2);
  mb.pop();
}

function sandbagRow(mb, x0, z0, x1, z1, layers, seed) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const yaw = Math.atan2(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 0.55));
  mb.col(C.sandbag, MAT.CLOTH).vary(0.12);
  for (let l = 0; l < layers; l++) {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5 + (l % 2) * 0.5) / (n + 0.5);
      if (t > 1) continue;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      mb.push(x, 0.13 + l * 0.2, z, (rnd(seed, i + l * 50) - 0.5) * 0.1, yaw + Math.PI / 2 + (rnd(seed, i * 3 + l) - 0.5) * 0.2, 0);
      mb.box(0.56, 0.2, 0.34, { bevel: mb.lod ? 0 : 0.07 });
      mb.pop();
    }
  }
  mb.vary(0);
}

// ------------------------------------------------------------------ New Antioch

export function buildBastion(lod, damaged = false) {
  const mb = new MeshBuilder({ lod, seed: 201 });
  const stone = C.stone, dark = C.stoneDark;
  mb.col(dark, MAT.STONE).vary(0.05);
  mb.push(0, 0.5, 0).box(23, 1.2, 19, { bevel: 0.2 }).pop();
  // nave
  mb.col(stone, MAT.STONE);
  mb.push(0, 5.6, -2).box(10.5, 9, 14, { bevel: 0.15 }).pop();
  if (!damaged) {
    mb.col(C.slate, MAT.DARKMETAL).push(0, 10.1, -2).push(0, 0, 0, 0, 0, 0);
    roofPrism(mb, 10.5, 5.2, 14);
    mb.pop().pop();
  } else {
    mb.col(C.char, MAT.WOOD).push(0, 10.1, -5.5);
    roofPrism(mb, 10.5, 4.6, 6.5);
    mb.pop();
    for (let k = 0; k < (lod ? 3 : 7); k++) mb.push(-4 + k * 1.3, 11.5 + rnd(3, k), 1, (rnd(5, k) - 0.5) * 0.8, 0, 0.9).box(0.25, 3.5, 0.25).pop();
  }
  // buttresses
  mb.col(dark, MAT.STONE);
  for (let i = 0; i < 4; i++) {
    const z = -7.5 + i * 3.6;
    for (const s of [1, -1]) mb.push(s * 5.9, 4.6, z).box(1.3, 7.2, 1.6, { taper: [0.5, 0.7], shift: [-s * 0.25, 0] }).pop();
  }
  // tower + spire at the front
  mb.col(stone, MAT.STONE);
  mb.push(0, 9.2, 6.2).box(6.2, 17, 6.2, { bevel: 0.15 }).pop();
  mb.col(dark, MAT.STONE).push(0, 17.9, 6.2).box(6.8, 0.6, 6.8).pop();
  if (!damaged) {
    mb.col(C.slate, MAT.DARKMETAL).push(0, 18.2, 6.2);
    pyramid(mb, 3.3, 11, 3.3);
    mb.pop();
    if (!lod) {
      mb.col(C.brass, MAT.METAL).push(0, 29.1, 6.2).box(0.18, 2.4, 0.18).pop();
      mb.push(0, 29.8, 6.2).box(1.3, 0.18, 0.18).pop();
    }
  } else {
    mb.col(C.char, MAT.WOOD).jitter(0.3, 0.8, 9).push(0, 18.2, 6.2);
    pyramid(mb, 3.3, 3.5, 3.3);
    mb.pop().noJitter();
  }
  // pinnacles
  mb.col(dark, MAT.STONE);
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    mb.push(sx * 3.1, 18.2, 6.2 + sz * 3.1);
    pyramid(mb, 0.55, 2.6, 0.55);
    mb.pop();
  }
  // windows & gate
  mb.col([0.035, 0.035, 0.04], MAT.GLASS);
  for (let i = 0; i < 3; i++) {
    const z = -6 + i * 3.6;
    for (const s of [1, -1]) {
      mb.push(s * 5.27, 3.2, z, 0, s * Math.PI / 2, 0).extrude(gothicArch(1.4, 4.2), 0.08).pop();
    }
  }
  mb.push(0, 10, 9.32).extrude(gothicArch(2.0, 4.5), 0.08).pop();
  mb.col(C.woodDark, MAT.WOOD).push(0, 1.1, 9.32).extrude(gothicArch(3.0, 5.0), 0.12).pop();
  if (!lod) {
    mb.col(C.steelDark, MAT.METAL);
    for (let k = 0; k < 4; k++) mb.push(0, 1.6 + k * 0.9, 9.4).box(2.9, 0.1, 0.05).pop();
  }
  // curtain wall with corner towers
  mb.col(mix(stone, dark, 0.5), MAT.STONE).vary(0.05);
  const hw = 12.5, hd = 10.5, wh = 2.4;
  mb.push(0, wh / 2, -hd).box(hw * 2, wh, 0.8).pop();
  for (const s of [1, -1]) mb.push(s * hw, wh / 2, 0).box(0.8, wh, hd * 2).pop();
  for (const s of [1, -1]) mb.push(s * (hw * 0.62), wh / 2, hd).box(hw * 0.76, wh, 0.8).pop();
  mb.vary(0);
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    mb.col(dark, MAT.STONE).push(sx * hw, 0, sz * hd).cyl(1.5, 1.3, 4.2, lod ? 7 : 12).pop();
    mb.col(C.slate, MAT.DARKMETAL).push(sx * hw, 4.2, sz * hd).lathe([[1.7, 0], [0, 2.4]], lod ? 7 : 12).pop();
  }
  if (!lod) {
    // crenellations
    mb.col(stone, MAT.STONE);
    for (let i = -6; i <= 6; i++) mb.push(i * 1.9, wh + 0.3, -hd).box(0.9, 0.6, 0.85).pop();
    // gate sandbags + banners
    sandbagRow(mb, -4.5, hd + 2.2, -1.8, hd + 2.2, 3, 7);
    sandbagRow(mb, 1.8, hd + 2.2, 4.5, hd + 2.2, 3, 8);
    for (const s of [1, -1]) {
      mb.col(C.crossRed, MAT.ACCENT).sheet([s * 2.2, 15.5, 9.35], [s * 1.3, 15.5, 9.35], [s * 1.3, 9.5, 9.45], [s * 2.2, 9.5, 9.45]);
      mb.col(C.tabard, MAT.CLOTH).sheet([s * 1.85, 14.6, 9.4], [s * 1.65, 14.6, 9.4], [s * 1.65, 11.0, 9.47], [s * 1.85, 11.0, 9.47]);
    }
  }
  // ---- richer gothic-military detail (LOD0 mostly)
  // plinth + cornice bands on the nave
  mb.col(dark, MAT.STONE);
  mb.push(0, 1.35, -2).box(10.9, 0.5, 14.4).pop();
  mb.push(0, 9.95, -2).box(11.1, 0.35, 14.6).pop();
  // flying buttresses: arcs from the outer piers to the clerestory
  if (!lod) {
    mb.col(mix(stone, dark, 0.4), MAT.STONE);
    for (let i = 0; i < 4; i++) {
      const z = -7.5 + i * 3.6;
      for (const sx of [1, -1]) {
        mb.tube([[sx * 6.3, 7.6, z], [sx * 5.9, 8.9, z], [sx * 5.35, 9.4, z]], [0.32, 0.26, 0.22], 5);
        mb.push(sx * 6.05, 8.25, z);
        pyramid(mb, 0.42, 1.5, 0.42);
        mb.pop();
      }
    }
    // roof ridge crest
    mb.col(C.steelDark, MAT.DARKMETAL);
    mb.push(0, 15.35, -2).box(0.18, 0.22, 14.2).pop();
    for (let k = 0; k < 7; k++) mb.push(0, 15.6, -8.5 + k * 2.2).box(0.08, 0.5, 0.08).pop();
    // belfry openings on all four tower faces + clock-less louvres
    mb.col([0.03, 0.03, 0.035], MAT.GLASS);
    for (let f = 0; f < 4; f++) {
      const a = (f * Math.PI) / 2;
      mb.push(Math.sin(a) * 3.13, 13.2, 6.2 + Math.cos(a) * 3.13, 0, a, 0).extrude(gothicArch(1.5, 3.6), 0.06).pop();
    }
    mb.col(C.woodDark, MAT.WOOD);
    for (let f = 0; f < 4; f++) {
      const a = (f * Math.PI) / 2;
      for (let k = 0; k < 4; k++) mb.push(Math.sin(a) * 3.16, 13.6 + k * 0.62, 6.2 + Math.cos(a) * 3.16, -0.5, a, 0).box(1.35, 0.08, 0.14).pop();
    }
    // tower corner buttresses
    mb.col(dark, MAT.STONE);
    for (const sx of [1, -1]) for (const sz of [1, -1]) mb.push(sx * 3.25, 6.5, 6.2 + sz * 3.25).box(0.8, 13, 0.8, { taper: [0.7, 0.7] }).pop();
    // spire lucarnes (small gabled openings)
    mb.col(C.slate, MAT.DARKMETAL);
    for (let f = 0; f < 4; f++) {
      const a = (f * Math.PI) / 2;
      mb.push(Math.sin(a) * 1.9, 21.2, 6.2 + Math.cos(a) * 1.9, 0, a, 0).box(0.7, 1.0, 0.6).pop();
      mb.push(Math.sin(a) * 2.0, 21.95, 6.2 + Math.cos(a) * 2.0, 0, a + Math.PI / 2, 0);
      roofPrism(mb, 0.8, 0.55, 0.7, 0.05);
      mb.pop();
    }
    // rose window above the gate
    mb.col([0.05, 0.02, 0.02], MAT.GLASS).push(0, 7.2, 9.33, Math.PI / 2, 0, 0).cyl(1.05, 1.05, 0.06, 16).pop();
    mb.col(dark, MAT.STONE);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      mb.push(Math.cos(a) * 0.55, 7.2 + Math.sin(a) * 0.55, 9.38, 0, 0, a).box(1.0, 0.07, 0.05).pop();
    }
    // crenellations on the side walls, wall-walk sandbag nests at the corners
    mb.col(stone, MAT.STONE);
    for (const sx of [1, -1]) for (let i = -4; i <= 4; i++) mb.push(sx * hw, wh + 0.3, i * 2.1).box(0.85, 0.6, 0.9).pop();
    for (const sx of [1, -1]) for (let i = 0; i < 3; i++) mb.push(sx * (hw * 0.62 + (i - 1) * 2.4), wh + 0.3, hd).box(0.9, 0.6, 0.85).pop();
    sandbagRow(mb, -hw + 1.6, -hd + 1.3, -hw + 3.6, -hd + 1.3, 2, 31);
    sandbagRow(mb, hw - 3.6, -hd + 1.3, hw - 1.6, -hd + 1.3, 2, 32);
    // courtyard clutter: crates, ammunition, a cart, a well
    mb.col(C.wood, MAT.WOOD).vary(0.12);
    for (let i = 0; i < 6; i++) mb.push(-8.5 + (i % 3) * 0.9, 0.35 + Math.floor(i / 3) * 0.66 + 0.6, 4.6 + (i % 2) * 0.2, 0, rnd(41, i) * 0.4, 0).box(0.8, 0.64, 0.8, { bevel: 0.03 }).pop();
    mb.vary(0);
    mb.col(mix(C.coatDark, C.steelDark, 0.4), MAT.WOOD);
    for (let i = 0; i < 6; i++) mb.push(8.2 + (i % 3) * 0.6, 1.25 + Math.floor(i / 3) * 0.3, 4.8, 0, 0.1, 0).box(0.55, 0.28, 0.36, { bevel: 0.02 }).pop();
    mb.col(C.stoneDark, MAT.STONE).push(8.5, 1.1, -6.5).lathe([[0.9, 0], [0.9, 0.9], [0.75, 0.9], [0.75, 0.2]], 12).pop();
    mb.col(C.woodDark, MAT.WOOD);
    for (const s2 of [1, -1]) mb.push(8.5 + s2 * 0.8, 2.3, -6.5).box(0.12, 1.6, 0.12).pop();
    mb.push(8.5, 3.1, -6.5).box(1.9, 0.12, 0.12).pop();
  }
  if (damaged) {
    mb.col(C.stoneDark, MAT.STONE).vary(0.2);
    for (let k = 0; k < (lod ? 6 : 16); k++) {
      const a = rnd(11, k) * Math.PI * 2, r = 7 + rnd(12, k) * 5;
      mb.push(Math.cos(a) * r, 0.3, Math.sin(a) * r * 0.8, rnd(13, k), rnd(14, k) * 3, 0).box(0.8 + rnd(15, k), 0.5, 0.6 + rnd(16, k)).pop();
    }
    mb.vary(0);
  }
  return mb.finish();
}

export function buildDepot(lod) {
  const mb = new MeshBuilder({ lod, seed: 211 });
  // canvas tent
  mb.col(C.canvas, MAT.CLOTH).push(-2.5, 0, -0.5);
  mb.extrude([[-2.2, 0], [2.2, 0], [1.9, 1.0], [0, 3.0], [-1.9, 1.0]], 7);
  mb.pop();
  mb.col(C.woodDark, MAT.WOOD);
  for (const z of [-3.9, 2.9]) mb.push(-2.5, 1.6, z).box(0.15, 3.2, 0.15).pop();
  // crate stacks & barrels
  mb.col(C.wood, MAT.WOOD).vary(0.12);
  for (let i = 0; i < (lod ? 4 : 10); i++) {
    const x = 1.5 + (i % 4) * 1.0, z = -3 + Math.floor(i / 4) * 1.1;
    const h = 1 + (i % 3 === 0 ? 1 : 0);
    for (let k = 0; k < h; k++) mb.push(x, 0.35 + k * 0.7, z, 0, rnd(21, i + k) * 0.3, 0).box(0.85, 0.68, 0.85, { bevel: 0.03 }).pop();
  }
  mb.vary(0);
  mb.col(C.woodDark, MAT.WOOD);
  for (let i = 0; i < (lod ? 2 : 6); i++) mb.push(3.5 + (i % 3) * 0.7, 0, 2.2 + Math.floor(i / 3) * 0.7).lathe([[0.3, 0], [0.34, 0.45], [0.3, 0.9]], lod ? 7 : 11, { capTop: true }).pop();
  // ammunition boxes (dark green-grey)
  mb.col(mix(C.coatDark, C.steelDark, 0.4), MAT.WOOD).vary(0.1);
  for (let i = 0; i < (lod ? 3 : 8); i++) mb.push(-5.5 + (i % 4) * 0.55, 0.15 + Math.floor(i / 4) * 0.3, 3.2, 0, 0.05 * i, 0).box(0.5, 0.28, 0.3, { bevel: 0.02 }).pop();
  mb.vary(0);
  // pole with a pennant
  mb.col(C.woodDark, MAT.WOOD).push(5.5, 0, -3.5).cyl(0.08, 0.06, 6, 6).pop();
  mb.col(C.crossRed, MAT.ACCENT).sheet([5.55, 5.8, -3.5], [7.2, 5.6, -3.5], [7.0, 5.1, -3.5], [5.55, 5.0, -3.5]);
  return mb.finish();
}

export function buildField(lod) {
  const mb = new MeshBuilder({ lod, seed: 221 });
  const w = 40, d = 30;
  mb.col(C.woodDark, MAT.WOOD);
  const post = (x, z, h) => mb.push(x, h / 2, z, (rnd(x | 0, z | 0) - 0.5) * 0.15, 0, (rnd(z | 0, x | 0) - 0.5) * 0.15).box(0.12, h, 0.12).pop();
  const step = lod ? 6 : 3;
  for (let x = -w / 2; x <= w / 2; x += step) { post(x, -d / 2, 1.2); post(x, d / 2, 1.2); }
  for (let z = -d / 2 + step; z < d / 2; z += step) { post(-w / 2, z, 1.2); post(w / 2, z, 1.2); }
  if (!lod) {
    mb.col(C.wood, MAT.WOOD);
    for (const z of [-d / 2, d / 2]) for (const y of [0.55, 0.95]) mb.push(0, y, z).box(w, 0.06, 0.05).pop();
  }
  // sheaves / stooks
  mb.col(mix(C.dryGrass, C.soil, 0.25), MAT.CLOTH).vary(0.1);
  for (let i = 0; i < (lod ? 4 : 12); i++) {
    const x = -w / 2 + 4 + rnd(31, i) * (w - 8), z = -d / 2 + 4 + rnd(32, i) * (d - 8);
    mb.push(x, 0, z).lathe([[0.45, 0], [0.4, 0.6], [0.1, 1.3], [0, 1.35]], 7).pop();
  }
  mb.vary(0);
  return mb.finish();
}

export function buildFirePost(lod) {
  const mb = new MeshBuilder({ lod, seed: 231 });
  // horseshoe sandbag emplacement open to the rear (-z)
  const R = 2.3;
  const segs = lod ? 6 : 10;
  for (let i = 0; i < segs; i++) {
    const a0 = -Math.PI * 0.62 + (i / segs) * Math.PI * 1.24, a1 = -Math.PI * 0.62 + ((i + 1) / segs) * Math.PI * 1.24;
    sandbagRow(mb, Math.sin(a0) * R, Math.cos(a0) * R, Math.sin(a1) * R, Math.cos(a1) * R, lod ? 3 : 4, 40 + i);
  }
  // timber overhead cover
  mb.col(C.woodDark, MAT.WOOD);
  for (const x of [-1.9, 1.9]) for (const z of [-1.2, 1.4]) mb.push(x, 0.95, z).box(0.16, 1.9, 0.16).pop();
  mb.col(C.plank, MAT.WOOD).vary(0.15);
  for (let k = 0; k < (lod ? 3 : 7); k++) mb.push(0, 1.95, -1.3 + k * 0.45).box(4.3, 0.1, 0.42).pop();
  mb.vary(0);
  if (!lod) {
    mb.col(C.soil, MAT.SOIL).jitter(0.08, 2, 5).push(0, 2.05, 0.1).box(4.0, 0.25, 3.0, { taper: [0.9, 0.85] }).pop().noJitter();
  }
  // water-cooled machine gun on tripod, shielded
  mb.col(C.steelDark, MAT.DARKMETAL);
  mb.push(0, 0.55, 0.9);
  for (const a of [0.9, -0.9, Math.PI]) mb.cylBetween([0, 0.05, 0], [Math.sin(a) * 0.55, -0.5, Math.cos(a) * 0.55 - 0.1], 0.025, 0.02, 4);
  mb.push(0, 0.15, 0.05).box(0.14, 0.16, 0.34, { bevel: 0.02 }).pop();
  mb.col(C.engine, MAT.DARKMETAL).cylBetween([0, 0.17, 0.2], [0, 0.17, 0.95], 0.065, 0.065, lod ? 7 : 12);
  mb.col(C.steel, MAT.METAL).cylBetween([0, 0.17, 0.95], [0, 0.17, 1.1], 0.02, 0.025, 6);
  mb.col(C.armor, MAT.METAL).push(0, 0.3, 0.32).extrude([[-0.42, -0.25], [0.42, -0.25], [0.42, 0.28], [0.25, 0.4], [-0.25, 0.4], [-0.42, 0.28]], 0.02).pop();
  if (!lod) {
    mb.col(C.crossRed, MAT.ACCENT).push(0, 0.33, 0.335).box(0.05, 0.3, 0.012).pop();
    mb.push(0, 0.38, 0.335).box(0.22, 0.05, 0.012).pop();
    mb.col(mix(C.coatDark, C.steelDark, 0.4), MAT.WOOD);
    for (let i = 0; i < 3; i++) mb.push(0.6 + i * 0.32, -0.4, -0.3).box(0.28, 0.2, 0.18, { bevel: 0.02 }).pop();
  }
  mb.pop();
  return mb.finish();
}

export function buildObsPost(lod) {
  const mb = new MeshBuilder({ lod, seed: 241 });
  const h = 6.2;
  mb.col(C.woodDark, MAT.WOOD);
  for (const sx of [1, -1]) for (const sz of [1, -1]) mb.cylBetween([sx * 1.5, 0, sz * 1.5], [sx * 1.1, h + 1.4, sz * 1.1], 0.1, 0.08, lod ? 5 : 7);
  if (!lod) {
    for (const s of [1, -1]) {
      mb.cylBetween([s * 1.45, 0.5, 1.45], [-s * 1.2, h - 0.5, 1.2], 0.05, 0.05, 4);
      mb.cylBetween([1.45, 0.5, s * 1.45], [1.2, h - 0.5, -s * 1.2], 0.05, 0.05, 4);
    }
  }
  mb.col(C.plank, MAT.WOOD).vary(0.12);
  mb.push(0, h, 0).box(3.0, 0.14, 3.0).pop();
  for (const s of [1, -1]) {
    mb.push(0, h + 0.5, s * 1.45).box(3.0, 0.9, 0.08).pop();
    mb.push(s * 1.45, h + 0.5, 0).box(0.08, 0.9, 3.0).pop();
  }
  mb.vary(0);
  mb.col(C.slate, MAT.DARKMETAL).push(0, h + 1.45, 0);
  pyramid(mb, 2.3, 1.2, 2.3);
  mb.pop();
  if (!lod) {
    mb.col(C.wood, MAT.WOOD);
    mb.cylBetween([-0.35, 0, 1.9], [-0.3, h, 1.5], 0.04, 0.04, 4);
    mb.cylBetween([0.35, 0, 1.9], [0.3, h, 1.5], 0.04, 0.04, 4);
    for (let k = 1; k < 12; k++) {
      const t = k / 12;
      mb.push(0, h * t, 1.9 - 0.4 * t).box(0.7, 0.05, 0.05).pop();
    }
    sandbagRow(mb, -1.2, 1.55, 1.2, 1.55, 1, 9);
  }
  return mb.finish();
}

export function buildSupplyCache(lod) {
  const mb = new MeshBuilder({ lod, seed: 251 });
  mb.col(mix(C.coatDark, C.steelDark, 0.4), MAT.WOOD).vary(0.12);
  for (let i = 0; i < (lod ? 4 : 9); i++) {
    const x = -1.2 + (i % 3) * 0.6, z = -0.6 + Math.floor(i / 3) % 2 * 0.45, y = 0.15 + Math.floor(i / 6) * 0.3;
    mb.push(x, y, z, 0, (rnd(7, i) - 0.5) * 0.2, 0).box(0.55, 0.28, 0.4, { bevel: 0.02 }).pop();
  }
  mb.vary(0);
  mb.col(C.canvasDark, MAT.CLOTH).jitter(lod ? 0 : 0.05, 3, 3);
  mb.push(0.2, 0.9, 0).box(3.0, 0.08, 2.2, { taper: [0.9, 0.9] }).pop();
  mb.noJitter();
  mb.col(C.woodDark, MAT.WOOD);
  for (const sx of [1, -1]) for (const sz of [1, -1]) mb.push(sx * 1.35, 0.45, sz * 0.95).box(0.08, 0.9, 0.08).pop();
  return mb.finish();
}

// ------------------------------------------------------------------ Black Grail

export function buildGrailAltar(lod) {
  // "altars of Beelzebub ... constructed from the remains of their victims shaped into the form of monstrous flies"
  const mb = new MeshBuilder({ lod, seed: 261 });
  const seg = lod ? 8 : 14;
  mb.col(mix(C.soil, C.fleshDark, 0.35), MAT.SOIL).jitter(0.3, 0.6, 11);
  mb.push(0, 0, 0).sphere(5.2, 1.8, 5.0, seg, lod ? 5 : 8, { hemi: 1 }).pop();
  mb.noJitter();
  // heap of remains
  mb.vary(0.2);
  for (let i = 0; i < (lod ? 8 : 26); i++) {
    const a = rnd(3, i) * Math.PI * 2, r = 1.5 + rnd(4, i) * 3;
    const y = 0.6 + (1 - r / 4.5) * 1.1;
    if (i % 3 === 0) mb.col(C.bone, MAT.BONE).push(Math.cos(a) * r, y, Math.sin(a) * r, rnd(5, i) * 2, rnd(6, i) * 3, 0).box(0.14, 0.14, 0.9).pop();
    else if (i % 3 === 1) mb.col(C.boneDark, MAT.BONE).push(Math.cos(a) * r, y, Math.sin(a) * r).sphere(0.16, 0.15, 0.18, 6, 4).pop();
    else mb.col(C.rags, MAT.CLOTH).push(Math.cos(a) * r, y, Math.sin(a) * r, rnd(7, i), rnd(8, i) * 3, 0.3).box(0.6, 0.3, 1.2, { bevel: 0.1 }).pop();
  }
  mb.vary(0);
  // the fly: abdomen, thorax, head with compound eyes, wings of stretched hide, legs
  mb.jitter(lod ? 0.03 : 0.07, 2.5, 21);
  mb.col(C.flesh, MAT.FLESH).push(0, 3.4, -1.4, -0.5, 0, 0).sphere(1.5, 1.3, 2.1, seg, lod ? 6 : 10).pop();
  mb.col(C.chitin, MAT.DARKMETAL).push(0, 4.3, 0.3).sphere(1.2, 1.05, 1.1, seg, lod ? 6 : 9).pop();
  mb.col(C.fleshDark, MAT.FLESH).push(0, 4.9, 1.45).sphere(0.8, 0.72, 0.7, seg, lod ? 5 : 8).pop();
  mb.noJitter();
  mb.col([0.3, 0.07, 0.05], MAT.GLASS);
  for (const s of [1, -1]) mb.push(s * 0.55, 5.1, 1.7).sphere(0.52, 0.58, 0.45, seg, lod ? 6 : 9).pop();
  if (!lod) {
    mb.col(C.fleshDark, MAT.FLESH).tube([[0, 4.6, 2.0], [0, 4.0, 2.6], [0, 3.1, 2.7]], [0.16, 0.12, 0.05], 6);
    mb.col(C.pus, MAT.GLOW);
    for (let k = 0; k < 6; k++) mb.push(Math.cos(k) * 1.1, 3.0 + rnd(9, k) * 1.2, -1.4 + Math.sin(k) * 1.2).sphere(0.14, 0.14, 0.14, 6, 4).pop();
  }
  mb.col(mix(C.skinBruise, C.rags, 0.4), MAT.FLESH);
  for (const s of [1, -1]) {
    mb.push(s * 0.8, 4.6, -0.2, 0.25, s * 0.35, s * 0.55);
    mb.extrude([[0, 0], [s * 1.2, 1.4], [s * 3.6, 2.6], [s * 4.2, 1.4], [s * 3.1, 0.3], [s * 1.6, -0.3]], 0.06);
    mb.pop();
    if (!lod) {
      mb.col(C.boneDark, MAT.BONE);
      mb.tube([[s * 0.8, 4.6, -0.2], [s * 2.2, 5.8, -0.9], [s * 3.9, 6.6, -1.6]], [0.1, 0.07, 0.03], 5);
      mb.col(mix(C.skinBruise, C.rags, 0.4), MAT.FLESH);
    }
  }
  mb.col(C.chitin, MAT.DARKMETAL);
  for (const s of [1, -1]) for (let k = 0; k < 3; k++) {
    const z = 0.9 - k * 0.8;
    mb.tube([[s * 0.8, 3.9, z], [s * 2.2, 3.6 + (k === 1 ? 0.3 : 0), z + 0.3], [s * 3.0, 1.4, z + 0.6]], [0.13, 0.1, 0.05], lod ? 4 : 6);
  }
  // impaled remains on stakes around the altar
  for (let i = 0; i < (lod ? 3 : 6); i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4, r = 4.6;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    mb.col(C.woodDark, MAT.WOOD).cylBetween([x, 0.4, z], [x * 1.05, 4.2, z * 1.05], 0.07, 0.04, 5);
    if (!lod) {
      mb.col(C.skinDead, MAT.SKIN).push(x * 1.03, 2.8, z * 1.03, 0.2, a, 0.3).box(0.35, 0.9, 0.2, { bevel: 0.05 }).pop();
      mb.col(C.rags, MAT.CLOTH).push(x * 1.03, 2.2, z * 1.03, 0.1, a, -0.2).box(0.4, 0.6, 0.24).pop();
    }
  }
  return mb.finish();
}

// ------------------------------------------------------------------ unique world meshes

export function buildHouse(mb, h, gy) {
  const seed = h.seed || 1;
  mb.push(h.x, gy - 0.3, h.z, 0, h.rot, 0);
  const wallH = 3.2 + rnd(seed, 1) * 1.2;
  const plaster = mix(C.plaster, C.soil, 0.15 + rnd(seed, 2) * 0.2);
  mb.col(C.stoneDark, MAT.STONE).push(0, 0.3, 0).box(h.w + 0.2, 0.6, h.d + 0.2).pop();
  mb.col(plaster, MAT.STONE).push(0, 0.6 + wallH / 2, 0).box(h.w, wallH, h.d, { bevel: 0.05 }).pop();
  // timber framing
  mb.col(C.woodDark, MAT.WOOD);
  for (const s of [1, -1]) {
    mb.push(0, 0.6 + wallH - 0.1, s * (h.d / 2 + 0.01)).box(h.w, 0.2, 0.05).pop();
    for (let k = 0; k <= 3; k++) mb.push(-h.w / 2 + (k * h.w) / 3, 0.6 + wallH / 2, s * (h.d / 2 + 0.02)).box(0.18, wallH, 0.05).pop();
  }
  // roof
  const roofCol = rnd(seed, 3) > 0.5 ? C.slate : mix(C.brick, C.slate, 0.5);
  mb.col(roofCol, MAT.DARKMETAL).push(0, 0.6 + wallH, 0, 0, Math.PI / 2, 0);
  roofPrism(mb, h.d, 2.6 + rnd(seed, 4), h.w, 0.5);
  mb.pop();
  mb.col(C.brick, MAT.STONE).push(h.w * 0.25, 0.6 + wallH + 1.6, h.d * 0.15).box(0.7, 3.0, 0.7).pop();
  // windows / door
  mb.col([0.04, 0.04, 0.045], MAT.GLASS);
  for (const s of [1, -1]) for (const x of [-h.w * 0.28, h.w * 0.28]) mb.push(x, 0.6 + wallH * 0.55, s * (h.d / 2 + 0.03)).box(0.8, 1.1, 0.05).pop();
  mb.col(C.woodDark, MAT.WOOD).push(0, 1.6, h.d / 2 + 0.04).box(1.1, 2.0, 0.06).pop();
  mb.pop();
}

export function buildRuin(mb, ruin, ground) {
  // Shell-blasted masonry: every wall piece is split into ~0.9 m columns with jagged tops,
  // window / breach gaps, corner quoins, charred beams and rubble spilling at the base.
  const brick = ruin.kind === 'chapel' ? C.stone : mix(C.brick, C.plaster, 0.3);
  const quoin = ruin.kind === 'chapel' ? C.stoneDark : mix(C.stone, C.brick, 0.3);
  mb.vary(0.1);
  let pi = 0;
  for (const p of ruin.pieces) {
    pi++;
    const len = Math.hypot(p.bx - p.ax, p.bz - p.az);
    if (len < 0.05) continue;
    const yaw = Math.atan2(p.bx - p.ax, p.bz - p.az);
    const ux = (p.bx - p.ax) / len, uz = (p.bz - p.az) / len;
    const h = Math.max(0.3, p.h);
    const cols = Math.max(1, Math.round(len / 0.9));
    const seed = ruin.index * 977 + pi * 31;
    const windowRow = h > 2.6 && p.q > 0.35;
    for (let k = 0; k < cols; k++) {
      const t0 = k / cols, t1 = (k + 1) / cols;
      const cx = p.ax + (p.bx - p.ax) * (t0 + t1) / 2, cz = p.az + (p.bz - p.az) * (t0 + t1) / 2;
      const w = len / cols + 0.02;
      const gy = ground(cx, cz) - 0.25;
      const edge = k === 0 || k === cols - 1;
      let hk = h * (0.78 + 0.3 * rnd(seed, k));
      if (edge && h > 1.5) hk = Math.max(hk, h * 0.98);
      const col = hk < 0.8 ? mix(brick, C.soil, 0.35) : edge && h > 2 ? quoin : brick;
      mb.col(col, MAT.STONE);
      const win = windowRow && !edge && k % 3 === 1;
      if (win) {
        // lower sill + upper lintel mass: an empty window opening between them
        const sill = 1.0, top = Math.min(hk, 2.35);
        mb.push(cx, gy + (sill + 0.25) / 2, cz, 0, yaw, 0).box(p.thick, sill + 0.25, w).pop();
        if (hk > top + 0.25) {
          mb.col(C.woodDark, MAT.WOOD).push(cx, gy + top + 0.33, cz, 0, yaw, 0).box(p.thick + 0.04, 0.14, w + 0.2).pop();
          mb.col(col, MAT.STONE).push(cx, gy + (top + 0.4 + hk) / 2 + 0.12, cz, 0, yaw, 0).box(p.thick, hk - top - 0.15, w).pop();
        }
      } else {
        mb.push(cx, gy + (hk + 0.25) / 2, cz, (rnd(seed, k + 40) - 0.5) * 0.03, yaw, 0).box(p.thick, hk + 0.25, w, { taper: [1, 0.9] }).pop();
        // broken brick teeth on the top edge
        if (!mb.lod && hk > 1.2 && rnd(seed, k + 60) > 0.45) {
          mb.push(cx + ux * (rnd(seed, k + 70) - 0.5) * w * 0.5, gy + hk + 0.25 + 0.12, cz + uz * (rnd(seed, k + 70) - 0.5) * w * 0.5, 0, yaw, (rnd(seed, k + 80) - 0.5) * 0.4)
            .box(p.thick * 0.9, 0.24, w * 0.4).pop();
        }
      }
    }
    // charred beams leaning out of tall broken walls
    if (h > 2.2 && p.q > 0.55) {
      const cx = (p.ax + p.bx) / 2, cz = (p.az + p.bz) / 2;
      mb.col(C.char, MAT.WOOD).push(cx, ground(cx, cz) + h * 0.7, cz, 0.5 + p.q * 0.4, yaw + 1.2, 0.2).box(0.2, 0.2, 2.6).pop();
    }
    // rubble spill along the wall base (both sides)
    const piles = Math.max(1, Math.round(len / 1.4));
    for (let k = 0; k < piles; k++) {
      const t = (k + 0.5) / piles;
      for (const sd of [-1, 1]) {
        if (rnd(seed, k * 2 + (sd > 0 ? 1 : 0) + 100) < 0.45) continue;
        const off = (p.thick / 2 + 0.35 + rnd(seed, k + 120) * 0.6) * sd;
        const x = p.ax + (p.bx - p.ax) * t - uz * off, z = p.az + (p.bz - p.az) * t + ux * off;
        const sz = 0.35 + rnd(seed, k + 140) * 0.35;
        mb.col(rnd(seed, k + 160) < 0.3 ? C.char : brick, MAT.STONE);
        mb.push(x, ground(x, z) + sz * 0.2, z, rnd(seed, k + 170), rnd(seed, k + 180) * 3, rnd(seed, k + 190))
          .box(sz * 1.4, sz * 0.6, sz, { taper: [0.7, 0.7] }).pop();
      }
    }
  }
  mb.vary(0);
  if (ruin.kind === 'chapel') {
    mb.col(C.stoneDark, MAT.STONE).push(ruin.x, ground(ruin.x, ruin.z) - 0.2, ruin.z, 0, ruin.rot, 0);
    mb.push(0, 0, ruin.d / 2).extrude(gothicArch(3.4, 6.4).map(([x, y]) => [x, y]), 0.6).pop();
    // fallen bell and a broken cross
    mb.col(mix(C.brass, C.rust, 0.6), MAT.METAL).push(1.8, 0.6, -1.5, 1.3, 0.4, 0).lathe([[0.7, 0], [0.62, 0.3], [0.45, 0.8], [0.2, 1.05], [0, 1.1]], mb.lod ? 8 : 14).pop();
    mb.col(C.stone, MAT.STONE).push(-2.2, 0.25, -2.4, 0, 0.7, 1.45).box(0.3, 2.2, 0.3).pop();
    mb.push(-2.2, 0.28, -2.4, 0, 0.7, 1.45).push(0, 0.5, 0).box(1.1, 0.28, 0.28).pop().pop();
    mb.pop();
  }
}

export function buildBridge(mb, b) {
  const len = b.z1 - b.z0;
  const cz = (b.z0 + b.z1) / 2;
  mb.col(C.stone, MAT.STONE).vary(0.06);
  mb.push(b.x, 0, cz);
  // deck with ramps
  const rampL = 5;
  mb.push(0, b.deck - 0.25, 0).box(b.width, 0.5, len - rampL * 2).pop();
  for (const s of [1, -1]) {
    const endY = s < 0 ? b.hA : b.hB;
    const zc = s * (len / 2 - rampL / 2);
    const tilt = Math.atan2(b.deck - endY, rampL) * s;
    mb.push(0, (b.deck + endY) / 2 - 0.25, zc, tilt, 0, 0).box(b.width, 0.5, rampL + 0.4).pop();
  }
  // parapets (partly broken)
  mb.col(C.stoneDark, MAT.STONE);
  for (const s of [1, -1]) {
    for (let k = 0; k < 6; k++) {
      if ((k + (s > 0 ? 1 : 0)) % 4 === 3) continue;
      const z0 = -len / 2 + rampL + (k * (len - rampL * 2)) / 6;
      mb.push(s * (b.width / 2 - 0.25), b.deck + 0.45, z0 + (len - rampL * 2) / 12).box(0.5, 0.9, (len - rampL * 2) / 6 - 0.1).pop();
    }
  }
  // piers
  for (let k = 0; k < 3; k++) {
    const z = -len / 2 + rampL + ((k + 0.5) * (len - rampL * 2)) / 3;
    mb.push(0, (b.deck - 4) / 2 - 0.3, z).box(b.width * 0.9, b.deck + 4, 1.6, { taper: [0.9, 0.8] }).pop();
  }
  mb.pop();
  mb.vary(0);
}

export function buildWorldStatic(world, ground) {
  const mb = new MeshBuilder({ lod: 0, seed: 999 });
  for (const h of world.houses) buildHouse(mb, h, ground(h.x, h.z));
  for (const r of world.ruins) buildRuin(mb, r, ground);
  for (const b of world.bridges) buildBridge(mb, b);
  return mb.finish();
}

export const STRUCTURE_MODELS = {
  bastion: (lod) => buildBastion(lod, false),
  bastion_damaged: (lod) => buildBastion(lod, true),
  depot: (lod) => buildDepot(lod),
  field: (lod) => buildField(lod),
  fire_post: (lod) => buildFirePost(lod),
  obs_post: (lod) => buildObsPost(lod),
  supply_cache: (lod) => buildSupplyCache(lod),
  grail_altar: (lod) => buildGrailAltar(lod),
  // Phase 2: new buildings + the reworked Altar of Beelzebub (overrides the Phase 1 altar)
  ...STRUCTURE_MODELS_P2,
};

