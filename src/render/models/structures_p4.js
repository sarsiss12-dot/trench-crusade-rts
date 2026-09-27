// Phase 4 structure models (model-local: +z = front, footprint centred).
//  - FIELD GUN emplacement: a sandbagged gun pit (horseshoe open at the back), spoked wheels, box
//    trail and a steel shield; the BARREL is a separate model (field_gun_barrel, origin at the
//    trunnions) drawn per frame so it can recoil and follow the gun's aim
//  - VISCERA CANNON nest: a gun grown, not built — a heaped cairn of bone and diseased tissue with a
//    ribbed gut-barrel; nothing of a human bunker
//  - CORRUPTION BELCHER nest: a bloated fume sac on a rib cage, vent pipes of bone, sores
import { MeshBuilder, MAT } from './meshbuilder.js';
import { C, mix } from './palette.js';
import { hash32 } from '../../core/rng.js';

function rnd(seed, i) {
  return hash32(seed, i, 977) / 4294967296;
}

const ROT = [0.21, 0.1, 0.085];
const HIDE = [0.24, 0.19, 0.18];
const HIDE_D = [0.14, 0.11, 0.1];
const FILTH = [0.06, 0.068, 0.028];
const GUNMETAL = [0.19, 0.2, 0.19];
const OLIVE = [0.28, 0.29, 0.22];

function wheel(mb, x, lod) {
  mb.push(x, 0.72, 0, 0, 0, Math.PI / 2);
  mb.col(C.woodDark, MAT.WOOD).cyl(0.72, 0.72, 0.1, lod ? 10 : 18, { caps: false });
  mb.col(C.steelDark, MAT.METAL).push(0, -0.01, 0).cyl(0.74, 0.74, 0.12, lod ? 10 : 18, { caps: false }).pop();
  mb.col(C.woodDark, MAT.WOOD).cyl(0.14, 0.14, 0.22, 8);
  if (!lod) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      mb.cylBetween([0, 0.05, 0], [Math.cos(a) * 0.68, 0.05, Math.sin(a) * 0.68], 0.03, 0.025, 4);
    }
  }
  mb.pop();
}

/** Field gun emplacement (6 x 6): pit, sandbag horseshoe, carriage, wheels, shield, ammo. */
export function buildFieldGun(lod) {
  const mb = new MeshBuilder({ lod, seed: 911 });
  // shallow pit floor + spoil
  mb.col(mix(C.soil, C.char, 0.2), MAT.SOIL).jitter(0.05, 2, 4).push(0, -0.05, 0).sphere(2.9, 0.12, 2.9, lod ? 10 : 16, 3).pop().noJitter();
  // sandbag horseshoe (open to the rear, -z)
  mb.col(C.sandbag, MAT.CLOTH).vary(0.14);
  const layers = lod ? 2 : 3;
  for (let l = 0; l < layers; l++) {
    const n = lod ? 9 : 15;
    for (let i = 0; i < n; i++) {
      const a = -2.15 + (i / (n - 1)) * 4.3 + (l % 2) * 0.12;
      const r = 2.75 - l * 0.08;
      mb.push(Math.sin(a) * r, 0.14 + l * 0.24, Math.cos(a) * r, (rnd(l, i) - 0.5) * 0.08, a + Math.PI / 2, 0).box(0.6, 0.24, 0.36, { bevel: 0.07 }).pop();
    }
  }
  mb.vary(0);
  // carriage: axle, cheeks, box trail to the rear (the barrel model sits on the trunnions)
  mb.col(OLIVE, MAT.METAL);
  mb.push(0, 0.72, 0.1).box(1.5, 0.12, 0.14).pop();
  for (const s of [-0.28, 0.28]) mb.push(s, 0.95, 0.05, -0.08, 0, 0).box(0.1, 0.5, 1.2).pop();
  mb.push(0, 0.55, -1.25, 0.32, 0, 0).box(0.34, 0.2, 2.1).pop();
  mb.col(C.steelDark, MAT.METAL).push(0, 0.08, -2.2).box(0.5, 0.1, 0.3).pop(); // spade
  wheel(mb, -0.82, lod);
  wheel(mb, 0.82, lod);
  // shield: bent steel plate with a sighting notch
  mb.col(mix(OLIVE, C.steel, 0.3), MAT.METAL);
  mb.push(0, 1.25, 0.55).box(1.9, 1.05, 0.06, { bevel: lod ? 0 : 0.02 }).pop();
  if (!lod) {
    for (const s of [-1, 1]) mb.push(s * 1.05, 1.2, 0.42, 0, s * 0.35, 0).box(0.36, 0.95, 0.05).pop();
    mb.col([0.05, 0.05, 0.045], MAT.DARKMETAL).push(-0.45, 1.55, 0.59).box(0.14, 0.12, 0.02).pop();
    // a red cross stencilled on the shield (New Antioch)
    mb.col(C.crossRed, MAT.ACCENT).push(0.55, 1.35, 0.59).box(0.06, 0.34, 0.02).pop();
    mb.push(0.55, 1.42, 0.59).box(0.24, 0.06, 0.02).pop();
    // ready rounds: wicker shell baskets + a crate at the back of the pit
    mb.col(C.wood, MAT.WOOD);
    for (let i = 0; i < 3; i++) mb.push(-1.5 + i * 0.4, 0.28, -1.7).box(0.32, 0.56, 0.32, { bevel: 0.03 }).pop();
    mb.col(C.brass, MAT.METAL);
    for (let i = 0; i < 4; i++) mb.push(1.2 + (i % 2) * 0.22, 0.34, -1.6 - (i >> 1) * 0.22).cyl(0.07, 0.07, 0.62, 8).pop();
    // spent cases on the floor
    for (let i = 0; i < 5; i++) mb.push((rnd(3, i) - 0.5) * 2.4, 0.06, -0.4 - rnd(4, i) * 1.4, 0, rnd(5, i) * 6, Math.PI / 2).cyl(0.06, 0.06, 0.5, 6).pop();
  }
  return mb.finish();
}

/** Field gun barrel (origin = trunnion axis at the carriage, +z forward, slight elevation). */
export function buildFieldGunBarrel(lod) {
  const mb = new MeshBuilder({ lod, seed: 913 });
  mb.push(0, 1.12, 0.1, -0.12, 0, 0);
  mb.col(GUNMETAL, MAT.METAL);
  // cradle / recuperator under the tube
  mb.push(0, -0.12, -0.2).box(0.26, 0.2, 1.7, { bevel: lod ? 0 : 0.03 }).pop();
  // breech block
  mb.col(C.steelDark, MAT.METAL).push(0, 0, -0.95).box(0.34, 0.34, 0.4, { bevel: lod ? 0 : 0.04 }).pop();
  // the tube (tapered), reinforcing band, muzzle
  mb.col(GUNMETAL, MAT.METAL).push(0, 0, -0.75, Math.PI / 2, 0, 0).cyl(0.13, 0.09, 3.1, lod ? 8 : 14).pop();
  if (!lod) {
    mb.push(0, 0, 0.0, Math.PI / 2, 0, 0).cyl(0.15, 0.15, 0.16, 12).pop();
    mb.col([0.05, 0.05, 0.05], MAT.DARKMETAL).push(0, 0, 2.34, Math.PI / 2, 0, 0).cyl(0.06, 0.06, 0.03, 10).pop();
    mb.col(C.brass, MAT.METAL).push(0.2, 0.08, -0.85).box(0.05, 0.22, 0.12).pop(); // firing lever
  }
  mb.pop();
  return mb.finish();
}

function lumps(mb, list, lod, seed) {
  mb.jitter(lod ? 0.05 : 0.14, 1.6, seed);
  list.forEach(([x, y, z, r, h, col], i) => {
    mb.col(col || (i % 2 ? HIDE_D : mix(HIDE, ROT, 0.4)), MAT.SKIN).push(x, y, z).sphere(r, h, r * 0.95, lod ? 8 : 11, lod ? 5 : 7).pop();
  });
  mb.noJitter();
}

function ribs(mb, cx, cz, r, h, n, lod, twist = 0.4) {
  mb.col(mix(C.bone, C.boneDark, 0.35), MAT.BONE);
  for (let k = 0; k < (lod ? Math.ceil(n / 2) : n); k++) {
    const a = (k / n) * Math.PI * 2;
    const pts = [];
    for (let j = 0; j <= 4; j++) {
      const t = j / 4;
      const rr = r * (1 - t * 0.55);
      pts.push([cx + Math.cos(a + t * twist) * rr, t * h, cz + Math.sin(a + t * twist) * rr]);
    }
    mb.tube(pts, [0.12, 0.11, 0.09, 0.06, 0.03], 4);
  }
}

/** Viscera Cannon nest (5 x 5): bone cairn + sagging tissue, a ribbed gut-barrel aimed forward. */
export function buildVisceraNest(lod) {
  const mb = new MeshBuilder({ lod, seed: 921 });
  mb.col(mix(C.soil, ROT, 0.35), MAT.SOIL).jitter(0.12, 1.2, 3).push(0, 0, 0).sphere(2.5, 0.5, 2.4, lod ? 8 : 12, 4, { hemi: 1 }).pop().noJitter();
  lumps(mb, [[0, 0.8, -0.3, 1.6, 0.9], [0.5, 1.5, -0.6, 1.0, 0.7], [-0.6, 1.4, -0.4, 0.9, 0.65, mix(C.flesh, ROT, 0.5)], [0.1, 2.1, -0.5, 0.7, 0.55]], lod, 7);
  // skulls and long bones heaped into the base (a cairn, not a wall)
  mb.col(C.bone, MAT.BONE).vary(0.1);
  for (let i = 0; i < (lod ? 6 : 16); i++) {
    const a = rnd(9, i) * Math.PI * 2, r = 1.7 + rnd(10, i) * 0.6;
    const y = 0.2 + rnd(11, i) * 0.5;
    if (i % 3 === 0) mb.push(Math.cos(a) * r, y, Math.sin(a) * r).sphere(0.2, 0.22, 0.24, 7, 5).pop();
    else mb.cylBetween([Math.cos(a) * r, y, Math.sin(a) * r], [Math.cos(a + 0.5) * (r + 0.3), y + 0.3, Math.sin(a + 0.5) * (r + 0.3)], 0.06, 0.05, 5);
  }
  mb.vary(0);
  ribs(mb, 0, -0.3, 1.9, 2.4, 7, lod);
  // the gut-barrel: a ribbed fleshy tube from the mound, mouth forward (+z)
  const pts = [[0, 1.5, -0.2], [0, 1.75, 0.6], [0, 1.9, 1.4], [0, 1.95, 2.2]];
  mb.col(mix(C.flesh, HIDE, 0.35), MAT.FLESH).tube(pts, [0.5, 0.42, 0.36, 0.34], lod ? 8 : 12);
  if (!lod) {
    mb.col(mix(C.bone, C.boneDark, 0.4), MAT.BONE);
    for (let i = 0; i < 5; i++) {
      const t = i / 4, z = -0.1 + t * 2.1, y = 1.55 + t * 0.4;
      mb.push(0, y, z, Math.PI / 2, 0, 0).lathe([[0.44 - t * 0.08, -0.05], [0.47 - t * 0.08, 0], [0.44 - t * 0.08, 0.05]], 12, { capBottom: false }).pop();
    }
    mb.col(FILTH, MAT.MUD).push(0, 1.95, 2.3).sphere(0.26, 0.26, 0.08, 10, 4).pop(); // the wet maw
    mb.col(C.pus, MAT.FLESH);
    for (let i = 0; i < 6; i++) mb.push((rnd(12, i) - 0.5) * 1.6, 0.9 + rnd(13, i) * 1.1, -0.6 + rnd(14, i)).sphere(0.12, 0.1, 0.12, 6, 4).pop();
  }
  return mb.finish();
}

/** Corruption Belcher nest (4 x 4): a bloated fume sac in a rib cage, bone vent pipes, sores. */
export function buildBelcherNest(lod) {
  const mb = new MeshBuilder({ lod, seed: 931 });
  mb.col(mix(C.soil, FILTH, 0.4), MAT.SOIL).jitter(0.1, 1.4, 5).push(0, 0, 0).sphere(1.9, 0.35, 1.9, lod ? 8 : 12, 3, { hemi: 1 }).pop().noJitter();
  lumps(mb, [[0, 1.2, 0, 1.35, 1.15, mix(HIDE, C.pus, 0.25)], [0.3, 2.1, 0.1, 0.9, 0.75, mix(HIDE, C.grailAccent, 0.2)]], lod, 11);
  ribs(mb, 0, 0, 1.55, 2.6, 6, lod, 0.9);
  // bone vent pipes spewing forward / up
  mb.col(mix(C.bone, C.chitin, 0.3), MAT.BONE);
  for (const [x, z, a] of [[0.5, 0.9, 0.5], [-0.6, 0.7, -0.4], [0.1, 1.1, 0]]) {
    mb.cylBetween([x * 0.6, 1.4, z * 0.4], [x + Math.sin(a) * 0.4, 2.6, z + 0.5], 0.14, 0.1, lod ? 5 : 8);
    if (!lod) mb.col(FILTH, MAT.MUD).push(x + Math.sin(a) * 0.4, 2.62, z + 0.5).sphere(0.1, 0.04, 0.1, 6, 3).pop().col(mix(C.bone, C.chitin, 0.3), MAT.BONE);
  }
  if (!lod) {
    mb.col(mix(C.flesh, C.pus, 0.3), MAT.FLESH);
    for (let i = 0; i < 9; i++) {
      const a = rnd(20, i) * Math.PI * 2, h = 0.6 + rnd(21, i) * 1.4;
      mb.push(Math.cos(a) * 1.25, h, Math.sin(a) * 1.25).sphere(0.16, 0.13, 0.16, 6, 4).pop();
    }
  }
  return mb.finish();
}

export const STRUCTURE_MODELS_P4 = {
  field_gun: (lod) => buildFieldGun(lod),
  field_gun_barrel: (lod) => buildFieldGunBarrel(lod),
  viscera_nest: (lod) => buildVisceraNest(lod),
  belcher_nest: (lod) => buildBelcherNest(lod),
};
