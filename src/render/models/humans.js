// Procedural humanoid models on a shared 14-bone rig. Silhouette, proportion and equipment
// define identity (not team colour). LOD1 drops small details but keeps the silhouette.
import { MeshBuilder, MAT } from './meshbuilder.js';
import { C, mix, scale } from './palette.js';

export const BONE = Object.freeze({
  PELVIS: 0, SPINE: 1, HEAD: 2, UARM_L: 3, LARM_L: 4, UARM_R: 5, LARM_R: 6,
  ULEG_L: 7, LLEG_L: 8, ULEG_R: 9, LLEG_R: 10, WEAPON: 11, TOOL: 12, PACK: 13,
});
export const BONE_COUNT = 14;
export const PARENTS = [-1, 0, 1, 1, 3, 1, 5, 0, 7, 0, 9, 1, 1, 1];

/** Rig from body proportions (meters). Left side = +x (model faces +z). */
function makeRig(p) {
  const r = {
    ...p,
    upperArm: p.shoulderY - p.elbowY,
    foreArm: p.elbowY - p.wristY,
    upperLeg: p.hipJ - p.knee,
    lowerLeg: p.knee - p.ankle,
    pivots: new Float32Array(BONE_COUNT * 3),
    parents: PARENTS.slice(),
  };
  const set = (b, x, y, z) => { r.pivots[b * 3] = x; r.pivots[b * 3 + 1] = y; r.pivots[b * 3 + 2] = z; };
  set(BONE.PELVIS, 0, p.hip, 0);
  set(BONE.SPINE, 0, p.waist, 0);
  set(BONE.HEAD, 0, p.neck, 0.01);
  set(BONE.UARM_L, p.shoulderW, p.shoulderY, 0);
  set(BONE.LARM_L, p.shoulderW + 0.005, p.elbowY, 0);
  set(BONE.UARM_R, -p.shoulderW, p.shoulderY, 0);
  set(BONE.LARM_R, -p.shoulderW - 0.005, p.elbowY, 0);
  set(BONE.ULEG_L, p.hipW, p.hipJ, 0);
  set(BONE.LLEG_L, p.hipW, p.knee, 0.01);
  set(BONE.ULEG_R, -p.hipW, p.hipJ, 0);
  set(BONE.LLEG_R, -p.hipW, p.knee, 0.01);
  set(BONE.WEAPON, p.weaponPivot[0], p.weaponPivot[1], p.weaponPivot[2]);
  set(BONE.TOOL, p.toolPivot[0], p.toolPivot[1], p.toolPivot[2]);
  set(BONE.PACK, 0, p.packY, -p.packZ);
  if (p.weaponParent === 'hand') r.parents[BONE.WEAPON] = BONE.LARM_R;
  return r;
}

const HUMAN = {
  hip: 0.95, hipJ: 0.93, waist: 1.06, shoulderY: 1.43, shoulderW: 0.2, hipW: 0.095, neck: 1.5,
  headY: 1.625, elbowY: 1.14, wristY: 0.885, knee: 0.5, ankle: 0.09, packY: 1.28, packZ: 0.14,
  weaponPivot: [-0.11, 1.37, 0.1], toolPivot: [0.05, 1.3, -0.2], weaponParent: 'spine',
};

// Weapon definitions in weapon-local space (origin at butt/pommel, +z along barrel/blade).
// grips are WRIST targets for the IK arms; muzzle for VFX.
export const WEAPON_GEOM = {
  rifle: { rightGrip: [0, -0.06, 0.26], leftGrip: [0.0, -0.07, 0.52], muzzle: [0, 0.02, 1.16], hip: false },
  shotgun: { rightGrip: [0, -0.06, 0.22], leftGrip: [0, -0.08, 0.47], muzzle: [0, 0.02, 0.86], hip: false },
  mg: { rightGrip: [0, -0.1, 0.34], leftGrip: [0.02, 0.07, 0.62], muzzle: [0, 0.0, 1.3], hip: true },
  infested: { rightGrip: [0, -0.06, 0.26], leftGrip: [0.0, -0.07, 0.52], muzzle: [0, 0.03, 1.14], hip: false },
  greatblade: { rightGrip: [0, 0, 0], leftGrip: [0, 0, 0.17], muzzle: [0, 0, 1.3], twoHanded: true },
  claws: { none: true },
};

// ------------------------------------------------------------------------------ body parts

function legs(mb, r, o) {
  const seg = mb.lod ? 5 : 8;
  for (const side of [1, -1]) {
    const ul = side > 0 ? BONE.ULEG_L : BONE.ULEG_R, ll = side > 0 ? BONE.LLEG_L : BONE.LLEG_R;
    const hx = r.hipW * side;
    mb.bone(ul).col(o.trouser, o.trouserMat !== undefined ? o.trouserMat : MAT.CLOTH);
    mb.cylBetween([hx, r.knee - 0.02, 0.012], [hx * 1.05, r.hipJ + 0.04, 0], o.thighR * 0.78, o.thighR, seg, { caps: false });
    if (!mb.lod && o.kneePad) {
      mb.col(o.kneePad, MAT.METAL).push(hx, r.knee, 0.05).sphere(o.thighR * 0.85, o.thighR * 0.9, o.thighR * 0.7, 8, 6).pop();
    }
    mb.bone(ll).col(o.puttee, o.putteeMat !== undefined ? o.putteeMat : MAT.CLOTH);
    mb.cylBetween([hx, r.ankle, 0.0], [hx, r.knee + 0.02, 0.012], o.calfR * 0.7, o.calfR, seg, { caps: false });
    if (o.bareFoot && side > 0) {
      mb.col(C.skinDead, MAT.SKIN).push(hx, 0.045, 0.04).box(0.09, 0.08, 0.22, { bevel: 0.02, taper: [0.8, 0.7] }).pop();
    } else {
      mb.col(o.boot, MAT.LEATHER).push(hx, 0.055, 0.035).box(0.11 * o.bootW, 0.11, 0.27 * o.bootL, { bevel: 0.022, taper: [0.92, 0.82] }).pop();
      if (!mb.lod) mb.col(scale(o.boot, 0.6), MAT.LEATHER).push(hx, 0.012, 0.035).box(0.115 * o.bootW, 0.024, 0.28 * o.bootL).pop();
    }
  }
}

function hand(mb, bone, x, y, color) {
  mb.bone(bone).col(color, color === C.skinPale || color === C.skinDead ? MAT.SKIN : MAT.LEATHER);
  mb.push(x, y - 0.045, 0.01).box(0.07, 0.1, 0.085, { bevel: 0.015, taper: [0.8, 0.9] }).pop();
}

function arms(mb, r, o) {
  const seg = mb.lod ? 5 : 8;
  for (const side of [1, -1]) {
    const ua = side > 0 ? BONE.UARM_L : BONE.UARM_R, la = side > 0 ? BONE.LARM_L : BONE.LARM_R;
    const sx = r.shoulderW * side;
    const big = o.swollen && side < 0 ? o.swollen : 1;
    mb.bone(ua, BONE.SPINE, 0.25).col(o.sleeve, o.sleeveMat !== undefined ? o.sleeveMat : MAT.CLOTH);
    mb.push(sx, r.shoulderY - 0.01, 0).sphere(o.shoulderR * big, o.shoulderR * 0.9 * big, o.shoulderR * big, seg, 5).pop();
    mb.bone(ua);
    mb.cylBetween([sx, r.elbowY, 0], [sx, r.shoulderY, 0], o.upperArmR * 0.85 * big, o.upperArmR * big, seg, { caps: false });
    mb.bone(la).col(o.sleeve, o.sleeveMat !== undefined ? o.sleeveMat : MAT.CLOTH);
    mb.cylBetween([sx, r.wristY + 0.02, 0.005], [sx, r.elbowY + 0.02, 0], o.foreArmR * 0.78 * big, o.foreArmR * big, seg);
    if (!mb.lod && o.cuff) mb.col(o.cuff, MAT.CLOTH).cylBetween([sx, r.wristY + 0.03, 0.005], [sx, r.wristY + 0.08, 0.004], o.foreArmR * 0.95, o.foreArmR * 0.98, seg);
    if (o.claws) {
      mb.col(C.skinDead, MAT.SKIN).push(sx, r.wristY - 0.04, 0.01).box(0.06 * big, 0.08, 0.07, { bevel: 0.01 }).pop();
      if (!mb.lod) {
        mb.col(C.boneDark, MAT.BONE);
        for (let k = -1; k <= 1; k++) mb.tube([[sx + k * 0.018, r.wristY - 0.07, 0.02], [sx + k * 0.02, r.wristY - 0.15, 0.05], [sx + k * 0.022, r.wristY - 0.2, 0.1]], [0.008, 0.006, 0.002], 4);
      }
    } else hand(mb, la, sx, r.wristY, o.hand);
  }
}

/** Long coat skirt skinned between pelvis and thighs (cloth-like swing). */
function coatSkirt(mb, r, color, topY, botY, rTop, rBot, opts = {}) {
  const hipJ = r.hipJ;
  mb.skinWith((x, y) => {
    if (y > hipJ + 0.03) return [BONE.PELVIS, BONE.PELVIS, 0];
    const t = Math.min(1, (hipJ + 0.03 - y) / (hipJ - botY + 0.03));
    const w = t * 0.62 * Math.min(1, Math.abs(x) / 0.1);
    return [BONE.PELVIS, x > 0 ? BONE.ULEG_L : BONE.ULEG_R, w];
  });
  mb.col(color, opts.mat !== undefined ? opts.mat : MAT.CLOTH);
  const seg = mb.lod ? 8 : 14;
  const gap = opts.gap !== undefined ? opts.gap : 0.22;
  const prof = [];
  const rings = mb.lod ? 3 : 5;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    prof.push([rBot + (rTop - rBot) * Math.pow(t, 0.8), botY + (topY - botY) * t]);
  }
  if (opts.ragged && !mb.lod) mb.jitter(0.025, 9, 7);
  mb.lathe(prof, seg, { a0: gap, a1: Math.PI * 2 - gap, sx: 1.0, sz: opts.sz || 0.82 });
  mb.noJitter();
  mb.bone(BONE.PELVIS);
}

function torso(mb, r, o) {
  const midY = (r.waist + r.shoulderY) / 2 - 0.01;
  const h = r.shoulderY - r.waist + 0.08;
  mb.bone(BONE.SPINE).col(o.coat, o.coatMat !== undefined ? o.coatMat : MAT.CLOTH);
  mb.push(0, midY, 0.005).box(o.waistW, h, o.depth, { bevel: 0.04, taper: [o.chestW / o.waistW, o.chestDepth / o.depth], shift: [0, 0.015] }).pop();
  // pelvis block
  mb.bone(BONE.PELVIS).col(o.hips || o.coat, MAT.CLOTH);
  mb.push(0, r.hip + 0.02, 0).box(o.waistW * 0.95, 0.2, o.depth * 0.9, { bevel: 0.035 }).pop();
}

function neckAndHead(mb, r, o) {
  mb.bone(BONE.HEAD).col(o.neck || C.skin, MAT.SKIN);
  mb.cylBetween([0, r.neck - 0.03, 0.0], [0, r.neck + 0.07, 0.015], 0.052, 0.047, mb.lod ? 5 : 7);
  mb.col(o.skin || C.skin, MAT.SKIN).push(0, r.headY, 0.012).sphere(0.083, 0.106, 0.098, mb.lod ? 7 : 11, mb.lod ? 5 : 8).pop();
}

// ------------------------------------------------------------------------------ equipment

function gasMask(mb, r) {
  const hy = r.headY;
  mb.bone(BONE.HEAD).col(C.rubber, MAT.LEATHER);
  mb.push(0, hy - 0.012, 0.03).sphere(0.086, 0.098, 0.09, mb.lod ? 7 : 11, mb.lod ? 5 : 8).pop();
  const seg = mb.lod ? 6 : 10;
  for (const s of [1, -1]) {
    mb.col(C.brass, MAT.METAL).push(0.036 * s, hy + 0.012, 0.098, Math.PI / 2, 0, 0).cyl(0.03, 0.03, 0.022, seg).pop();
    mb.col(C.lens, MAT.GLASS).push(0.036 * s, hy + 0.012, 0.121, Math.PI / 2, 0, 0).sphere(0.024, 0.006, 0.024, seg, 3, { hemi: 1 }).pop();
  }
  mb.col(C.rubber, MAT.LEATHER);
  mb.cylBetween([0, hy - 0.04, 0.1], [0, hy - 0.08, 0.15], 0.028, 0.024, seg);
  mb.col(C.steelDark, MAT.METAL);
  mb.cylBetween([0, hy - 0.075, 0.15], [0, hy - 0.16, 0.17], 0.034, 0.034, seg);
  if (!mb.lod) mb.col(C.steel, MAT.METAL).cylBetween([0, hy - 0.16, 0.17], [0, hy - 0.175, 0.172], 0.03, 0.02, seg);
}

function gothicHelmet(mb, r) {
  const hy = r.headY;
  mb.bone(BONE.HEAD).col(C.steelDark, MAT.METAL);
  const seg = mb.lod ? 9 : 16;
  const prof = [[0.142, -0.03], [0.146, -0.012], [0.124, 0.02], [0.114, 0.07], [0.096, 0.12], [0.06, 0.155], [0.02, 0.168], [0.0, 0.169]];
  mb.push(0, hy + 0.035, -0.008).lathe(prof, seg, { sx: 1.0, sz: 1.12 });
  // lowered neck guard (sallet tail)
  const tail = [[0.155, -0.075], [0.15, -0.03], [0.128, 0.02]];
  mb.lathe(tail, mb.lod ? 5 : 8, { a0: Math.PI * 0.62, a1: Math.PI * 1.38, sx: 1.0, sz: 1.12 });
  mb.col(C.steel, MAT.METAL).push(0, 0.15, -0.01).box(0.014, 0.05, 0.25, { bevel: 0.004 }).pop();
  mb.pop();
}

function sapperHelmet(mb, r) {
  const hy = r.headY;
  mb.bone(BONE.HEAD).col(scale(C.steelDark, 1.15), MAT.METAL);
  const seg = mb.lod ? 9 : 16;
  mb.push(0, hy + 0.04, 0.0);
  mb.lathe([[0.19, -0.02], [0.185, -0.008], [0.12, 0.0], [0.115, 0.05], [0.095, 0.1], [0.05, 0.13], [0.0, 0.135]], seg, { sx: 1.0, sz: 1.08 });
  if (!mb.lod) {
    // goggles strapped on the brow
    mb.col(C.leatherDark, MAT.LEATHER).push(0, 0.02, 0).lathe([[0.121, 0], [0.121, 0.03]], seg).pop();
    for (const s of [1, -1]) {
      mb.col(C.brass, MAT.METAL).push(0.04 * s, 0.035, 0.105, Math.PI / 2 - 0.4, 0, 0).cyl(0.026, 0.026, 0.03, 8).pop();
      mb.col(C.lens, MAT.GLASS).push(0.04 * s, 0.047, 0.13, Math.PI / 2 - 0.4, 0, 0).sphere(0.021, 0.005, 0.021, 8, 3, { hemi: 1 }).pop();
    }
  }
  mb.pop();
  // scarf over the lower face
  mb.col(C.canvasDark, MAT.CLOTH).push(0, hy - 0.045, 0.035).sphere(0.089, 0.06, 0.085, mb.lod ? 7 : 10, 5).pop();
}

function backpack(mb, r, o = {}) {
  mb.bone(BONE.PACK).col(o.color || C.canvas, MAT.CLOTH).vary(0.06);
  const z = -r.packZ - 0.06;
  mb.push(0, r.packY, z).box(0.3, 0.32, 0.13, { bevel: 0.03 }).pop();
  mb.vary(0);
  mb.col(C.blanket, MAT.CLOTH).push(0, r.packY + 0.2, z + 0.01, 0, 0, Math.PI / 2).cyl(0.052, 0.052, 0.36, mb.lod ? 6 : 10).pop();
  if (!mb.lod) {
    mb.col(C.steelDark, MAT.METAL).push(0, r.packY - 0.02, z - 0.07).box(0.14, 0.1, 0.03, { bevel: 0.008 }).pop();
    mb.col(C.leatherDark, MAT.LEATHER).push(0.1, r.packY + 0.05, z - 0.066).box(0.03, 0.26, 0.012).pop();
    mb.push(-0.1, r.packY + 0.05, z - 0.066).box(0.03, 0.26, 0.012).pop();
    // entrenching tool
    mb.col(C.wood, MAT.WOOD).cylBetween([0.17, r.packY - 0.15, z], [0.17, r.packY + 0.2, z], 0.014, 0.014, 5);
    mb.col(C.steelDark, MAT.METAL).push(0.17, r.packY - 0.2, z).box(0.02, 0.13, 0.11, { bevel: 0.005 }).pop();
  }
}

function webbing(mb, r, color) {
  if (mb.lod) return;
  mb.bone(BONE.SPINE).col(color, MAT.LEATHER);
  for (const s of [1, -1]) {
    mb.push(0.1 * s, r.shoulderY - 0.1, 0.118, 0.12, 0, -0.18 * s).box(0.035, 0.32, 0.012).pop();
    mb.push(0.1 * s, r.shoulderY - 0.1, -0.118, -0.12, 0, -0.18 * s).box(0.035, 0.32, 0.012).pop();
    mb.push(0.12 * s, r.shoulderY + 0.005, 0, 0, 0, 0).box(0.04, 0.012, 0.25).pop();
  }
}

function beltAndPouches(mb, r, o = {}) {
  mb.bone(BONE.PELVIS).col(o.belt || C.leather, MAT.LEATHER);
  mb.push(0, r.waist - 0.01, 0).lathe([[0.175, -0.03], [0.178, 0.03]], mb.lod ? 8 : 14, { sx: 1.0, sz: 0.72 }).pop();
  if (mb.lod) return;
  mb.col(C.leatherDark, MAT.LEATHER).vary(0.08);
  for (const x of [-0.11, -0.04, 0.04, 0.11]) mb.push(x, r.waist - 0.04, 0.12).box(0.055, 0.07, 0.035, { bevel: 0.008 }).pop();
  mb.vary(0);
  if (o.bayonet) {
    mb.col(C.steelDark, MAT.METAL).push(0.16, r.waist - 0.2, -0.04, 0.25, 0, 0.1).box(0.025, 0.36, 0.02).pop();
  }
}

function tabardCross(mb, r, o) {
  // short crusader tabard over the coat: identity accent, not team paint
  mb.skinWith((x, y) => (y > r.waist ? [BONE.SPINE, BONE.SPINE, 0] : [BONE.PELVIS, BONE.PELVIS, 0]));
  mb.col(o.cloth, MAT.CLOTH);
  const z = 0.13;
  const top = r.shoulderY - 0.07, bot = r.hipJ - 0.2;
  mb.sheet([-0.13, top, z], [0.13, top, z], [0.12, bot, z + 0.03], [-0.12, bot, z + 0.03]);
  mb.col(o.cross, MAT.ACCENT);
  const cz = z + 0.004;
  mb.sheet([-0.02, top - 0.03, cz], [0.02, top - 0.03, cz], [0.02, bot + 0.08, cz + 0.025], [-0.02, bot + 0.08, cz + 0.025]);
  const cy = top - 0.16;
  mb.sheet([-0.1, cy + 0.02, cz + 0.004], [0.1, cy + 0.02, cz + 0.004], [0.1, cy - 0.02, cz + 0.005], [-0.1, cy - 0.02, cz + 0.005]);
  mb.bone(BONE.SPINE);
}

function shoulderPatch(mb, r, color) {
  if (mb.lod) return;
  mb.bone(BONE.UARM_L).col(color, MAT.ACCENT).push(r.shoulderW + 0.058, r.shoulderY - 0.1, 0).box(0.012, 0.07, 0.07).pop();
}

// ------------------------------------------------------------------------------ weapons

function rifleGeometry(mb, kind) {
  const lod = mb.lod;
  // stock (extruded profile along z in side view: we build in YZ plane by rotating an XY extrusion)
  mb.col(kind === 'infested' ? C.boneDark : C.wood, kind === 'infested' ? MAT.BONE : MAT.WOOD);
  mb.push(0, 0, 0, 0, -Math.PI / 2, 0);
  const stock = [[0, -0.07], [0.05, -0.08], [0.26, -0.05], [0.3, -0.08], [0.34, -0.08], [0.36, -0.02], [0.72, -0.015], [0.74, 0.012], [0.3, 0.018], [0.02, 0.03], [0, 0.03]];
  mb.extrude(stock, 0.042);
  mb.pop();
  mb.col(C.steelDark, MAT.DARKMETAL);
  mb.push(0, 0.01, 0.42).box(0.034, 0.045, 0.2, { bevel: lod ? 0 : 0.006 }).pop();
  mb.cylBetween([0, 0.015, 0.52], [0, 0.015, 1.16], 0.011, 0.01, lod ? 5 : 7);
  if (!lod) {
    mb.col(C.steel, MAT.METAL).cylBetween([-0.02, 0.03, 0.4], [-0.06, 0.02, 0.38], 0.006, 0.006, 5);
    mb.push(0, 0.035, 1.12).box(0.005, 0.02, 0.01).pop();
    mb.col(C.leatherDark, MAT.LEATHER).push(0.024, -0.04, 0.5).box(0.004, 0.02, 0.62).pop();
  }
  if (kind === 'rifle') {
    mb.col(C.steel, MAT.METAL).push(0, -0.004, 1.34).box(0.006, 0.022, 0.4, { taper: [0.5, 0.3] }).pop();
  }
  if (kind === 'infested') {
    mb.col(C.flesh, MAT.FLESH).jitter(0.008, 30, 3);
    mb.push(0, 0.03, 0.8).sphere(0.03, 0.025, 0.07, 7, 5).pop();
    mb.push(0.01, 0.025, 0.95).sphere(0.022, 0.02, 0.05, 6, 4).pop();
    if (!lod) mb.col(C.pus, MAT.FLESH).push(-0.012, 0.045, 0.72).sphere(0.012, 0.012, 0.012, 6, 4).pop();
    mb.noJitter();
  }
}

function shotgunGeometry(mb) {
  const lod = mb.lod;
  mb.col(C.woodDark, MAT.WOOD).push(0, 0, 0, 0, -Math.PI / 2, 0);
  mb.extrude([[0, -0.06], [0.2, -0.04], [0.26, -0.07], [0.3, -0.06], [0.3, 0.025], [0, 0.03]], 0.045);
  mb.pop();
  mb.col(C.steelDark, MAT.DARKMETAL).push(0, 0.005, 0.38).box(0.045, 0.07, 0.18, { bevel: lod ? 0 : 0.008 }).pop();
  mb.cylBetween([0, 0.012, 0.46], [0, 0.012, 0.86], 0.017, 0.017, lod ? 5 : 8);
  mb.cylBetween([0, -0.018, 0.46], [0, -0.018, 0.78], 0.013, 0.013, lod ? 5 : 7);
  mb.col(C.steel, MAT.METAL).push(0, -0.09, 0.38, Math.PI / 2, 0, 0).cyl(0.06, 0.06, 0.05, lod ? 7 : 12).pop();
  mb.col(C.woodDark, MAT.WOOD).push(0, -0.02, 0.6).box(0.04, 0.035, 0.12, { bevel: 0.006 }).pop();
}

function mgGeometry(mb) {
  const lod = mb.lod;
  mb.col(C.woodDark, MAT.WOOD).push(0, 0, 0, 0, -Math.PI / 2, 0);
  mb.extrude([[0, -0.07], [0.22, -0.04], [0.3, -0.1], [0.36, -0.1], [0.36, 0.03], [0, 0.035]], 0.05);
  mb.pop();
  mb.col(C.steelDark, MAT.DARKMETAL).push(0, 0.005, 0.44).box(0.06, 0.08, 0.2, { bevel: lod ? 0 : 0.01 }).pop();
  mb.col(C.engine, MAT.DARKMETAL).cylBetween([0, 0.0, 0.52], [0, 0.0, 1.18], 0.045, 0.042, lod ? 7 : 12);
  mb.col(C.steel, MAT.METAL).cylBetween([0, 0.0, 1.18], [0, 0.0, 1.32], 0.016, 0.02, lod ? 5 : 7);
  mb.col(C.steelDark, MAT.METAL).push(0, 0.075, 0.44).cyl(0.11, 0.11, 0.035, lod ? 10 : 18).pop();
  if (!lod) {
    mb.col(C.steel, MAT.METAL).push(0, 0.114, 0.44).cyl(0.03, 0.03, 0.02, 8).pop();
    mb.col(C.leather, MAT.LEATHER).push(0.03, 0.07, 0.62).box(0.03, 0.09, 0.03).pop();
    for (const s of [1, -1]) mb.col(C.steelDark, MAT.METAL).cylBetween([0.02 * s, -0.03, 1.05], [0.05 * s, -0.12, 0.8], 0.007, 0.007, 4);
  }
}

function greatbladeGeometry(mb) {
  const lod = mb.lod;
  mb.col(C.leatherDark, MAT.LEATHER).cylBetween([0, 0, -0.08], [0, 0, 0.26], 0.022, 0.022, lod ? 5 : 7);
  mb.col(C.bronze, MAT.METAL).push(0, 0, 0.27).box(0.26, 0.05, 0.05, { bevel: lod ? 0 : 0.01 }).pop();
  mb.col(C.rust, MAT.METAL).push(0, 0, 0, 0, -Math.PI / 2, 0);
  // cleaver blade profile in (along, width)
  mb.extrude([[0.28, -0.05], [1.35, -0.07], [1.46, 0.03], [1.3, 0.13], [0.9, 0.11], [0.5, 0.07], [0.28, 0.05]], 0.03);
  mb.pop();
  if (!lod) {
    mb.col(C.ichor, MAT.FLESH).push(0.0, 0.07, 1.0).sphere(0.02, 0.05, 0.12, 6, 4).pop();
    mb.col(C.bone, MAT.BONE).push(0, 0, -0.1).sphere(0.035, 0.035, 0.035, 7, 5).pop();
  }
}

function weaponAtPivot(mb, r, kind) {
  mb.bone(BONE.WEAPON);
  mb.push(r.pivots[BONE.WEAPON * 3], r.pivots[BONE.WEAPON * 3 + 1], r.pivots[BONE.WEAPON * 3 + 2]);
  if (kind === 'rifle' || kind === 'infested') rifleGeometry(mb, kind);
  else if (kind === 'shotgun') shotgunGeometry(mb);
  else if (kind === 'mg') mgGeometry(mb);
  else if (kind === 'greatblade') greatbladeGeometry(mb);
  mb.pop();
}

function shovelAtPivot(mb, r) {
  mb.bone(BONE.TOOL);
  const p = [r.pivots[BONE.TOOL * 3], r.pivots[BONE.TOOL * 3 + 1], r.pivots[BONE.TOOL * 3 + 2]];
  // shovel local: +z along the handle from grip (0) to blade (1.0)
  mb.push(p[0], p[1], p[2]);
  mb.col(C.wood, MAT.WOOD).cylBetween([0, 0, 0], [0, 0, 0.82], 0.017, 0.019, mb.lod ? 5 : 7);
  if (!mb.lod) mb.col(C.woodDark, MAT.WOOD).push(0, 0, -0.04).box(0.1, 0.02, 0.03).pop();
  mb.col(C.steelDark, MAT.METAL).push(0, 0.0, 0.94).box(0.19, 0.012, 0.25, { taper: [0.8, 1] }).pop();
  mb.pop();
}

// ------------------------------------------------------------------------------ models

function naBody(mb, r, o) {
  legs(mb, r, { trouser: C.trousers, puttee: C.puttee, boot: C.boot, thighR: 0.085, calfR: 0.064, bootW: 1, bootL: 1 });
  torso(mb, r, { coat: o.coat, waistW: 0.32, chestW: 0.41, depth: 0.22, chestDepth: 0.24 });
  if (o.skirt) coatSkirt(mb, r, o.coat, r.waist + 0.02, 0.5, 0.185, 0.245);
  arms(mb, r, { sleeve: o.coat, cuff: C.coatDark, hand: C.glove, shoulderR: 0.072, upperArmR: 0.058, foreArmR: 0.05 });
  neckAndHead(mb, r, { neck: C.rubber });
}

export function buildYeoman(lod) {
  const r = makeRig(HUMAN);
  const mb = new MeshBuilder({ lod, seed: 11 });
  naBody(mb, r, { coat: C.coat, skirt: true });
  beltAndPouches(mb, r, { bayonet: true });
  webbing(mb, r, C.leatherDark);
  tabardCross(mb, r, { cloth: C.tabard, cross: C.crossRed });
  shoulderPatch(mb, r, C.crossRed);
  gasMask(mb, r);
  gothicHelmet(mb, r);
  backpack(mb, r);
  weaponAtPivot(mb, r, 'rifle');
  return { mesh: mb.finish(), rig: r, weapon: 'rifle' };
}

export function buildEngineer(lod) {
  const r = makeRig({ ...HUMAN, packZ: 0.16, toolPivot: [0.06, 1.3, -0.24] });
  const mb = new MeshBuilder({ lod, seed: 23 });
  naBody(mb, r, { coat: mix(C.coat, C.canvas, 0.35), skirt: false });
  // leather work apron
  mb.skinWith((x, y) => {
    if (y > r.hipJ) return [BONE.PELVIS, BONE.PELVIS, 0];
    return [BONE.PELVIS, x > 0 ? BONE.ULEG_L : BONE.ULEG_R, Math.min(0.55, (r.hipJ - y) * 1.4)];
  });
  mb.col(C.leather, MAT.LEATHER);
  mb.sheet([-0.16, r.waist + 0.12, 0.125], [0.16, r.waist + 0.12, 0.125], [0.15, 0.56, 0.16], [-0.15, 0.56, 0.16]);
  mb.bone(BONE.SPINE);
  beltAndPouches(mb, r, { belt: C.leatherDark });
  // cross harness (X straps)
  if (!lod) {
    mb.bone(BONE.SPINE).col(C.leatherDark, MAT.LEATHER);
    mb.push(0, r.waist + 0.2, 0.122, 0, 0, 0.62).box(0.04, 0.46, 0.012).pop();
    mb.push(0, r.waist + 0.2, 0.122, 0, 0, -0.62).box(0.04, 0.46, 0.012).pop();
    mb.col(C.brass, MAT.METAL).push(0, r.waist + 0.2, 0.13).box(0.045, 0.045, 0.012, { bevel: 0.006 }).pop();
    // hammer on the belt
    mb.bone(BONE.PELVIS).col(C.wood, MAT.WOOD).cylBetween([-0.17, r.waist - 0.28, 0.02], [-0.17, r.waist - 0.02, 0.02], 0.012, 0.012, 5);
    mb.col(C.steelDark, MAT.METAL).push(-0.17, r.waist - 0.03, 0.02).box(0.03, 0.03, 0.1).pop();
  }
  shoulderPatch(mb, r, C.brass);
  sapperHelmet(mb, r);
  // big tool backpack: frame, planks, cable coil, pickaxe
  mb.bone(BONE.PACK).col(C.canvasDark, MAT.CLOTH);
  const z = -r.packZ - 0.08;
  mb.push(0, r.packY - 0.02, z).box(0.34, 0.4, 0.16, { bevel: 0.03 }).pop();
  mb.col(C.woodDark, MAT.WOOD);
  for (const s of [1, -1]) mb.cylBetween([0.19 * s, r.packY - 0.3, z - 0.02], [0.19 * s, r.packY + 0.34, z - 0.02], 0.012, 0.012, 5);
  mb.col(C.plank, MAT.WOOD).vary(0.12);
  for (let k = 0; k < (lod ? 2 : 4); k++) mb.push(0.02 * (k - 1.5), r.packY + 0.27 + k * 0.028, z - 0.01, 0, 0.05 * k, Math.PI / 2).box(0.03, 0.62, 0.1).pop();
  mb.vary(0);
  if (!lod) {
    mb.col(C.cable, MAT.LEATHER);
    const coil = [];
    for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI * 2; coil.push([0.21, r.packY + Math.sin(a) * 0.1, z + Math.cos(a) * 0.1]); }
    mb.tube(coil, 0.02, 5);
    mb.col(C.wood, MAT.WOOD).cylBetween([-0.2, r.packY - 0.3, z - 0.05], [0.12, r.packY + 0.45, z - 0.07], 0.016, 0.016, 5);
    mb.col(C.steelDark, MAT.METAL).push(0.12, r.packY + 0.45, z - 0.07, 0, 0, 1.1).box(0.04, 0.4, 0.035, { taper: [0.3, 0.5] }).pop();
  }
  weaponAtPivot(mb, r, 'shotgun');
  shovelAtPivot(mb, r);
  return { mesh: mb.finish(), rig: r, weapon: 'shotgun', tool: 'shovel' };
}

export function buildHeavy(lod) {
  const r = makeRig({
    ...HUMAN, hip: 1.04, hipJ: 1.02, waist: 1.18, shoulderY: 1.62, shoulderW: 0.3, hipW: 0.13, neck: 1.7,
    headY: 1.83, elbowY: 1.3, wristY: 1.02, knee: 0.56, ankle: 0.11, packY: 1.45, packZ: 0.22,
    weaponPivot: [-0.14, 1.12, 0.22],
  });
  const mb = new MeshBuilder({ lod, seed: 37 });
  const seg = lod ? 6 : 10;
  legs(mb, r, { trouser: C.armor, trouserMat: MAT.METAL, puttee: C.armor, putteeMat: MAT.METAL, boot: C.steelDark, thighR: 0.13, calfR: 0.11, bootW: 1.5, bootL: 1.25, kneePad: C.armorEdge });
  torso(mb, r, { coat: C.armor, coatMat: MAT.METAL, hips: C.leatherDark, waistW: 0.46, chestW: 0.66, depth: 0.36, chestDepth: 0.44 });
  // plated skirt (tassets)
  coatSkirt(mb, r, C.armor, r.waist + 0.02, 0.66, 0.26, 0.3, { mat: MAT.METAL, gap: 0.5, sz: 0.85 });
  // belly lames + brass trim
  if (!lod) {
    mb.bone(BONE.SPINE).col(C.armorEdge, MAT.METAL);
    for (let k = 0; k < 3; k++) mb.push(0, r.waist + 0.05 + k * 0.07, 0.2 + k * 0.012).box(0.4 - k * 0.02, 0.04, 0.04, { bevel: 0.008 }).pop();
    mb.col(C.brass, MAT.METAL).push(0, r.shoulderY - 0.08, 0.23).box(0.5, 0.03, 0.02).pop();
  }
  arms(mb, r, { sleeve: C.armor, sleeveMat: MAT.METAL, hand: C.steelDark, shoulderR: 0.12, upperArmR: 0.095, foreArmR: 0.09 });
  // pauldrons
  mb.col(C.armorEdge, MAT.METAL);
  for (const s of [1, -1]) {
    mb.bone(s > 0 ? BONE.UARM_L : BONE.UARM_R, BONE.SPINE, 0.4);
    mb.push(r.shoulderW * s * 1.08, r.shoulderY + 0.02, 0, 0, 0, -0.35 * s).lathe([[0.2, -0.12], [0.2, -0.06], [0.17, 0.02], [0.11, 0.08], [0.0, 0.1]], seg, { sz: 0.9 }).pop();
  }
  // enclosed helm with vision slit + breathing tubes
  mb.bone(BONE.HEAD).col(C.steelDark, MAT.METAL);
  mb.push(0, r.headY - 0.1, 0.02).lathe([[0.13, 0.0], [0.135, 0.12], [0.128, 0.2], [0.1, 0.25], [0.0, 0.265]], seg, { capBottom: true, sz: 1.08 }).pop();
  mb.col([0.02, 0.02, 0.02], MAT.GLASS).push(0, r.headY + 0.05, 0.155).box(0.16, 0.022, 0.02).pop();
  if (!lod) {
    mb.col(C.rubber, MAT.LEATHER);
    for (const s of [1, -1]) mb.tube([[0.05 * s, r.headY - 0.04, 0.13], [0.14 * s, r.headY - 0.12, 0.05], [0.16 * s, r.headY - 0.15, -0.15], [0.12 * s, r.packY + 0.12, -r.packZ - 0.05]], 0.022, 6);
  }
  // back-mounted engine with exhaust stacks
  mb.bone(BONE.PACK).col(C.engine, MAT.DARKMETAL);
  const z = -r.packZ - 0.12;
  mb.push(0, r.packY, z).box(0.46, 0.5, 0.26, { bevel: 0.04 }).pop();
  mb.col(C.steelDark, MAT.METAL);
  for (const s of [1, -1]) mb.cylBetween([0.16 * s, r.packY + 0.1, z - 0.06], [0.18 * s, r.packY + 0.56, z - 0.1], 0.04, 0.035, seg);
  if (!lod) {
    mb.col(C.brass, MAT.METAL).push(0.12, r.packY - 0.08, z - 0.14, Math.PI / 2, 0, 0).cyl(0.045, 0.045, 0.02, 10).pop();
    mb.col(C.char, MAT.DARKMETAL);
    for (const s of [1, -1]) mb.push(0.18 * s, r.packY + 0.57, z - 0.1).cyl(0.03, 0.03, 0.01, 8).pop();
  }
  weaponAtPivot(mb, r, 'mg');
  return { mesh: mb.finish(), rig: r, weapon: 'mg', heavy: true };
}

export function buildThrall(lod, variant = 0) {
  const r = makeRig({ ...HUMAN, shoulderW: 0.19, weaponPivot: [-0.13, 1.3, 0.1] });
  const mb = new MeshBuilder({ lod, seed: 51 + variant });
  const skin = variant ? C.skinDead : C.skinPale;
  legs(mb, r, { trouser: C.rags, puttee: variant ? C.puttee : skin, putteeMat: variant ? MAT.CLOTH : MAT.SKIN, boot: C.ragsDark, thighR: 0.075, calfR: 0.055, bootW: 0.9, bootL: 0.95, bareFoot: !variant });
  // emaciated torso with a bloated belly
  mb.bone(BONE.SPINE).col(skin, MAT.SKIN);
  const midY = (r.waist + r.shoulderY) / 2;
  mb.push(0, midY, 0.0).box(0.29, r.shoulderY - r.waist + 0.06, 0.19, { bevel: 0.045, taper: [1.2, 1.1] }).pop();
  mb.bone(BONE.PELVIS).col(C.skinBruise, MAT.SKIN).push(0, r.waist + 0.02, 0.07).sphere(0.15, 0.13, 0.12, lod ? 7 : 11, lod ? 5 : 7).pop();
  mb.push(0, r.hip + 0.02, 0).box(0.28, 0.2, 0.19, { bevel: 0.04 }).pop();
  if (!lod) {
    mb.bone(BONE.SPINE).col(C.boneDark, MAT.BONE);
    for (let k = 0; k < 3; k++) mb.push(0, midY + 0.02 + k * 0.05, 0.1).box(0.24 - k * 0.02, 0.012, 0.02).pop();
  }
  // tattered rags / remnant uniform
  coatSkirt(mb, r, variant ? C.coatDark : C.rags, r.waist + 0.03, 0.56, 0.17, 0.24, { ragged: true, gap: 0.5 });
  mb.bone(BONE.SPINE);
  if (variant) {
    mb.col(C.coatDark, MAT.CLOTH).push(0.02, midY + 0.05, -0.01).box(0.31, 0.3, 0.2, { bevel: 0.03, taper: [1.1, 1.05] }).pop();
  }
  // asymmetric swollen right arm with tumours, long clawed hands
  arms(mb, r, { sleeve: skin, sleeveMat: MAT.SKIN, hand: skin, shoulderR: 0.06, upperArmR: 0.048, foreArmR: 0.042, swollen: 1.55, claws: true });
  mb.bone(BONE.UARM_R).col(C.flesh, MAT.FLESH).jitter(lod ? 0 : 0.012, 22, 3);
  mb.push(-r.shoulderW - 0.05, r.shoulderY - 0.1, 0.03).sphere(0.07, 0.08, 0.07, lod ? 6 : 9, lod ? 4 : 6).pop();
  if (!lod) mb.push(-r.shoulderW - 0.02, r.shoulderY + 0.02, -0.05).sphere(0.05, 0.05, 0.05, 7, 5).pop();
  mb.noJitter();
  if (!lod) {
    mb.bone(BONE.SPINE).col(C.pus, MAT.FLESH);
    mb.push(0.1, r.shoulderY - 0.02, -0.09).sphere(0.03, 0.03, 0.03, 6, 4).pop();
    mb.push(-0.04, r.shoulderY - 0.12, -0.1).sphere(0.024, 0.024, 0.024, 6, 4).pop();
    mb.push(0.06, midY, 0.1).sphere(0.02, 0.02, 0.02, 6, 4).pop();
  }
  // head: bald, low, open jaw, sunken eyes
  neckAndHead(mb, r, { neck: skin, skin });
  mb.bone(BONE.HEAD).col(C.fleshDark, MAT.FLESH);
  mb.push(0, r.headY - 0.085, 0.045, 0.35, 0, 0).box(0.1, 0.03, 0.09, { bevel: 0.01 }).pop();
  mb.col([0.02, 0.015, 0.012], MAT.FLESH);
  for (const s of [1, -1]) mb.push(0.035 * s, r.headY + 0.012, 0.085).sphere(0.022, 0.018, 0.012, 6, 4).pop();
  if (variant) {
    // remnant of a New Antioch helmet: the risen dead of the defenders
    mb.col(C.rust, MAT.METAL).push(0.01, r.headY + 0.04, -0.01, -0.25, 0, 0.2).lathe([[0.14, -0.02], [0.12, 0.02], [0.1, 0.09], [0.06, 0.14], [0.0, 0.155]], lod ? 8 : 12, { sz: 1.1 }).pop();
  }
  return { mesh: mb.finish(), rig: r, weapon: 'claws', hunch: 0.48 };
}

export function buildCorpseGuard(lod) {
  const r = makeRig({ ...HUMAN, shoulderW: 0.215, packZ: 0.17 });
  const mb = new MeshBuilder({ lod, seed: 67 });
  const seg = lod ? 7 : 12;
  legs(mb, r, { trouser: C.ragsDark, puttee: C.rust, putteeMat: MAT.METAL, boot: C.ragsDark, thighR: 0.09, calfR: 0.068, bootW: 1.1, bootL: 1.05 });
  torso(mb, r, { coat: C.ragsDark, waistW: 0.34, chestW: 0.44, depth: 0.24, chestDepth: 0.27 });
  // rusted breastplate + mail skirt
  mb.bone(BONE.SPINE).col(C.rust, MAT.METAL);
  mb.push(0, r.waist + 0.22, 0.03).box(0.38, 0.34, 0.24, { bevel: 0.05, taper: [1.12, 1.05] }).pop();
  coatSkirt(mb, r, C.steelDark, r.waist + 0.03, 0.55, 0.19, 0.25, { mat: MAT.DARKMETAL, gap: 0.3 });
  coatSkirt(mb, r, C.ragsDark, r.waist - 0.02, 0.45, 0.2, 0.28, { ragged: true, gap: 0.65 });
  tabardCross(mb, r, { cloth: C.rags, cross: C.grailAccent });
  arms(mb, r, { sleeve: C.ragsDark, hand: C.leatherDark, shoulderR: 0.08, upperArmR: 0.06, foreArmR: 0.052, cuff: C.rust });
  mb.col(C.rust, MAT.METAL);
  for (const s of [1, -1]) {
    mb.bone(s > 0 ? BONE.UARM_L : BONE.UARM_R, BONE.SPINE, 0.35);
    mb.push(r.shoulderW * s, r.shoulderY + 0.02, 0, 0, 0, -0.3 * s).lathe([[0.12, -0.08], [0.11, 0.0], [0.07, 0.05], [0.0, 0.06]], seg).pop();
  }
  neckAndHead(mb, r, { neck: C.ragsDark, skin: C.skinDead });
  // bucket helm with compound-eye lenses and mandible grille, hooded
  mb.bone(BONE.HEAD).col(C.rust, MAT.METAL);
  mb.push(0, r.headY - 0.1, 0.015).lathe([[0.112, 0.0], [0.118, 0.12], [0.11, 0.2], [0.07, 0.235], [0.0, 0.245]], seg, { capBottom: true, sz: 1.1 }).pop();
  mb.col(C.lensGreen, MAT.GLASS);
  for (const s of [1, -1]) mb.push(0.045 * s, r.headY + 0.025, 0.105).sphere(0.04, 0.036, 0.03, lod ? 7 : 10, lod ? 5 : 7).pop();
  if (!lod) {
    mb.col(C.steelDark, MAT.DARKMETAL);
    for (let k = -2; k <= 2; k++) mb.push(k * 0.018, r.headY - 0.05, 0.12).box(0.008, 0.05, 0.012).pop();
  }
  mb.col(C.ragsDark, MAT.CLOTH).jitter(lod ? 0 : 0.015, 12, 9);
  mb.push(0, r.headY - 0.05, -0.025).lathe([[0.16, -0.1], [0.15, 0.05], [0.125, 0.16], [0.07, 0.24], [0.0, 0.26]], seg, { a0: 0.9, a1: Math.PI * 2 - 0.9, sz: 1.1 }).pop();
  mb.noJitter();
  // parasitic backpack creature
  mb.bone(BONE.PACK).col(C.flesh, MAT.FLESH).jitter(lod ? 0.006 : 0.018, 14, 5);
  const z = -r.packZ - 0.12;
  mb.push(0, r.packY, z).sphere(0.2, 0.24, 0.16, lod ? 8 : 13, lod ? 6 : 9).pop();
  mb.col(C.fleshDark, MAT.FLESH).push(0.05, r.packY + 0.18, z - 0.04).sphere(0.09, 0.09, 0.08, lod ? 6 : 9, lod ? 4 : 6).pop();
  mb.noJitter();
  if (!lod) {
    mb.col(C.chitin, MAT.BONE);
    for (const s of [1, -1]) {
      mb.tube([[0.15 * s, r.packY + 0.1, z + 0.02], [0.22 * s, r.packY + 0.24, z + 0.1], [0.19 * s, r.shoulderY + 0.04, 0.02], [0.14 * s, r.shoulderY - 0.1, 0.13]], [0.022, 0.018, 0.014, 0.006], 5);
      mb.tube([[0.16 * s, r.packY - 0.1, z + 0.03], [0.24 * s, r.packY - 0.18, z + 0.13], [0.2 * s, r.waist + 0.05, 0.05]], [0.02, 0.015, 0.005], 5);
    }
    mb.col(C.pus, MAT.FLESH);
    mb.push(-0.09, r.packY + 0.06, z - 0.15).sphere(0.03, 0.03, 0.03, 6, 4).pop();
    mb.push(0.1, r.packY - 0.08, z - 0.13).sphere(0.025, 0.025, 0.025, 6, 4).pop();
  }
  weaponAtPivot(mb, r, 'infested');
  return { mesh: mb.finish(), rig: r, weapon: 'infested' };
}

export function buildPlagueKnight(lod) {
  const r = makeRig({
    ...HUMAN, hip: 1.1, hipJ: 1.08, waist: 1.24, shoulderY: 1.72, shoulderW: 0.29, hipW: 0.13, neck: 1.8,
    headY: 1.95, elbowY: 1.38, wristY: 1.09, knee: 0.6, ankle: 0.11, packY: 1.55, packZ: 0.2,
    weaponPivot: [-0.3, 1.0, 0.1], weaponParent: 'hand',
  });
  const mb = new MeshBuilder({ lod, seed: 79 });
  const seg = lod ? 7 : 12;
  legs(mb, r, { trouser: C.chitin, trouserMat: MAT.DARKMETAL, puttee: C.chitin, putteeMat: MAT.DARKMETAL, boot: C.chitin, thighR: 0.12, calfR: 0.1, bootW: 1.45, bootL: 1.2, kneePad: C.chitinHi });
  torso(mb, r, { coat: C.chitin, coatMat: MAT.DARKMETAL, hips: C.ragsDark, waistW: 0.44, chestW: 0.64, depth: 0.34, chestDepth: 0.42 });
  // segmented carapace (abdomen plates)
  mb.bone(BONE.SPINE).col(C.chitinHi, MAT.DARKMETAL);
  for (let k = 0; k < (lod ? 2 : 4); k++) mb.push(0, r.waist + 0.06 + k * 0.1, 0.19).box(0.42 - k * 0.02, 0.07, 0.05, { bevel: lod ? 0 : 0.015, taper: [0.9, 1] }).pop();
  // surcoat with fly heraldry
  coatSkirt(mb, r, C.ragsDark, r.waist + 0.02, 0.5, 0.26, 0.34, { ragged: true, gap: 0.4, sz: 0.85 });
  tabardCross(mb, { ...r, shoulderY: r.shoulderY - 0.05 }, { cloth: C.rags, cross: C.grailAccent });
  arms(mb, r, { sleeve: C.chitin, sleeveMat: MAT.DARKMETAL, hand: C.chitin, shoulderR: 0.11, upperArmR: 0.09, foreArmR: 0.085 });
  // shoulder carapaces
  mb.col(C.chitinHi, MAT.DARKMETAL);
  for (const s of [1, -1]) {
    mb.bone(s > 0 ? BONE.UARM_L : BONE.UARM_R, BONE.SPINE, 0.45);
    mb.push(r.shoulderW * s * 1.12, r.shoulderY + 0.04, -0.02, 0.15, 0, -0.45 * s).lathe([[0.22, -0.14], [0.21, -0.05], [0.17, 0.05], [0.09, 0.12], [0.0, 0.14]], seg, { sz: 0.8 }).pop();
  }
  // folded wing-plates on the back (insect heraldry)
  mb.bone(BONE.PACK).col(C.chitin, MAT.DARKMETAL);
  const z = -r.packZ - 0.08;
  mb.push(0, r.packY - 0.05, z).sphere(0.28, 0.34, 0.14, seg, lod ? 5 : 8, { hemi: 0 }).pop();
  if (!lod) {
    mb.col(C.chitinHi, MAT.DARKMETAL);
    for (const s of [1, -1]) {
      mb.push(0.1 * s, r.packY + 0.1, z - 0.1, 0, 0, 0.12 * s);
      mb.extrude([[0, 0], [0.05 * s, 0.1], [0.12 * s, -0.3], [0.08 * s, -0.75], [0.02 * s, -0.6]], 0.02);
      mb.pop();
    }
  }
  // great helm with compound eyes and proboscis
  neckAndHead(mb, r, { neck: C.chitin, skin: C.skinDead });
  mb.bone(BONE.HEAD).col(C.chitin, MAT.DARKMETAL);
  mb.push(0, r.headY - 0.12, 0.01).lathe([[0.13, 0.0], [0.14, 0.14], [0.13, 0.24], [0.08, 0.31], [0.02, 0.34], [0.0, 0.35]], seg, { capBottom: true, sz: 1.12 }).pop();
  mb.col(C.lensGreen, MAT.GLASS);
  for (const s of [1, -1]) mb.push(0.065 * s, r.headY + 0.04, 0.1).sphere(0.062, 0.058, 0.05, lod ? 8 : 12, lod ? 5 : 8).pop();
  mb.col(C.fleshDark, MAT.FLESH);
  mb.tube([[0, r.headY - 0.04, 0.14], [0, r.headY - 0.13, 0.19], [0.02, r.headY - 0.25, 0.17], [0.0, r.headY - 0.33, 0.12]], [0.035, 0.03, 0.022, 0.012], lod ? 5 : 7);
  if (!lod) {
    mb.col(C.bronze, MAT.METAL).push(0, r.headY + 0.2, 0.0).box(0.02, 0.09, 0.3, { taper: [1, 0.6] }).pop();
  }
  weaponAtPivot(mb, r, 'greatblade');
  return { mesh: mb.finish(), rig: r, weapon: 'greatblade', heavy: true };
}

export const UNIT_MODELS = {
  na_yeoman: (lod) => buildYeoman(lod),
  na_engineer: (lod) => buildEngineer(lod),
  na_heavy: (lod) => buildHeavy(lod),
  bg_thrall: (lod) => buildThrall(lod, 0),
  bg_thrall_b: (lod) => buildThrall(lod, 1),
  bg_corpse_guard: (lod) => buildCorpseGuard(lod),
  bg_plague_knight: (lod) => buildPlagueKnight(lod),
};
