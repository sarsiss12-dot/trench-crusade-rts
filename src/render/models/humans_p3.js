// Phase 3 roster on the shared 14-bone humanoid rig: New Antioch Combat Medic, Trench Cleric,
// Shock Flamer team, Lieutenant, Sniper Priest (4.1), four kinds of civilians; Black Grail Herald of Beelzebub,
// Amalgam and the Lord of Tumours. Identity through silhouette and equipment (red cross armband,
// fuel tanks, cassock and censer, officer's cap; fly wings, fused bodies, tumour crown).
import { MeshBuilder, MAT } from './meshbuilder.js';
import { C, mix, scale } from './palette.js';
import {
  BONE, makeRig, HUMAN, legs, arms, torso, coatSkirt, neckAndHead, gasMask, gothicHelmet,
  backpack, webbing, beltAndPouches, tabardCross, naBody, greatbladeGeometry, weaponAtPivot,
} from './humans.js';

// ------------------------------------------------------------------ weapons / tools

function pistolGeometry(mb) {
  mb.col(C.steelDark, MAT.DARKMETAL);
  mb.push(0, 0.0, 0.1).box(0.03, 0.05, 0.22, { bevel: mb.lod ? 0 : 0.006 }).pop();
  mb.col(C.woodDark, MAT.WOOD).push(0, -0.07, 0.02, 0.35, 0, 0).box(0.028, 0.11, 0.045, { bevel: 0.006 }).pop();
  if (!mb.lod) mb.col(C.steel, MAT.METAL).cylBetween([0, 0.012, 0.2], [0, 0.012, 0.25], 0.008, 0.008, 5);
}

function smgGeometry(mb) {
  const lod = mb.lod;
  mb.col(C.woodDark, MAT.WOOD).push(0, 0, 0, 0, -Math.PI / 2, 0);
  mb.extrude([[0, -0.05], [0.16, -0.035], [0.2, -0.07], [0.24, -0.06], [0.24, 0.025], [0, 0.03]], 0.04);
  mb.pop();
  mb.col(C.steelDark, MAT.DARKMETAL).push(0, 0.005, 0.36).box(0.045, 0.06, 0.26, { bevel: lod ? 0 : 0.008 }).pop();
  mb.cylBetween([0, 0.01, 0.48], [0, 0.01, 0.74], 0.022, 0.02, lod ? 6 : 9); // cooling jacket
  mb.col(C.steel, MAT.METAL).push(0, -0.1, 0.36).box(0.03, 0.14, 0.05).pop(); // magazine
}

function flamerGeometry(mb) {
  const lod = mb.lod;
  // projector: grip + tube + ignition cup
  mb.col(C.woodDark, MAT.WOOD).push(0, -0.06, 0.26, 0.3, 0, 0).box(0.035, 0.11, 0.05).pop();
  mb.col(C.brass, MAT.METAL).cylBetween([0, 0.0, 0.12], [0, 0.0, 0.82], 0.028, 0.026, lod ? 6 : 10);
  mb.col(C.steelDark, MAT.DARKMETAL).cylBetween([0, 0.0, 0.82], [0, 0.005, 1.06], 0.034, 0.042, lod ? 6 : 10);
  if (!lod) {
    mb.col(C.char, MAT.DARKMETAL).push(0, 0.005, 1.07).cyl(0.036, 0.036, 0.01, 8).pop();
    mb.col(C.steel, MAT.METAL).cylBetween([0, -0.04, 0.95], [0, -0.05, 1.02], 0.008, 0.008, 5); // pilot light
    mb.col(C.rubber, MAT.LEATHER).tube([[0, -0.03, 0.12], [0.02, -0.18, 0.02], [0.08, -0.3, -0.12]], 0.018, 5);
  }
}

function toolAtPivot(mb, r, kind) {
  mb.bone(BONE.TOOL);
  const p = [r.pivots[BONE.TOOL * 3], r.pivots[BONE.TOOL * 3 + 1], r.pivots[BONE.TOOL * 3 + 2]];
  mb.push(p[0], p[1], p[2]);
  mb.col(C.wood, MAT.WOOD).cylBetween([0, 0, -0.02], [0, 0, 0.95], 0.016, 0.018, mb.lod ? 5 : 7);
  mb.col(C.steelDark, MAT.METAL);
  if (kind === 'hoe') mb.push(0, -0.06, 0.98, 0.3, 0, 0).box(0.16, 0.12, 0.012, { taper: [0.8, 1] }).pop();
  else if (kind === 'pick') mb.push(0, 0, 0.97, 0, 0, 0).box(0.46, 0.035, 0.04, { taper: [0.3, 1] }).pop();
  else if (kind === 'fork') for (const x of [-0.05, 0, 0.05]) mb.cylBetween([x, 0, 0.95], [x * 1.3, 0.02, 1.2], 0.007, 0.005, 4);
  mb.pop();
}

function weaponP3(mb, r, kind) {
  mb.bone(BONE.WEAPON);
  mb.push(r.pivots[BONE.WEAPON * 3], r.pivots[BONE.WEAPON * 3 + 1], r.pivots[BONE.WEAPON * 3 + 2]);
  if (kind === 'pistol') pistolGeometry(mb);
  else if (kind === 'smg') smgGeometry(mb);
  else if (kind === 'flamer') flamerGeometry(mb);
  else if (kind === 'greatblade') greatbladeGeometry(mb);
  mb.pop();
}

function redCrossPatch(mb, bone, x, y, z, s = 1) {
  mb.bone(bone).col(C.tabard, MAT.CLOTH).push(x, y, z).box(0.012 * s, 0.1 * s, 0.1 * s).pop();
  mb.col(C.crossRed, MAT.ACCENT);
  mb.push(x + 0.004 * Math.sign(x || 1), y, z).box(0.012 * s, 0.075 * s, 0.022 * s).pop();
  mb.push(x + 0.004 * Math.sign(x || 1), y, z).box(0.012 * s, 0.022 * s, 0.075 * s).pop();
}

// ------------------------------------------------------------------ New Antioch

/** Combat Medic: red-cross armband and satchel, soft cap under the helmet, service pistol. */
export function buildMedic(lod) {
  const r = makeRig({ ...HUMAN, weaponPivot: [-0.12, 1.3, 0.14] });
  const mb = new MeshBuilder({ lod, seed: 301 });
  naBody(mb, r, { coat: mix(C.coat, C.canvas, 0.2), skirt: true });
  beltAndPouches(mb, r, { belt: C.leatherDark });
  webbing(mb, r, C.leatherDark);
  // armband + shoulder cross
  mb.bone(BONE.UARM_L).col(C.tabard, MAT.CLOTH);
  mb.cylBetween([r.shoulderW, r.shoulderY - 0.2, 0], [r.shoulderW, r.shoulderY - 0.12, 0], 0.064, 0.066, lod ? 6 : 9);
  if (!lod) redCrossPatch(mb, BONE.UARM_L, r.shoulderW + 0.066, r.shoulderY - 0.16, 0, 0.8);
  // big medical satchel on the right hip
  mb.bone(BONE.PELVIS).col(C.canvas, MAT.CLOTH).push(-0.2, r.waist - 0.12, 0.02).box(0.12, 0.2, 0.26, { bevel: 0.03 }).pop();
  if (!lod) redCrossPatch(mb, BONE.PELVIS, -0.262, r.waist - 0.1, 0.02, 1.1);
  gasMask(mb, r);
  gothicHelmet(mb, r);
  // medical pack with a cross on the flap
  backpack(mb, r, { color: C.canvas });
  if (!lod) redCrossPatch(mb, BONE.PACK, 0.0, r.packY + 0.02, -r.packZ - 0.13, 1.4);
  weaponP3(mb, r, 'pistol');
  return { mesh: mb.finish(), rig: r, weapon: 'pistol' };
}

/** Trench Cleric: ankle-long cassock, crusader tabard, hood over the mask, censer and holy book. */
export function buildCleric(lod) {
  const r = makeRig({ ...HUMAN, weaponPivot: [-0.12, 1.3, 0.14], packZ: 0.15 });
  const mb = new MeshBuilder({ lod, seed: 313 });
  const cassock = [0.12, 0.105, 0.09];
  legs(mb, r, { trouser: cassock, puttee: cassock, boot: C.boot, thighR: 0.085, calfR: 0.064, bootW: 1, bootL: 1 });
  torso(mb, r, { coat: cassock, waistW: 0.33, chestW: 0.42, depth: 0.23, chestDepth: 0.25 });
  coatSkirt(mb, r, cassock, r.waist + 0.02, 0.14, 0.19, 0.29, { gap: 0.12 });
  arms(mb, r, { sleeve: cassock, cuff: C.coatDark, hand: C.glove, shoulderR: 0.075, upperArmR: 0.06, foreArmR: 0.056 });
  neckAndHead(mb, r, { neck: C.rubber });
  tabardCross(mb, { ...r, hipJ: r.hipJ - 0.28 }, { cloth: C.tabard, cross: C.crossRed });
  beltAndPouches(mb, r, { belt: C.leatherDark });
  gasMask(mb, r);
  // deep hood
  mb.bone(BONE.HEAD).col(cassock, MAT.CLOTH).jitter(lod ? 0 : 0.01, 10, 4);
  mb.push(0, r.headY - 0.06, -0.03).lathe([[0.16, -0.12], [0.155, 0.04], [0.13, 0.15], [0.07, 0.23], [0.0, 0.25]], lod ? 8 : 14, { a0: 0.75, a1: Math.PI * 2 - 0.75, sz: 1.1 }).pop();
  mb.noJitter();
  // holy book chained to the belt, censer on the other side
  mb.bone(BONE.PELVIS).col(C.leatherDark, MAT.LEATHER).push(0.2, r.waist - 0.16, 0.06, 0, 0, 0.1).box(0.05, 0.2, 0.15, { bevel: 0.01 }).pop();
  if (!lod) {
    mb.col(C.brass, MAT.METAL).push(0.228, r.waist - 0.16, 0.06).box(0.008, 0.08, 0.02).pop();
    mb.col(C.brass, MAT.METAL).push(-0.21, r.waist - 0.34, 0.04).sphere(0.05, 0.06, 0.05, 8, 6).pop();
    mb.col(C.steelDark, MAT.METAL).cylBetween([-0.21, r.waist - 0.29, 0.04], [-0.19, r.waist - 0.02, 0.04], 0.004, 0.004, 4);
  }
  // processional cross strapped to the back (tall silhouette)
  mb.bone(BONE.PACK).col(C.woodDark, MAT.WOOD);
  mb.cylBetween([0.06, r.packY - 0.45, -r.packZ - 0.08], [0.06, r.packY + 0.75, -r.packZ - 0.08], 0.018, 0.018, lod ? 5 : 7);
  mb.col(C.brass, MAT.METAL).push(0.06, r.packY + 0.62, -r.packZ - 0.08).box(0.3, 0.035, 0.03).pop();
  mb.push(0.06, r.packY + 0.7, -r.packZ - 0.08).box(0.035, 0.2, 0.03).pop();
  weaponP3(mb, r, 'pistol');
  return { mesh: mb.finish(), rig: r, weapon: 'pistol' };
}

/**
 * Sniper Priest (Phase 4.1; official New Antioch elite — "Devotees of the Church ritually blind
 * themselves"): hooded grey-brown robe, a white blindfold band across the eyes (his silhouette),
 * rosary / relic pouch, a long rifle with a telescopic sight.
 */
export function buildSniperPriest(lod) {
  const r = makeRig({ ...HUMAN, packZ: 0.15 });
  const mb = new MeshBuilder({ lod, seed: 353 });
  const robe = [0.2, 0.18, 0.15];
  legs(mb, r, { trouser: robe, puttee: robe, boot: C.boot, thighR: 0.082, calfR: 0.062, bootW: 1, bootL: 1 });
  torso(mb, r, { coat: robe, waistW: 0.32, chestW: 0.4, depth: 0.22, chestDepth: 0.24 });
  coatSkirt(mb, r, robe, r.waist + 0.02, 0.1, 0.18, 0.3, { gap: 0.12 });
  arms(mb, r, { sleeve: robe, cuff: C.coatDark, hand: C.glove, shoulderR: 0.072, upperArmR: 0.058, foreArmR: 0.054 });
  neckAndHead(mb, r, { neck: C.skin, skin: C.skin });
  beltAndPouches(mb, r, { belt: C.leatherDark });
  // blindfold: a white band across the eyes, tails hanging at the back
  mb.bone(BONE.HEAD).col(C.tabard, MAT.CLOTH);
  mb.push(0, r.headY + 0.015, 0.0).lathe([[0.112, -0.028], [0.114, 0.028]], lod ? 9 : 14, { sz: 1.12 }).pop();
  if (!lod) {
    mb.col(C.crossRed, MAT.ACCENT).push(0, r.headY + 0.016, 0.127).box(0.03, 0.03, 0.006).pop();
    mb.col(C.tabard, MAT.CLOTH).push(0.02, r.headY - 0.06, -0.12, 0.2, 0, 0.1).box(0.03, 0.14, 0.008).pop();
  }
  // deep hood (open face)
  mb.col(robe, MAT.CLOTH).jitter(lod ? 0 : 0.01, 10, 4);
  mb.push(0, r.headY - 0.06, -0.03).lathe([[0.155, -0.12], [0.15, 0.04], [0.125, 0.15], [0.06, 0.22], [0.0, 0.24]], lod ? 8 : 14, { a0: 0.85, a1: Math.PI * 2 - 0.85, sz: 1.08 }).pop();
  mb.noJitter();
  // relic pouch and a hanging rosary cross
  mb.bone(BONE.PELVIS).col(C.leather, MAT.LEATHER).push(-0.19, r.waist - 0.12, 0.05).box(0.08, 0.12, 0.12, { bevel: 0.01 }).pop();
  if (!lod) {
    mb.bone(BONE.SPINE).col(C.brass, MAT.METAL).push(0.0, r.waist + 0.12, 0.135).box(0.018, 0.06, 0.006).pop();
    mb.push(0.0, r.waist + 0.13, 0.135).box(0.04, 0.014, 0.006).pop();
  }
  weaponAtPivot(mb, r, 'sniper');
  return { mesh: mb.finish(), rig: r, weapon: 'rifle' };
}

/** Shock Flamer: leather apron, gas mask and helmet, twin fuel tanks, projector held at the hip. */
export function buildFlamer(lod) {
  const r = makeRig({ ...HUMAN, packZ: 0.19, weaponPivot: [-0.12, 1.14, 0.16] });
  const mb = new MeshBuilder({ lod, seed: 327 });
  naBody(mb, r, { coat: C.coatDark, skirt: true });
  // heavy leather apron / sleeves (fire)
  mb.skinWith((x, y) => (y > r.hipJ ? [BONE.SPINE, BONE.SPINE, 0] : [BONE.PELVIS, x > 0 ? BONE.ULEG_L : BONE.ULEG_R, Math.min(0.55, (r.hipJ - y) * 1.4)]));
  mb.col(C.leather, MAT.LEATHER);
  mb.sheet([-0.17, r.shoulderY - 0.06, 0.13], [0.17, r.shoulderY - 0.06, 0.13], [0.16, 0.5, 0.17], [-0.16, 0.5, 0.17]);
  mb.bone(BONE.SPINE);
  beltAndPouches(mb, r, { belt: C.leatherDark });
  gasMask(mb, r);
  gothicHelmet(mb, r);
  // fuel tanks + pressure bottle
  mb.bone(BONE.PACK).col(C.steelDark, MAT.DARKMETAL);
  const z = -r.packZ - 0.12;
  for (const s of [1, -1]) mb.push(0.1 * s, r.packY - 0.05, z).cyl(0.095, 0.095, 0.62, lod ? 8 : 14).pop();
  mb.col(C.brass, MAT.METAL).push(0, r.packY - 0.02, z - 0.1).cyl(0.05, 0.05, 0.5, lod ? 6 : 10).pop();
  if (!lod) {
    mb.col(C.steel, MAT.METAL);
    for (const s of [1, -1]) mb.push(0.1 * s, r.packY + 0.27, z).cyl(0.03, 0.03, 0.05, 8).pop();
    mb.col(C.rubber, MAT.LEATHER).tube([[0.1, r.packY - 0.35, z], [0.0, r.packY - 0.5, z + 0.1], [-0.12, r.waist - 0.05, 0.1]], 0.02, 5);
    mb.col(C.crossRed, MAT.ACCENT).push(-0.1, r.packY, z - 0.098).box(0.12, 0.03, 0.01).pop(); // warning band
  }
  weaponP3(mb, r, 'flamer');
  return { mesh: mb.finish(), rig: r, weapon: 'flamer' };
}

/** Lieutenant: peaked cap with the cross, greatcoat with sash and brass, map case, trench SMG. */
export function buildLieutenant(lod) {
  const r = makeRig({ ...HUMAN, weaponPivot: [-0.12, 1.3, 0.12] });
  const mb = new MeshBuilder({ lod, seed: 341 });
  naBody(mb, r, { coat: mix(C.coat, C.coatDark, 0.4), skirt: true });
  beltAndPouches(mb, r, { belt: C.leather });
  // officer's sash + brass buttons
  mb.bone(BONE.SPINE).col(C.crossRed, MAT.ACCENT).push(0, r.waist + 0.2, 0.12, 0, 0, 0.7).box(0.05, 0.55, 0.012).pop();
  if (!lod) {
    mb.col(C.brass, MAT.METAL);
    for (let k = 0; k < 4; k++) mb.push(0.05, r.waist + 0.07 + k * 0.08, 0.123).box(0.018, 0.018, 0.008).pop();
    // binoculars + map case
    mb.col(C.leatherDark, MAT.LEATHER).push(0.08, r.shoulderY - 0.2, 0.14).box(0.1, 0.07, 0.05, { bevel: 0.01 }).pop();
    mb.bone(BONE.PELVIS).col(C.leather, MAT.LEATHER).push(0.19, r.waist - 0.2, -0.02).box(0.04, 0.22, 0.2, { bevel: 0.01 }).pop();
  }
  neckAndHead(mb, r, { neck: C.skin });
  // peaked cap
  mb.bone(BONE.HEAD).col(C.coatDark, MAT.CLOTH);
  mb.push(0, r.headY + 0.06, 0.0).lathe([[0.115, -0.02], [0.13, 0.05], [0.14, 0.08], [0.0, 0.085]], lod ? 9 : 14, { sz: 1.1 }).pop();
  mb.col(C.leatherDark, MAT.LEATHER).push(0, r.headY + 0.045, 0.1, -0.25, 0, 0).box(0.2, 0.012, 0.09).pop();
  if (!lod) mb.col(C.crossRed, MAT.ACCENT).push(0, r.headY + 0.1, 0.13).box(0.03, 0.03, 0.008).pop();
  weaponP3(mb, r, 'smg');
  return { mesh: mb.finish(), rig: r, weapon: 'smg' };
}

// ------------------------------------------------------------------ civilians

const CIV = [
  { shirt: [0.42, 0.38, 0.3], trouser: [0.28, 0.25, 0.2], hat: 'brim', tool: 'hoe' },
  { shirt: [0.36, 0.28, 0.24], trouser: [0.24, 0.2, 0.17], hat: 'scarf', tool: 'fork', skirt: true },
  { shirt: [0.4, 0.4, 0.36], trouser: [0.3, 0.27, 0.22], hat: 'cap', tool: 'hoe', sack: true },
  { shirt: [0.33, 0.31, 0.27], trouser: [0.22, 0.21, 0.19], hat: 'cap', tool: 'pick' },
];

/** Civilians of the principality: farmer, farm woman, porter, labourer (tools, no weapons). */
export function buildCivilian(lod, v = 0) {
  const o = CIV[v % CIV.length];
  const r = makeRig({ ...HUMAN, shoulderW: 0.19, toolPivot: [0.06, 1.28, -0.2], packZ: 0.12 });
  const mb = new MeshBuilder({ lod, seed: 401 + v });
  legs(mb, r, { trouser: o.trouser, puttee: o.trouser, boot: C.boot, thighR: 0.08, calfR: 0.06, bootW: 0.95, bootL: 0.95 });
  torso(mb, r, { coat: o.shirt, waistW: 0.3, chestW: 0.38, depth: 0.2, chestDepth: 0.22 });
  if (o.skirt) coatSkirt(mb, r, scale(o.trouser, 1.2), r.waist, 0.16, 0.18, 0.27, { gap: 0.1 });
  else {
    // waistcoat
    mb.bone(BONE.SPINE).col(scale(o.shirt, 0.7), MAT.CLOTH).push(0, r.waist + 0.2, 0.012).box(0.31, 0.34, 0.215, { bevel: 0.03 }).pop();
  }
  arms(mb, r, { sleeve: o.shirt, hand: C.skin, shoulderR: 0.066, upperArmR: 0.052, foreArmR: 0.046 });
  neckAndHead(mb, r, { neck: C.skin, skin: C.skin });
  mb.bone(BONE.HEAD);
  if (o.hat === 'brim') {
    mb.col(C.canvasDark, MAT.CLOTH).push(0, r.headY + 0.07, 0).lathe([[0.2, -0.01], [0.2, 0.0], [0.1, 0.01], [0.095, 0.08], [0.0, 0.09]], lod ? 9 : 14).pop();
  } else if (o.hat === 'scarf') {
    mb.col([0.3, 0.14, 0.1], MAT.CLOTH).push(0, r.headY + 0.01, -0.01).lathe([[0.11, -0.1], [0.115, 0.02], [0.095, 0.1], [0.0, 0.125]], lod ? 8 : 12, { a0: 0.6, a1: Math.PI * 2 - 0.6 }).pop();
    // shawl
    mb.bone(BONE.SPINE).col([0.26, 0.2, 0.16], MAT.CLOTH).push(0, r.shoulderY - 0.02, -0.02).lathe([[0.22, -0.18], [0.2, -0.05], [0.12, 0.05]], lod ? 8 : 12, { sz: 0.8 }).pop();
  } else {
    mb.col(scale(o.trouser, 0.8), MAT.CLOTH).push(0, r.headY + 0.06, 0.0).lathe([[0.1, -0.02], [0.105, 0.04], [0.0, 0.06]], lod ? 8 : 12).pop();
    mb.col(scale(o.trouser, 0.7), MAT.CLOTH).push(0, r.headY + 0.05, 0.09, -0.2, 0, 0).box(0.16, 0.012, 0.07).pop();
  }
  if (o.sack) {
    // porter's load: a heavy sack across the back
    mb.bone(BONE.PACK).col(C.sandbag, MAT.CLOTH).jitter(lod ? 0 : 0.015, 8, 3);
    mb.push(0, r.packY + 0.02, -r.packZ - 0.14, 0, 0, 0.2).sphere(0.2, 0.26, 0.15, lod ? 7 : 11, lod ? 5 : 8).pop();
    mb.noJitter();
  } else if (v === 1) {
    // basket
    mb.bone(BONE.PACK).col(C.plank, MAT.WOOD).push(0, r.packY - 0.02, -r.packZ - 0.12).lathe([[0.12, -0.14], [0.16, 0.14], [0.155, 0.15]], lod ? 8 : 12).pop();
  }
  toolAtPivot(mb, r, o.tool);
  return { mesh: mb.finish(), rig: r, weapon: 'claws', tool: o.tool };
}

// ------------------------------------------------------------------ Black Grail

/** Herald of Beelzebub: gaunt and tall, fly crown, membranous wings, a banner of the Fly. */
export function buildHerald(lod) {
  const r = makeRig({
    ...HUMAN, hip: 1.12, hipJ: 1.1, waist: 1.27, shoulderY: 1.74, shoulderW: 0.22, hipW: 0.1, neck: 1.82,
    headY: 1.96, elbowY: 1.36, wristY: 1.04, knee: 0.6, ankle: 0.1, packY: 1.55, packZ: 0.16,
  });
  const mb = new MeshBuilder({ lod, seed: 503 });
  legs(mb, r, { trouser: C.ragsDark, puttee: C.skinDead, putteeMat: MAT.SKIN, boot: C.ragsDark, thighR: 0.075, calfR: 0.055, bootW: 0.9, bootL: 1.1, bareFoot: true });
  torso(mb, r, { coat: C.ragsDark, waistW: 0.3, chestW: 0.38, depth: 0.22, chestDepth: 0.24 });
  mb.bone(BONE.PELVIS).col(C.skinBruise, MAT.SKIN).push(0, r.waist + 0.04, 0.08).sphere(0.17, 0.15, 0.14, lod ? 7 : 11, lod ? 5 : 7).pop();
  coatSkirt(mb, r, C.rags, r.waist + 0.05, 0.2, 0.2, 0.3, { ragged: true, gap: 0.3 });
  arms(mb, r, { sleeve: C.rags, hand: C.skinDead, shoulderR: 0.065, upperArmR: 0.05, foreArmR: 0.045, claws: true });
  neckAndHead(mb, r, { neck: C.skinDead, skin: C.skinDead });
  // crown of flies: a ring of dark nodules + compound eyes
  mb.bone(BONE.HEAD).col(C.lensGreen, MAT.GLASS);
  for (const s of [1, -1]) mb.push(0.045 * s, r.headY + 0.02, 0.085).sphere(0.04, 0.035, 0.028, lod ? 6 : 9, lod ? 4 : 6).pop();
  mb.col(C.chitin, MAT.DARKMETAL);
  const n = lod ? 5 : 9;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    mb.push(Math.sin(a) * 0.12, r.headY + 0.14 + (k % 2) * 0.03, Math.cos(a) * 0.12).sphere(0.028, 0.034, 0.028, 5, 4).pop();
  }
  // wings (membranes) on the back
  mb.bone(BONE.PACK).col(C.boneDark, MAT.BONE);
  const z = -r.packZ - 0.06;
  for (const s of [1, -1]) {
    mb.tube([[0.05 * s, r.packY + 0.1, z], [0.35 * s, r.packY + 0.45, z - 0.15], [0.6 * s, r.packY + 0.1, z - 0.2]], [0.02, 0.015, 0.006], 5);
    mb.col(mix(C.skinPale, C.pus, 0.3), MAT.FLESH);
    mb.sheet([0.05 * s, r.packY + 0.1, z], [0.35 * s, r.packY + 0.45, z - 0.15], [0.6 * s, r.packY + 0.1, z - 0.2], [0.2 * s, r.packY - 0.35, z - 0.08]);
    mb.col(C.boneDark, MAT.BONE);
  }
  // fly banner pole
  mb.col(C.woodDark, MAT.WOOD).cylBetween([-0.12, r.packY - 0.6, z], [-0.12, r.packY + 1.0, z], 0.018, 0.016, lod ? 5 : 7);
  mb.col(C.grailAccent, MAT.ACCENT).sheet([-0.12, r.packY + 0.95, z], [0.25, r.packY + 0.92, z - 0.02], [0.23, r.packY + 0.55, z - 0.02], [-0.12, r.packY + 0.5, z]);
  return { mesh: mb.finish(), rig: r, weapon: 'claws', hunch: 0.25 };
}

/** Amalgam: many bodies fused into one hulking mass — extra arms, heads sunk into the flesh. */
export function buildAmalgam(lod) {
  const r = makeRig({
    ...HUMAN, hip: 1.25, hipJ: 1.22, waist: 1.45, shoulderY: 2.1, shoulderW: 0.44, hipW: 0.2, neck: 2.16,
    headY: 2.28, elbowY: 1.62, wristY: 1.2, knee: 0.66, ankle: 0.12, packY: 1.85, packZ: 0.34,
  });
  const mb = new MeshBuilder({ lod, seed: 521 });
  legs(mb, r, { trouser: C.flesh, trouserMat: MAT.FLESH, puttee: C.skinPale, putteeMat: MAT.SKIN, boot: C.fleshDark, thighR: 0.17, calfR: 0.14, bootW: 1.7, bootL: 1.3, bareFoot: true });
  mb.bone(BONE.SPINE).col(C.skinPale, MAT.SKIN).jitter(lod ? 0.01 : 0.03, 5, 13);
  mb.push(0, (r.waist + r.shoulderY) / 2, 0.02).sphere(0.52, 0.5, 0.42, lod ? 9 : 16, lod ? 7 : 12).pop();
  mb.bone(BONE.PELVIS).col(C.skinBruise, MAT.SKIN).push(0, r.hip + 0.05, 0.05).sphere(0.42, 0.3, 0.38, lod ? 8 : 13, lod ? 6 : 9).pop();
  mb.noJitter();
  arms(mb, r, { sleeve: C.skinPale, sleeveMat: MAT.SKIN, hand: C.skinDead, shoulderR: 0.16, upperArmR: 0.12, foreArmR: 0.11, claws: true, swollen: 1.25 });
  // fused extra arms and sunken faces
  if (!lod) {
    mb.bone(BONE.SPINE).col(C.skinDead, MAT.SKIN);
    for (const s of [1, -1]) mb.tube([[0.3 * s, r.shoulderY - 0.35, 0.25], [0.55 * s, r.shoulderY - 0.55, 0.35], [0.6 * s, r.shoulderY - 0.95, 0.3]], [0.07, 0.055, 0.04], 6);
    mb.col(C.skinPale, MAT.SKIN);
    for (const [x, y, zz] of [[0.18, r.shoulderY - 0.15, 0.38], [-0.22, r.waist + 0.3, 0.4], [0.05, r.waist + 0.1, 0.42]]) mb.push(x, y, zz).sphere(0.09, 0.11, 0.07, 8, 6).pop();
    mb.col([0.02, 0.015, 0.012], MAT.FLESH);
    for (const [x, y, zz] of [[0.18, r.shoulderY - 0.15, 0.45], [-0.22, r.waist + 0.3, 0.47]]) mb.push(x, y, zz).box(0.06, 0.02, 0.01).pop();
    mb.col(C.boneDark, MAT.BONE);
    for (let k = 0; k < 5; k++) mb.push(-0.2 + k * 0.1, r.shoulderY + 0.05, -0.25 - (k % 2) * 0.05, -0.5, 0, 0).cyl(0.03, 0.005, 0.25, 5).pop();
  }
  neckAndHead(mb, r, { neck: C.skinPale, skin: C.skinDead });
  mb.bone(BONE.PACK).col(C.flesh, MAT.FLESH).jitter(lod ? 0.01 : 0.03, 7, 21);
  mb.push(0, r.packY - 0.1, -r.packZ - 0.1).sphere(0.36, 0.4, 0.3, lod ? 8 : 13, lod ? 6 : 9).pop();
  mb.noJitter();
  if (!lod) mb.col(C.pus, MAT.FLESH).push(0.15, r.packY, -r.packZ - 0.36).sphere(0.06, 0.06, 0.06, 7, 5).pop();
  return { mesh: mb.finish(), rig: r, weapon: 'claws', hunch: 0.35, heavy: true };
}

/** Lord of Tumours: bloated, armoured in chitin and bone, a crown of growths, the tumour blade. */
export function buildLord(lod) {
  const r = makeRig({
    ...HUMAN, hip: 1.18, hipJ: 1.16, waist: 1.34, shoulderY: 1.86, shoulderW: 0.33, hipW: 0.15, neck: 1.94,
    headY: 2.09, elbowY: 1.48, wristY: 1.16, knee: 0.64, ankle: 0.12, packY: 1.68, packZ: 0.24,
    weaponPivot: [-0.33, 1.07, 0.1], weaponParent: 'hand',
  });
  const mb = new MeshBuilder({ lod, seed: 541 });
  const seg = lod ? 7 : 12;
  legs(mb, r, { trouser: C.chitin, trouserMat: MAT.DARKMETAL, puttee: C.chitinHi, putteeMat: MAT.DARKMETAL, boot: C.chitin, thighR: 0.14, calfR: 0.11, bootW: 1.5, bootL: 1.25, kneePad: C.bone });
  torso(mb, r, { coat: C.chitin, coatMat: MAT.DARKMETAL, hips: C.ragsDark, waistW: 0.5, chestW: 0.7, depth: 0.4, chestDepth: 0.48 });
  // bloated belly bursting through the plates
  mb.bone(BONE.PELVIS).col(C.skinBruise, MAT.SKIN).jitter(lod ? 0 : 0.02, 9, 5);
  mb.push(0, r.waist + 0.05, 0.16).sphere(0.3, 0.26, 0.24, lod ? 8 : 13, lod ? 6 : 9).pop();
  mb.noJitter();
  coatSkirt(mb, r, C.ragsDark, r.waist + 0.02, 0.4, 0.3, 0.42, { ragged: true, gap: 0.35, sz: 0.85 });
  arms(mb, r, { sleeve: C.chitin, sleeveMat: MAT.DARKMETAL, hand: C.chitin, shoulderR: 0.13, upperArmR: 0.1, foreArmR: 0.095 });
  mb.col(C.bone, MAT.BONE);
  for (const s of [1, -1]) {
    mb.bone(s > 0 ? BONE.UARM_L : BONE.UARM_R, BONE.SPINE, 0.45);
    mb.push(r.shoulderW * s * 1.1, r.shoulderY + 0.05, 0, 0.1, 0, -0.45 * s).lathe([[0.24, -0.15], [0.22, -0.04], [0.16, 0.07], [0.0, 0.12]], seg, { sz: 0.85 }).pop();
  }
  // tumours
  mb.bone(BONE.SPINE).col(C.flesh, MAT.FLESH).jitter(lod ? 0 : 0.015, 20, 3);
  for (const [x, y, z, rr] of [[0.25, r.shoulderY - 0.1, 0.18, 0.1], [-0.2, r.shoulderY - 0.3, 0.2, 0.08], [0.1, r.waist + 0.35, 0.24, 0.07], [-0.3, r.shoulderY, -0.1, 0.09]]) mb.push(x, y, z).sphere(rr, rr * 1.1, rr, lod ? 6 : 9, lod ? 4 : 6).pop();
  mb.noJitter();
  // head: sunken face under a crown of bony growths
  neckAndHead(mb, r, { neck: C.chitin, skin: C.skinDead });
  mb.bone(BONE.HEAD).col(C.chitin, MAT.DARKMETAL);
  mb.push(0, r.headY - 0.1, 0.01).lathe([[0.13, 0.0], [0.14, 0.13], [0.12, 0.2], [0.0, 0.23]], seg, { capBottom: true, sz: 1.1 }).pop();
  mb.col(C.lensGreen, MAT.GLASS);
  for (const s of [1, -1]) mb.push(0.05 * s, r.headY + 0.02, 0.11).sphere(0.035, 0.03, 0.025, 8, 5).pop();
  mb.col(C.boneDark, MAT.BONE);
  const n = lod ? 5 : 8;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    mb.push(Math.sin(a) * 0.11, r.headY + 0.15, Math.cos(a) * 0.11, Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35).cyl(0.025, 0.004, 0.22 + (k % 3) * 0.06, 5).pop();
  }
  // cape of rot with flies
  mb.bone(BONE.PACK).col(C.rags, MAT.CLOTH).jitter(lod ? 0 : 0.02, 10, 7);
  mb.sheet([-0.32, r.shoulderY, -0.2], [0.32, r.shoulderY, -0.2], [0.4, 0.3, -0.45], [-0.4, 0.3, -0.45]);
  mb.noJitter();
  weaponP3(mb, r, 'greatblade');
  return { mesh: mb.finish(), rig: r, weapon: 'greatblade', heavy: true };
}

export const UNIT_MODELS_P3 = {
  na_medic: (lod) => buildMedic(lod),
  na_cleric: (lod) => buildCleric(lod),
  na_flamer: (lod) => buildFlamer(lod),
  na_lieutenant: (lod) => buildLieutenant(lod),
  na_sniper: (lod) => buildSniperPriest(lod),
  na_civilian: (lod) => buildCivilian(lod, 0),
  na_civilian_b: (lod) => buildCivilian(lod, 1),
  na_civilian_c: (lod) => buildCivilian(lod, 2),
  na_civilian_d: (lod) => buildCivilian(lod, 3),
  bg_herald: (lod) => buildHerald(lod),
  bg_amalgam: (lod) => buildAmalgam(lod),
  bg_lord: (lod) => buildLord(lod),
};
