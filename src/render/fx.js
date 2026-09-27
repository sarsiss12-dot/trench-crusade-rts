// VFX: pooled CPU particles (ring buffer, bounded) + pooled ground decals (bounded).
// Driven only by fog-filtered simulation events and visible entities -> no information leaks.
import { createBuffer, createVAO, drawArrays, drawElements } from './gl.js';
import { createVisualRng } from '../core/rng.js';
import { WEAPONS } from '../data/weapons.js';
import { STRUCTURES } from '../data/structures.js';
import { ABILITIES } from '../data/abilities.js';
import { isSquadVisibleTo, isStructureVisibleTo, isPointVisibleTo, effectVisibleTo, isSoldierVisibleTo } from '../sim/perception.js';
import { groundHeightAt } from '../world/ground.js';
import { planDeath, createPoolSet, GORE_QUALITY } from './gore.js';

const SHAPE = { SOFT: 0, GLOW: 1, STREAK: 2, CHUNK: 3, SPECK: 4 };
const DSHAPE = { SHADOW: 0, RING: 1, BLOOD: 2, SCORCH: 3, CRATER: 4, MARKER: 5, LIGHT: 6, ATTACK: 7, AREA: 8, BOX: 9, SHOCK: 10, TIMER: 11, SPRAY: 12 };
// blood palettes: New Antioch red; Black Grail ichor (dark, green-black, diseased) — a visual
// abstraction, no invented canon biology
const RED = [0.11, 0.008, 0.006], RED_DARK = [0.055, 0.004, 0.003];
const ICHOR = [0.028, 0.032, 0.008], ICHOR_DARK = [0.014, 0.016, 0.004];

// Fill-rate guard for mobile GPUs. Smoke is the one effect that can cover the screen many times
// over (a barrage stacks dozens of 10-20 m billboards), so per quality: a size cap, a lifetime cap
// for drifting smoke, and a screen-coverage budget — above it, big smoke ages faster until the
// estimated coverage is back under budget.
const SMOKE_LIMITS = {
  low: { size: 4, life: 4, screens: 2.5 },
  balanced: { size: 6.5, life: 7, screens: 4 },
  high: { size: 10, life: 11, screens: 7 },
};

export function createFx(gl, particleProgram, decalProgram, opts) {
  const vr = createVisualRng(0xfeed);
  const cap = opts.particles;
  const LIM = SMOKE_LIMITS[opts.quality] || SMOKE_LIMITS.balanced;
  let smokeAging = 1; // > 1 while the coverage budget is exceeded
  // particle SoA
  const P = {
    x: new Float32Array(cap), y: new Float32Array(cap), z: new Float32Array(cap),
    vx: new Float32Array(cap), vy: new Float32Array(cap), vz: new Float32Array(cap),
    size: new Float32Array(cap), grow: new Float32Array(cap),
    r: new Float32Array(cap), g: new Float32Array(cap), b: new Float32Array(cap), a: new Float32Array(cap),
    age: new Float32Array(cap), life: new Float32Array(cap),
    shape: new Uint8Array(cap), add: new Uint8Array(cap), rot: new Float32Array(cap), rotV: new Float32Array(cap),
    drag: new Float32Array(cap), grav: new Float32Array(cap), stretch: new Float32Array(cap), seed: new Float32Array(cap),
    fadeIn: new Float32Array(cap),
  };
  let head = 0;
  let alive = 0;
  const instA = new Float32Array(cap * 16), instB = new Float32Array(cap * 16);
  let nA = 0, nB = 0;
  const quad = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
  const pBufA = createBuffer(gl, gl.ARRAY_BUFFER, instA.byteLength, gl.DYNAMIC_DRAW);
  const pBufB = createBuffer(gl, gl.ARRAY_BUFFER, instB.byteLength, gl.DYNAMIC_DRAW);
  const pAttribs = (buf) => ({
    buffer: buf, stride: 64, attribs: [
      { loc: 4, size: 4, type: gl.FLOAT, offset: 0, divisor: 1 },
      { loc: 5, size: 4, type: gl.FLOAT, offset: 16, divisor: 1 },
      { loc: 6, size: 4, type: gl.FLOAT, offset: 32, divisor: 1 },
      { loc: 7, size: 4, type: gl.FLOAT, offset: 48, divisor: 1 },
    ],
  });
  const quadLayout = { buffer: quad, stride: 8, attribs: [{ loc: 0, size: 2, type: gl.FLOAT, offset: 0 }] };
  const vaoA = createVAO(gl, [quadLayout, pAttribs(pBufA)]);
  const vaoB = createVAO(gl, [quadLayout, pAttribs(pBufB)]);

  // decals
  const dcap = opts.decals;
  const D = [];
  let dhead = 0;
  const grid = [];
  const N = 4;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) grid.push(-1 + (2 * i) / N, -1 + (2 * j) / N);
  const gidx = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    gidx.push(a, c, b, b, c, d);
  }
  const gridBuf = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(grid));
  const gridIdx = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(gidx));
  const DMAX = dcap + 900; // + per-frame blob shadows / rings
  const dInst = new Float32Array(DMAX * 16);
  const dInstAdd = new Float32Array(256 * 16);
  const dBuf = createBuffer(gl, gl.ARRAY_BUFFER, dInst.byteLength, gl.DYNAMIC_DRAW);
  const dBufAdd = createBuffer(gl, gl.ARRAY_BUFFER, dInstAdd.byteLength, gl.DYNAMIC_DRAW);
  const gridLayout = { buffer: gridBuf, stride: 8, attribs: [{ loc: 0, size: 2, type: gl.FLOAT, offset: 0 }] };
  const dVao = createVAO(gl, [gridLayout, pAttribs(dBuf)], gridIdx);
  const dVaoAdd = createVAO(gl, [gridLayout, pAttribs(dBufAdd)], gridIdx);
  let dn = 0, dnAdd = 0;
  const pending = []; // delayed impacts
  const smokers = [];
  let sim = null, viewer = 'new_antioch', time = 0;
  const renderer = opts.renderer;
  const stats = { particles: 0, decals: 0, additive: 0, fires: 0, pools: 0 };
  const goreQ = GORE_QUALITY[opts.quality] ? opts.quality : 'balanced';
  const GQ = GORE_QUALITY[goreQ];
  const pools = createPoolSet(goreQ); // bounded blood pools / corpse stains
  const structStage = new Map(); // structure id -> last damage stage shown (0 healthy, 1 damaged, 2 critical)

  function ground(x, z) {
    if (opts.renderer && opts.renderer.viewGrid) return opts.renderer.groundAt(x, z); // what the viewer knows
    return sim ? groundHeightAt(sim.world, sim.rt.structGrid, x, z) : 0;
  }

  function spawn(o) {
    const i = head;
    head = (head + 1) % cap;
    P.x[i] = o.x; P.y[i] = o.y; P.z[i] = o.z;
    P.vx[i] = o.vx || 0; P.vy[i] = o.vy || 0; P.vz[i] = o.vz || 0;
    P.size[i] = o.size; P.grow[i] = o.grow || 0;
    P.r[i] = o.r; P.g[i] = o.g; P.b[i] = o.b; P.a[i] = o.a;
    P.age[i] = 0;
    // drifting smoke / dust is shortened on weaker presets (additive flashes are always brief)
    P.life[i] = !o.add && (o.shape || 0) === SHAPE.SOFT ? Math.min(o.life, LIM.life) : o.life;
    P.shape[i] = o.shape || 0; P.add[i] = o.add ? 1 : 0;
    P.rot[i] = o.rot !== undefined ? o.rot : vr.next() * 6.28; P.rotV[i] = o.rotV || 0;
    P.drag[i] = o.drag || 0; P.grav[i] = o.grav || 0; P.stretch[i] = o.stretch || 0;
    P.seed[i] = vr.next() * 10; P.fadeIn[i] = o.fadeIn || 0;
  }

  function decal(o) {
    const d = D.length < dcap ? {} : D[dhead];
    if (D.length < dcap) D.push(d); else dhead = (dhead + 1) % dcap;
    d.x = o.x; d.z = o.z; d.y = o.y !== undefined ? o.y : ground(o.x, o.z);
    d.size = o.size; d.grow = o.grow || 0; d.maxSize = o.maxSize || o.size;
    d.rot = o.rot !== undefined ? o.rot : vr.next() * 6.28;
    d.r = o.r; d.g = o.g; d.b = o.b; d.a = o.a;
    d.shape = o.shape; d.age = 0; d.life = o.life || -1; d.add = !!o.add; d.aspect = o.aspect || 1;
    d.p1 = o.p1 || 0; d.p2 = o.p2 || 0;
  }

  // ------------------------------------------------------------------ composed effects

  function muzzleFlash(x, y, z, dx, dz, kind) {
    const big = kind === 'mg' || kind === 'mg_heavy';
    const bio = kind === 'rifle_bio';
    const k = kind === 'shotgun' ? 1.3 : big ? 1.15 : 1;
    const cr = bio ? 1.4 : 4.2, cg = bio ? 2.6 : 2.6, cb = bio ? 0.6 : 1.1;
    spawn({ x, y, z, size: 0.24 * k + vr.next() * 0.1, r: cr, g: cg, b: cb, a: 1, life: 0.06, shape: SHAPE.GLOW, add: true });
    spawn({ x: x + dx * 0.3, y, z: z + dz * 0.3, vx: dx * 3, vz: dz * 3, size: 0.2 * k, r: cr, g: cg * 0.8, b: cb * 0.6, a: 0.9, life: 0.05, shape: SHAPE.STREAK, add: true, stretch: 0.7 });
    spawn({ x: x + dx * 0.2, y: y + 0.05, z: z + dz * 0.2, vx: dx * 0.8 + (vr.next() - 0.5) * 0.3, vy: 0.4, vz: dz * 0.8, size: 0.18, grow: 0.9, r: 0.28, g: 0.27, b: 0.25, a: 0.35, life: 1.3, shape: SHAPE.SOFT, drag: 1.5 });
    decal({ x, z, size: 1.9 * k, r: 1.1, g: 0.62, b: 0.26, a: 0.35, shape: DSHAPE.LIGHT, life: 0.06, add: true });
  }

  function tracer(x0, y0, z0, x1, y1, z1, kind) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const d = Math.hypot(dx, dy, dz) || 1;
    const speed = kind === 'pellet' ? 180 : 300;
    const bio = kind === 'bio';
    const r = bio ? 0.8 : 2.4, g = bio ? 1.6 : 1.6, b = bio ? 0.4 : 0.6;
    const life = d / speed;
    spawn({ x: x0, y: y0, z: z0, vx: (dx / d) * speed, vy: (dy / d) * speed, vz: (dz / d) * speed, size: kind === 'mg' ? 0.035 : 0.025, r, g, b, a: kind === 'pellet' ? 0.6 : 0.85, life, shape: SHAPE.STREAK, add: true, stretch: Math.min(d * 0.8, kind === 'mg' ? 7 : 5) });
    return life;
  }

  function impact(x, z, kind, dirx, dirz, big) {
    const y = ground(x, z) + 0.05;
    const n = big ? 2 : 1;
    switch (kind) {
      case 'ground':
        for (let i = 0; i < 3 * n; i++) spawn({ x, y, z, vx: (vr.next() - 0.5) * 1.2, vy: 1.2 + vr.next() * 1.6, vz: (vr.next() - 0.5) * 1.2, size: 0.2 + vr.next() * 0.2, grow: 0.8, r: 0.24, g: 0.19, b: 0.14, a: 0.55, life: 0.9 + vr.next() * 0.5, shape: SHAPE.SOFT, drag: 2.2, grav: 1.5 });
        for (let i = 0; i < 3 * n; i++) spawn({ x, y, z, vx: (vr.next() - 0.5) * 2.4, vy: 2 + vr.next() * 2.5, vz: (vr.next() - 0.5) * 2.4, size: 0.04 + vr.next() * 0.04, r: 0.07, g: 0.055, b: 0.04, a: 1, life: 0.8, shape: SHAPE.CHUNK, grav: 9.8 });
        break;
      case 'water':
        for (let i = 0; i < 6; i++) spawn({ x, y: y + 0.1, z, vx: (vr.next() - 0.5) * 1.2, vy: 2 + vr.next() * 2.4, vz: (vr.next() - 0.5) * 1.2, size: 0.06, r: 0.45, g: 0.46, b: 0.42, a: 0.8, life: 0.7, shape: SHAPE.CHUNK, grav: 9.8 });
        spawn({ x, y: y + 0.05, z, size: 0.3, grow: 1.4, r: 0.4, g: 0.42, b: 0.4, a: 0.35, life: 0.6, shape: SHAPE.SOFT });
        break;
      case 'flesh':
      case 'organic':
        bloodHit(x, y, z, dirx, dirz, kind === 'organic', big);
        break;
      case 'metal':
        for (let i = 0; i < 5 * n; i++) spawn({ x, y: y + 1.0, z, vx: (vr.next() - 0.5) * 5 - dirx * 2, vy: 1 + vr.next() * 3, vz: (vr.next() - 0.5) * 5 - dirz * 2, size: 0.02, r: 4, g: 2.2, b: 0.8, a: 1, life: 0.3 + vr.next() * 0.2, shape: SHAPE.STREAK, add: true, grav: 9.8, stretch: 0.25 });
        break;
      case 'wall':
        for (let i = 0; i < 4 * n; i++) spawn({ x, y: y + 0.8, z, vx: (vr.next() - 0.5) * 1.6 - dirx, vy: 0.6 + vr.next() * 1.5, vz: (vr.next() - 0.5) * 1.6 - dirz, size: 0.22, grow: 0.9, r: 0.4, g: 0.37, b: 0.32, a: 0.45, life: 1.1, shape: SHAPE.SOFT, drag: 2, grav: 1 });
        for (let i = 0; i < 3 * n; i++) spawn({ x, y: y + 0.8, z, vx: (vr.next() - 0.5) * 3, vy: 1 + vr.next() * 2, vz: (vr.next() - 0.5) * 3, size: 0.05, r: 0.2, g: 0.18, b: 0.15, a: 1, life: 0.9, shape: SHAPE.CHUNK, grav: 9.8 });
        break;
      default: break;
    }
  }

  /**
   * Blast. size: 'heavy' (artillery: flash, ground burst, debris, shock ring, bounded smoke column),
   * 'light' (mortar: sharp, small, no column), 'detonation' (ammunition dump: heavy + secondary pops).
   */
  function explosion(x, z, heavy, size) {
    const y = ground(x, z);
    const kind = size || (heavy ? 'heavy' : 'light');
    const k = kind === 'light' ? 0.5 : kind === 'detonation' ? 1.15 : 1;
    // flash + light on the ground
    spawn({ x, y: y + 1.4 * k, z, size: 8 * k, r: 6, g: 3.6, b: 1.5, a: 1, life: 0.12, shape: SHAPE.GLOW, add: true });
    spawn({ x, y: y + 0.6, z, size: 3.5 * k, r: 5, g: 2.4, b: 0.7, a: 1, life: 0.22, shape: SHAPE.GLOW, add: true });
    decal({ x, z, size: 26 * k, r: 2.6, g: 1.4, b: 0.5, a: 0.85, shape: DSHAPE.LIGHT, life: 0.28, add: true });
    // fireball
    for (let i = 0; i < 8 * k; i++) spawn({ x: x + (vr.next() - 0.5), y: y + 0.8, z: z + (vr.next() - 0.5), vx: (vr.next() - 0.5) * 6, vy: 3 + vr.next() * 5, vz: (vr.next() - 0.5) * 6, size: 1.3 * k, grow: 2.2, r: 3.4, g: 1.5, b: 0.4, a: 0.9, life: 0.3 + vr.next() * 0.25, shape: SHAPE.SOFT, add: true, drag: 3 });
    // ground burst: a cone of earth thrown up (dark clods + brown spray)
    const clods = Math.round((kind === 'light' ? 14 : 34) * k);
    for (let i = 0; i < clods; i++) {
      const a = vr.next() * 6.28, sp = (2 + vr.next() * 6) * k;
      spawn({ x, y: y + 0.3, z, vx: Math.cos(a) * sp, vy: (6 + vr.next() * 11) * Math.sqrt(k), vz: Math.sin(a) * sp, size: 0.06 + vr.next() * 0.14, r: 0.06, g: 0.047, b: 0.035, a: 1, life: 2 + vr.next(), shape: SHAPE.CHUNK, grav: 9.8, rotV: (vr.next() - 0.5) * 12 });
    }
    for (let i = 0; i < 12 * k; i++) {
      const a = vr.next() * 6.28;
      spawn({ x: x + Math.cos(a) * 0.6, y: y + 0.5, z: z + Math.sin(a) * 0.6, vx: Math.cos(a) * 2.2, vy: 5 + vr.next() * 7, vz: Math.sin(a) * 2.2, size: 0.9 * k, grow: 1.6, r: 0.22, g: 0.17, b: 0.12, a: 0.75, life: 1.3 + vr.next() * 0.6, shape: SHAPE.SOFT, drag: 1.6, grav: 4 });
    }
    // ground-hugging dust wave
    for (let i = 0; i < 16 * k; i++) {
      const a = vr.next() * 6.28, s2 = 5 + vr.next() * 8;
      spawn({ x, y: y + 0.3, z, vx: Math.cos(a) * s2, vy: 0.4 + vr.next(), vz: Math.sin(a) * s2, size: 1.2 * k, grow: 3, r: 0.25, g: 0.21, b: 0.17, a: 0.5, life: 1.6 + vr.next(), shape: SHAPE.SOFT, drag: 2.6 });
    }
    // hot debris streaks
    for (let i = 0; i < 8 * k; i++) spawn({ x, y: y + 0.6, z, vx: (vr.next() - 0.5) * 16, vy: 4 + vr.next() * 8, vz: (vr.next() - 0.5) * 16, size: 0.025, r: 4, g: 1.8, b: 0.5, a: 1, life: 0.6 + vr.next() * 0.5, shape: SHAPE.STREAK, add: true, grav: 9.8, stretch: 0.35 });
    // shock ring racing out over the ground
    decal({ x, z, size: 1.5, grow: 38 * k, maxSize: 11 * k, r: 0.5, g: 0.46, b: 0.4, a: 0.55, shape: DSHAPE.SHOCK, life: 0.4 });
    if (kind !== 'light') {
      // bounded smoke column (few big billboards; the smoke budget ages them when over coverage)
      for (let i = 0; i < 5 * k; i++) spawn({ x: x + (vr.next() - 0.5) * 2, y: y + 1 + i * 1.2, z: z + (vr.next() - 0.5) * 2, vx: (vr.next() - 0.5) * 0.6 + 0.3, vy: 1.4 + vr.next() * 1.4, vz: (vr.next() - 0.5) * 0.6, size: 2 * k, grow: 1.5, r: 0.11, g: 0.1, b: 0.09, a: 0.6, life: 7 + vr.next() * 4, shape: SHAPE.SOFT, drag: 0.5, fadeIn: 0.12 });
    }
    decal({ x, z, size: (kind === 'light' ? 2.2 : 4.4) * k + vr.next(), r: 0.02, g: 0.017, b: 0.013, a: 0.9, shape: DSHAPE.SCORCH });
    if (kind === 'light') decal({ x, z, size: 1.5, r: 0.03, g: 0.025, b: 0.02, a: 0.75, shape: DSHAPE.CRATER });
    if (kind === 'detonation') {
      // cook-off: delayed secondary pops and tracer sparks
      for (let i = 0; i < 4; i++) pending.push({ t: time + 0.25 + i * 0.35 + vr.next() * 0.2, x: x + (vr.next() - 0.5) * 6, z: z + (vr.next() - 0.5) * 6, kind: 'pop', dx: 0, dz: 0 });
    }
    if (renderer) renderer.shakeAt(x, z, kind === 'light' ? 0.35 : kind === 'detonation' ? 1.2 : 0.95);
    // nearby soldiers flinch / are knocked (presentation)
    const reach = 16 * k;
    if (renderer && renderer.units) for (const v of renderer.units.visuals.values()) {
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < reach) { v.hit = Math.max(v.hit, 1 - d / reach); v.hitSide = v.x > x ? 1 : -1; }
    }
  }

  function pop(x, z) {
    const y = ground(x, z);
    spawn({ x, y: y + 0.6, z, size: 2.4, r: 5, g: 2.6, b: 0.8, a: 1, life: 0.1, shape: SHAPE.GLOW, add: true });
    for (let i = 0; i < 6; i++) spawn({ x, y: y + 0.5, z, vx: (vr.next() - 0.5) * 10, vy: 3 + vr.next() * 6, vz: (vr.next() - 0.5) * 10, size: 0.02, r: 4, g: 2, b: 0.5, a: 1, life: 0.5, shape: SHAPE.STREAK, add: true, grav: 9.8, stretch: 0.3 });
    spawn({ x, y: y + 1, z, vy: 1.2, size: 1.4, grow: 1.2, r: 0.12, g: 0.11, b: 0.1, a: 0.5, life: 3, shape: SHAPE.SOFT, drag: 0.6 });
  }

  // ------------------------------------------------------------------ gore (presentation only)

  /** Impact mist + heavy droplets + a spray mark on the ground behind the victim. */
  function bloodHit(x, y, z, dirx, dirz, bio, big) {
    const C = bio ? ICHOR : RED, CD = bio ? ICHOR_DARK : RED_DARK;
    const n = Math.max(1, Math.round((big ? 7 : 4) * GQ.burst));
    spawn({ x, y: y + 1.15, z, vx: dirx * 1.4, vy: 0.3, vz: dirz * 1.4, size: 0.22, grow: 1.3, r: C[0] * 1.6, g: C[1] * 1.6, b: C[2] * 1.6, a: 0.42, life: 0.3, shape: SHAPE.SOFT });
    for (let i = 0; i < n; i++) spawn({ x, y: y + 1.1, z, vx: dirx * (1.8 + vr.next() * 2.2) + (vr.next() - 0.5) * 1.4, vy: 0.4 + vr.next() * 1.8, vz: dirz * (1.8 + vr.next() * 2.2) + (vr.next() - 0.5) * 1.4, size: 0.035 + vr.next() * 0.045, r: C[0], g: C[1], b: C[2], a: 1, life: 0.7, shape: SHAPE.CHUNK, grav: 9.8 });
    if (big) for (let i = 0; i < 3; i++) spawn({ x, y: y + 1.05, z, vx: dirx * 3 + (vr.next() - 0.5), vy: 1 + vr.next(), vz: dirz * 3 + (vr.next() - 0.5), size: 0.02, r: C[0] * 1.3, g: C[1], b: C[2], a: 0.9, life: 0.35, shape: SHAPE.STREAK, stretch: 0.3, grav: 6 });
    if (bio && vr.next() < 0.5) diseaseMotes(x, y + 1.1, z, 3);
    if (vr.next() < 0.55) decal({ x: x + dirx * (0.7 + vr.next() * 0.8), z: z + dirz * (0.7 + vr.next() * 0.8), size: 0.3 + vr.next() * 0.35, rot: Math.atan2(dirx, dirz), aspect: 1.6, r: CD[0], g: CD[1], b: CD[2], a: 0.85, shape: DSHAPE.SPRAY });
  }

  function diseaseMotes(x, y, z, n) {
    for (let i = 0; i < n; i++) spawn({ x: x + (vr.next() - 0.5) * 0.5, y: y + (vr.next() - 0.5) * 0.4, z: z + (vr.next() - 0.5) * 0.5, vx: (vr.next() - 0.5) * 0.6, vy: 0.2 + vr.next() * 0.4, vz: (vr.next() - 0.5) * 0.6, size: 0.05, grow: 0.2, r: 0.35, g: 0.42, b: 0.06, a: 0.55, life: 1.4, shape: SHAPE.SOFT, drag: 1 });
  }

  /**
   * A death the viewer saw: trauma from render/gore.js planDeath (cause / overkill / blast force;
   * hash of the soldier id, never the gameplay RNG). Limbs themselves are drawn by the unit
   * renderer; this layer adds the burst, fragments, spray and a bounded pool under the body.
   */
  function deathGore(ev) {
    const plan = planDeath(ev, goreQ);
    const bio = ev.faction === 'black_grail';
    const C = bio ? ICHOR : RED, CD = bio ? ICHOR_DARK : RED_DARK;
    const y = ground(ev.x, ev.z);
    const dx = ev.dx || 0, dz = ev.dz || 0;
    const disease = ev.cause === 'plague' || ev.cause === 'swarm';
    // corpse stain / pool (grows slowly under the body)
    pools.add(ev.x + dx * 0.4, ev.z + dz * 0.4, (disease ? 0.7 : 1.1) + (plan.lost ? 0.6 : 0) + vr.next() * 0.4, bio, 0.18 + vr.next() * 0.1, 160, vr.next() * 6.28);
    if (disease) {
      // sickness: dark vomit / ichor, motes and flies instead of a wound spray
      diseaseMotes(ev.x, y + 0.9, ev.z, 5);
      flyBurst(ev.x, ev.z, 6);
      return;
    }
    if (!plan.lost) {
      for (let i = 0; i < 3 * GQ.burst; i++) spawn({ x: ev.x, y: y + 1.0, z: ev.z, vx: dx * 1.5 + (vr.next() - 0.5), vy: 0.8 + vr.next(), vz: dz * 1.5 + (vr.next() - 0.5), size: 0.05, r: C[0], g: C[1], b: C[2], a: 1, life: 0.6, shape: SHAPE.CHUNK, grav: 9.8 });
      return;
    }
    // dismemberment: directional burst + fragments + long spray + second pool
    const cat = plan.kind === 'catastrophic';
    const n = Math.round((cat ? 30 : 14) * GQ.burst);
    const h = plan.chains.indexOf('head') >= 0 ? 1.55 : 1.0;
    spawn({ x: ev.x, y: y + h, z: ev.z, vx: dx * 2, vy: 0.5, vz: dz * 2, size: cat ? 1.0 : 0.45, grow: 2.2, r: C[0] * 1.5, g: C[1] * 1.5, b: C[2] * 1.5, a: 0.55, life: 0.5, shape: SHAPE.SOFT });
    for (let i = 0; i < n; i++) {
      const sp = cat ? 3 + vr.next() * 7 : 2 + vr.next() * 4;
      spawn({ x: ev.x, y: y + h, z: ev.z, vx: dx * sp + (vr.next() - 0.5) * sp, vy: 1 + vr.next() * (cat ? 6 : 3), vz: dz * sp + (vr.next() - 0.5) * sp, size: 0.04 + vr.next() * 0.07, r: C[0], g: C[1], b: C[2], a: 1, life: 1.1, shape: SHAPE.CHUNK, grav: 9.8 });
    }
    // flesh / organic fragments (dark, meaty; Grail bodies shed rotten matter)
    for (let i = 0; i < (cat ? 10 : 4) * GQ.burst; i++) spawn({ x: ev.x, y: y + 1, z: ev.z, vx: dx * 3 + (vr.next() - 0.5) * 5, vy: 2 + vr.next() * 4, vz: dz * 3 + (vr.next() - 0.5) * 5, size: 0.09 + vr.next() * 0.09, r: bio ? 0.05 : 0.09, g: bio ? 0.055 : 0.02, b: bio ? 0.02 : 0.016, a: 1, life: 2.5, shape: SHAPE.CHUNK, grav: 9.8, rotV: (vr.next() - 0.5) * 10 });
    for (let i = 0; i < (cat ? 3 : 2); i++) {
      const d = 1 + vr.next() * (cat ? 3 : 2);
      decal({ x: ev.x + dx * d, z: ev.z + dz * d, size: 0.5 + vr.next() * 0.6, rot: Math.atan2(dx, dz), aspect: 2.2, r: CD[0], g: CD[1], b: CD[2], a: 0.9, shape: DSHAPE.SPRAY });
    }
    if (cat) pools.add(ev.x + dx * 1.5, ev.z + dz * 1.5, 1.4, bio, 0.3, 120, vr.next() * 6.28);
    if (bio) { diseaseMotes(ev.x, y + 1, ev.z, 6); flyBurst(ev.x, ev.z, 8); }
  }

  function buildingHit(x, z, stype, big) {
    const def = STRUCTURES[stype];
    const y = ground(x, z);
    const off = def.footprint ? Math.max(def.footprint.w, def.footprint.d) * 0.3 : 1;
    const px = x + (vr.next() - 0.5) * off, pz = z + (vr.next() - 0.5) * off;
    const kind = stype === 'fire_post' || stype === 'wire' ? 'metal' : 'wall';
    impact(px, pz, kind, 0, 0, big);
    if (big) for (let i = 0; i < 8; i++) spawn({ x: px, y: y + 1.5, z: pz, vx: (vr.next() - 0.5) * 2, vy: 1 + vr.next() * 2, vz: (vr.next() - 0.5) * 2, size: 1.2, grow: 1.5, r: 0.3, g: 0.28, b: 0.25, a: 0.5, life: 2.5, shape: SHAPE.SOFT, drag: 1 });
  }

  // ------------------------------------------------------------------ events

  const MZ = [0, 0, 0];
  function shooterMuzzle(ev) {
    const u = renderer && renderer.units;
    if (u && u.muzzleOf(ev.shooter, MZ)) return MZ;
    MZ[0] = ev.x; MZ[1] = ground(ev.x, ev.z) + 1.35; MZ[2] = ev.z;
    return MZ;
  }

  function onEvent(ev, show, s) {
    sim = s;
    const SRC = 1, IMP = 2, TGT = 4;
    switch (ev.type) {
      case 'FIRE':
      case 'STRUCTURE_FIRE': {
        stats.fires++;
        const w = WEAPONS[ev.weapon];
        const dx = ev.tx - ev.x, dz = ev.tz - ev.z;
        const d = Math.hypot(dx, dz) || 1;
        if (ev.flame || (w && w.kind === 'flame')) {
          // a gout of burning fuel: the source only where seen, the fire where it lands if seen
          const m = shooterMuzzle(ev);
          if (show & SRC) flameJet(m[0], m[1], m[2], ev.tx, ground(ev.tx, ev.tz) + 0.6, ev.tz);
          else if (show & IMP) flameLand(ev.tx, ev.tz);
          break;
        }
        let delay = 0.05;
        if (show & SRC) {
          const m = ev.type === 'STRUCTURE_FIRE' ? [ev.x, ground(ev.x, ev.z) + 1.0, ev.z] : shooterMuzzle(ev);
          muzzleFlash(m[0], m[1], m[2], dx / d, dz / d, w ? w.muzzle : 'rifle');
          const ty = ground(ev.tx, ev.tz) + (ev.hit ? 1.1 : 0.05);
          const pellets = w && w.tracer === 'pellet' ? 3 : 1;
          for (let k = 0; k < pellets; k++) {
            const sx = k ? (vr.next() - 0.5) * 1.2 : 0, sz = k ? (vr.next() - 0.5) * 1.2 : 0;
            delay = tracer(m[0], m[1], m[2], ev.tx + sx, ty, ev.tz + sz, w ? w.tracer : 'rifle');
          }
        }
        if ((show & IMP) || ((show & TGT) && ev.hit)) {
          const kind = (show & IMP) ? ev.impact : 'flesh';
          pending.push({ t: time + delay, x: ev.tx, z: ev.tz, kind: kind === 'ground' || kind === 'water' || kind === 'metal' || kind === 'wall' ? kind : ev.hit ? kind : 'ground', dx: dx / d, dz: dz / d });
        }
        break;
      }
      case 'MELEE': {
        if (!ev.hit) break;
        if ((show & IMP) || (show & TGT)) {
          const d = Math.hypot(ev.tx - ev.x, ev.tz - ev.z) || 1;
          impact(ev.tx, ev.tz, ev.impact === 'blade' || ev.impact === 'claw' || ev.impact === 'blunt' ? (ev.faction === 'black_grail' ? 'flesh' : 'organic') : ev.impact, (ev.tx - ev.x) / d, (ev.tz - ev.z) / d, ev.weapon === 'plague_greatblade' || ev.weapon === 'great_hammer');
        }
        break;
      }
      case 'DEATH': {
        if (!show) break;
        deathGore(ev);
        break;
      }
      case 'EXPLOSION':
        if (show) explosion(ev.x, ev.z, ev.size !== 'light', ev.ability === 'detonation' ? 'detonation' : ev.size);
        break;
      case 'ABILITY_CAST':
        // lasting areas (fly swarm) are drawn per frame from the effects the viewer can see
        break;
      case 'STRUCTURE_DAMAGED': {
        if (!show) break;
        buildingHit(ev.x, ev.z, ev.stype, ev.hp <= 0);
        // damage stages: crossing into DAMAGED / CRITICAL throws debris and a smoke puff once
        const st = s.rt.structById.get(ev.id);
        if (st && st.maxHp) {
          const ratio = st.hp / st.maxHp;
          const stage = ratio < 0.33 ? 2 : ratio < 0.66 ? 1 : 0;
          const prev = structStage.get(ev.id) || 0;
          if (stage > prev) stageDebris(ev.x, ev.z, ev.stype, stage);
          structStage.set(ev.id, stage);
        }
        break;
      }
      case 'STRUCTURE_DESTROYED':
        if (!show || ev.cancelled) break;
        structStage.delete(ev.id);
        if (ev.organic) organicRupture(ev.x, ev.z, ev.stype);
        else {
          explosion(ev.x, ev.z, false, 'light');
          collapse(ev.x, ev.z, ev.stype);
        }
        break;
      case 'CORPSE_REMOVED':
        if (!show) break;
        if (ev.reason === 'consumed') {
          for (let i = 0; i < 8; i++) spawn({ x: ev.x, y: ground(ev.x, ev.z) + 0.3, z: ev.z, vx: (vr.next() - 0.5) * 2, vy: 0.5 + vr.next() * 1.5, vz: (vr.next() - 0.5) * 2, size: 0.07, r: 0.12, g: 0.03, b: 0.02, a: 1, life: 0.8, shape: SHAPE.CHUNK, grav: 9.8 });
          decal({ x: ev.x, z: ev.z, size: 0.9, r: 0.04, g: 0.012, b: 0.009, a: 0.8, shape: DSHAPE.BLOOD });
        } else if (ev.reason === 'raised') {
          flyBurst(ev.x, ev.z, 14);
        } else if (ev.reason === 'burned') {
          cremation(ev.x, ev.z);
        }
        break;
      case 'ANIMAL_KILLED':
        if (!show || ev.cause === 'slaughter') break;
        bloodHit(ev.x, ground(ev.x, ev.z) - 0.4, ev.z, 0, 0, false, true);
        if (ev.by === 'black_grail') flyBurst(ev.x, ev.z, 6);
        break;
      case 'CONVOY_LOST':
        if (!show) break;
        collapse(ev.x, ev.z, 'supply_cache');
        break;
      case 'SOLDIER_RISING':
        if (show) {
          flyBurst(ev.x, ev.z, 10);
          impact(ev.x, ev.z, 'ground', 0, 0, false);
        }
        break;
      case 'SQUAD_SPAWNED':
        if (show && ev.emerging) flyBurst(ev.x, ev.z, 20);
        break;
      case 'STRUCTURE_COMPLETED':
        if (show) for (let i = 0; i < 8; i++) spawn({ x: ev.x + (vr.next() - 0.5) * 3, y: ground(ev.x, ev.z) + 0.2, z: ev.z + (vr.next() - 0.5) * 3, vy: 0.6, size: 0.6, grow: 1, r: 0.32, g: 0.28, b: 0.22, a: 0.4, life: 1.5, shape: SHAPE.SOFT, drag: 1 });
        break;
      default: break;
    }
  }

  /** Debris + dust when a structure crosses into a worse damage stage. */
  function stageDebris(x, z, stype, stage) {
    const def = STRUCTURES[stype];
    const y = ground(x, z);
    const rr = def && def.footprint ? Math.max(def.footprint.w, def.footprint.d) * 0.5 : 2;
    const organic = def && def.organic;
    for (let i = 0; i < 6 + stage * 6; i++) {
      const a = vr.next() * 6.28;
      spawn({ x: x + Math.cos(a) * rr * 0.6, y: y + 1 + vr.next() * 2, z: z + Math.sin(a) * rr * 0.6, vx: Math.cos(a) * 2.5, vy: 1 + vr.next() * 3, vz: Math.sin(a) * 2.5, size: 0.08 + vr.next() * 0.1, r: organic ? 0.05 : 0.2, g: organic ? 0.05 : 0.18, b: organic ? 0.02 : 0.15, a: 1, life: 2, shape: SHAPE.CHUNK, grav: 9.8 });
    }
    spawn({ x, y: y + 2, z, vy: 1, size: rr * 0.8, grow: 1.5, r: 0.2, g: 0.18, b: 0.16, a: 0.45, life: 3, shape: SHAPE.SOFT, drag: 0.8 });
    for (let i = 0; i < stage + 1; i++) decal({ x: x + (vr.next() - 0.5) * rr * 2.2, z: z + (vr.next() - 0.5) * rr * 2.2, size: 0.8 + vr.next(), r: organic ? 0.03 : 0.09, g: organic ? 0.03 : 0.085, b: organic ? 0.012 : 0.075, a: 0.8, shape: organic ? DSHAPE.SPRAY : DSHAPE.SCORCH });
  }

  /** New Antioch / neutral structure destroyed: collapse into rubble, dust, smoke. */
  function collapse(x, z, stype) {
    const def = STRUCTURES[stype];
    const y = ground(x, z);
    const rr = def && def.footprint ? Math.max(def.footprint.w, def.footprint.d) * 0.5 : 3;
    for (let i = 0; i < 6; i++) buildingHit(x, z, stype, true);
    for (let i = 0; i < 12; i++) spawn({ x: x + (vr.next() - 0.5) * rr * 2, y: y + 0.5, z: z + (vr.next() - 0.5) * rr * 2, vx: (vr.next() - 0.5) * 3, vy: 0.5 + vr.next() * 1.5, vz: (vr.next() - 0.5) * 3, size: 1.2 + rr * 0.2, grow: 2, r: 0.3, g: 0.27, b: 0.23, a: 0.55, life: 3.5, shape: SHAPE.SOFT, drag: 1.4 });
    decal({ x, z, size: rr * 2.2, r: 0.07, g: 0.064, b: 0.055, a: 0.85, shape: DSHAPE.SCORCH });
  }

  /** Black Grail structure destroyed: organic rupture — dark biomass, ichor, a cloud of flies. */
  function organicRupture(x, z, stype) {
    const def = STRUCTURES[stype];
    const y = ground(x, z);
    const rr = def && def.footprint ? Math.max(def.footprint.w, def.footprint.d) * 0.5 : 3;
    spawn({ x, y: y + 1.2, z, size: rr * 1.4, grow: 3, r: 0.06, g: 0.07, b: 0.02, a: 0.7, life: 1.2, shape: SHAPE.SOFT });
    for (let i = 0; i < 40 * GQ.burst; i++) {
      const a = vr.next() * 6.28, sp = 2 + vr.next() * 7;
      spawn({ x, y: y + 1 + vr.next() * 2, z, vx: Math.cos(a) * sp, vy: 2 + vr.next() * 6, vz: Math.sin(a) * sp, size: 0.08 + vr.next() * 0.16, r: ICHOR[0] * 2, g: ICHOR[1] * 2, b: ICHOR[2] * 2, a: 1, life: 2.4, shape: SHAPE.CHUNK, grav: 9.8, rotV: (vr.next() - 0.5) * 8 });
    }
    diseaseMotes(x, y + 1.5, z, 14);
    flyBurst(x, z, 40);
    for (let i = 0; i < 4; i++) pools.add(x + (vr.next() - 0.5) * rr * 1.6, z + (vr.next() - 0.5) * rr * 1.6, 1.2 + vr.next() * 1.5, true, 0.5, 220, vr.next() * 6.28);
    if (renderer) renderer.shakeAt(x, z, 0.35);
  }

  function flyBurst(x, z, n) {
    const y = ground(x, z);
    for (let i = 0; i < n; i++) spawn({ x: x + (vr.next() - 0.5) * 0.6, y: y + 0.3 + vr.next(), z: z + (vr.next() - 0.5) * 0.6, vx: (vr.next() - 0.5) * 3, vy: 0.5 + vr.next() * 1.5, vz: (vr.next() - 0.5) * 3, size: 0.035, r: 0.02, g: 0.02, b: 0.015, a: 1, life: 1.5 + vr.next(), shape: SHAPE.SPECK, drag: 0.8 });
  }

  // ------------------------------------------------------------------ fire / plague (Phase 3)

  /** Flamethrower gout: burning fuel streams from the nozzle, fire splashes where it lands. */
  function flameJet(x0, y0, z0, tx, ty, tz) {
    const dx = tx - x0, dy = ty - y0, dz = tz - z0;
    const d = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / d, uy = dy / d, uz = dz / d;
    const n = Math.round((10 + d * 1.1) * (0.6 + GQ.burst * 0.4));
    for (let i = 0; i < n; i++) {
      // spread along the stream (not all at the nozzle): reads as a jet at once, never a white ball
      const sp = 10 + vr.next() * 5, f = (i / n) * 0.75, rest = d * (1 - f);
      spawn({ x: x0 + ux * (0.2 + d * f), y: y0 + uy * d * f, z: z0 + uz * (0.2 + d * f), vx: ux * sp + (vr.next() - 0.5) * 1.4, vy: uy * sp + 0.5 + vr.next() * 0.8, vz: uz * sp + (vr.next() - 0.5) * 1.4, size: 0.18 + f * 0.35 + vr.next() * 0.2, grow: 1.4, r: 2.5, g: 0.85 + vr.next() * 0.45, b: 0.16, a: 0.6, life: (rest / sp) * (0.8 + vr.next() * 0.45), shape: SHAPE.SOFT, add: true, drag: 0.5, fadeIn: 0.03 });
    }
    spawn({ x: x0, y: y0, z: z0, size: 0.4, r: 3, g: 1.4, b: 0.3, a: 0.9, life: 0.08, shape: SHAPE.GLOW, add: true });
    flameLand(tx, tz);
  }

  function flameLand(x, z) {
    const gy = ground(x, z);
    for (let i = 0; i < 7; i++) spawn({ x: x + (vr.next() - 0.5) * 1.8, y: gy + 0.25, z: z + (vr.next() - 0.5) * 1.8, vx: (vr.next() - 0.5) * 0.8, vy: 1.1 + vr.next() * 1.6, vz: (vr.next() - 0.5) * 0.8, size: 0.5 + vr.next() * 0.45, grow: 0.8, r: 2.4, g: 0.85, b: 0.15, a: 0.62, life: 0.45 + vr.next() * 0.5, shape: SHAPE.SOFT, add: true, drag: 1 });
    for (let i = 0; i < 2; i++) spawn({ x, y: gy + 1, z, vx: (vr.next() - 0.5) * 0.6, vy: 1.3, vz: (vr.next() - 0.5) * 0.6, size: 0.9, grow: 1.4, r: 0.06, g: 0.055, b: 0.05, a: 0.5, life: 2.4, shape: SHAPE.SOFT, drag: 0.6 });
    decal({ x, z, size: 1.4 + vr.next() * 0.7, r: 0.022, g: 0.017, b: 0.012, a: 0.7, shape: DSHAPE.SCORCH, life: 90 });
    decal({ x, z, size: 6, r: 1.5, g: 0.62, b: 0.16, a: 0.4, shape: DSHAPE.LIGHT, life: 0.22, add: true });
  }

  /** A body burned (flame, sanitation, cleric, purge): a short pyre, embers, ash and a black mark. */
  function cremation(x, z) {
    const y = ground(x, z);
    for (let i = 0; i < 12; i++) spawn({ x: x + (vr.next() - 0.5) * 1.2, y: y + 0.2, z: z + (vr.next() - 0.5) * 1.2, vx: (vr.next() - 0.5) * 0.6, vy: 1.4 + vr.next() * 1.8, vz: (vr.next() - 0.5) * 0.6, size: 0.45 + vr.next() * 0.45, grow: 0.6, r: 3.8, g: 1.5, b: 0.3, a: 0.85, life: 0.7 + vr.next() * 0.6, shape: SHAPE.SOFT, add: true, drag: 1 });
    for (let i = 0; i < 8; i++) spawn({ x, y: y + 0.5, z, vx: (vr.next() - 0.5) * 1.5, vy: 2 + vr.next() * 3, vz: (vr.next() - 0.5) * 1.5, size: 0.02, r: 4, g: 1.7, b: 0.4, a: 1, life: 1 + vr.next(), shape: SHAPE.STREAK, add: true, grav: 1.2, stretch: 0.2 });
    for (let i = 0; i < 3; i++) spawn({ x: x + (vr.next() - 0.5), y: y + 1 + i * 0.8, z: z + (vr.next() - 0.5), vx: 0.2, vy: 1.1 + vr.next() * 0.6, vz: (vr.next() - 0.5) * 0.3, size: 1.1, grow: 1.2, r: 0.09, g: 0.085, b: 0.08, a: 0.55, life: 4 + vr.next() * 2, shape: SHAPE.SOFT, drag: 0.5, fadeIn: 0.1 });
    decal({ x, z, size: 1.3 + vr.next() * 0.5, r: 0.018, g: 0.015, b: 0.012, a: 0.85, shape: DSHAPE.SCORCH, life: 120 });
    if (pyres.length < 16) pyres.push({ x, z, t: 2.5 + vr.next() });
  }
  const pyres = [];

  /** Per frame: pyres, burning soldiers, plague clouds / purge / black tide, turning bodies. */
  let burnAcc = 0, turnAcc = 0;
  function plagueFx(dt) {
    if (!sim) return;
    const tick = sim.state.tick;
    for (let i = pyres.length - 1; i >= 0; i--) {
      const p = pyres[i];
      p.t -= dt;
      if (p.t <= 0) { pyres.splice(i, 1); continue; }
      if (vr.next() < dt * 14) spawn({ x: p.x + (vr.next() - 0.5) * 0.8, y: ground(p.x, p.z) + 0.15, z: p.z + (vr.next() - 0.5) * 0.8, vy: 1 + vr.next(), size: 0.35 + vr.next() * 0.3, grow: 0.5, r: 3.4, g: 1.3, b: 0.25, a: 0.8 * Math.min(1, p.t), life: 0.6, shape: SHAPE.SOFT, add: true, drag: 1 });
    }
    // soldiers on fire (seen ones only)
    burnAcc += dt;
    if (burnAcc >= 0.07) {
      burnAcc = 0;
      let n = 0;
      for (const sq of sim.state.squads) {
        if (!isSquadVisibleTo(sq, viewer)) continue;
        for (const m of sq.members) {
          if (!m.burn || m.burn <= tick || m.state !== 'alive' || n > 40) continue;
          if (sq.faction !== viewer && !isSoldierVisibleTo(sim, sq, m, viewer)) continue;
          n++;
          const y = ground(m.x, m.z);
          spawn({ x: m.x + (vr.next() - 0.5) * 0.4, y: y + 0.6 + vr.next() * 0.9, z: m.z + (vr.next() - 0.5) * 0.4, vx: (vr.next() - 0.5) * 0.4, vy: 1.3 + vr.next(), vz: (vr.next() - 0.5) * 0.4, size: 0.3 + vr.next() * 0.25, grow: 0.6, r: 3.8, g: 1.4, b: 0.3, a: 0.85, life: 0.4 + vr.next() * 0.3, shape: SHAPE.SOFT, add: true, drag: 1 });
          if (vr.next() < 0.3) spawn({ x: m.x, y: y + 1.6, z: m.z, vy: 1.2, size: 0.5, grow: 1, r: 0.07, g: 0.065, b: 0.06, a: 0.45, life: 1.6, shape: SHAPE.SOFT, drag: 0.6 });
        }
      }
    }
    // lasting plague areas (only those the viewer sees)
    for (const e of sim.state.effects) {
      if (e.kind !== 'plague_cloud' && e.kind !== 'purge' && e.kind !== 'tide') continue;
      if (!effectVisibleTo(sim, e, viewer)) continue;
      const gy = ground(e.x, e.z);
      const total = Math.max(1, (e.end || e.start + 1) - e.start);
      const left = Math.max(0, ((e.end || tick) - tick) / total);
      e.fxAcc = (e.fxAcc || 0) + dt;
      if (e.kind === 'plague_cloud') {
        const nFog = Math.floor(e.fxAcc * 9), nFly = Math.floor(e.fxAcc * 60);
        if (nFog + nFly > 0) e.fxAcc = 0;
        for (let k = 0; k < nFog; k++) {
          const a = vr.next() * 6.28, r = Math.sqrt(vr.next()) * e.radius;
          spawn({ x: e.x + Math.cos(a) * r, y: gy + 0.6 + vr.next() * 2.2, z: e.z + Math.sin(a) * r, vx: (vr.next() - 0.5) * 0.5, vy: 0.15, vz: (vr.next() - 0.5) * 0.5, size: 3 + vr.next() * 2.5, grow: 0.5, r: 0.2, g: 0.24, b: 0.05, a: 0.2, life: 3.5, shape: SHAPE.SOFT, fadeIn: 0.3 });
        }
        for (let k = 0; k < nFly; k++) {
          const a = vr.next() * 6.28, r = Math.sqrt(vr.next()) * e.radius;
          spawn({ x: e.x + Math.cos(a) * r, y: gy + 0.4 + vr.next() * 2.5, z: e.z + Math.sin(a) * r, vx: (vr.next() - 0.5) * 3, vy: (vr.next() - 0.5), vz: (vr.next() - 0.5) * 3, size: 0.06, r: 0.012, g: 0.014, b: 0.006, a: 1, life: 0.5, shape: SHAPE.SPECK });
        }
        rings.push(e.x, e.z, gy, e.radius, left);
      } else if (e.kind === 'purge') {
        const nF = Math.floor(e.fxAcc * 40);
        if (nF > 0) e.fxAcc = 0;
        for (let k = 0; k < nF; k++) {
          const a = vr.next() * 6.28, r = Math.sqrt(vr.next()) * e.radius;
          spawn({ x: e.x + Math.cos(a) * r, y: gy + 0.2, z: e.z + Math.sin(a) * r, vy: 1.6 + vr.next() * 2, size: 0.5 + vr.next() * 0.5, grow: 0.7, r: 4.2, g: 2.6, b: 0.9, a: 0.8, life: 0.7 + vr.next() * 0.4, shape: SHAPE.SOFT, add: true, drag: 1 });
        }
        if (vr.next() < dt * 3) decal({ x: e.x, z: e.z, size: e.radius * 2.2, r: 1.6, g: 1.2, b: 0.5, a: 0.35, shape: DSHAPE.LIGHT, life: 0.4, add: true });
      } else if (e.kind === 'tide' && tick - e.start < 60) {
        rings.push(e.x, e.z, gy, e.radius, left);
      }
    }
    // the Black Tide surging: dark motes around seen, surging Grail soldiers (bounded)
    let tideN = 0;
    for (const sq of sim.state.squads) {
      if (!sq.tideUntil || sq.tideUntil <= tick || !isSquadVisibleTo(sq, viewer) || tideN > 24) continue;
      tideN++;
      if (vr.next() < dt * 6) diseaseMotes(sq.cx, ground(sq.cx, sq.cz) + 0.8, sq.cz, 2);
    }
    // turning bodies: faint flies over infected dead that will rise (the counterplay cue)
    turnAcc += dt;
    if (turnAcc >= 0.25) {
      turnAcc = 0;
      let n = 0;
      for (const c of sim.state.corpses) {
        if (!(c.turn || c.riseAt) || n > 30 || !c.infected) continue;
        if (!isPointVisibleTo(sim, viewer, c.x, c.z)) continue;
        n++;
        const y = ground(c.x, c.z);
        spawn({ x: c.x + (vr.next() - 0.5) * 0.8, y: y + 0.3 + vr.next() * 0.6, z: c.z + (vr.next() - 0.5) * 0.8, vx: (vr.next() - 0.5) * 1.2, vy: 0.2, vz: (vr.next() - 0.5) * 1.2, size: 0.04, r: 0.02, g: 0.02, b: 0.012, a: 1, life: 0.8, shape: SHAPE.SPECK, drag: 0.8 });
        if (c.riseAt && vr.next() < 0.35) diseaseMotes(c.x, y + 0.3, c.z, 1);
      }
    }
  }

  // ------------------------------------------------------------------ per frame

  /**
   * Fly Swarm readability (only swarms the viewer can currently see — effectVisibleTo): a dark,
   * moving swarm of flies, faint miasma, and a ground ring whose lit arc shows the time left.
   */
  const rings = [];
  const shades = []; // the swarm's shadow on the ground (the area reads even from far away)
  function swarmFx(dt) {
    rings.length = 0;
    shades.length = 0;
    if (!sim) return;
    for (const e of sim.state.effects) {
      if (e.kind !== 'swarm' || !effectVisibleTo(sim, e, viewer)) continue;
      const def = ABILITIES[e.ability];
      const total = Math.max(1, e.end - e.start);
      const left = Math.max(0, (e.end - sim.state.tick) / total);
      const gy = ground(e.x, e.z);
      // the swarm body (time-based rates, independent of the frame rate): dark clumps orbiting a
      // drifting centre, individual flies around them, faint green miasma low over the ground
      const cx = e.x + Math.sin(time * 0.7 + e.id) * e.radius * 0.25, cz = e.z + Math.cos(time * 0.53 + e.id) * e.radius * 0.25;
      const q = 0.5 + GQ.burst * 0.5;
      e.fxAcc = (e.fxAcc || 0) + dt;
      const nClump = Math.floor(e.fxAcc * 55 * q), nFly = Math.floor(e.fxAcc * 170 * q), nMist = Math.floor(e.fxAcc * 5), nCore = Math.floor(e.fxAcc * 7);
      if (nClump + nFly + nMist > 0) e.fxAcc = 0;
      for (let k = 0; k < nCore; k++) {
        const a = vr.next() * 6.28, r = vr.next() * e.radius * 0.45;
        spawn({ x: cx + Math.cos(a) * r, y: gy + 1.2 + vr.next() * 1.4, z: cz + Math.sin(a) * r, vx: -Math.sin(a) * 1.2, vy: 0.1, vz: Math.cos(a) * 1.2, size: 2.2 + vr.next() * 1.2, grow: 0.3, r: 0.01, g: 0.011, b: 0.008, a: 0.38, life: 1.6, shape: SHAPE.SOFT, fadeIn: 0.3 });
      }
      for (let k = 0; k < nClump; k++) {
        const a = vr.next() * 6.28, r = Math.sqrt(vr.next()) * e.radius * 0.8;
        const sp = 1.8 + vr.next() * 1.8;
        spawn({ x: cx + Math.cos(a) * r, y: gy + 0.6 + vr.next() * 2.6, z: cz + Math.sin(a) * r, vx: -Math.sin(a) * sp, vy: (vr.next() - 0.5) * 0.6, vz: Math.cos(a) * sp, size: 0.7 + vr.next() * 0.9, grow: 0.25, r: 0.012, g: 0.013, b: 0.009, a: 0.65, life: 1.1 + vr.next() * 0.5, shape: SHAPE.SOFT, fadeIn: 0.25 });
      }
      for (let k = 0; k < nFly; k++) {
        const a = vr.next() * 6.28, r = Math.sqrt(vr.next()) * e.radius * 0.95;
        const sp = 2 + vr.next() * 3;
        spawn({ x: cx + Math.cos(a) * r, y: gy + 0.3 + vr.next() * 3.2, z: cz + Math.sin(a) * r, vx: -Math.sin(a) * sp + (vr.next() - 0.5) * 3, vy: (vr.next() - 0.5) * 1.6, vz: Math.cos(a) * sp + (vr.next() - 0.5) * 3, size: 0.07, r: 0.01, g: 0.011, b: 0.007, a: 1, life: 0.45 + vr.next() * 0.4, shape: SHAPE.SPECK });
      }
      for (let k = 0; k < nMist; k++) spawn({ x: e.x + (vr.next() - 0.5) * e.radius * 1.4, y: gy + 0.4, z: e.z + (vr.next() - 0.5) * e.radius * 1.4, size: 3 + vr.next(), grow: 0.8, r: 0.1, g: 0.12, b: 0.04, a: 0.13, life: 3, shape: SHAPE.SOFT, fadeIn: 0.35 });
      shades.push(cx, cz, gy, e.radius * 0.95);
      // area + remaining duration (lit arc), in the Grail's sickly colour (written with the decals)
      rings.push(e.x, e.z, gy, e.radius, left);
      if (def && vr.next() < 0.1) diseaseMotes(e.x + (vr.next() - 0.5) * e.radius, gy + 1, e.z + (vr.next() - 0.5) * e.radius, 2);
    }
  }

  let ambientTimer = 0;
  function update(s, camera, v, dt, t) {
    sim = s; viewer = v; time = t;
    // delayed impacts
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i];
      if (p.t <= time) {
        if (p.kind === 'pop') pop(p.x, p.z); else impact(p.x, p.z, p.kind, p.dx, p.dz, false);
        pending.splice(i, 1);
      }
    }
    ambientTimer -= dt;
    if (ambientTimer <= 0) {
      ambientTimer = 0.1;
      ambient(camera);
    }
    swarmFx(dt);
    plagueFx(dt);
    // pools / stains (bounded) and blood trails of flying limbs
    pools.step(dt);
    if (renderer && renderer.units && renderer.units.limbs) {
      for (const l of renderer.units.limbs.items) {
        if (!l.active || l.rest) continue;
        l.trail -= dt;
        if (l.trail <= 0) {
          l.trail = 0.07;
          const C = l.bio ? ICHOR : RED;
          spawn({ x: l.x, y: l.y, z: l.z, vx: 0, vy: -0.5, vz: 0, size: 0.04, r: C[0], g: C[1], b: C[2], a: 1, life: 0.5, shape: SHAPE.CHUNK, grav: 9.8 });
          if (l.y - ground(l.x, l.z) < 1.2) decal({ x: l.x, z: l.z, size: 0.14 + vr.next() * 0.12, r: C[0] * 0.6, g: C[1] * 0.6, b: C[2] * 0.6, a: 0.85, shape: DSHAPE.BLOOD, life: 90 });
        }
      }
    }
    // integrate particles and fill instance buffers
    nA = 0; nB = 0; alive = 0;
    const ex = camera.eye[0], ey = camera.eye[1], ez = camera.eye[2];
    const tanHalf = Math.tan((camera.fov || 0.63) * 0.5);
    const aspect = camera.aspect || 1.6;
    let coverage = 0; // estimated screens of smoke this frame
    for (let i = 0; i < cap; i++) {
      if (P.life[i] <= 0) continue;
      const smoke = P.shape[i] === SHAPE.SOFT && !P.add[i];
      P.age[i] += smoke && P.size[i] > 1 ? dt * smokeAging : dt;
      if (P.age[i] >= P.life[i]) { P.life[i] = 0; continue; }
      alive++;
      const drag = Math.exp(-P.drag[i] * dt);
      P.vy[i] -= P.grav[i] * dt;
      P.vx[i] *= drag; P.vy[i] *= drag; P.vz[i] *= drag;
      P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt; P.z[i] += P.vz[i] * dt;
      if (P.grav[i] > 5 && P.shape[i] === SHAPE.CHUNK) {
        const gy = ground(P.x[i], P.z[i]);
        if (P.y[i] < gy + 0.02) { P.y[i] = gy + 0.02; P.vx[i] *= 0.3; P.vz[i] *= 0.3; P.vy[i] = 0; }
      }
      P.size[i] = Math.min(LIM.size, P.size[i] + P.grow[i] * dt);
      P.rot[i] += P.rotV[i] * dt;
      if (smoke) {
        const dx = P.x[i] - ex, dy = P.y[i] - ey, dz = P.z[i] - ez;
        const k = P.size[i] / (Math.sqrt(dx * dx + dy * dy + dz * dz) * tanHalf + 1e-3);
        coverage += (k * k) / aspect;
      }
      const u = P.age[i] / P.life[i];
      let a = P.a[i] * (1 - u * u);
      if (P.fadeIn[i] > 0) a *= Math.min(1, u / P.fadeIn[i]);
      const add = P.add[i];
      const buf = add ? instB : instA;
      const o = (add ? nB++ : nA++) * 16;
      buf[o] = P.x[i]; buf[o + 1] = P.y[i]; buf[o + 2] = P.z[i]; buf[o + 3] = P.size[i];
      buf[o + 4] = P.r[i]; buf[o + 5] = P.g[i]; buf[o + 6] = P.b[i]; buf[o + 7] = a;
      buf[o + 8] = P.vx[i]; buf[o + 9] = P.vy[i]; buf[o + 10] = P.vz[i]; buf[o + 11] = P.stretch[i];
      buf[o + 12] = P.shape[i]; buf[o + 13] = P.rot[i]; buf[o + 14] = P.seed[i]; buf[o + 15] = u;
    }
    stats.particles = alive;
    stats.additive = nB;
    stats.smokeScreens = coverage;
    // over budget: big smoke fades faster (smoothly, recovers when the air clears)
    const want = coverage > LIM.screens ? Math.min(6, coverage / LIM.screens * 1.5) : 1;
    smokeAging += (want - smokeAging) * Math.min(1, dt * 3);
    if (nA) { gl.bindBuffer(gl.ARRAY_BUFFER, pBufA); gl.bufferSubData(gl.ARRAY_BUFFER, 0, instA, 0, nA * 16); }
    if (nB) { gl.bindBuffer(gl.ARRAY_BUFFER, pBufB); gl.bufferSubData(gl.ARRAY_BUFFER, 0, instB, 0, nB * 16); }
    // decals: persistent pool + per-frame blob shadows
    dn = 0; dnAdd = 0;
    for (const d of D) {
      if (d.life === 0) continue;
      d.age += dt;
      if (d.life > 0 && d.age > d.life) { d.life = 0; continue; }
      if (d.grow && d.size < d.maxSize) d.size = Math.min(d.maxSize, d.size + d.grow * dt);
      const fade = d.life > 0 ? 1 - d.age / d.life : 1;
      writeDecal(d.add, d.x, d.z, d.y, d.size, d.rot, d.r, d.g, d.b, d.a * fade, d.shape, d.p1, d.p2, d.aspect);
    }
    stats.decals = D.length;
    let np = 0;
    for (const p of pools.pool.items) {
      if (!p.active) continue;
      np++;
      const C = p.bio ? ICHOR_DARK : RED_DARK;
      const fade = p.age > p.life - 8 ? Math.max(0, (p.life - p.age) / 8) : 1;
      writeDecal(false, p.x, p.z, ground(p.x, p.z), p.size, p.rot, C[0], C[1], C[2], p.a * fade, DSHAPE.BLOOD, 0, 0, 1.25);
    }
    stats.pools = np;
    for (let i = 0; i < rings.length; i += 5) writeDecal(false, rings[i], rings[i + 1], rings[i + 2], rings[i + 3], 0, 0.32, 0.36, 0.08, 0.55, DSHAPE.TIMER, rings[i + 4], 0, 1);
    for (let i = 0; i < shades.length; i += 4) writeDecal(false, shades[i], shades[i + 1], shades[i + 2], shades[i + 3], 0, 0.005, 0.006, 0.002, 0.5, DSHAPE.SHADOW, 0, 0, 1);
    if (renderer && renderer.units) {
      for (const [, list] of renderer.units.bucketsView()) {
        for (const vv of list) {
          if (vv.death >= 1) continue;
          const mdl = vv.model;
          const sz = mdl && mdl.quad ? mdl.rig.len * 0.42 : mdl && mdl.rigid ? 1.3 : mdl && mdl.heavy ? 0.85 : 0.6;
          writeDecal(false, vv.x, vv.z, vv.y, sz, vv.rot, 0.0, 0.0, 0.0, 0.55 * (vv.death >= 0 ? 1 - vv.death : 1), DSHAPE.SHADOW, 0, 0, 0.8);
        }
      }
    }
    uploadDecals();
  }

  function writeDecal(add, x, z, y, size, rot, r, g, b, a, shape, p1, p2, aspect) {
    if (add) {
      if (dnAdd >= 256) return;
      const o = dnAdd++ * 16;
      fillDecal(dInstAdd, o, x, z, y, size, rot, r, g, b, a, shape, p1, p2, aspect);
    } else {
      if (dn >= DMAX) return;
      const o = dn++ * 16;
      fillDecal(dInst, o, x, z, y, size, rot, r, g, b, a, shape, p1, p2, aspect);
    }
  }

  function fillDecal(buf, o, x, z, y, size, rot, r, g, b, a, shape, p1, p2, aspect) {
    buf[o] = x; buf[o + 1] = z; buf[o + 2] = size; buf[o + 3] = rot;
    buf[o + 4] = r; buf[o + 5] = g; buf[o + 6] = b; buf[o + 7] = a;
    buf[o + 8] = shape; buf[o + 9] = p1; buf[o + 10] = p2; buf[o + 11] = aspect;
    buf[o + 12] = y; buf[o + 13] = 0.03; buf[o + 14] = 0; buf[o + 15] = 0;
  }

  function uploadDecals() {
    if (dn) { gl.bindBuffer(gl.ARRAY_BUFFER, dBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, dInst, 0, dn * 16); }
    if (dnAdd) { gl.bindBuffer(gl.ARRAY_BUFFER, dBufAdd); gl.bufferSubData(gl.ARRAY_BUFFER, 0, dInstAdd, 0, dnAdd * 16); }
  }

  function ambient(camera) {
    if (!sim) return;
    const { state } = sim;
    // flies around visible Black Grail squads
    for (const sq of state.squads) {
      if (sq.faction !== 'black_grail' || !isSquadVisibleTo(sq, viewer)) continue;
      if (Math.abs(sq.cx - camera.tx) > 90 || Math.abs(sq.cz - camera.tz) > 90) continue;
      const x = sq.cx + (vr.next() - 0.5) * 6, z = sq.cz + (vr.next() - 0.5) * 6;
      spawn({ x, y: ground(x, z) + 1 + vr.next() * 1.4, z, vx: (vr.next() - 0.5) * 2, vy: (vr.next() - 0.5) * 0.6, vz: (vr.next() - 0.5) * 2, size: 0.03, r: 0.015, g: 0.015, b: 0.01, a: 1, life: 1.2, shape: SHAPE.SPECK });
    }
    // visibly infected soldiers the viewer sees: a few flies and sick motes around them
    for (const sq of state.squads) {
      if (sq.faction === 'black_grail' || !isSquadVisibleTo(sq, viewer)) continue;
      if (Math.abs(sq.cx - camera.tx) > 80 || Math.abs(sq.cz - camera.tz) > 80) continue;
      for (const m of sq.members) {
        if (m.state !== 'alive' || m.infection < 2 || vr.next() > 0.25) continue;
        if (sq.faction !== viewer && !isSoldierVisibleTo(sim, sq, m, viewer)) continue;
        spawn({ x: m.x + (vr.next() - 0.5) * 0.8, y: ground(m.x, m.z) + 1 + vr.next() * 0.8, z: m.z + (vr.next() - 0.5) * 0.8, vx: (vr.next() - 0.5) * 1.5, vy: (vr.next() - 0.5) * 0.5, vz: (vr.next() - 0.5) * 1.5, size: 0.03, r: 0.012, g: 0.012, b: 0.008, a: 1, life: 0.8, shape: SHAPE.SPECK });
      }
    }
    // Grail organic structures breathe flies and spores
    // damaged structures smoke; altars exhale spores
    for (const st of state.structures) {
      if (!isStructureVisibleTo(st, viewer)) continue;
      if (Math.abs(st.x - camera.tx) > 120 || Math.abs(st.z - camera.tz) > 120) continue;
      const ratio = st.hp / st.maxHp;
      if (st.built && ratio < 0.55 && STRUCTURES[st.type].kind === 'building' && vr.next() < 0.7) {
        spawn({ x: st.x + (vr.next() - 0.5) * 3, y: ground(st.x, st.z) + 2 + vr.next() * 4, z: st.z + (vr.next() - 0.5) * 3, vx: 0.4, vy: 1.2 + vr.next(), vz: -0.2, size: 1.2, grow: 1.6, r: 0.1, g: 0.095, b: 0.09, a: 0.45, life: 6, shape: SHAPE.SOFT, drag: 0.3, fadeIn: 0.2 });
        if (ratio < 0.3 && vr.next() < 0.5) spawn({ x: st.x + (vr.next() - 0.5) * 2, y: ground(st.x, st.z) + 1.5 + vr.next() * 2, z: st.z + (vr.next() - 0.5) * 2, vy: 1.5, size: 0.7, grow: 0.5, r: 2.8, g: 1.2, b: 0.3, a: 0.7, life: 0.6, shape: SHAPE.SOFT, add: true });
      }
      const sdef = STRUCTURES[st.type];
      if (sdef.organic && st.built && vr.next() < 0.45) {
        spawn({ x: st.x + (vr.next() - 0.5) * 4, y: ground(st.x, st.z) + 0.8 + vr.next() * 2, z: st.z + (vr.next() - 0.5) * 4, vx: (vr.next() - 0.5) * 2, vy: 0.2, vz: (vr.next() - 0.5) * 2, size: 0.035, r: 0.02, g: 0.02, b: 0.01, a: 1, life: 1.4, shape: SHAPE.SPECK });
        if (st.type === 'plague_pit' && vr.next() < 0.5) spawn({ x: st.x + (vr.next() - 0.5) * 3, y: ground(st.x, st.z) + 0.3, z: st.z + (vr.next() - 0.5) * 3, vy: 0.35, size: 1.8, grow: 0.9, r: 0.14, g: 0.17, b: 0.05, a: 0.2, life: 4, shape: SHAPE.SOFT, fadeIn: 0.3 });
      }
      if (st.type === 'grail_altar' && vr.next() < 0.6) {
        spawn({ x: st.x + (vr.next() - 0.5) * 6, y: ground(st.x, st.z) + 1 + vr.next() * 3, z: st.z + (vr.next() - 0.5) * 6, vx: (vr.next() - 0.5) * 2, vy: 0.3, vz: (vr.next() - 0.5) * 2, size: 0.035, r: 0.02, g: 0.02, b: 0.01, a: 1, life: 1.6, shape: SHAPE.SPECK });
        spawn({ x: st.x + (vr.next() - 0.5) * 8, y: ground(st.x, st.z) + 0.5, z: st.z + (vr.next() - 0.5) * 8, vy: 0.25, size: 2.2, grow: 0.8, r: 0.12, g: 0.13, b: 0.05, a: 0.18, life: 5, shape: SHAPE.SOFT, fadeIn: 0.3 });
      }
    }
    // smouldering ruins + low mist over no man's land (only where the viewer has vision)
    for (const sm of smokers) {
      if (Math.abs(sm.x - camera.tx) > 140 || Math.abs(sm.z - camera.tz) > 140) continue;
      if (!isPointVisibleTo(sim, viewer, sm.x, sm.z) && vr.next() < 0.7) continue;
      spawn({ x: sm.x + (vr.next() - 0.5) * 1.5, y: sm.y + 1, z: sm.z + (vr.next() - 0.5) * 1.5, vx: 0.5 + vr.next() * 0.3, vy: 1.1 + vr.next() * 0.6, vz: -0.25, size: 1.0, grow: 1.4, r: 0.11, g: 0.1, b: 0.095, a: 0.4, life: 9, shape: SHAPE.SOFT, drag: 0.25, fadeIn: 0.15 });
    }
    if (vr.next() < 0.5) {
      const x = camera.tx + (vr.next() - 0.5) * 140, z = camera.tz + (vr.next() - 0.7) * 120;
      const band = z > 240 && z < 420;
      if (band) spawn({ x, y: ground(x, z) + 0.5, z, vx: 0.4, vz: 0.1, size: 6 + vr.next() * 4, grow: 0.4, r: 0.36, g: 0.35, b: 0.33, a: 0.11, life: 12, shape: SHAPE.SOFT, fadeIn: 0.35 });
    }
  }

  function setupSmokers(world) {
    smokers.length = 0;
    world.ruins.forEach((r, i) => {
      if (i % 3 === 1 || r.kind === 'chapel') smokers.push({ x: r.x, y: groundHeightAt(world, null, r.x, r.z), z: r.z });
    });
  }

  function drawDecals(setCommon, additive) {
    const p = decalProgram;
    const n = additive ? dnAdd : dn;
    if (!n) return;
    gl.useProgram(p.program);
    setCommon(p);
    gl.uniform1f(p.u.uAdditive, additive ? 1 : 0);
    if (additive) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(additive ? dVaoAdd : dVao);
    drawElements(gl, gl.TRIANGLES, gidx.length, gl.UNSIGNED_SHORT, n);
    gl.bindVertexArray(null);
  }

  function drawParticles(setCommon) {
    const p = particleProgram;
    gl.useProgram(p.program);
    setCommon(p);
    gl.depthMask(false);
    if (nA) {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(p.u.uAdditive, 0);
      gl.bindVertexArray(vaoA);
      drawArrays(gl, gl.TRIANGLE_STRIP, 0, 4, nA);
    }
    if (nB) {
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.uniform1f(p.u.uAdditive, 1);
      gl.bindVertexArray(vaoB);
      drawArrays(gl, gl.TRIANGLE_STRIP, 0, 4, nB);
    }
    gl.bindVertexArray(null);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Extra decal instance used by overlays (rings / markers) this frame. */
  function pushOverlayDecal(x, z, y, size, rot, r, g, b, a, shape, p1, p2, aspect) {
    writeDecal(false, x, z, y, size, rot, r, g, b, a, shape, p1, p2, aspect);
  }

  return { onEvent, update, drawDecals, drawParticles, spawn, decal, explosion, setupSmokers, pushOverlayDecal, uploadDecals, stats, DSHAPE, pools };
}
