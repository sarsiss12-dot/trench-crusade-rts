// Phase 2 structure models (model-local: +z = front, footprint centred). New Antioch logistics
// works in the same gothic-military language as the bastion; Black Grail structures are heaped,
// grown and fused from the dead. The Altar of Beelzebub keeps its canon fly shape.
import { MeshBuilder, MAT } from './meshbuilder.js';
import { C, mix } from './palette.js';
import { hash32 } from '../../core/rng.js';

function rnd(seed, i) {
  return hash32(seed, i, 557) / 4294967296;
}

function crateStack(mb, x0, z0, n, cols, seed, col = C.wood) {
  mb.col(col, MAT.WOOD).vary(0.12);
  for (let i = 0; i < n; i++) {
    const x = x0 + (i % cols) * 0.72, z = z0 + (Math.floor(i / cols) % 2) * 0.72, y = 0.3 + Math.floor(i / (cols * 2)) * 0.6;
    mb.push(x, y, z, 0, (rnd(seed, i) - 0.5) * 0.3, 0).box(0.68, 0.58, 0.68, { bevel: 0.03 }).pop();
  }
  mb.vary(0);
}

function bagArc(mb, cx, cz, R, a0, a1, layers, seed) {
  const segs = Math.max(2, Math.round(((a1 - a0) * R) / 0.56));
  mb.col(C.sandbag, MAT.CLOTH).vary(0.12);
  for (let l = 0; l < layers; l++) {
    for (let i = 0; i < segs; i++) {
      const a = a0 + ((i + 0.5 + (l % 2) * 0.5) / segs) * (a1 - a0);
      mb.push(cx + Math.sin(a) * R, 0.12 + l * 0.2, cz + Math.cos(a) * R, (rnd(seed, i + l * 30) - 0.5) * 0.1, a + Math.PI / 2, 0).box(0.56, 0.2, 0.34, { bevel: mb.lod ? 0 : 0.06 }).pop();
    }
  }
  mb.vary(0);
}

/** New Antioch red cross on a plane (x across, y up) at the current transform. */
function cross(mb, w, h, t) {
  mb.col(C.crossRed, MAT.ACCENT);
  mb.box(w * 0.28, h, t);
  mb.push(0, h * 0.18, 0).box(w, h * 0.26, t).pop();
}

// ------------------------------------------------------------------ New Antioch

/** Aid station: field dressing tent with the red cross, stretchers, supplies, a lantern. */
export function buildAidStation(lod) {
  const mb = new MeshBuilder({ lod, seed: 601 });
  mb.col(C.canvas, MAT.CLOTH).push(0, 0, -0.3);
  mb.extrude([[-2.6, 0], [2.6, 0], [2.3, 1.2], [0, 2.9], [-2.3, 1.2]], 4.2);
  mb.pop();
  mb.col(C.woodDark, MAT.WOOD);
  for (const z of [-2.4, 1.8]) mb.push(0, 1.45, z).box(0.14, 2.9, 0.14).pop();
  // cross on the front flap
  mb.push(0, 1.7, 1.83);
  cross(mb, 1.1, 1.3, 0.03);
  mb.pop();
  // stretchers with covered wounded
  for (let i = 0; i < (lod ? 1 : 3); i++) {
    const x = -1.7 + i * 1.7;
    mb.col(C.woodDark, MAT.WOOD);
    for (const s of [-0.28, 0.28]) mb.push(x + s, 0.22, 2.9).box(0.05, 0.05, 2.0).pop();
    mb.col(C.canvasDark, MAT.CLOTH).push(x, 0.25, 2.9).box(0.55, 0.03, 1.8).pop();
    if (!lod) mb.col(C.blanket, MAT.CLOTH).push(x, 0.36, 2.8).box(0.48, 0.18, 1.5, { bevel: 0.08 }).pop();
  }
  crateStack(mb, 2.8, -1.4, lod ? 2 : 4, 2, 5, mix(C.canvasDark, C.wood, 0.5));
  if (!lod) {
    // lantern post
    mb.col(C.woodDark, MAT.WOOD).push(-2.9, 0, 2.2).cyl(0.06, 0.05, 2.4, 6).pop();
    mb.col(C.brass, MAT.METAL).push(-2.9, 2.2, 2.35).box(0.18, 0.26, 0.18).pop();
    mb.col([0.9, 0.7, 0.35], MAT.GLOW).push(-2.9, 2.2, 2.35).box(0.1, 0.16, 0.1).pop();
    mb.col(C.sandbag, MAT.CLOTH);
    bagArc(mb, 0, 0.2, 3.3, -0.9, 0.9, 1, 7);
  }
  return mb.finish();
}

/** Field workshop: timber frame shed, workbench and anvil, hoist, stove chimney, stocked timber. */
export function buildWorkshop(lod) {
  const mb = new MeshBuilder({ lod, seed: 611 });
  const W = 8, D = 5.6, H = 3.2;
  mb.col(C.woodDark, MAT.WOOD);
  for (const x of [-W / 2 + 0.2, 0, W / 2 - 0.2]) for (const z of [-D / 2 + 0.2, D / 2 - 0.2]) mb.push(x, H / 2, z).box(0.22, H, 0.22).pop();
  // back + side walls (planks), open front
  mb.col(C.plank, MAT.WOOD).vary(0.1);
  mb.push(0, H / 2, -D / 2 + 0.1).box(W, H, 0.12).pop();
  for (const s of [-1, 1]) mb.push(s * (W / 2 - 0.1), H / 2, 0).box(0.12, H, D).pop();
  mb.vary(0);
  // slate roof (lean-to)
  mb.col(C.slate, MAT.DARKMETAL).push(0, H + 0.45, 0, -0.18, 0, 0).box(W + 0.6, 0.12, D + 0.8).pop();
  // stone chimney
  mb.col(C.brick, MAT.STONE).push(W / 2 - 1, H + 0.6, -D / 2 + 0.6).box(0.7, H + 1.6, 0.7).pop();
  // workbench, anvil, vice
  mb.col(C.wood, MAT.WOOD).push(-2, 0.85, -D / 2 + 0.9).box(3, 0.1, 0.9).pop();
  for (const x of [-3.3, -0.7]) mb.col(C.woodDark, MAT.WOOD).push(x, 0.42, -D / 2 + 0.9).box(0.1, 0.84, 0.8).pop();
  mb.col(C.steelDark, MAT.DARKMETAL).push(1.5, 0.35, 0).box(0.5, 0.7, 0.35).pop();
  mb.push(1.5, 0.78, 0).box(0.9, 0.18, 0.3, { taper: [0.8, 1] }).pop();
  if (!lod) {
    // hoist
    mb.col(C.woodDark, MAT.WOOD);
    mb.cylBetween([2.8, 0, 1.8], [2.6, 3.0, 1.6], 0.08, 0.07, 6);
    mb.cylBetween([2.6, 3.0, 1.6], [1.4, 3.0, 1.6], 0.07, 0.07, 6);
    mb.col(C.cable, MAT.METAL).cylBetween([1.5, 3.0, 1.6], [1.5, 1.4, 1.6], 0.015, 0.015, 3);
    mb.col(C.steelDark, MAT.DARKMETAL).push(1.5, 1.3, 1.6).box(0.3, 0.25, 0.3).pop();
    // tools on the wall
    mb.col(C.steel, MAT.METAL);
    for (let i = 0; i < 5; i++) mb.push(-3.4 + i * 0.4, 1.8, -D / 2 + 0.2, 0, 0, 0.1 * i).box(0.05, 0.7, 0.04).pop();
  }
  // timber stock outside
  mb.col(C.wood, MAT.WOOD).vary(0.1);
  for (let i = 0; i < (lod ? 3 : 8); i++) mb.push(-W / 2 - 0.9, 0.12 + Math.floor(i / 4) * 0.22, -1.5 + (i % 4) * 0.45, 0, 0, Math.PI / 2).cyl(0.1, 0.1, 3.2, 6).pop();
  mb.vary(0);
  return mb.finish();
}

/** Ammunition dump: sandbag-walled bay stacked with shells and cartridge crates (explodes). */
export function buildAmmoDump(lod) {
  const mb = new MeshBuilder({ lod, seed: 621 });
  bagArc(mb, 0, 0, 2.5, -Math.PI * 0.62, Math.PI * 0.62, lod ? 2 : 3, 11);
  crateStack(mb, -1.3, -0.9, lod ? 4 : 10, 4, 13, mix(C.coatDark, C.steelDark, 0.4));
  // shells standing in rows
  mb.col(C.brass, MAT.METAL).vary(0.06);
  const rows = lod ? 2 : 3, per = lod ? 3 : 6;
  for (let r = 0; r < rows; r++) for (let i = 0; i < per; i++) {
    const x = -1 + i * 0.3, z = 0.8 + r * 0.3;
    mb.push(x, 0, z).lathe([[0.1, 0], [0.1, 0.45], [0.08, 0.58], [0.02, 0.72], [0, 0.74]], lod ? 6 : 9, { capBottom: false }).pop();
  }
  mb.vary(0);
  // tarp + warning pennant
  mb.col(C.canvasDark, MAT.CLOTH).jitter(lod ? 0 : 0.05, 3, 4).push(0, 1.35, -0.2).box(3.6, 0.06, 2.6, { taper: [0.92, 0.9] }).pop().noJitter();
  mb.col(C.woodDark, MAT.WOOD);
  for (const sx of [1, -1]) for (const sz of [1, -1]) mb.push(sx * 1.6, 0.68, sz * 1.1 - 0.2).box(0.08, 1.35, 0.08).pop();
  mb.push(2.4, 0, 1.3).cyl(0.05, 0.04, 3.2, 5).pop();
  mb.col(C.crossRed, MAT.ACCENT).sheet([2.43, 3.1, 1.3], [3.3, 2.95, 1.3], [3.3, 2.6, 1.3], [2.43, 2.55, 1.3]);
  return mb.finish();
}

/** Signal post: telegraph pole with wire runs, field telephone box, signal lamp and flags. */
export function buildSignalPost(lod) {
  const mb = new MeshBuilder({ lod, seed: 631 });
  mb.col(C.woodDark, MAT.WOOD).push(0, 0, 0).cyl(0.12, 0.1, 5.4, lod ? 6 : 8).pop();
  mb.push(0, 5.0, 0).box(1.6, 0.1, 0.1).pop();
  mb.push(0, 4.5, 0).box(1.2, 0.1, 0.1).pop();
  if (!lod) {
    mb.col(C.lens, MAT.GLASS);
    for (const x of [-0.7, -0.35, 0.35, 0.7]) mb.push(x, 5.1, 0).sphere(0.05, 0.07, 0.05, 6, 4).pop();
    mb.col(C.cable, MAT.METAL);
    for (const x of [-0.7, 0.7]) mb.tube([[x, 5.1, 0], [x, 4.4, 3.5], [x * 1.2, 3.8, 8]], 0.01, 3);
  }
  // signal lamp (shuttered) on a bracket
  mb.col(C.steelDark, MAT.DARKMETAL).push(0.1, 3.4, 0.35).box(0.35, 0.35, 0.45).pop();
  mb.col([0.95, 0.8, 0.45], MAT.GLOW).push(0.1, 3.4, 0.6).box(0.22, 0.22, 0.02).pop();
  // telephone box on a crate, sandbag nest
  mb.col(C.wood, MAT.WOOD).push(0.9, 0.35, 0.6).box(0.7, 0.7, 0.5).pop();
  mb.col(C.leatherDark, MAT.LEATHER).push(0.9, 0.85, 0.6).box(0.4, 0.3, 0.25).pop();
  bagArc(mb, 0, 0, 1.4, -1.1, 1.1, lod ? 1 : 2, 17);
  mb.col(C.woodDark, MAT.WOOD).push(-1.1, 0, -0.6).cyl(0.04, 0.03, 2.6, 5).pop();
  mb.col(C.crossRed, MAT.ACCENT).sheet([-1.07, 2.5, -0.6], [-0.3, 2.4, -0.6], [-0.3, 2.0, -0.6], [-1.07, 1.95, -0.6]);
  return mb.finish();
}

/** Muster point: palisaded yard with the New Antioch banner, bell, benches and a rifle rack. */
export function buildMusterPoint(lod) {
  const mb = new MeshBuilder({ lod, seed: 641 });
  const W = 7.4, D = 5.4;
  mb.col(C.woodDark, MAT.WOOD).vary(0.1);
  const stake = (x, z, h) => mb.push(x, h / 2, z, (rnd(Math.round(x * 10), Math.round(z * 10)) - 0.5) * 0.1, 0, 0).cyl(0.09, 0.07, h, 5).pop();
  const step = lod ? 1.2 : 0.45;
  for (let x = -W / 2; x <= W / 2 + 1e-6; x += step) { stake(x, -D / 2, 1.9); }
  for (let z = -D / 2 + step; z <= D / 2; z += step) { stake(-W / 2, z, 1.9); stake(W / 2, z, 1.9); }
  mb.vary(0);
  // banner pole with cross banner
  mb.col(C.woodDark, MAT.WOOD).push(0, 0, -1.2).cyl(0.09, 0.07, 6.2, 7).pop();
  mb.col(C.brass, MAT.METAL).push(0, 6.3, -1.2).sphere(0.13, 0.13, 0.13, 7, 5).pop();
  mb.col(C.tabard, MAT.CLOTH).push(0.62, 5.2, -1.2).box(1.1, 1.6, 0.03).pop();
  mb.push(0.62, 5.25, -1.18);
  cross(mb, 0.8, 1.2, 0.02);
  mb.pop();
  // muster bell on a frame
  mb.col(C.woodDark, MAT.WOOD);
  for (const x of [-2.6, -1.8]) mb.push(x, 1.1, 1.6).box(0.12, 2.2, 0.12).pop();
  mb.push(-2.2, 2.2, 1.6).box(1.0, 0.12, 0.14).pop();
  mb.col(C.bronze, MAT.METAL).push(-2.2, 1.55, 1.6).lathe([[0.3, 0], [0.24, 0.2], [0.14, 0.5], [0, 0.55]], lod ? 7 : 11, { capBottom: false }).pop();
  // benches + rifle rack
  mb.col(C.wood, MAT.WOOD);
  for (const z of [0.4, 1.5]) mb.push(1.6, 0.45, z).box(2.4, 0.08, 0.35).pop();
  if (!lod) {
    mb.col(C.woodDark, MAT.WOOD).push(2.8, 0.9, -1.8).box(1.4, 0.08, 0.3).pop();
    mb.col(C.steelDark, MAT.DARKMETAL);
    for (let i = 0; i < 5; i++) mb.push(2.25 + i * 0.28, 0.75, -1.72, 0.18, 0, 0).box(0.04, 1.3, 0.05).pop();
  }
  crateStack(mb, -3.0, -1.8, lod ? 2 : 4, 2, 19);
  return mb.finish();
}

// ------------------------------------------------------------------ Black Grail
// Grimdark organic palette: dead, bruised, filth-dark — never saturated or glossy "toy" flesh.
const ROT = [0.21, 0.1, 0.085];
const HIDE = [0.24, 0.19, 0.18];
const HIDE_D = [0.14, 0.11, 0.1];
const FILTH = [0.06, 0.068, 0.028];
const BILE = [0.13, 0.15, 0.045];
const EYE = [0.11, 0.022, 0.02];
const BODY_COLS = [ROT, HIDE, C.rags, HIDE_D, mix(C.skinDead, ROT, 0.45), C.coatDark];

/**
 * Heap of bodies on an ellipsoid (the Grail builds from its dead): n corpse-sized pieces laid
 * over a dark core, bones and skulls between them.
 */
function bodyCluster(mb, cx, cy, cz, rx, ry, rz, n, seed, core = true) {
  if (core) {
    mb.col(ROT, MAT.SKIN).jitter(mb.lod ? 0.05 : 0.14, 2.2, seed);
    mb.push(cx, cy, cz).sphere(rx * 0.92, ry * 0.92, rz * 0.92, mb.lod ? 8 : 12, mb.lod ? 5 : 8).pop();
    mb.noJitter();
  }
  const cnt = mb.lod ? Math.ceil(n / 3) : n;
  for (let i = 0; i < cnt; i++) {
    const u = rnd(seed, i * 3 + 1) * Math.PI * 2, v = Math.acos(rnd(seed, i * 3 + 2) * 2 - 1);
    const nx = Math.sin(v) * Math.cos(u), ny = Math.cos(v), nz = Math.sin(v) * Math.sin(u);
    // pieces sit half-sunk into the mass: lumps of bodies, not a pile of planks
    const x = cx + nx * rx * 0.9, y = cy + ny * ry * 0.9, z = cz + nz * rz * 0.9;
    const k = i % 7;
    if (k === 5) mb.col(C.boneDark, MAT.BONE).push(x, y, z).sphere(0.17, 0.16, 0.19, 6, 4).pop();
    else if (k === 6) mb.col(C.bone, MAT.BONE).push(x, y, z, rnd(seed, i) * 3, u, rnd(seed, i + 7)).box(0.11, 0.11, 0.9).pop();
    else {
      mb.col(BODY_COLS[(i * 5 + seed) % BODY_COLS.length], k === 4 ? MAT.CLOTH : MAT.SKIN);
      // long axis tangent to the surface (around the vertical), tilted with the local slope
      mb.push(x, y, z, -Math.asin(Math.max(-1, Math.min(1, ny))) * 0.9, -u + (rnd(seed, i + 5) - 0.5) * 0.6, 0);
      mb.box(0.46, 0.32, 0.8 + rnd(seed, i + 11) * 0.45, { bevel: mb.lod ? 0 : 0.13 });
      mb.pop();
    }
  }
}

/**
 * Altar of Beelzebub (canon: remains of victims shaped into the form of monstrous flies).
 * The whole fly is built from the dead: a heaped plinth of bodies, an abdomen of fused corpses,
 * a thorax plated with bone, a head of skulls under faceted compound eyes, a proboscis dripping
 * into a grail-shaped offering bowl, torn hide wings on bone struts, jointed legs of bone gripping
 * the heap, impaled offerings and chains.
 */
export function buildGrailAltarP2(lod) {
  const mb = new MeshBuilder({ lod, seed: 261 });
  const seg = lod ? 8 : 14;
  // plinth: soil and filth mound under a heap of the dead
  mb.col(mix(C.soil, ROT, 0.3), MAT.SOIL).jitter(0.45, 0.7, 11);
  mb.push(0, 0, 0).sphere(5.3, 1.15, 5.1, lod ? 10 : 18, lod ? 4 : 7, { hemi: 1 }).pop();
  mb.noJitter();
  for (let ring = 0; ring < (lod ? 1 : 2); ring++) {
    const R = 3.2 + ring * 1.2;
    const n = lod ? 8 : 18 - ring * 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * 0.3 + rnd(3, i) * 0.2;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      mb.col(BODY_COLS[(i + ring) % BODY_COLS.length], MAT.SKIN).push(x, 0.95 - ring * 0.4, z, 0.2 + rnd(4, i) * 0.4, -a + (rnd(5, i) - 0.5), 1.4).box(0.42, 0.3, 1.5, { bevel: lod ? 0 : 0.12 }).pop();
    }
  }
  // the fly dominates the heap: everything above is built in fly space (scaled up)
  mb.push(0, -1.1, 0.2, 0, 0, 0, 1.3);
  // abdomen: fused corpses around a rotting core, bile sacs
  bodyCluster(mb, 0, 3.55, -1.7, 1.55, 1.3, 2.2, 46, 21);
  if (!lod) {
    mb.col(BILE, MAT.GLOW);
    for (let k = 0; k < 5; k++) mb.push(Math.cos(k * 1.9) * 1.35, 3.1 + rnd(9, k) * 1.2, -1.6 + Math.sin(k * 1.9) * 1.6).sphere(0.16, 0.15, 0.16, 6, 4).pop();
    // coarse bristles of bone splinters
    mb.col(C.boneDark, MAT.BONE);
    for (let k = 0; k < 14; k++) {
      const a = rnd(31, k) * Math.PI * 2, z = -3.2 + rnd(32, k) * 3;
      const x = Math.cos(a) * 1.5, y = 3.55 + Math.sin(a) * 1.25;
      mb.cylBetween([x, y, z], [x * 1.3, y + Math.sin(a) * 0.45 + 0.15, z - 0.25], 0.035, 0.008, 4);
    }
  }
  // thorax: bone-plated heap
  bodyCluster(mb, 0, 4.4, 0.35, 1.2, 1.05, 1.1, 22, 33);
  mb.col(C.boneDark, MAT.BONE);
  for (let k = 0; k < (lod ? 2 : 5); k++) mb.push(0, 5.35 - k * 0.1, -0.5 + k * 0.38, 0.45 - k * 0.2, 0, 0).box(1.25 - k * 0.1, 0.12, 0.45, { bevel: lod ? 0 : 0.05 }).pop();
  // head: a knot of skulls under two faceted compound eyes
  mb.col(ROT, MAT.SKIN).jitter(lod ? 0 : 0.08, 3, 41).push(0, 4.9, 1.55).sphere(0.8, 0.72, 0.7, lod ? 7 : 10, lod ? 5 : 7).pop().noJitter();
  mb.col(C.boneDark, MAT.BONE);
  for (let k = 0; k < (lod ? 3 : 9); k++) {
    const a = (k / 9) * Math.PI * 2;
    mb.push(Math.cos(a) * 0.62, 4.75 + Math.sin(a * 2) * 0.2, 1.75 + Math.sin(a) * 0.35).sphere(0.16, 0.15, 0.18, 6, 4).pop();
  }
  mb.col(EYE, MAT.GLASS);
  for (const sx of [1, -1]) mb.push(sx * 0.6, 5.15, 1.72).sphere(0.58, 0.64, 0.52, lod ? 6 : 7, lod ? 4 : 5).pop(); // faceted
  // proboscis dripping into the grail bowl (the Black Grail's idol)
  mb.col(HIDE_D, MAT.SKIN).tube([[0, 4.6, 2.05], [0, 4.05, 2.75], [0, 3.1, 3.2]], [0.19, 0.13, 0.05], lod ? 4 : 6);
  mb.col(C.boneDark, MAT.BONE).push(0, 0.95, 3.7).cyl(0.24, 0.17, 1.9, lod ? 6 : 9).pop();
  mb.col(C.bronze, MAT.METAL).push(0, 1.85, 3.7).lathe([[0.1, 0], [0.18, 0.12], [0.5, 0.35], [0.62, 0.62], [0.58, 0.66], [0.4, 0.42], [0, 0.34]], lod ? 8 : 14, { capBottom: true }).pop();
  mb.col(FILTH, MAT.MUD).push(0, 2.43, 3.7).sphere(0.5, 0.04, 0.5, lod ? 6 : 10, 3).pop();
  // wings: torn hide stretched over bone struts
  for (const sx of [1, -1]) {
    mb.col(HIDE_D, MAT.SKIN);
    mb.push(sx * 0.8, 4.75, -0.2, 0.25, sx * 0.35, sx * 0.55);
    mb.extrude([[0, 0], [sx * 1.2, 1.5], [sx * 2.4, 2.3], [sx * 3.0, 2.0], [sx * 3.7, 2.8], [sx * 4.4, 2.0], [sx * 3.9, 1.5], [sx * 4.2, 0.8], [sx * 3.4, 0.6], [sx * 3.0, 0.1], [sx * 1.9, 0.0], [sx * 1.4, -0.4]], 0.07);
    mb.pop();
    if (!lod) {
      mb.col(HIDE, MAT.SKIN).push(sx * 0.7, 4.55, -0.6, 0.45, sx * 0.6, sx * 0.35);
      mb.extrude([[0, 0], [sx * 1.0, 0.9], [sx * 2.2, 1.0], [sx * 3.1, 1.5], [sx * 3.4, 0.6], [sx * 2.6, 0.3], [sx * 2.1, -0.2]], 0.06);
      mb.pop();
    }
    mb.col(C.boneDark, MAT.BONE);
    mb.tube([[sx * 0.8, 4.75, -0.2], [sx * 2.2, 5.95, -0.9], [sx * 3.9, 6.75, -1.6]], [0.13, 0.09, 0.04], lod ? 4 : 6);
    if (!lod) {
      mb.tube([[sx * 0.8, 4.75, -0.2], [sx * 2.6, 5.15, -1.3], [sx * 4.1, 5.05, -2.2]], [0.1, 0.07, 0.03], 5);
      mb.tube([[sx * 0.8, 4.7, -0.2], [sx * 1.9, 4.6, -1.5], [sx * 3.1, 4.15, -2.4]], [0.08, 0.05, 0.02], 4);
    }
  }
  // six jointed bone legs gripping the heap, ending in hooks
  mb.col(mix(C.boneDark, C.chitin, 0.5), MAT.BONE);
  for (const sx of [1, -1]) for (let k = 0; k < 3; k++) {
    const z = 0.9 - k * 0.85;
    mb.tube([[sx * 0.8, 3.95, z], [sx * 2.3, 3.85 + (k === 1 ? 0.45 : 0.15), z + 0.3], [sx * 3.1, 1.6, z + 0.6], [sx * 3.45, 0.95, z + 0.85]], [0.17, 0.13, 0.09, 0.03], lod ? 4 : 6);
    if (!lod) mb.push(sx * 2.3, 3.95 + (k === 1 ? 0.45 : 0.15), z + 0.3).sphere(0.17, 0.17, 0.17, 6, 4).pop();
  }
  mb.pop(); // fly space
  // impaled offerings on stakes + hanging chains
  for (let i = 0; i < (lod ? 3 : 7); i++) {
    const a = (i / 7) * Math.PI * 2 + 0.4, r = 4.8;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    mb.col(C.woodDark, MAT.WOOD).cylBetween([x, 0.4, z], [x * 1.05, 4.4, z * 1.05], 0.08, 0.04, 5);
    if (!lod) {
      mb.col(C.skinDead, MAT.SKIN).push(x * 1.03, 2.95, z * 1.03, 0.2, a, 0.3).box(0.36, 1.0, 0.22, { bevel: 0.06 }).pop();
      mb.col(C.ragsDark, MAT.CLOTH).push(x * 1.03, 2.3, z * 1.03, 0.1, a, -0.2).box(0.42, 0.62, 0.25).pop();
      mb.col(C.rust, MAT.METAL).cylBetween([x * 1.05, 4.3, z * 1.05], [x * 0.7, 5.3, z * 0.7 - 0.5], 0.022, 0.022, 3);
    }
  }
  return mb.finish();
}

/** Corpse mound: bodies heaped and bound with rope and stakes — the Grail's larder of the dead. */
export function buildCorpseMound(lod) {
  const mb = new MeshBuilder({ lod, seed: 701 });
  mb.col(mix(C.soil, ROT, 0.25), MAT.SOIL).jitter(0.2, 0.8, 3);
  mb.push(0, 0, 0).sphere(3.3, 0.8, 3.1, lod ? 8 : 12, lod ? 4 : 6, { hemi: 1 }).pop();
  mb.noJitter();
  bodyCluster(mb, 0, 0.6, 0, 2.5, 1.35, 2.3, 40, 7);
  mb.col(C.woodDark, MAT.WOOD);
  for (let i = 0; i < (lod ? 3 : 6); i++) {
    const a = (i / 6) * Math.PI * 2, r = 3.1;
    mb.cylBetween([Math.cos(a) * r, 0, Math.sin(a) * r], [Math.cos(a) * r * 0.9, 2.3, Math.sin(a) * r * 0.9], 0.07, 0.05, 5);
  }
  if (!lod) {
    mb.col(FILTH, MAT.MUD).push(0.6, 0.04, 2.9).sphere(1.2, 0.04, 0.75, 8, 2).pop();
    mb.col(C.rope, MAT.CLOTH);
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
      mb.tube([[Math.cos(a0) * 2.8, 1.9, Math.sin(a0) * 2.8], [Math.cos((a0 + a1) / 2) * 2.3, 1.5, Math.sin((a0 + a1) / 2) * 2.3], [Math.cos(a1) * 2.8, 1.9, Math.sin(a1) * 2.8]], 0.02, 3);
    }
  }
  return mb.finish();
}

/** Plague pit: a sunken wound in the ground, heaped with the dead, brimming with dark filth. */
export function buildPlaguePit(lod) {
  const mb = new MeshBuilder({ lod, seed: 711 });
  const seg = lod ? 10 : 18;
  mb.col(mix(ROT, C.soil, 0.55), MAT.SOIL).jitter(0.22, 1.5, 9);
  mb.push(0, 0, 0).lathe([[3.0, 0], [2.8, 0.5], [2.35, 0.62], [1.95, 0.2]], seg, { capBottom: false }).pop();
  mb.noJitter();
  // the filth: near-black, a sickly sheen only where it bubbles
  mb.col(FILTH, MAT.MUD).push(0, 0.2, 0).sphere(2.0, 0.05, 2.0, seg, 3).pop();
  if (!lod) {
    mb.col(BILE, MAT.GLOW);
    for (let k = 0; k < 6; k++) mb.push(Math.cos(k * 2.1) * 1.3 * rnd(3, k), 0.24, Math.sin(k * 2.1) * 1.3 * rnd(4, k)).sphere(0.13, 0.07, 0.13, 6, 3).pop();
  }
  // bodies slumped over the rim
  const n = lod ? 5 : 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd(6, i) * 0.3;
    mb.col(BODY_COLS[i % BODY_COLS.length], MAT.SKIN).push(Math.cos(a) * 2.35, 0.55, Math.sin(a) * 2.35, 0.35, -a, 0.2).box(0.4, 0.28, 1.45, { bevel: lod ? 0 : 0.1 }).pop();
  }
  // a cage of great ribs arching over the pit (vertebra knots at the crown)
  mb.col(C.boneDark, MAT.BONE);
  const ribs = lod ? 4 : 7;
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2;
    const x = Math.cos(a) * 2.7, z = Math.sin(a) * 2.7;
    mb.tube([[x, 0.4, z], [x * 0.8, 2.1, z * 0.8], [x * 0.3, 2.95, z * 0.3]], [0.19, 0.13, 0.06], lod ? 4 : 6);
  }
  if (!lod) for (let k = 0; k < 4; k++) mb.push(0, 2.95 + k * 0.18, 0).sphere(0.22 - k * 0.03, 0.1, 0.22 - k * 0.03, 7, 3).pop();
  return mb.finish();
}

/** Fly nest: a lumpy hive spire of hide and filth riddled with holes, clustered with pupae. */
export function buildFlyNest(lod) {
  const mb = new MeshBuilder({ lod, seed: 721 });
  // stacked, sagging lumps (grown, not built)
  const lumps = [[0, 0.7, 0, 1.9, 1.1], [0.2, 1.9, -0.1, 1.55, 1.0], [-0.15, 3.0, 0.1, 1.25, 0.95], [0.1, 4.0, 0, 0.95, 0.85], [0, 4.9, 0.05, 0.62, 0.75], [0.05, 5.6, 0, 0.32, 0.55]];
  mb.jitter(lod ? 0.06 : 0.16, 1.8, 5);
  lumps.forEach(([x, y, z, r, h], i) => {
    mb.col(i % 2 ? HIDE_D : mix(HIDE, ROT, 0.4), MAT.SKIN).push(x, y, z).sphere(r, h, r * 0.95, lod ? 8 : 11, lod ? 5 : 7).pop();
  });
  mb.noJitter();
  // holes the flies pour out of (dark, wet)
  mb.col(FILTH, MAT.MUD);
  for (let i = 0; i < (lod ? 5 : 15); i++) {
    const L = lumps[1 + (i % 4)];
    const a = rnd(2, i) * Math.PI * 2;
    mb.push(L[0] + Math.cos(a) * L[3] * 0.92, L[1] + (rnd(1, i) - 0.5) * L[4] * 0.6, L[2] + Math.sin(a) * L[3] * 0.92).sphere(0.2, 0.17, 0.2, 6, 4).pop();
  }
  // chitin / bone ribs spiralling up
  mb.col(mix(C.chitin, C.boneDark, 0.4), MAT.BONE);
  for (let k = 0; k < (lod ? 3 : 6); k++) {
    const a = (k / 6) * Math.PI * 2;
    const pts = [];
    for (let j = 0; j <= 5; j++) {
      const t = j / 5, y = 0.3 + t * 5.4, r = 2.05 - t * 1.7;
      pts.push([Math.cos(a + t * 1.3) * r, y, Math.sin(a + t * 1.3) * r]);
    }
    mb.tube(pts, [0.14, 0.12, 0.1, 0.07, 0.05, 0.02], 4);
  }
  // pupae clusters at the foot + a hanging carcass
  mb.col(mix([0.38, 0.36, 0.27], HIDE, 0.4), MAT.SKIN).vary(0.12);
  for (let i = 0; i < (lod ? 5 : 16); i++) {
    const a = rnd(5, i) * Math.PI * 2, r = 2.0 + rnd(6, i) * 0.5;
    mb.push(Math.cos(a) * r, 0.2, Math.sin(a) * r, 0.5, a, 0).sphere(0.17, 0.17, 0.34, 6, 4).pop();
  }
  mb.vary(0);
  if (!lod) {
    mb.col(C.skinDead, MAT.SKIN).push(1.3, 2.4, 1.0, 0.1, 0.4, 0.2).box(0.34, 1.0, 0.22, { bevel: 0.06 }).pop();
    mb.col(C.rust, MAT.METAL).cylBetween([1.3, 2.9, 1.0], [0.9, 3.6, 0.6], 0.02, 0.02, 3);
  }
  return mb.finish();
}

export const STRUCTURE_MODELS_P2 = {
  aid_station: (lod) => buildAidStation(lod),
  workshop: (lod) => buildWorkshop(lod),
  ammo_dump: (lod) => buildAmmoDump(lod),
  signal_post: (lod) => buildSignalPost(lod),
  muster_point: (lod) => buildMusterPoint(lod),
  grail_altar: (lod) => buildGrailAltarP2(lod),
  corpse_mound: (lod) => buildCorpseMound(lod),
  plague_pit: (lod) => buildPlaguePit(lod),
  fly_nest: (lod) => buildFlyNest(lod),
};
