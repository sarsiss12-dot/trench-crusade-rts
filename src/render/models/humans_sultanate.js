// Original procedural silhouettes; canon roster identities, CANON-INSPIRED interpretation.
// Shared rig/animation, but no Antioch helmets, crosses, tabards or complete reskinned bodies.
import { MeshBuilder, MAT } from './meshbuilder.js';
import { C } from './palette.js';
import { BONE, HUMAN, makeRig, legs, arms, torso, coatSkirt, neckAndHead, beltAndPouches, weaponAtPivot } from './humans.js';

const SAND = [0.49, 0.40, 0.25], TEAL = [0.12, 0.26, 0.25], IRON = [0.18, 0.22, 0.23];
function body(mb, r, kind) {
  const elite = kind === 'janissary', cloth = elite ? TEAL : SAND;
  legs(mb, r, { trouser: cloth, puttee: TEAL, boot: C.boot, thighR: elite ? 0.086 : 0.075, calfR: 0.06, bootW: 1, bootL: 1 });
  torso(mb, r, { coat: cloth, waistW: 0.32, chestW: elite ? 0.46 : 0.38, depth: 0.22, chestDepth: 0.25 });
  arms(mb, r, { sleeve: cloth, cuff: TEAL, hand: C.glove, shoulderR: elite ? 0.1 : 0.074, upperArmR: 0.062, foreArmR: 0.055 });
  neckAndHead(mb, r, { skin: [0.39, 0.28, 0.20] });
  beltAndPouches(mb, r, { belt: C.leatherDark });
  // High wrapped collar / face cloth: very different from the round gas-mask silhouette.
  mb.bone(BONE.HEAD).col(TEAL, MAT.CLOTH).push(0, r.headY - 0.07, 0.02).cyl(0.10, 0.11, 0.10, 8).pop();
  mb.col(elite ? IRON : SAND, elite ? MAT.METAL : MAT.CLOTH).push(0, r.headY + 0.08, 0);
  mb.lathe(elite ? [[0.12, -0.03], [0.10, 0.12], [0.055, 0.23], [0.02, 0.25]] : [[0.115, -0.02], [0.12, 0.05], [0.085, 0.10], [0, 0.12]], mb.lod ? 8 : 12).pop();
  if (elite) {
    coatSkirt(mb, r, TEAL, 1.06, 0.53, 0.18, 0.25, { gap: 0.35 });
    mb.bone(BONE.SPINE).col(IRON, MAT.METAL).push(0, 1.3, 0.13).box(0.36, 0.34, 0.07, { bevel: 0.02 }).pop();
    for (const s of [-1, 1]) mb.bone(s > 0 ? BONE.UARM_L : BONE.UARM_R).push(s * 0.23, 1.43, 0).box(0.19, 0.12, 0.29, { bevel: 0.025 }).pop();
    mb.bone(BONE.HEAD).col(C.brass, MAT.METAL).push(0, 1.76, 0.105).box(0.032, 0.19, 0.025).pop();
    mb.col(TEAL, MAT.CLOTH).push(0, 1.68, -0.1).box(0.20, 0.24, 0.055).pop();
  } else {
    mb.bone(BONE.SPINE).col(TEAL, MAT.CLOTH).push(-0.08, 1.24, 0.135, 0, 0, -0.35).box(0.08, 0.45, 0.025).pop();
  }
}
function build(kind, lod) {
  const r = makeRig({ ...HUMAN, shoulderW: kind === 'janissary' ? 0.23 : 0.20 });
  const mb = new MeshBuilder({ lod, seed: 530 + ['azeb', 'janissary', 'sapper', 'alchemist'].indexOf(kind) });
  body(mb, r, kind);
  let weapon = 'rifle';
  if (kind === 'sapper') {
    weapon = 'shotgun';
    mb.bone(BONE.SPINE).col(C.leatherDark, MAT.LEATHER).push(0, 1.12, 0.15).box(0.34, 0.49, 0.045).pop();
    mb.bone(BONE.PACK).col(C.wood, MAT.WOOD).push(0, 1.3, -0.19).box(0.33, 0.46, 0.16).pop();
    mb.col(C.steelDark, MAT.METAL).cylBetween([-0.22, 0.95, -0.23], [0.22, 1.79, -0.23], 0.022, 0.022, 6);
    mb.push(0.20, 1.72, -0.23, 0, 0, -0.4).box(0.4, 0.05, 0.08).pop();
    if (!lod) for (const x of [-0.12, 0, 0.12]) mb.bone(BONE.PELVIS).push(x, 0.99, 0.2).box(0.07, 0.12, 0.05).pop();
  }
  if (kind === 'alchemist') {
    weapon = 'flamer';
    coatSkirt(mb, r, [0.26, 0.29, 0.23], 1.04, 0.37, 0.18, 0.27, { gap: 0.18 });
    mb.bone(BONE.PACK).col(C.brass, MAT.METAL);
    for (const x of [-0.12, 0.12]) mb.cylBetween([x, 0.98, -0.22], [x, 1.60, -0.22], 0.095, 0.07, lod ? 6 : 10);
    mb.col(TEAL, MAT.GLASS).push(0, 1.62, -0.22).sphere(0.10, 0.10, 0.10, 8, 6).pop();
    mb.bone(BONE.HEAD).col(C.brass, MAT.METAL);
    for (const x of [-0.055, 0.055]) mb.push(x, 1.64, 0.1).sphere(0.045, 0.034, 0.03, 6, 4).pop();
    mb.bone(BONE.WEAPON).push(r.pivots[33], r.pivots[34], r.pivots[35]);
    mb.col(C.brass, MAT.METAL).cylBetween([0, 0, 0.1], [0, 0, 0.82], 0.032, 0.042, 8);
    mb.col(IRON, MAT.DARKMETAL).cylBetween([0, 0, 0.82], [0, 0, 1.06], 0.055, 0.07, 8);
    mb.pop();
    if (!lod) mb.bone(BONE.SPINE).col(C.rubber, MAT.LEATHER).tube([[0.12, 1.25, -0.2], [0.27, 1.05, 0], [0.16, 1.2, 0.22]], 0.02, 6);
  } else weaponAtPivot(mb, r, weapon);
  return { mesh: mb.finish(), rig: r, weapon };
}
export const UNIT_MODELS_SULTANATE = {
  is_azeb: (lod) => build('azeb', lod), is_janissary: (lod) => build('janissary', lod),
  is_sapper: (lod) => build('sapper', lod), is_alchemist: (lod) => build('alchemist', lod),
};
