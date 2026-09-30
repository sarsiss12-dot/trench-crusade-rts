// Phase 2 linear fortifications, built from segment data like trenches / sandbags / wire:
// low sandbag line, timber-and-earth breastwork, reinforced sandbag & timber wall, fortified wall
// section (New Antioch) and the Black Grail bone barricade. Construction progress raises them
// course by course; damage knocks pieces out. Model-free of GL (MeshBuilder only).
import { MAT } from './meshbuilder.js';
import { C, mix } from './palette.js';
import { hash32 } from '../../core/rng.js';

function rnd(seed, i) {
  return hash32(seed, i, 919) / 4294967296;
}

function frame(s) {
  const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
  const len = Math.hypot(dx, dz) || 1e-6;
  const ux = dx / len, uz = dz / len;
  const f = s.front === -1 ? -1 : 1;
  // front normal (toward the enemy side chosen at placement)
  return { dx, dz, len, ux, uz, nx: -uz * f, nz: ux * f, yaw: Math.atan2(ux, uz) };
}

function keep(s, i) {
  const h = s.maxHp ? s.hp / s.maxHp : 1;
  return h >= 0.6 || rnd(s.id, i) < h + 0.35;
}

/** One row of sandbags along the line, offset `off` toward the front, layer l. */
function bagRow(mb, s, F, ground, off, l, salt) {
  const n = Math.max(1, Math.round(F.len / 0.56));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5 + (l % 2) * 0.5) / (n + 0.5);
    if (t > 1 || !keep(s, i * 13 + l * 7 + salt)) continue;
    const x = s.x1 + F.dx * t + F.nx * off, z = s.z1 + F.dz * t + F.nz * off;
    mb.push(x, ground(x, z) + 0.1 + l * 0.19, z, (rnd(s.id, i + l * 50 + salt) - 0.5) * 0.12, F.yaw + Math.PI / 2 + (rnd(s.id, i * 3 + l + salt) - 0.5) * 0.18, 0);
    mb.box(0.56, 0.19, 0.34, { bevel: mb.lod ? 0 : 0.07 });
    mb.pop();
  }
}

const courses = (s, total) => Math.max(1, Math.ceil(total * Math.min(1, (s.progress || 0) + 0.001)));

/** Low sandbag line: two courses, knee-high — light cover, quick to lay. */
export function buildLowSandbags(mb, s, ground) {
  const F = frame(s);
  mb.col(mix(C.sandbag, C.soil, 0.15), MAT.CLOTH).vary(0.14);
  for (let l = 0; l < courses(s, 2); l++) bagRow(mb, s, F, ground, 0, l, 1);
  mb.vary(0);
}

/** Timber-and-earth breastwork: a thick raised bank of packed earth, faced with planks and stakes. */
export function buildBreastwork(mb, s, ground) {
  const F = frame(s);
  const prog = Math.min(1, s.progress || 0);
  const h = 0.35 + 0.85 * prog;
  const segs = Math.max(2, Math.ceil(F.len / 1.2));
  // earth bank (jittered prisms)
  mb.col(mix(C.soil, C.sandbagDark, 0.2), MAT.SOIL).jitter(mb.lod ? 0 : 0.07, 2.2, s.id);
  for (let i = 0; i < segs; i++) {
    if (!keep(s, i)) continue;
    const t = (i + 0.5) / segs;
    const x = s.x1 + F.dx * t, z = s.z1 + F.dz * t;
    mb.push(x, ground(x, z) + h * 0.5 - 0.05, z, 0, F.yaw, 0);
    mb.box(1.7, h, F.len / segs + 0.1, { taper: [0.55, 1], bevel: 0 });
    mb.pop();
  }
  mb.noJitter();
  if (prog < 0.5) return;
  // plank revetment on the rear (fighting) side + stakes
  mb.col(C.plank, MAT.WOOD).vary(0.12);
  const back = -0.62;
  for (let i = 0; i < segs; i++) {
    const t = (i + 0.5) / segs;
    const x = s.x1 + F.dx * t + F.nx * back, z = s.z1 + F.dz * t + F.nz * back;
    mb.push(x, ground(x, z) + h * 0.45, z, 0.18, F.yaw, 0).box(0.06, h * 0.9, F.len / segs + 0.05).pop();
  }
  mb.col(C.woodDark, MAT.WOOD);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const x = s.x1 + F.dx * t + F.nx * (back - 0.06), z = s.z1 + F.dz * t + F.nz * (back - 0.06);
    mb.push(x, ground(x, z) + h * 0.5, z, 0.15, 0, 0).cyl(0.06, 0.05, h * 1.15, 5).pop();
  }
  mb.vary(0);
}

/** Reinforced sandbag & timber wall: chest-high double bag wall held by posts and a plank top. */
export function buildTimberWall(mb, s, ground) {
  const F = frame(s);
  const layers = courses(s, 6);
  mb.col(C.sandbag, MAT.CLOTH).vary(0.13);
  for (let l = 0; l < layers; l++) {
    bagRow(mb, s, F, ground, 0.2, l, 3);
    if (l < 3) bagRow(mb, s, F, ground, -0.2, l, 5);
  }
  mb.vary(0);
  if ((s.progress || 0) < 0.6) return;
  const posts = Math.max(2, Math.round(F.len / 1.6));
  mb.col(C.woodDark, MAT.WOOD);
  for (let i = 0; i <= posts; i++) {
    if (!keep(s, 70 + i)) continue;
    const t = i / posts;
    const x = s.x1 + F.dx * t - F.nx * 0.5, z = s.z1 + F.dz * t - F.nz * 0.5;
    mb.push(x, ground(x, z) + 0.8, z).box(0.14, 1.6, 0.14).pop();
  }
  mb.col(C.plank, MAT.WOOD).vary(0.1);
  const cx = (s.x1 + s.x2) / 2 - F.nx * 0.1, cz = (s.z1 + s.z2) / 2 - F.nz * 0.1;
  mb.push(cx, ground(cx, cz) + 1.25, cz, 0, F.yaw, 0).box(0.9, 0.06, F.len).pop();
  mb.vary(0);
}

/** Fortified wall section: masonry and concrete with a firing step and loopholes (blocks movement). */
export function buildFortifiedWall(mb, s, ground) {
  const F = frame(s);
  const prog = Math.min(1, s.progress || 0);
  const H = 0.4 + 1.8 * prog;
  const segs = Math.max(2, Math.ceil(F.len / 1.5));
  mb.col(C.stoneDark, MAT.STONE).vary(0.06);
  for (let i = 0; i < segs; i++) {
    const t = (i + 0.5) / segs;
    const x = s.x1 + F.dx * t, z = s.z1 + F.dz * t;
    const broken = !keep(s, i);
    const hh = broken ? H * 0.45 : H;
    mb.push(x, ground(x, z) + hh * 0.5 - 0.1, z, 0, F.yaw, 0).box(1.3, hh, F.len / segs + 0.02, { bevel: 0.05, taper: [0.85, 1] }).pop();
    if (prog > 0.95 && !broken) {
      // crenellated top with loophole gaps
      mb.col(C.stone, MAT.STONE);
      mb.push(x + F.nx * 0.35, ground(x, z) + H + 0.2, z + F.nz * 0.35, 0, F.yaw, 0).box(0.5, 0.4, F.len / segs * 0.6).pop();
      mb.col(C.stoneDark, MAT.STONE);
    }
  }
  mb.vary(0);
  if (prog < 0.8) return;
  // firing step (rear) + iron strapping
  mb.col(mix(C.stoneDark, C.soil, 0.3), MAT.STONE);
  const cx = (s.x1 + s.x2) / 2 - F.nx * 0.95, cz = (s.z1 + s.z2) / 2 - F.nz * 0.95;
  mb.push(cx, ground(cx, cz) + 0.25, cz, 0, F.yaw, 0).box(0.7, 0.5, F.len * 0.96).pop();
  mb.col(C.steelDark, MAT.DARKMETAL);
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const x = s.x1 + F.dx * t - F.nx * 0.66, z = s.z1 + F.dz * t - F.nz * 0.66;
    mb.push(x, ground(x, z) + H * 0.5, z, 0, F.yaw, 0).box(0.05, H * 0.9, 0.12).pop();
  }
}

/** Bone barricade (Black Grail): a continuous rampart of bodies, long bones and skulls, bristling
 * with bone stakes angled toward the enemy. */
export function buildBoneBarricade(mb, s, ground) {
  const F = frame(s);
  const prog = Math.min(1, s.progress || 0);
  const HIDE = [0.22, 0.17, 0.16], ROT = [0.2, 0.1, 0.085];
  const cols = [C.skinDead, C.rags, HIDE, ROT, C.coatDark];
  // earth + filth bank along the whole line
  mb.col(mix(C.soil, ROT, 0.35), MAT.SOIL).jitter(mb.lod ? 0 : 0.08, 2.2, s.id);
  const cx = (s.x1 + s.x2) / 2, cz = (s.z1 + s.z2) / 2;
  mb.push(cx, ground(cx, cz) + 0.12, cz, 0, F.yaw, 0).box(1.35, 0.3 + 0.2 * prog, F.len + 0.3, { taper: [0.55, 0.95] }).pop();
  mb.noJitter();
  // bodies and long bones heaped on it
  const n = Math.max(3, Math.round((F.len / 0.55) * prog * (mb.lod ? 0.4 : 1)));
  for (let i = 0; i < n; i++) {
    if (!keep(s, i)) continue;
    const t = (i + 0.5) / n + (rnd(s.id, i) - 0.5) * 0.04;
    const side = (rnd(s.id, i + 3) - 0.5) * 0.7;
    const x = s.x1 + F.dx * t + F.nx * side, z = s.z1 + F.dz * t + F.nz * side;
    const gy = ground(x, z) + 0.35 + rnd(s.id, i + 5) * 0.25;
    if (i % 4 === 3) mb.col(C.bone, MAT.BONE).push(x, gy + 0.1, z, rnd(s.id, i) * 2, F.yaw + rnd(s.id, i + 1) * 3, 0).box(0.1, 0.1, 0.95).pop();
    else mb.col(cols[i % cols.length], MAT.SKIN).push(x, gy, z, (rnd(s.id, i + 7) - 0.5) * 0.6, F.yaw + Math.PI / 2 + (rnd(s.id, i + 9) - 0.5) * 0.9, 0).box(0.38, 0.26, 1.2, { bevel: mb.lod ? 0 : 0.1 }).pop();
  }
  if (prog < 0.3) return;
  // stakes of bone angled toward the enemy, skulls between them
  const stakes = Math.max(2, Math.round(F.len / 0.8));
  for (let i = 0; i < stakes; i++) {
    if (!keep(s, 40 + i)) continue;
    const t = (i + 0.5) / stakes;
    const x = s.x1 + F.dx * t + F.nx * 0.3, z = s.z1 + F.dz * t + F.nz * 0.3;
    const gy = ground(x, z);
    const lean = 1.0 + rnd(s.id, i) * 0.4;
    const L = (0.8 + rnd(s.id, i + 9) * 0.5) * prog;
    mb.col(i % 3 === 0 ? mix(C.boneDark, ROT, 0.3) : C.boneDark, MAT.BONE);
    mb.cylBetween([x, gy + 0.3, z], [x + F.nx * L * lean, gy + 0.3 + L, z + F.nz * L * lean], 0.1, 0.02, 5);
    if (!mb.lod && i % 2 === 1) mb.col(C.boneDark, MAT.BONE).push(x - F.nx * 0.4, gy + 0.7, z - F.nz * 0.4).sphere(0.15, 0.14, 0.17, 6, 4).pop();
  }
}

// A visible slice of a massive frontier: 8m high, 5m thick, connected buttressed segments.
export function buildIronWall(mb, s, ground) {
  const f = frame(s), n = Math.max(1, Math.ceil(f.len / 6));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, x = s.x1 + f.dx * t, z = s.z1 + f.dz * t;
    const h = keep(s, i) ? 8 : 4.5;
    mb.push(x, ground(x, z), z, 0, f.yaw, 0);
    mb.col([0.22, 0.25, 0.23], MAT.STONE).push(0, h / 2, 0).box(5, h, f.len / n + 0.08, { taper: [0.84, 1] }).pop();
    mb.col(C.steelDark, MAT.DARKMETAL).push(0, h * 0.58, 0).box(5.1, 0.6, f.len / n + 0.08).pop();
    mb.col(C.stoneDark, MAT.STONE).push(0, h / 2, -f.len / n / 2).box(6.2, h + 1.5, 1.1, { taper: [0.8, 1] }).pop();
    for (const dz of [-1.5, 1.5]) mb.push(f.nx ? 1.8 : -1.8, h + 0.5, dz).box(0.9, 1, 1.4).pop();
    mb.pop();
  }
}

export const WALL_BUILDERS = {
  iron_wall_section: buildIronWall,
  low_sandbags: buildLowSandbags,
  breastwork: buildBreastwork,
  timber_wall: buildTimberWall,
  fortified_wall: buildFortifiedWall,
  bone_barricade: buildBoneBarricade,
};
