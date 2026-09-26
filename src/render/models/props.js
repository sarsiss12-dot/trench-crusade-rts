// Battlefield props and vegetation (static, instanced). Irregular, weathered shapes: deterministic
// jitter + per-face colour break-up keep them from looking machine-clean or toy-like.
import { MeshBuilder, MAT } from './meshbuilder.js';
import { C, mix } from './palette.js';
import { hash32 } from '../../core/rng.js';

function rnd(seed, i) {
  return hash32(seed, i, 71) / 4294967296;
}

function deadTree(mb, v, seed) {
  const lod = mb.lod;
  const seg = lod ? 5 : 7;
  const h = v === 3 ? 2.2 + rnd(seed, 1) * 2.5 : 7 + rnd(seed, 2) * 4;
  const lean = (rnd(seed, 3) - 0.5) * 0.25;
  mb.col(v === 1 ? C.treeBarkDark : C.treeBark, MAT.WOOD).vary(0.1);
  mb.jitter(lod ? 0.03 : 0.06, 2.2, seed & 1023);
  const trunk = [];
  const radii = [];
  const steps = lod ? 4 : 7;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    trunk.push([Math.sin(t * 3 + seed) * 0.25 * t + lean * t * h * 0.4, t * h, Math.cos(t * 2.4 + seed) * 0.2 * t]);
    radii.push(0.3 * (1 - t * 0.82) + 0.03);
  }
  // flared roots
  mb.lathe([[0.55, -0.1], [0.4, 0.15], [0.3, 0.5]], seg);
  mb.tube(trunk, radii, seg, { capEnd: v === 3 });
  if (v === 3) {
    // splintered top
    mb.col(C.plank, MAT.WOOD);
    const top = trunk[trunk.length - 1];
    for (let k = 0; k < (lod ? 2 : 5); k++) {
      const a = (k / 5) * Math.PI * 2 + seed;
      mb.tube([[top[0] + Math.cos(a) * 0.08, top[1] - 0.1, top[2] + Math.sin(a) * 0.08], [top[0] + Math.cos(a) * 0.12, top[1] + 0.3 + rnd(seed, 10 + k) * 0.4, top[2] + Math.sin(a) * 0.12]], [0.05, 0.005], 3);
    }
    mb.noJitter().vary(0);
    return;
  }
  const branches = lod ? 3 : 5 + (seed % 3);
  for (let b = 0; b < branches; b++) {
    const t0 = 0.45 + rnd(seed, 20 + b) * 0.45;
    const idx = Math.min(trunk.length - 1, Math.round(t0 * steps));
    const base = trunk[idx];
    const a = rnd(seed, 30 + b) * Math.PI * 2;
    const len = (1.5 + rnd(seed, 40 + b) * 2.5) * (1.1 - t0 * 0.5);
    const up = 0.6 + rnd(seed, 50 + b) * 0.8;
    const p1 = [base[0] + Math.cos(a) * len * 0.5, base[1] + len * 0.5 * up, base[2] + Math.sin(a) * len * 0.5];
    const p2 = [base[0] + Math.cos(a) * len, base[1] + len * up * 0.8 + 0.3, base[2] + Math.sin(a) * len];
    mb.tube([base, p1, p2], [radii[idx] * 0.55, radii[idx] * 0.3, 0.01], lod ? 3 : 4);
    if (!lod) {
      for (let s = 0; s < 2; s++) {
        const a2 = a + (rnd(seed, 60 + b * 3 + s) - 0.5) * 1.8;
        const l2 = len * 0.45;
        mb.tube([p1, [p1[0] + Math.cos(a2) * l2, p1[1] + l2 * 0.7, p1[2] + Math.sin(a2) * l2]], [radii[idx] * 0.18, 0.006], 3);
      }
    }
  }
  mb.noJitter().vary(0);
}

function stump(mb, seed) {
  mb.col(C.treeBark, MAT.WOOD).jitter(0.05, 3, seed & 511);
  mb.lathe([[0.55, -0.1], [0.38, 0.1], [0.33, 0.5], [0.25, 0.75]], mb.lod ? 6 : 9, { capTop: true });
  mb.noJitter();
  mb.col(C.plank, MAT.WOOD).push(0, 0.78, 0).cyl(0.2, 0.05, 0.25, 5, { caps: false }).pop();
}

function graveCross(mb, v, seed) {
  mb.col(C.soil, MAT.SOIL).jitter(0.04, 3, seed & 255).push(0, 0.02, -0.35).sphere(0.42, 0.14, 0.85, 8, 5, { hemi: 1 }).pop().noJitter();
  const tilt = v === 1 ? 0.25 : (rnd(seed, 1) - 0.5) * 0.12;
  mb.push(0, 0, 0, tilt, 0, (rnd(seed, 2) - 0.5) * 0.15);
  if (v === 2) {
    mb.col(C.stoneDark, MAT.STONE);
    mb.push(0, 0.5, 0).box(0.14, 1.0, 0.1, { bevel: 0.02 }).pop();
    mb.push(0, 0.72, 0).box(0.5, 0.13, 0.1, { bevel: 0.02 }).pop();
  } else {
    mb.col(C.woodDark, MAT.WOOD).vary(0.15);
    mb.push(0, 0.55, 0).box(0.08, 1.1, 0.06).pop();
    mb.push(0, 0.82, 0.005).box(0.52, 0.07, 0.05).pop();
    mb.vary(0);
    if (!mb.lod && v === 0) mb.col(C.steelDark, MAT.METAL).push(0, 0.98, 0.04, -0.5, 0, 0).lathe([[0.13, 0], [0.12, 0.03], [0.09, 0.07], [0, 0.09]], 8).pop();
  }
  mb.pop();
}

function rubble(mb, v, seed) {
  mb.col(C.soil, MAT.SOIL).jitter(0.12, 1.5, seed & 511).push(0, 0, 0).sphere(1.5, 0.45, 1.3, 9, 5, { hemi: 1 }).pop().noJitter();
  mb.vary(0.18);
  const n = mb.lod ? 5 : 12;
  for (let i = 0; i < n; i++) {
    const a = rnd(seed, i) * Math.PI * 2, r = rnd(seed, 100 + i) * 1.3;
    const col = v === 1 ? C.stoneDark : i % 3 === 0 ? C.char : C.brick;
    mb.col(col, col === C.char ? MAT.WOOD : MAT.STONE);
    mb.push(Math.cos(a) * r, 0.25 + rnd(seed, 200 + i) * 0.3, Math.sin(a) * r, rnd(seed, 300 + i), rnd(seed, 400 + i) * 3, rnd(seed, 500 + i))
      .box(0.25 + rnd(seed, 600 + i) * 0.4, 0.12 + rnd(seed, 700 + i) * 0.15, 0.18 + rnd(seed, 800 + i) * 0.3).pop();
  }
  mb.vary(0);
}

function beam(mb, seed) {
  mb.col(C.char, MAT.WOOD).jitter(0.03, 4, seed & 255);
  mb.push(0, 0.14, 0, 0, 0, 0.1).box(0.26, 0.24, 3.4 + rnd(seed, 1) * 1.5).pop();
  mb.noJitter();
}

function crate(mb, v) {
  mb.col(C.wood, MAT.WOOD).vary(0.1);
  mb.push(0, 0.3, 0).box(0.8, 0.6, 0.6, { bevel: 0.03 }).pop();
  if (!mb.lod) {
    mb.col(C.woodDark, MAT.WOOD);
    for (const x of [-0.3, 0.3]) mb.push(x, 0.3, 0.305).box(0.06, 0.58, 0.02).pop();
    mb.push(0, 0.3, 0.305, 0, 0, 0.6).box(0.05, 0.9, 0.02).pop();
  }
  if (v === 1) mb.col(C.plank, MAT.WOOD).push(0.05, 0.85, 0.02, 0, 0.3, 0).box(0.7, 0.5, 0.55, { bevel: 0.03 }).pop();
  mb.vary(0);
}

function barrel(mb, v) {
  mb.col(v === 2 ? C.rust : C.woodDark, v === 2 ? MAT.METAL : MAT.WOOD);
  const prof = [[0.27, 0], [0.31, 0.2], [0.33, 0.42], [0.31, 0.64], [0.27, 0.84]];
  if (v === 1) mb.push(0, 0.3, 0, Math.PI / 2, 0, 0.2).push(0, -0.42, 0);
  mb.lathe(prof, mb.lod ? 7 : 12, { capTop: true, capBottom: true });
  if (!mb.lod) {
    mb.col(C.steelDark, MAT.METAL);
    for (const y of [0.12, 0.72]) mb.push(0, y, 0).lathe([[0.3, 0], [0.31, 0.04]], 12).pop();
  }
  if (v === 1) mb.pop().pop();
}

function cart(mb, seed) {
  mb.col(C.wood, MAT.WOOD).vary(0.12);
  mb.push(0, 0.75, 0, 0.1, 0, 0.05).box(1.3, 0.12, 2.3).pop();
  for (const x of [-0.62, 0.62]) mb.push(x, 0.95, 0, 0.1, 0, 0.05).box(0.06, 0.35, 2.3).pop();
  mb.vary(0);
  mb.col(C.woodDark, MAT.WOOD);
  for (const x of [-0.72, 0.72]) {
    const broken = x > 0 && (seed & 1);
    mb.push(x, broken ? 0.4 : 0.6, -0.2, 0, Math.PI / 2, broken ? 1.2 : 0).push(0, 0, 0, Math.PI / 2, 0, 0);
    mb.lathe([[0.62, -0.04], [0.62, 0.04]], mb.lod ? 8 : 14);
    if (!mb.lod) for (let k = 0; k < 6; k++) mb.push(0, 0, 0, 0, (k / 6) * Math.PI * 2, 0).push(0, 0, 0.3).box(0.04, 0.04, 0.6).pop().pop();
    mb.pop().pop();
  }
  mb.cylBetween([-0.3, 0.7, 1.1], [-0.35, 0.1, 2.6], 0.04, 0.035, 5);
  mb.cylBetween([0.3, 0.7, 1.1], [0.4, 0.2, 2.5], 0.04, 0.035, 5);
}

function pole(mb, v, seed) {
  const h = v === 1 ? 3.5 : 7.5;
  mb.push(0, 0, 0, v === 1 ? 0.35 : (rnd(seed, 1) - 0.5) * 0.08, 0, v === 1 ? 0.2 : 0);
  mb.col(C.woodDark, MAT.WOOD).cyl(0.11, 0.08, h, mb.lod ? 5 : 7, { bottom: false });
  if (v !== 1) {
    mb.push(0, h - 0.5, 0).box(1.4, 0.1, 0.1).pop();
    if (!mb.lod) {
      mb.col(C.lens, MAT.GLASS);
      for (const x of [-0.6, -0.2, 0.2, 0.6]) mb.push(x, h - 0.38, 0).cyl(0.04, 0.03, 0.12, 5).pop();
    }
  } else {
    mb.col(C.plank, MAT.WOOD).push(0, h, 0).cyl(0.08, 0.02, 0.3, 4, { caps: false }).pop();
  }
  mb.pop();
}

function sandbagPile(mb, seed) {
  mb.col(C.sandbagDark, MAT.CLOTH).vary(0.14).jitter(0.03, 5, seed & 255);
  const n = mb.lod ? 4 : 9;
  for (let i = 0; i < n; i++) {
    const a = rnd(seed, i) * Math.PI * 2, r = rnd(seed, 50 + i) * 0.9;
    const y = 0.12 + (i > 5 ? 0.2 : 0);
    mb.push(Math.cos(a) * r, y, Math.sin(a) * r, 0, rnd(seed, 90 + i) * 3, (rnd(seed, 95 + i) - 0.5) * 0.4).sphere(0.32, 0.12, 0.2, 6, 4).pop();
  }
  mb.noJitter().vary(0);
}

function stake(mb, seed) {
  // knife-rest wire obstacle: a long rail on two X-frames
  mb.col(mix(C.wood, C.woodDark, 0.4), MAT.WOOD);
  for (const x of [-0.8, 0.8]) {
    mb.cylBetween([x, 0, -0.45], [x, 0.9, 0.35], 0.035, 0.03, 4);
    mb.cylBetween([x, 0, 0.45], [x, 0.9, -0.35], 0.035, 0.03, 4);
  }
  mb.cylBetween([-1.0, 0.62, 0], [1.0, 0.62, 0], 0.035, 0.035, 4);
  if (!mb.lod) {
    mb.col(C.wire, MAT.METAL);
    for (let k = 0; k < 3; k++) {
      const y = 0.4 + k * 0.28;
      mb.tube([[-0.8, y, 0], [0, y - 0.15 - rnd(seed, k) * 0.2, 0.05], [0.8, y, 0]], 0.006, 3);
    }
  }
}

function remains(mb, seed) {
  mb.col(C.rags, MAT.CLOTH).jitter(0.02, 6, seed & 255);
  mb.push(0, 0.03, 0, 0, rnd(seed, 1) * 3, 0).box(0.7, 0.05, 1.1).pop();
  mb.noJitter();
  mb.col(C.boneDark, MAT.BONE);
  mb.push(0.15, 0.08, 0.35).sphere(0.1, 0.09, 0.11, 7, 5).pop();
  if (!mb.lod) {
    mb.col(C.bone, MAT.BONE);
    mb.cylBetween([-0.3, 0.04, -0.1], [0.2, 0.05, -0.35], 0.025, 0.02, 4);
    mb.cylBetween([-0.2, 0.04, 0.2], [0.35, 0.04, 0.0], 0.022, 0.02, 4);
    mb.col(C.rust, MAT.METAL).push(-0.3, 0.1, 0.35, 0.6, 0, 0.3).lathe([[0.14, 0], [0.13, 0.03], [0.1, 0.08], [0.0, 0.1]], 8).pop();
  }
}

function helmetCross(mb, seed) {
  // rifle bayonet-down in the earth with a helmet on the butt: battlefield grave
  mb.col(C.soil, MAT.SOIL).push(0, 0, 0).sphere(0.35, 0.1, 0.35, 7, 4, { hemi: 1 }).pop();
  mb.push(0, 0, 0, (rnd(seed, 1) - 0.5) * 0.2, rnd(seed, 2) * 3, (rnd(seed, 3) - 0.5) * 0.2);
  mb.col(C.wood, MAT.WOOD).push(0, 0.55, 0).box(0.045, 0.75, 0.06).pop();
  mb.col(C.steelDark, MAT.DARKMETAL).cylBetween([0, 0.1, 0], [0, 0.32, 0], 0.012, 0.012, 5);
  mb.col(C.steelDark, MAT.METAL).push(0, 0.92, 0.0).lathe([[0.15, -0.02], [0.14, 0.02], [0.12, 0.08], [0.07, 0.14], [0, 0.155]], mb.lod ? 8 : 12, { sz: 1.1 }).pop();
  mb.pop();
}

function growth(mb, v, seed) {
  mb.jitter(0.06, 3.5, seed & 1023);
  mb.col(mix(C.fleshDark, C.skinBruise, 0.4), MAT.FLESH).push(0, 0.1, 0).sphere(0.9, 0.55, 0.8, mb.lod ? 7 : 11, mb.lod ? 5 : 7, { hemi: 1 }).pop();
  const n = mb.lod ? 3 : 7;
  for (let i = 0; i < n; i++) {
    const a = rnd(seed, i) * Math.PI * 2, r = 0.3 + rnd(seed, 10 + i) * 0.5;
    const s = 0.15 + rnd(seed, 20 + i) * 0.25;
    mb.col(i % 2 ? C.flesh : C.skinBruise, MAT.FLESH).push(Math.cos(a) * r, 0.35 + rnd(seed, 30 + i) * 0.3, Math.sin(a) * r).sphere(s, s * 1.1, s, 7, 5).pop();
  }
  mb.noJitter();
  if (!mb.lod) {
    mb.col(C.pus, MAT.FLESH);
    for (let i = 0; i < 5; i++) {
      const a = rnd(seed, 40 + i) * Math.PI * 2;
      mb.push(Math.cos(a) * 0.55, 0.35 + rnd(seed, 50 + i) * 0.2, Math.sin(a) * 0.5).sphere(0.07, 0.07, 0.07, 6, 4).pop();
    }
    if (v === 2) {
      mb.col(C.fleshDark, MAT.FLESH);
      for (let i = 0; i < 3; i++) {
        const a = rnd(seed, 60 + i) * Math.PI * 2;
        mb.tube([[Math.cos(a) * 0.4, 0.3, Math.sin(a) * 0.4], [Math.cos(a) * 1.0, 0.5 + i * 0.2, Math.sin(a) * 1.0], [Math.cos(a) * 1.4, 0.1, Math.sin(a) * 1.3]], [0.08, 0.05, 0.01], 5);
      }
    }
  }
}

function boneSpike(mb, seed) {
  mb.col(C.soil, MAT.SOIL).jitter(0.05, 3, seed & 511).push(0, 0, 0).sphere(0.7, 0.2, 0.7, 8, 4, { hemi: 1 }).pop().noJitter();
  mb.col(C.bone, MAT.BONE);
  const n = mb.lod ? 2 : 4;
  for (let i = 0; i < n; i++) {
    const a = rnd(seed, i) * Math.PI * 2;
    const h = 1.5 + rnd(seed, 10 + i) * 1.8;
    const bx = Math.cos(a) * 0.25, bz = Math.sin(a) * 0.25;
    mb.tube([[bx, 0, bz], [bx * 1.6, h * 0.5, bz * 1.6], [bx * 2.4 + 0.1, h, bz * 2.4]], [0.12, 0.07, 0.01], mb.lod ? 4 : 6);
  }
  mb.col(C.boneDark, MAT.BONE).push(0.05, 1.2, 0.1).sphere(0.11, 0.1, 0.12, 7, 5).pop();
}

function rock(mb, v, seed) {
  mb.col(v === 1 ? C.stoneDark : C.stone, MAT.STONE).vary(0.08).jitter(0.25, 1.1, seed & 1023);
  mb.push(0, 0.2, 0).sphere(1.0, 0.7 + rnd(seed, 1) * 0.4, 0.9, mb.lod ? 7 : 10, mb.lod ? 5 : 7).pop();
  mb.noJitter().vary(0);
}

function shrub(mb, seed) {
  mb.col(mix(C.dryGrass, C.treeBark, 0.5), MAT.WOOD);
  const n = mb.lod ? 5 : 11;
  for (let i = 0; i < n; i++) {
    const a = rnd(seed, i) * Math.PI * 2, l = 0.5 + rnd(seed, 20 + i) * 0.7;
    mb.tube([[0, 0, 0], [Math.cos(a) * l * 0.4, l * 0.6, Math.sin(a) * l * 0.4], [Math.cos(a) * l * 0.8, l, Math.sin(a) * l * 0.8]], [0.025, 0.012, 0.002], 3);
  }
  mb.col(C.dryGrass, MAT.CLOTH).jitter(0.06, 4, seed & 255).push(0, 0.05, 0).sphere(0.4, 0.18, 0.4, 6, 4, { hemi: 1 }).pop().noJitter();
}

function grassTuft(mb, seed) {
  mb.col(C.dryGrass, MAT.CLOTH);
  const n = mb.lod ? 5 : 9;
  for (let i = 0; i < n; i++) {
    const a = rnd(seed, i) * Math.PI * 2, r = rnd(seed, 30 + i) * 0.18;
    const h = 0.25 + rnd(seed, 40 + i) * 0.35;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const tx = bx + Math.cos(a) * h * 0.4, tz = bz + Math.sin(a) * h * 0.4;
    const w = 0.025;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    mb.face([[bx - px, 0, bz - pz], [bx + px, 0, bz + pz], [tx, h, tz]]);
    mb.face([[tx, h, tz], [bx + px, 0, bz + pz], [bx - px, 0, bz - pz]]);
  }
}

// ------------------------------------------------------------------ ground clutter (render-only)

function grassClump(mb, seed, big) {
  // single-sided blades (rendered double-sided); normals are bent upward afterwards so the clump
  // lights like the ground it grows from instead of reading as black spikes
  const n = mb.lod ? (big ? 9 : 6) : big ? 22 : 13;
  for (let i = 0; i < n; i++) {
    const a = rnd(seed, i) * Math.PI * 2, r = rnd(seed, 30 + i) * (big ? 0.4 : 0.24);
    const h = (big ? 0.32 : 0.18) + rnd(seed, 40 + i) * (big ? 0.42 : 0.26);
    const bend = 0.3 + rnd(seed, 50 + i) * 0.55;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const tx = bx + Math.cos(a) * h * bend, tz = bz + Math.sin(a) * h * bend;
    const w = 0.035 + rnd(seed, 60 + i) * 0.02;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    const tone = rnd(seed, 70 + i);
    mb.col(tone < 0.35 ? mix(C.dryGrass, C.soil, 0.55) : tone < 0.8 ? mix(C.dryGrass, C.soil, 0.25) : C.dryGrass, MAT.CLOTH);
    mb.face([[bx - px, 0, bz - pz], [bx + px, 0, bz + pz], [tx, h, tz]]);
  }
}

/** Bend all normals of a finished mesh toward +Y (foliage lighting). */
function upNormals(mesh, k) {
  const i8 = new Int8Array(mesh.vertices);
  for (let o = 0; o < i8.length; o += 24) {
    let x = i8[o + 12] / 127, y = i8[o + 13] / 127, z = i8[o + 14] / 127;
    if (y < 0) { x = -x; y = -y; z = -z; }
    x *= 1 - k; z *= 1 - k; y = y * (1 - k) + k;
    const l = Math.hypot(x, y, z) || 1;
    i8[o + 12] = Math.round((x / l) * 127); i8[o + 13] = Math.round((y / l) * 127); i8[o + 14] = Math.round((z / l) * 127);
  }
  return mesh;
}

function pebbles(mb, seed) {
  mb.vary(0.2);
  const n = mb.lod ? 3 : 7;
  for (let i = 0; i < n; i++) {
    const a = rnd(seed, i) * Math.PI * 2, r = rnd(seed, 10 + i) * 0.55;
    const s = 0.05 + rnd(seed, 20 + i) * 0.11;
    mb.col(i % 3 === 0 ? C.brick : i % 3 === 1 ? C.stoneDark : C.stone, MAT.STONE);
    mb.push(Math.cos(a) * r, s * 0.35, Math.sin(a) * r, rnd(seed, 30 + i), rnd(seed, 40 + i) * 3, 0).box(s * 1.6, s, s * 1.2, { taper: [0.8, 0.85] }).pop();
  }
  mb.vary(0);
}

function planks(mb, seed) {
  mb.col(mix(C.woodDark, C.char, 0.3), MAT.WOOD).vary(0.15);
  const n = mb.lod ? 2 : 4;
  for (let i = 0; i < n; i++) {
    const a = rnd(seed, i) * Math.PI;
    mb.push((rnd(seed, 10 + i) - 0.5) * 0.8, 0.04 + i * 0.03, (rnd(seed, 20 + i) - 0.5) * 0.8, 0, a, (rnd(seed, 30 + i) - 0.5) * 0.2)
      .box(0.14, 0.035, 0.7 + rnd(seed, 40 + i) * 0.6).pop();
  }
  mb.vary(0);
}

function shellCasing(mb, seed) {
  const lie = rnd(seed, 1) < 0.6;
  mb.push(0, lie ? 0.07 : 0, 0, lie ? Math.PI / 2 : 0.15, rnd(seed, 2) * 3, 0);
  mb.col(mix(C.brass, C.rust, 0.55), MAT.METAL).lathe([[0.075, 0], [0.075, 0.34], [0.07, 0.36]], mb.lod ? 6 : 10, { capBottom: true });
  mb.pop();
  if (!mb.lod) mb.col(C.soil, MAT.SOIL).push(0, 0, 0).sphere(0.22, 0.05, 0.22, 6, 3, { hemi: 1 }).pop();
}

function weeds(mb, seed) {
  mb.col(mix(C.dryGrass, C.treeBarkDark, 0.55), MAT.WOOD);
  const n = mb.lod ? 3 : 5;
  for (let i = 0; i < n; i++) {
    const a = rnd(seed, i) * Math.PI * 2, l = 0.55 + rnd(seed, 10 + i) * 0.6;
    const top = [Math.cos(a) * l * 0.25, l, Math.sin(a) * l * 0.25];
    mb.tube([[0, 0, 0], [top[0] * 0.5, l * 0.55, top[2] * 0.5], top], [0.014, 0.009, 0.004], 3);
    if (!mb.lod && i < 3) mb.col(C.treeBarkDark, MAT.WOOD).push(top[0], top[1], top[2]).box(0.05, 0.08, 0.05).pop().col(mix(C.dryGrass, C.treeBarkDark, 0.55), MAT.WOOD);
  }
}

export const CLUTTER_MODELS = {
  grass_s: (lod) => { const mb = new MeshBuilder({ lod, seed: 3 }); grassClump(mb, 17, false); return upNormals(mb.finish(), 0.75); },
  grass_b: (lod) => { const mb = new MeshBuilder({ lod, seed: 4 }); grassClump(mb, 23, true); return upNormals(mb.finish(), 0.75); },
  pebbles: (lod) => { const mb = new MeshBuilder({ lod, seed: 5 }); pebbles(mb, 31); return mb.finish(); },
  planks: (lod) => { const mb = new MeshBuilder({ lod, seed: 6 }); planks(mb, 37); return mb.finish(); },
  shell: (lod) => { const mb = new MeshBuilder({ lod, seed: 7 }); shellCasing(mb, 41); return mb.finish(); },
  weeds: (lod) => { const mb = new MeshBuilder({ lod, seed: 8 }); weeds(mb, 43); return upNormals(mb.finish(), 0.5); },
};

/** Prop model catalogue: key -> builder(lod). Variants are separate keys. */
export const PROP_MODELS = {};
for (let v = 0; v < 4; v++) PROP_MODELS['tree_' + v] = (lod) => { const mb = new MeshBuilder({ lod, seed: 101 + v }); deadTree(mb, v, 1000 + v * 77); return mb.finish(); };
PROP_MODELS.tree_4 = (lod) => { const mb = new MeshBuilder({ lod, seed: 105 }); deadTree(mb, 0, 4242); return mb.finish(); };
PROP_MODELS.stump_0 = (lod) => { const mb = new MeshBuilder({ lod }); stump(mb, 55); return mb.finish(); };
for (let v = 0; v < 3; v++) PROP_MODELS['cross_' + v] = (lod) => { const mb = new MeshBuilder({ lod, seed: 7 + v }); graveCross(mb, v, 300 + v); return mb.finish(); };
for (let v = 0; v < 3; v++) PROP_MODELS['rubble_' + v] = (lod) => { const mb = new MeshBuilder({ lod, seed: 9 + v }); rubble(mb, v % 2, 500 + v * 13); return mb.finish(); };
PROP_MODELS.beam_0 = (lod) => { const mb = new MeshBuilder({ lod }); beam(mb, 77); return mb.finish(); };
for (let v = 0; v < 2; v++) PROP_MODELS['crate_' + v] = (lod) => { const mb = new MeshBuilder({ lod, seed: 3 + v }); crate(mb, v); return mb.finish(); };
for (let v = 0; v < 3; v++) PROP_MODELS['barrel_' + v] = (lod) => { const mb = new MeshBuilder({ lod }); barrel(mb, v); return mb.finish(); };
PROP_MODELS.cart_0 = (lod) => { const mb = new MeshBuilder({ lod, seed: 4 }); cart(mb, 3); return mb.finish(); };
for (let v = 0; v < 2; v++) PROP_MODELS['pole_' + v] = (lod) => { const mb = new MeshBuilder({ lod }); pole(mb, v, 9 + v); return mb.finish(); };
PROP_MODELS.sandbag_pile_0 = (lod) => { const mb = new MeshBuilder({ lod, seed: 8 }); sandbagPile(mb, 88); return mb.finish(); };
PROP_MODELS.stake_0 = (lod) => { const mb = new MeshBuilder({ lod }); stake(mb, 5); return mb.finish(); };
PROP_MODELS.remains_0 = (lod) => { const mb = new MeshBuilder({ lod }); remains(mb, 12); return mb.finish(); };
PROP_MODELS.helmet_cross_0 = (lod) => { const mb = new MeshBuilder({ lod }); helmetCross(mb, 21); return mb.finish(); };
for (let v = 0; v < 3; v++) PROP_MODELS['growth_' + v] = (lod) => { const mb = new MeshBuilder({ lod, seed: 60 + v }); growth(mb, v, 900 + v * 31); return mb.finish(); };
PROP_MODELS.bone_spike_0 = (lod) => { const mb = new MeshBuilder({ lod }); boneSpike(mb, 33); return mb.finish(); };
for (let v = 0; v < 3; v++) PROP_MODELS['rock_' + v] = (lod) => { const mb = new MeshBuilder({ lod, seed: 40 + v }); rock(mb, v % 2, 700 + v * 19); return mb.finish(); };
PROP_MODELS.shrub_0 = (lod) => { const mb = new MeshBuilder({ lod }); shrub(mb, 44); return upNormals(mb.finish(), 0.45); };
PROP_MODELS.shrub_1 = (lod) => { const mb = new MeshBuilder({ lod }); shrub(mb, 45); return upNormals(mb.finish(), 0.45); };
PROP_MODELS.grass_0 = (lod) => { const mb = new MeshBuilder({ lod }); grassTuft(mb, 7); return upNormals(mb.finish(), 0.75); };
PROP_MODELS.grass_1 = (lod) => { const mb = new MeshBuilder({ lod }); grassTuft(mb, 8); return upNormals(mb.finish(), 0.75); };

/** Map a world prop record to a model key. */
export function propModelKey(p) {
  switch (p.type) {
    case 'tree': return 'tree_' + (p.v === 3 ? 3 : (p.seed % 5 === 4 ? 4 : p.v));
    case 'stump': return 'stump_0';
    case 'cross': return 'cross_' + (p.v % 3);
    case 'rubble': return 'rubble_' + (p.v % 3);
    case 'beam': return 'beam_0';
    case 'crate': return 'crate_' + (p.v % 2);
    case 'barrel': return 'barrel_' + (p.v % 3);
    case 'cart': return 'cart_0';
    case 'pole': return 'pole_' + (p.v % 2);
    case 'sandbag_pile': return 'sandbag_pile_0';
    case 'stake': return 'stake_0';
    case 'remains': return 'remains_0';
    case 'helmet_cross': return 'helmet_cross_0';
    case 'growth': return 'growth_' + (p.v % 3);
    case 'bone_spike': return 'bone_spike_0';
    case 'rock': return 'rock_' + (p.v % 3);
    case 'shrub': return 'shrub_' + (p.v % 2);
    default: return null;
  }
}

