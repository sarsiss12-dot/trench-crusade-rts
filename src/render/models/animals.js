// Procedural farm animals and the supply cart (Phase 3) on the SAME 14-bone skinning pipeline as
// the soldiers, re-used as a quadruped rig (no new shader, no new texture):
//   PELVIS = hindquarters (root), SPINE = forequarters, HEAD = neck + head,
//   UARM/LARM = front legs, ULEG/LLEG = hind legs, WEAPON = tail (child of PELVIS),
//   TOOL = ears (child of HEAD), PACK = pack saddle / harness (child of SPINE).
// Real livestock only (sheep, goat, pig, cattle, mule, dog) — no fantasy animals.
// The cart is a RIGID model: body on PELVIS, the two wheels on WEAPON / TOOL (they turn).
import { MeshBuilder, MAT } from './meshbuilder.js';
import { C, mix, scale } from './palette.js';
import { BONE, BONE_COUNT, PARENTS } from './humans.js';

/**
 * Quadruped rig from proportions (metres; model faces +z):
 * len body length, w half-width of the leg stance, hipY hip joint height, shoulderY, kneeF / hockY
 * lower-leg joints, neckY / neckZ head joint, tailY.
 */
export function makeQuadRig(p) {
  const r = { ...p, quad: true, pivots: new Float32Array(BONE_COUNT * 3), parents: PARENTS.slice() };
  const set = (b, x, y, z) => { r.pivots[b * 3] = x; r.pivots[b * 3 + 1] = y; r.pivots[b * 3 + 2] = z; };
  const hz = -p.len * 0.34, fz = p.len * 0.3;
  set(BONE.PELVIS, 0, p.hipY, hz);
  set(BONE.SPINE, 0, p.backY, 0);
  set(BONE.HEAD, 0, p.neckY, p.neckZ);
  set(BONE.UARM_L, p.w, p.shoulderY, fz);
  set(BONE.LARM_L, p.w, p.kneeF, fz + 0.01);
  set(BONE.UARM_R, -p.w, p.shoulderY, fz);
  set(BONE.LARM_R, -p.w, p.kneeF, fz + 0.01);
  set(BONE.ULEG_L, p.w, p.hipY, hz);
  set(BONE.LLEG_L, p.w, p.hockY, hz - 0.03);
  set(BONE.ULEG_R, -p.w, p.hipY, hz);
  set(BONE.LLEG_R, -p.w, p.hockY, hz - 0.03);
  set(BONE.WEAPON, 0, p.tailY, -p.len * 0.5);
  set(BONE.TOOL, 0, p.neckY + p.headUp, p.neckZ + p.headFwd * 0.4);
  set(BONE.PACK, 0, p.backY + p.bodyR * 0.8, 0);
  r.parents[BONE.WEAPON] = BONE.PELVIS;
  r.parents[BONE.TOOL] = BONE.HEAD;
  return r;
}

function limb(mb, r, upper, lower, x, top, knee, z, rTop, rKnee, rFoot, hoof, lod) {
  const seg = lod ? 5 : 7;
  mb.bone(upper);
  mb.cylBetween([x, knee, z + 0.005], [x, top + 0.04, z], rKnee, rTop, seg, { caps: false });
  mb.bone(lower);
  mb.cylBetween([x, 0.05, z + 0.01], [x, knee + 0.02, z + 0.005], rFoot, rKnee * 0.95, seg);
  mb.col(hoof, MAT.BONE).push(x, 0.035, z + 0.02).box(rFoot * 2.3, 0.07, rFoot * 2.8, { bevel: 0.01 }).pop();
}

function legs4(mb, r, o, lod) {
  const hz = -r.len * 0.34, fz = r.len * 0.3;
  for (const s of [1, -1]) {
    mb.col(o.leg, o.legMat !== undefined ? o.legMat : MAT.SKIN);
    limb(mb, r, s > 0 ? BONE.UARM_L : BONE.UARM_R, s > 0 ? BONE.LARM_L : BONE.LARM_R, r.w * s, r.shoulderY, r.kneeF, fz, o.thigh * 0.8, o.knee, o.foot, o.hoof, lod);
    mb.col(o.leg, o.legMat !== undefined ? o.legMat : MAT.SKIN);
    limb(mb, r, s > 0 ? BONE.ULEG_L : BONE.ULEG_R, s > 0 ? BONE.LLEG_L : BONE.LLEG_R, r.w * s, r.hipY, r.hockY, hz - 0.03, o.thigh, o.knee, o.foot, o.hoof, lod);
  }
}

/** Barrel body in two halves (hindquarters on PELVIS, forequarters on SPINE). */
function body(mb, r, color, mat, opts = {}) {
  const lod = mb.lod;
  const rr = r.bodyR, len = r.len;
  mb.col(color, mat);
  if (opts.jitter && !lod) mb.jitter(opts.jitter, 6, opts.seed || 3);
  mb.bone(BONE.PELVIS).push(0, r.backY - rr * 0.05, -len * 0.22).sphere(rr * (opts.hipW || 1), rr * 0.95, len * 0.34, lod ? 8 : 13, lod ? 6 : 9).pop();
  mb.bone(BONE.SPINE).push(0, r.backY, len * 0.14).sphere(rr * (opts.chestW || 1.02), rr * (opts.chestH || 1.0), len * 0.36, lod ? 8 : 13, lod ? 6 : 9).pop();
  mb.noJitter();
}

function tail(mb, r, color, mat, len, thick, curl = 0) {
  mb.bone(BONE.WEAPON).col(color, mat);
  const x0 = 0, y0 = r.tailY, z0 = -r.len * 0.5;
  mb.tube([[x0, y0, z0 + 0.03], [x0, y0 - len * 0.35 + curl, z0 - len * 0.25], [x0, y0 - len * 0.8 + curl * 1.5, z0 - len * 0.3]], [thick, thick * 0.8, thick * 0.4], mb.lod ? 4 : 6);
}

function eyes(mb, hx, hy, hz, spread) {
  if (mb.lod) return;
  mb.col([0.03, 0.025, 0.02], MAT.GLASS);
  for (const s of [1, -1]) mb.push(hx + spread * s, hy, hz).sphere(0.018, 0.018, 0.012, 5, 4).pop();
}

// ------------------------------------------------------------------ species

export function buildSheep(lod) {
  const r = makeQuadRig({ len: 1.0, w: 0.13, hipY: 0.6, backY: 0.66, shoulderY: 0.62, kneeF: 0.3, hockY: 0.32, neckY: 0.74, neckZ: 0.42, tailY: 0.66, bodyR: 0.28, headUp: 0.12, headFwd: 0.2 });
  const mb = new MeshBuilder({ lod, seed: 701 });
  const wool = [0.55, 0.52, 0.44];
  legs4(mb, r, { leg: [0.2, 0.18, 0.16], thigh: 0.06, knee: 0.035, foot: 0.028, hoof: [0.1, 0.09, 0.08] }, lod);
  body(mb, r, wool, MAT.CLOTH, { jitter: 0.035, seed: 5, hipW: 1.05, chestW: 1.05 });
  mb.bone(BONE.HEAD).col([0.2, 0.18, 0.16], MAT.SKIN);
  mb.cylBetween([0, r.neckY - 0.04, r.neckZ - 0.08], [0, r.neckY + 0.1, r.neckZ + 0.08], 0.08, 0.07, lod ? 6 : 8);
  mb.push(0, r.neckY + 0.1, r.neckZ + 0.18, 0.5, 0, 0).sphere(0.075, 0.085, 0.14, lod ? 7 : 10, lod ? 5 : 7).pop();
  mb.col(wool, MAT.CLOTH).push(0, r.neckY + 0.16, r.neckZ + 0.1).sphere(0.08, 0.06, 0.08, 7, 5).pop();
  eyes(mb, 0, r.neckY + 0.15, r.neckZ + 0.24, 0.055);
  mb.bone(BONE.TOOL).col([0.2, 0.18, 0.16], MAT.SKIN);
  for (const s of [1, -1]) mb.push(0.08 * s, r.neckY + 0.14, r.neckZ + 0.12, 0, 0, -1.3 * s).box(0.04, 0.1, 0.02).pop();
  tail(mb, r, wool, MAT.CLOTH, 0.18, 0.04);
  return { mesh: mb.finish(), rig: r, quad: true, stride: 0.75 };
}

export function buildGoat(lod) {
  const r = makeQuadRig({ len: 0.95, w: 0.12, hipY: 0.62, backY: 0.68, shoulderY: 0.66, kneeF: 0.32, hockY: 0.34, neckY: 0.82, neckZ: 0.4, tailY: 0.74, bodyR: 0.22, headUp: 0.14, headFwd: 0.2 });
  const mb = new MeshBuilder({ lod, seed: 711 });
  const coat = [0.36, 0.3, 0.24];
  legs4(mb, r, { leg: coat, legMat: MAT.CLOTH, thigh: 0.055, knee: 0.03, foot: 0.024, hoof: [0.08, 0.07, 0.06] }, lod);
  body(mb, r, coat, MAT.CLOTH, { jitter: 0.012, seed: 7 });
  mb.bone(BONE.HEAD).col(coat, MAT.CLOTH);
  mb.cylBetween([0, r.neckY - 0.1, r.neckZ - 0.1], [0, r.neckY + 0.08, r.neckZ + 0.06], 0.07, 0.06, lod ? 6 : 8);
  mb.push(0, r.neckY + 0.08, r.neckZ + 0.16, 0.6, 0, 0).sphere(0.06, 0.07, 0.15, lod ? 7 : 10, lod ? 5 : 7).pop();
  eyes(mb, 0, r.neckY + 0.13, r.neckZ + 0.2, 0.05);
  if (!lod) mb.col(scale(coat, 0.6), MAT.CLOTH).push(0, r.neckY - 0.06, r.neckZ + 0.22).box(0.03, 0.09, 0.03, { taper: [0.3, 0.5] }).pop(); // beard
  mb.bone(BONE.TOOL).col(C.boneDark, MAT.BONE);
  for (const s of [1, -1]) mb.tube([[0.03 * s, r.neckY + 0.16, r.neckZ + 0.12], [0.05 * s, r.neckY + 0.27, r.neckZ + 0.06], [0.06 * s, r.neckY + 0.3, r.neckZ - 0.05]], [0.02, 0.015, 0.005], 4);
  tail(mb, r, coat, MAT.CLOTH, 0.1, 0.025, 0.08);
  return { mesh: mb.finish(), rig: r, quad: true, stride: 0.7 };
}

export function buildPig(lod) {
  const r = makeQuadRig({ len: 1.15, w: 0.14, hipY: 0.46, backY: 0.56, shoulderY: 0.48, kneeF: 0.22, hockY: 0.24, neckY: 0.55, neckZ: 0.5, tailY: 0.6, bodyR: 0.3, headUp: 0.1, headFwd: 0.22 });
  const mb = new MeshBuilder({ lod, seed: 721 });
  const skin = [0.55, 0.42, 0.38];
  legs4(mb, r, { leg: skin, thigh: 0.07, knee: 0.04, foot: 0.032, hoof: [0.12, 0.1, 0.09] }, lod);
  body(mb, r, mix(skin, C.soil, 0.25), MAT.SKIN, { hipW: 1.08, chestW: 1.05, chestH: 0.98 });
  mb.bone(BONE.HEAD).col(skin, MAT.SKIN);
  mb.push(0, r.neckY, r.neckZ + 0.1).sphere(0.17, 0.16, 0.19, lod ? 7 : 11, lod ? 5 : 8).pop();
  mb.push(0, r.neckY - 0.03, r.neckZ + 0.3, Math.PI / 2, 0, 0).cyl(0.07, 0.065, 0.12, lod ? 7 : 10).pop();
  if (!lod) mb.col(scale(skin, 0.6), MAT.SKIN).push(0, r.neckY - 0.03, r.neckZ + 0.365, Math.PI / 2, 0, 0).cyl(0.06, 0.06, 0.01, 8).pop();
  eyes(mb, 0, r.neckY + 0.06, r.neckZ + 0.22, 0.07);
  mb.bone(BONE.TOOL).col(skin, MAT.SKIN);
  for (const s of [1, -1]) mb.push(0.09 * s, r.neckY + 0.12, r.neckZ + 0.12, 0.7, 0, -0.4 * s).box(0.07, 0.09, 0.015).pop();
  tail(mb, r, skin, MAT.SKIN, 0.1, 0.018, 0.1);
  return { mesh: mb.finish(), rig: r, quad: true, stride: 0.55 };
}

export function buildCattle(lod) {
  const r = makeQuadRig({ len: 1.9, w: 0.22, hipY: 1.02, backY: 1.12, shoulderY: 1.06, kneeF: 0.5, hockY: 0.54, neckY: 1.12, neckZ: 0.86, tailY: 1.15, bodyR: 0.45, headUp: 0.16, headFwd: 0.34 });
  const mb = new MeshBuilder({ lod, seed: 731 });
  const hide = [0.34, 0.24, 0.17];
  legs4(mb, r, { leg: hide, legMat: MAT.LEATHER, thigh: 0.11, knee: 0.06, foot: 0.05, hoof: [0.08, 0.07, 0.06] }, lod);
  body(mb, r, hide, MAT.LEATHER, { hipW: 1.0, chestW: 1.05, chestH: 1.05 });
  if (!lod) {
    // pale patches
    mb.bone(BONE.SPINE).col([0.55, 0.5, 0.43], MAT.LEATHER).push(0.2, r.backY + 0.1, 0.25).sphere(0.28, 0.3, 0.32, 8, 6).pop();
    mb.bone(BONE.PELVIS).push(-0.22, r.backY - 0.05, -0.45).sphere(0.26, 0.28, 0.3, 8, 6).pop();
    // udder / dewlap
    mb.bone(BONE.SPINE).col(hide, MAT.LEATHER).push(0, r.backY - 0.4, r.len * 0.36).box(0.12, 0.3, 0.2, { taper: [0.6, 0.6] }).pop();
  }
  mb.bone(BONE.HEAD).col(hide, MAT.LEATHER);
  mb.cylBetween([0, r.neckY - 0.1, r.neckZ - 0.25], [0, r.neckY + 0.05, r.neckZ + 0.05], 0.2, 0.16, lod ? 7 : 10);
  mb.push(0, r.neckY + 0.02, r.neckZ + 0.22, 0.7, 0, 0).box(0.26, 0.24, 0.42, { bevel: 0.07, taper: [0.75, 0.8] }).pop();
  mb.col([0.2, 0.15, 0.12], MAT.SKIN).push(0, r.neckY - 0.13, r.neckZ + 0.38).box(0.2, 0.1, 0.1, { bevel: 0.04 }).pop();
  eyes(mb, 0, r.neckY + 0.1, r.neckZ + 0.3, 0.12);
  mb.bone(BONE.TOOL).col(C.bone, MAT.BONE);
  for (const s of [1, -1]) mb.tube([[0.1 * s, r.neckY + 0.15, r.neckZ + 0.12], [0.22 * s, r.neckY + 0.2, r.neckZ + 0.14], [0.27 * s, r.neckY + 0.3, r.neckZ + 0.2]], [0.035, 0.025, 0.008], lod ? 4 : 6);
  mb.col(hide, MAT.LEATHER);
  for (const s of [1, -1]) mb.push(0.17 * s, r.neckY + 0.08, r.neckZ + 0.08, 0, 0, -1.2 * s).box(0.06, 0.14, 0.03).pop();
  tail(mb, r, hide, MAT.LEATHER, 0.75, 0.03);
  return { mesh: mb.finish(), rig: r, quad: true, stride: 1.2 };
}

export function buildMule(lod) {
  const r = makeQuadRig({ len: 1.7, w: 0.19, hipY: 1.08, backY: 1.18, shoulderY: 1.14, kneeF: 0.56, hockY: 0.6, neckY: 1.4, neckZ: 0.78, tailY: 1.2, bodyR: 0.36, headUp: 0.2, headFwd: 0.38 });
  const mb = new MeshBuilder({ lod, seed: 741 });
  const coat = [0.3, 0.24, 0.19];
  legs4(mb, r, { leg: coat, legMat: MAT.LEATHER, thigh: 0.1, knee: 0.05, foot: 0.045, hoof: [0.07, 0.06, 0.05] }, lod);
  body(mb, r, coat, MAT.LEATHER, { chestH: 1.05 });
  mb.bone(BONE.HEAD).col(coat, MAT.LEATHER);
  mb.cylBetween([0, r.neckY - 0.35, r.neckZ - 0.22], [0, r.neckY + 0.02, r.neckZ + 0.02], 0.15, 0.11, lod ? 7 : 10);
  mb.push(0, r.neckY + 0.02, r.neckZ + 0.2, 1.0, 0, 0).box(0.17, 0.2, 0.5, { bevel: 0.05, taper: [0.7, 0.75] }).pop();
  eyes(mb, 0, r.neckY + 0.1, r.neckZ + 0.14, 0.085);
  if (!lod) mb.col(C.leatherDark, MAT.LEATHER).push(0, r.neckY - 0.05, r.neckZ + 0.2, 1.0, 0, 0).box(0.19, 0.04, 0.3).pop(); // bridle
  mb.col(scale(coat, 0.5), MAT.CLOTH).push(0, r.neckY - 0.1, r.neckZ - 0.14, -0.6, 0, 0).box(0.03, 0.4, 0.07).pop(); // mane
  mb.bone(BONE.TOOL).col(coat, MAT.LEATHER);
  for (const s of [1, -1]) mb.push(0.06 * s, r.neckY + 0.2, r.neckZ + 0.02, -0.2, 0, -0.25 * s).box(0.05, 0.26, 0.03, { taper: [0.4, 0.6] }).pop();
  // pack saddle / collar (harness for the cart)
  mb.bone(BONE.PACK).col(C.leatherDark, MAT.LEATHER);
  mb.push(0, r.backY + 0.3, r.len * 0.22).lathe([[0.3, -0.1], [0.28, 0.1]], lod ? 8 : 12, { sz: 0.7 }).pop();
  mb.col(C.canvasDark, MAT.CLOTH).push(0, r.backY + 0.3, -0.05).box(0.5, 0.1, 0.6, { bevel: 0.03 }).pop();
  tail(mb, r, scale(coat, 0.6), MAT.CLOTH, 0.7, 0.05);
  return { mesh: mb.finish(), rig: r, quad: true, stride: 1.15 };
}

export function buildDog(lod) {
  const r = makeQuadRig({ len: 0.85, w: 0.1, hipY: 0.46, backY: 0.5, shoulderY: 0.5, kneeF: 0.24, hockY: 0.25, neckY: 0.6, neckZ: 0.36, tailY: 0.52, bodyR: 0.16, headUp: 0.1, headFwd: 0.18 });
  const mb = new MeshBuilder({ lod, seed: 751 });
  const fur = [0.3, 0.26, 0.2];
  legs4(mb, r, { leg: fur, legMat: MAT.CLOTH, thigh: 0.045, knee: 0.025, foot: 0.022, hoof: scale(fur, 0.6) }, lod);
  body(mb, r, fur, MAT.CLOTH, { hipW: 0.9, chestH: 1.1, jitter: 0.01, seed: 11 });
  mb.bone(BONE.HEAD).col(fur, MAT.CLOTH);
  mb.cylBetween([0, r.neckY - 0.1, r.neckZ - 0.12], [0, r.neckY + 0.04, r.neckZ + 0.02], 0.07, 0.06, lod ? 6 : 8);
  mb.push(0, r.neckY + 0.05, r.neckZ + 0.1).sphere(0.08, 0.08, 0.09, lod ? 7 : 10, lod ? 5 : 7).pop();
  mb.push(0, r.neckY + 0.02, r.neckZ + 0.2, 0.15, 0, 0).box(0.07, 0.07, 0.14, { bevel: 0.02, taper: [0.8, 0.8] }).pop();
  eyes(mb, 0, r.neckY + 0.08, r.neckZ + 0.16, 0.04);
  mb.bone(BONE.TOOL).col(scale(fur, 0.7), MAT.CLOTH);
  for (const s of [1, -1]) mb.push(0.05 * s, r.neckY + 0.14, r.neckZ + 0.06, -0.2, 0, -0.3 * s).box(0.035, 0.09, 0.02, { taper: [0.4, 0.6] }).pop();
  tail(mb, r, fur, MAT.CLOTH, 0.32, 0.025, 0.25);
  return { mesh: mb.finish(), rig: r, quad: true, stride: 0.7 };
}

// ------------------------------------------------------------------ supply cart (rigid)

function makeRigidRig(wheelY, wheelX, wheelZ) {
  const r = { rigid: true, pivots: new Float32Array(BONE_COUNT * 3), parents: new Array(BONE_COUNT).fill(0) };
  r.parents[0] = -1;
  const set = (b, x, y, z) => { r.pivots[b * 3] = x; r.pivots[b * 3 + 1] = y; r.pivots[b * 3 + 2] = z; };
  set(BONE.WEAPON, wheelX, wheelY, wheelZ);
  set(BONE.TOOL, -wheelX, wheelY, wheelZ);
  return r;
}

/** Two-wheeled supply cart: plank bed, sacks and crates under canvas, shafts for the mule. */
export function buildCart(lod) {
  const R = 0.62;
  const r = makeRigidRig(R, 0.78, -0.2);
  const mb = new MeshBuilder({ lod, seed: 761 });
  mb.bone(BONE.PELVIS).col(C.plank, MAT.WOOD).vary(0.1);
  mb.push(0, 0.95, -0.2).box(1.3, 0.1, 2.0, { bevel: 0.02 }).pop();
  for (const s of [1, -1]) mb.push(0.62 * s, 1.18, -0.2).box(0.06, 0.4, 2.0).pop();
  mb.push(0, 1.18, -1.18).box(1.3, 0.4, 0.06).pop();
  mb.vary(0);
  // shafts toward the draught animal
  mb.col(C.woodDark, MAT.WOOD);
  for (const s of [1, -1]) mb.cylBetween([0.42 * s, 0.9, 0.7], [0.3 * s, 0.95, 2.4], 0.04, 0.035, lod ? 5 : 7);
  // cargo: sacks + a crate under a canvas
  mb.col(C.sandbag, MAT.CLOTH).jitter(lod ? 0 : 0.01, 8, 5);
  for (let k = 0; k < (lod ? 2 : 4); k++) mb.push(-0.3 + (k % 2) * 0.6, 1.2, -0.05 + Math.floor(k / 2) * 0.42).sphere(0.28, 0.2, 0.22, 8, 6).pop();
  mb.noJitter();
  mb.col(C.wood, MAT.WOOD).push(0.1, 1.2, -0.72).box(0.55, 0.4, 0.5, { bevel: 0.02 }).pop();
  // canvas arched over the rear half of the bed (lathe axis turned along the bed: the +z half -> up)
  mb.col(C.canvas, MAT.CLOTH).push(0, 1.0, -0.72, -Math.PI / 2, 0, 0).lathe([[0.63, -0.46], [0.63, 0.46]], lod ? 6 : 10, { a0: -Math.PI / 2, a1: Math.PI / 2, sx: 1, sz: 0.85 }).pop();
  // axle + wheels (turn on their bones)
  mb.col(C.steelDark, MAT.METAL).cylBetween([-0.8, R, -0.2], [0.8, R, -0.2], 0.035, 0.035, 6);
  for (const [bone, x] of [[BONE.WEAPON, 0.78], [BONE.TOOL, -0.78]]) {
    mb.bone(bone).col(C.woodDark, MAT.WOOD);
    mb.push(x, R, -0.2, 0, 0, Math.PI / 2).lathe([[R, -0.04], [R, 0.04], [R - 0.07, 0.04], [R - 0.07, -0.04]], lod ? 10 : 18).pop();
    const spokes = lod ? 4 : 8;
    for (let k = 0; k < spokes; k++) {
      const a = (k / spokes) * Math.PI * 2;
      mb.cylBetween([x, R, -0.2], [x, R + Math.sin(a) * (R - 0.05), -0.2 + Math.cos(a) * (R - 0.05)], 0.018, 0.015, 4);
    }
    mb.col(C.steelDark, MAT.METAL).push(x, R, -0.2, 0, 0, Math.PI / 2).cyl(0.08, 0.08, 0.1, 8).pop();
  }
  return { mesh: mb.finish(), rig: r, rigid: true, wheelR: R };
}

export const ANIMAL_MODELS = {
  an_sheep: (lod) => buildSheep(lod),
  an_goat: (lod) => buildGoat(lod),
  an_pig: (lod) => buildPig(lod),
  an_cattle: (lod) => buildCattle(lod),
  an_mule: (lod) => buildMule(lod),
  an_dog: (lod) => buildDog(lod),
  cart: (lod) => buildCart(lod),
};
