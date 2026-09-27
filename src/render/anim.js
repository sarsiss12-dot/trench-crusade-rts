// Procedural skeletal animation on the CPU (FK + analytic two-bone IK), written as skinning
// matrices (3x4 rows) into the pose texture. No mocap: walk cycles, aim/recoil, IK hands on
// weapons and tools, digging, melee swings, hit reactions, procedural death poses and rising.
import { BONE, BONE_COUNT, WEAPON_GEOM } from './models/humans.js';
import { affFromEuler, affMul, affApply } from './math3d.js';

export const POSE_FLOATS = (BONE_COUNT * 3 + 3) * 4;

const W = [];
for (let i = 0; i < BONE_COUNT; i++) W.push(new Float32Array(12));
const L = new Float32Array(12);
const ROOT = new Float32Array(12);
const V = [0, 0, 0], S = [0, 0, 0], TG = [0, 0, 0], TG2 = [0, 0, 0], POLE = [0, 0, 0];

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

function childLocal(out, rig, bone, parent, rx, ry, rz, tx = 0, ty = 0, tz = 0) {
  const p = rig.pivots;
  const ox = p[bone * 3] - (parent >= 0 ? p[parent * 3] : 0);
  const oy = p[bone * 3 + 1] - (parent >= 0 ? p[parent * 3 + 1] : 0);
  const oz = p[bone * 3 + 2] - (parent >= 0 ? p[parent * 3 + 2] : 0);
  return affFromEuler(out, rx, ry, rz, ox + tx, oy + ty, oz + tz);
}

/** W[bone] = W[parent] * local */
function fk(rig, bone, rx, ry, rz, tx, ty, tz) {
  const parent = rig.parents[bone];
  childLocal(L, rig, bone, parent, rx, ry, rz, tx, ty, tz);
  affMul(W[bone], parent >= 0 ? W[parent] : ROOT, L);
}

/** World position of a bone pivot-relative point (bind offsets) through W[bone]. */
function bonePoint(bone, lx, ly, lz, out) {
  return affApply(W[bone], lx, ly, lz, out);
}

/** Analytic 2-bone IK: sets W[upper], W[lower] so the wrist reaches target, elbow toward pole. */
function ikArm(rig, upper, lower, shoulder, target, pole) {
  const L1 = rig.upperArm, L2 = rig.foreArm;
  let dx = target[0] - shoulder[0], dy = target[1] - shoulder[1], dz = target[2] - shoulder[2];
  let d = Math.hypot(dx, dy, dz) || 1e-6;
  const dmax = L1 + L2 - 0.002, dmin = Math.abs(L1 - L2) + 0.01;
  const dc = d > dmax ? dmax : d < dmin ? dmin : d;
  dx /= d; dy /= d; dz /= d;
  d = dc;
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  // pole orthogonal to the shoulder->target axis
  const pd = pole[0] * dx + pole[1] * dy + pole[2] * dz;
  let px = pole[0] - dx * pd, py = pole[1] - dy * pd, pz = pole[2] - dz * pd;
  let pl = Math.hypot(px, py, pz);
  if (pl < 1e-5) { px = 0; py = -1; pz = 0; pl = 1; }
  px /= pl; py /= pl; pz /= pl;
  const ex = shoulder[0] + dx * a + px * h, ey = shoulder[1] + dy * a + py * h, ez = shoulder[2] + dz * a + pz * h;
  const tx = shoulder[0] + dx * d, ty = shoulder[1] + dy * d, tz = shoulder[2] + dz * d;
  setLimb(W[upper], shoulder[0], shoulder[1], shoulder[2], ex, ey, ez, px, py, pz);
  setLimb(W[lower], ex, ey, ez, tx, ty, tz, px, py, pz);
}

/** Limb frame: bone +y points from end back to start (bind limbs hang along -y); z = -pole. */
function setLimb(m, sx, sy, sz, ex, ey, ez, px, py, pz) {
  let yx = sx - ex, yy = sy - ey, yz = sz - ez;
  const yl = Math.hypot(yx, yy, yz) || 1;
  yx /= yl; yy /= yl; yz /= yl;
  let zx = -px, zy = -py, zz = -pz;
  const d = zx * yx + zy * yy + zz * yz;
  zx -= yx * d; zy -= yy * d; zz -= yz * d;
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;
  const xx = yy * zz - yz * zy, xy = yz * zx - yx * zz, xz = yx * zy - yy * zx;
  m[0] = xx; m[1] = yx; m[2] = zx; m[3] = sx;
  m[4] = xy; m[5] = yy; m[6] = zy; m[7] = sy;
  m[8] = xz; m[9] = yz; m[10] = zz; m[11] = sz;
}

/** Local offset vector rotated into world by W[bone]'s rotation only. */
function dirFrom(bone, x, y, z, out) {
  const m = W[bone];
  out[0] = m[0] * x + m[1] * y + m[2] * z;
  out[1] = m[4] * x + m[5] * y + m[6] * z;
  out[2] = m[8] * x + m[9] * y + m[10] * z;
  return out;
}

// ------------------------------------------------------------------ death / corpse poses

// [pelvisY, pelvisPitch, pelvisRoll, spinePitch, spineRoll, headPitch, headYaw,
//  uArmLPitch, uArmLRoll, lArmL, uArmRPitch, uArmRRoll, lArmR, uLegL, lLegL, uLegR, lLegR]
const DEATH_POSES = [
  [0.2, -1.5, 0.05, -0.25, 0.1, -0.35, 0.4, -2.4, 0.5, 0.6, -1.4, -1.0, 0.4, 0.35, 0.3, -0.1, 0.9],
  [0.19, 1.47, -0.1, 0.12, -0.1, 0.2, 1.1, -0.5, 0.5, 0.9, -2.6, -0.4, 0.2, -0.05, 0.2, 0.2, 0.6],
  [0.21, 0.25, 1.42, 0.35, 0.25, 0.3, -0.3, -1.0, 0.2, 1.2, -0.7, -0.6, 1.3, -0.95, 1.6, -0.6, 1.2],
  [0.2, 1.38, 0.2, 0.3, 0.1, 0.5, -0.8, -1.2, 0.8, 1.0, -0.2, -0.3, 0.5, -0.6, 1.9, -0.4, 1.4],
];
const KNEEL = [0.55, 0.35, 0.05, 0.45, 0.05, 0.3, 0, -0.4, 0.2, 0.5, -0.3, -0.2, 0.5, -1.3, 1.9, -1.1, 1.8];

export function deathVariant(seed) {
  return seed % DEATH_POSES.length;
}

function deathPose(rig, variant, t, out) {
  // t: 0 standing -> 1 lying. Variant 3 kneels first.
  const target = DEATH_POSES[variant];
  const stand = STAND;
  if (variant === 3 && t < 0.45) {
    const k = smooth(t / 0.45);
    for (let i = 0; i < out.length; i++) out[i] = lerp(stand[i], KNEEL[i], k);
  } else {
    const k = variant === 3 ? (t - 0.45) / 0.55 : t;
    const from = variant === 3 ? KNEEL : stand;
    const e = clamp01(k);
    const fall = e * e; // gravity-like acceleration
    for (let i = 0; i < out.length; i++) out[i] = lerp(from[i], target[i], i < 3 ? fall : smooth(e));
  }
  return out;
}
const STAND = [0.95, 0, 0, 0, 0, 0, 0, 0, 0.08, 0.15, 0, -0.08, 0.15, 0, 0.05, 0, 0.05];
const DP = new Array(17).fill(0);

// ------------------------------------------------------------------ main pose

/**
 * Write skinning matrices for one soldier into dst at offset.
 * a: animation input (see units_renderer VisualState). model: { rig, weapon, hunch, heavy }.
 */
export function computePose(dst, offset, model, a) {
  const rig = model.rig;
  const wg = WEAPON_GEOM[model.weapon] || WEAPON_GEOM.claws;
  affFromEuler(ROOT, 0, a.rot, 0, a.x, a.y, a.z, a.scale || 1);
  const heavy = !!model.heavy;
  const hunch = model.hunch || 0;
  const hipH = rig.hip;

  // ---------------- death / rising (full-body keyframe blend)
  if (a.death >= 0 || a.rise >= 0) {
    let t = a.death >= 0 ? a.death : 1 - a.rise;
    const v = a.variant;
    // hit reaction jolt at the start of death
    const jolt = a.death >= 0 ? Math.max(0, 1 - a.death * 7) : 0;
    deathPose(rig, v, clamp01(t), DP);
    const riseShake = a.rise >= 0 ? Math.sin(a.time * 23 + a.seed) * 0.08 * (1 - Math.abs(a.rise - 0.5) * 2) : 0;
    const py = DP[0] * (hipH / 0.95);
    fk(rig, BONE.PELVIS, DP[1] - jolt * 0.25, riseShake, DP[2], 0, py - hipH, 0);
    fk(rig, BONE.SPINE, DP[3] - jolt * 0.3 + (a.rise >= 0 ? hunch * a.rise : 0), 0, DP[4]);
    fk(rig, BONE.HEAD, DP[5], DP[6], 0);
    fk(rig, BONE.UARM_L, DP[7], 0, DP[8]);
    fk(rig, BONE.LARM_L, -DP[9], 0, 0);
    fk(rig, BONE.UARM_R, DP[10], 0, DP[11]);
    fk(rig, BONE.LARM_R, -DP[12], 0, 0);
    fk(rig, BONE.ULEG_L, DP[13], 0, 0.04);
    fk(rig, BONE.LLEG_L, DP[14], 0, 0);
    fk(rig, BONE.ULEG_R, DP[15], 0, -0.04);
    fk(rig, BONE.LLEG_R, DP[16], 0, 0);
    // dropped weapon falls with the right hand; tools stay slung
    if (rig.parents[BONE.WEAPON] === BONE.LARM_R) fk(rig, BONE.WEAPON, 0, 0, 0);
    else fk(rig, BONE.WEAPON, -0.4, 0.6, 1.2, 0.1, -0.25, 0.2);
    fk(rig, BONE.TOOL, 1.5, 0, 0.4, 0, 0, 0);
    fk(rig, BONE.PACK, 0, 0, 0);
    return writeRow(dst, offset, rig, a);
  }

  // ---------------- alive
  const t = a.time;
  const walk = a.walk; // 0..1
  const ph = a.phase;
  const sw = Math.sin(ph), cw = Math.cos(ph);
  const legAmp = (heavy ? 0.42 : 0.52) * walk;
  const armSwing = walk * (heavy ? 0.25 : 0.4);
  const work = a.work, wph = a.workPhase;
  const aim = a.aim;
  const recoil = a.recoil;
  const melee = a.melee; // -1 none, 0..1 swing
  const hit = a.hit;
  const breath = Math.sin(t * 1.7 + a.seed) * 0.018;
  const lurch = hunch > 0 ? Math.sin(ph * 0.5 + a.seed) * 0.1 * walk : 0;

  let bob = (1 - Math.abs(sw)) * (heavy ? 0.03 : 0.045) * walk;
  let crouch = work * 0.12 + (a.inTrench ? 0.0 : 0);
  if (melee >= 0) crouch += Math.sin(melee * Math.PI) * 0.08;
  const pelvisPitch = 0.06 * walk + hunch * 0.25 + work * 0.15;
  // visible sickness (infection stacks): an unsteady, swaying stance and a sagging head
  const sick = a.sick || 0;
  const stagger = sick > 0.25 ? Math.sin(t * 1.9 + a.seed) * 0.07 * sick + Math.sin(t * 4.7 + a.seed * 2) * 0.02 * sick : 0;
  const pelvisRoll = Math.sin(ph) * 0.045 * walk + lurch * 0.4 + stagger;
  fk(rig, BONE.PELVIS, pelvisPitch, Math.sin(ph) * 0.08 * walk, pelvisRoll, 0, bob - crouch, 0);

  // spine: lean, hunch, breathing, aim blade, recoil, dig bend, melee lunge, hit flinch
  const blade = aim * (model.weapon === 'mg' ? -0.2 : -0.6);
  let sp = hunch + breath + walk * 0.05 - recoil * (heavy ? 0.04 : 0.09) + work * (0.35 + 0.35 * (0.5 + 0.5 * Math.sin(wph)));
  if (melee >= 0) sp += Math.sin(melee * Math.PI) * 0.35;
  sp -= hit * 0.3;
  const spYaw = blade - Math.sin(ph) * 0.12 * walk * (1 - aim) + a.aimYaw * 0.4 + hit * 0.25 * a.hitSide;
  fk(rig, BONE.SPINE, sp + sick * 0.12, spYaw, -lurch * 0.5 - stagger * 1.2);
  fk(rig, BONE.HEAD, -hunch * 0.7 + aim * 0.08 - sp * 0.3 + Math.sin(t * 0.37 + a.seed) * 0.05, -blade * 0.9 + Math.sin(t * 0.23 + a.seed * 3) * 0.2 * (1 - aim), 0);

  // legs: walk cycle (drag one leg for lurching hordes), crouch for work / kneeling
  const drag = hunch > 0 ? 0.55 : 1;
  const kneeL = (0.12 + 0.95 * Math.max(0, cw)) * walk * 0.95;
  const kneeR = (0.12 + 0.95 * Math.max(0, -cw)) * walk * 0.95 * drag;
  const crouchLeg = work * 0.45 + (melee >= 0 ? Math.sin(melee * Math.PI) * 0.3 : 0);
  fk(rig, BONE.ULEG_L, -sw * legAmp - crouchLeg, 0, 0.03);
  fk(rig, BONE.LLEG_L, kneeL + crouchLeg * 1.6, 0, 0);
  fk(rig, BONE.ULEG_R, sw * legAmp * drag - crouchLeg * 0.6, 0, -0.03);
  fk(rig, BONE.LLEG_R, kneeR + crouchLeg * 1.3, 0, 0);

  fk(rig, BONE.PACK, 0.02 * walk * Math.abs(sw), 0, 0, 0, a.packPulse || 0, 0);

  const wk = model.weapon;
  const twoHandedGun = wk === 'rifle' || wk === 'shotgun' || wk === 'infested' || wk === 'mg';
  const useTool = work > 0.02 && model.tool;

  if (useTool) {
    // shovel in both hands, rifle slung on the back
    const dig = Math.sin(wph);
    fk(rig, BONE.TOOL, 0.75 + dig * 0.32, 0.1, 0, 0.02 - rig.pivots[BONE.TOOL * 3] - 0.12, -0.2 - dig * 0.12, 0.42 + dig * 0.1);
    slungWeapon(rig);
    bonePoint(BONE.TOOL, 0, 0, 0.02, TG);
    bonePoint(BONE.TOOL, 0, 0, 0.46, TG2);
    armsIK(rig, TG, TG2, 1);
  } else if (twoHandedGun) {
    // weapon pose: carry (port arms / hip) <-> aim; recoil kick; bayonet thrust in melee
    const hip = wg.hip;
    const thrust = melee >= 0 ? Math.sin(melee * Math.PI) : 0;
    const carryPitch = hip ? 0.35 : -1.05, carryYaw = hip ? 0.15 : 0.85, carryRoll = hip ? 0 : 0.2;
    const aimPitch = -recoil * (heavy ? 0.05 : 0.14) + (a.aimPitch || 0);
    const rx = lerp(carryPitch, aimPitch, aim);
    const ry = lerp(carryYaw, -blade + a.aimYaw * 0.6, aim);
    const rz = lerp(carryRoll, 0, aim);
    const ox = lerp(hip ? 0.02 : 0.06, 0, aim);
    const oy = lerp(hip ? -0.05 : -0.34, 0, aim) + Math.sin(ph * 2) * 0.012 * walk;
    const oz = lerp(hip ? 0.02 : 0.1, 0, aim) - recoil * (heavy ? 0.03 : 0.07) + thrust * 0.32;
    fk(rig, BONE.WEAPON, rx, ry, rz, ox, oy, oz);
    stowTool(rig);
    bonePoint(BONE.WEAPON, wg.rightGrip[0], wg.rightGrip[1], wg.rightGrip[2], TG);
    bonePoint(BONE.WEAPON, wg.leftGrip[0], wg.leftGrip[1], wg.leftGrip[2], TG2);
    armsIK(rig, TG, TG2, 0);
  } else if (wk === 'greatblade') {
    // FK right arm swing, blade in the right hand, left hand on the hilt
    let uaP, laP;
    if (melee >= 0) {
      const m = melee;
      uaP = m < 0.35 ? lerp(-0.9, -2.9, smooth(m / 0.35)) : lerp(-2.9, -0.35, smooth((m - 0.35) / 0.4));
      laP = m < 0.35 ? lerp(0.9, 1.4, m / 0.35) : lerp(1.4, 0.2, clamp01((m - 0.35) / 0.4));
    } else {
      uaP = lerp(-0.35 + sw * armSwing * 0.3, -0.9, aim * 0.6);
      laP = 0.9;
    }
    fk(rig, BONE.UARM_R, uaP, 0.3, -0.15);
    fk(rig, BONE.LARM_R, -laP, 0, 0);
    fk(rig, BONE.WEAPON, -1.2 + (melee >= 0 ? 0.3 : 0), 0.0, 0.0);
    stowTool(rig);
    bonePoint(BONE.WEAPON, wg.leftGrip[0], wg.leftGrip[1], wg.leftGrip[2], TG2);
    bonePoint(rig.parents[BONE.UARM_L], rig.pivots[BONE.UARM_L * 3] - rig.pivots[BONE.SPINE * 3], rig.pivots[BONE.UARM_L * 3 + 1] - rig.pivots[BONE.SPINE * 3 + 1], rig.pivots[BONE.UARM_L * 3 + 2] - rig.pivots[BONE.SPINE * 3 + 2], S);
    dirFrom(BONE.SPINE, 0.5, -1, -0.6, POLE);
    ikArm(rig, BONE.UARM_L, BONE.LARM_L, S, TG2, POLE);
  } else {
    // claws / unarmed: swinging arms, alternating raking strikes
    let lP = sw * armSwing - 0.2 - hunch * 0.6, rP = -sw * armSwing - 0.25 - hunch * 0.7;
    let lL = 0.35 + hunch * 0.4, rL = 0.4 + hunch * 0.3;
    if (melee >= 0) {
      const left = (a.seed & 1) === 0;
      const m = melee;
      const raise = m < 0.4 ? smooth(m / 0.4) : 1 - smooth((m - 0.4) / 0.35);
      const strike = -2.4 * raise + 0.3 * (1 - raise);
      if (left) { lP = strike; lL = 0.6 * raise + 0.2; } else { rP = strike; rL = 0.6 * raise + 0.2; }
    }
    fk(rig, BONE.UARM_L, lP, 0, 0.12 + hunch * 0.2);
    fk(rig, BONE.LARM_L, -lL, 0, 0);
    fk(rig, BONE.UARM_R, rP, 0, -0.14 - hunch * 0.25);
    fk(rig, BONE.LARM_R, -rL, 0, 0);
    fk(rig, BONE.WEAPON, 0, 0, 0);
    stowTool(rig);
  }
  return writeRow(dst, offset, rig, a);
}

function armsIK(rig, rightTarget, leftTarget, toolMode) {
  const sp = rig.pivots;
  const spx = sp[BONE.SPINE * 3], spy = sp[BONE.SPINE * 3 + 1], spz = sp[BONE.SPINE * 3 + 2];
  bonePoint(BONE.SPINE, sp[BONE.UARM_R * 3] - spx, sp[BONE.UARM_R * 3 + 1] - spy, sp[BONE.UARM_R * 3 + 2] - spz, S);
  dirFrom(BONE.SPINE, -0.8, -0.9, toolMode ? -0.2 : -0.5, POLE);
  ikArm(rig, BONE.UARM_R, BONE.LARM_R, S, rightTarget, POLE);
  bonePoint(BONE.SPINE, sp[BONE.UARM_L * 3] - spx, sp[BONE.UARM_L * 3 + 1] - spy, sp[BONE.UARM_L * 3 + 2] - spz, V);
  dirFrom(BONE.SPINE, 0.6, -1, toolMode ? -0.1 : -0.3, POLE);
  ikArm(rig, BONE.UARM_L, BONE.LARM_L, V, leftTarget, POLE);
}

function slungWeapon(rig) {
  // barrel up-diagonal across the back
  const p = rig.pivots;
  fk(rig, BONE.WEAPON, -1.25, Math.PI - 0.3, 0.5, 0.2 - p[BONE.WEAPON * 3], -0.35, -0.3 - p[BONE.WEAPON * 3 + 2]);
}

function stowTool(rig) {
  // shovel strapped to the pack, blade down
  fk(rig, BONE.TOOL, 1.75, 0.0, 0.35, 0.0, 0.45, -0.02);
}

const GM = new Float32Array(12);

/**
 * Skinning rows. Presentation gore (render/gore.js): a.lost (bone mask) collapses torn-off bones to
 * their joint (the stump stays on the body); a.gib = { mask, root, g } draws ONLY that limb chain,
 * carried rigidly by the world transform g (the rest of the body collapses to the torn end).
 */
function writeRow(dst, offset, rig, a) {
  const p = rig.pivots;
  let o = offset;
  const lost = a.lost || 0;
  const gib = a.gib;
  let jx = 0, jy = 0, jz = 0;
  if (gib) {
    const r = W[gib.root], g = gib.g;
    const rx = r[3], ry = r[7], rz = r[11];
    jx = g[0] * rx + g[1] * ry + g[2] * rz + g[3];
    jy = g[4] * rx + g[5] * ry + g[6] * rz + g[7];
    jz = g[8] * rx + g[9] * ry + g[10] * rz + g[11];
  }
  for (let b = 0; b < BONE_COUNT; b++) {
    let m = W[b];
    const bit = 1 << b;
    if (gib) {
      if (!(gib.mask & bit)) {
        dst[o] = 0; dst[o + 1] = 0; dst[o + 2] = 0; dst[o + 3] = jx;
        dst[o + 4] = 0; dst[o + 5] = 0; dst[o + 6] = 0; dst[o + 7] = jy;
        dst[o + 8] = 0; dst[o + 9] = 0; dst[o + 10] = 0; dst[o + 11] = jz;
        o += 12;
        continue;
      }
      affMul(GM, gib.g, m);
      m = GM;
    } else if (lost & bit) {
      // torn off: every vertex of the bone collapses onto its joint
      dst[o] = 0; dst[o + 1] = 0; dst[o + 2] = 0; dst[o + 3] = m[3];
      dst[o + 4] = 0; dst[o + 5] = 0; dst[o + 6] = 0; dst[o + 7] = m[7];
      dst[o + 8] = 0; dst[o + 9] = 0; dst[o + 10] = 0; dst[o + 11] = m[11];
      o += 12;
      continue;
    }
    const px = p[b * 3], py = p[b * 3 + 1], pz = p[b * 3 + 2];
    // skin = W * T(-pivot)
    dst[o] = m[0]; dst[o + 1] = m[1]; dst[o + 2] = m[2]; dst[o + 3] = m[3] - (m[0] * px + m[1] * py + m[2] * pz);
    dst[o + 4] = m[4]; dst[o + 5] = m[5]; dst[o + 6] = m[6]; dst[o + 7] = m[7] - (m[4] * px + m[5] * py + m[6] * pz);
    dst[o + 8] = m[8]; dst[o + 9] = m[9]; dst[o + 10] = m[10]; dst[o + 11] = m[11] - (m[8] * px + m[9] * py + m[10] * pz);
    o += 12;
  }
  dst[o] = a.tint; dst[o + 1] = a.mud; dst[o + 2] = a.wear; dst[o + 3] = a.highlight;
  dst[o + 4] = a.accent[0]; dst[o + 5] = a.accent[1]; dst[o + 6] = a.accent[2]; dst[o + 7] = a.fade;
  // gore / sickness layer: blood soaking, visible infection, Grail ichor (dark) vs red blood
  dst[o + 8] = a.blood || 0; dst[o + 9] = a.sick || 0; dst[o + 10] = a.bio ? 1 : 0; dst[o + 11] = lost || gib ? 1 : 0;
  return o + 12;
}

/** World position of a bone joint of the last posed soldier (call right after computePose). */
export function jointWorld(bone, out) {
  const m = W[bone];
  out[0] = m[3]; out[1] = m[7]; out[2] = m[11];
  return out;
}

/** World-space muzzle point of a posed soldier (call right after computePose). */
export function muzzleWorld(model, out) {
  const wg = WEAPON_GEOM[model.weapon];
  if (!wg || wg.none) return bonePoint(BONE.LARM_R, 0, -0.1, 0, out);
  return bonePoint(BONE.WEAPON, wg.muzzle[0], wg.muzzle[1], wg.muzzle[2], out);
}

export function headWorld(model, out) {
  return bonePoint(BONE.HEAD, 0, model.rig.headY - model.rig.neck + 0.05, 0, out);
}

