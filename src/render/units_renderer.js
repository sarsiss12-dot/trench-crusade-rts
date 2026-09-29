// Soldier rendering: per-model/LOD instanced skinned draws with CPU-computed procedural poses
// in a float pose texture. Frustum culling per squad, distance LOD, animation state driven by
// sim state + filtered events, bounded visual corpse pool (separate from gameplay corpses).
import { createBuffer, createVAO, createTexture2D, drawElements } from './gl.js';
import { POSE_TEXELS } from './shaders.js';
import { computePose, POSE_FLOATS, deathVariant, muzzleWorld, jointWorld } from './anim.js';
import { planDeath, createLimbPool, stepLimb, CHAINS, GORE_QUALITY } from './gore.js';
import { INFECTION_MAX } from '../sim/constants.js';
import { UNIT_MODELS } from './models/humans.js';
import { UNIT_MODELS_P3 } from './models/humans_p3.js';
import { ANIMAL_MODELS } from './models/animals.js';
import { SPECIES } from '../data/animals.js';
import { UNITS } from '../data/units.js';
import { VERTEX_STRIDE } from './models/meshbuilder.js';
import { sphereInFrustum, lerpAngle, clamp01 } from './math3d.js';
import { unitDef } from '../data/units.js';
import { groundHeightAt } from '../world/ground.js';
import { isSquadVisibleTo, isCorpseKnownTo, isSoldierVisibleTo, isAnimalVisibleTo, isConvoyVisibleTo } from '../sim/perception.js';
import { corpseTwitching } from '../sim/corpse_view.js';
import { hash32 } from '../core/rng.js';
import { DT, DYING_TICKS, RISING_TICKS } from '../sim/constants.js';
import { isOrganic, isPlagueImmune, baseFaction, isTwin } from '../data/factions.js';

export const MAX_LIVE_ROWS = 720;
export const MAX_CORPSE_ROWS = 300;
export const MAX_GIB_ROWS = 64; // detached limbs (bounded per quality by render/gore.js)
const GIB_BASE = MAX_LIVE_ROWS + MAX_CORPSE_ROWS;
const TEX_H = GIB_BASE + MAX_GIB_ROWS;
const DEATH_SECONDS = 1.35;

export const ACCENTS = {
  new_antioch: [0.42, 0.1, 0.08],
  black_grail: [0.52, 0.55, 0.24],
  iron_sultanate: [0.58, 0.28, 0.1],
};
// Phase 5A mirror matches: the twin side wears a different cloth accent (same faction models /
// silhouettes — only the banner / sash colour tells the two armies apart)
export const MIRROR_ACCENTS = {
  new_antioch: [0.14, 0.2, 0.34],
  black_grail: [0.38, 0.2, 0.34],
  iron_sultanate: [0.12, 0.35, 0.4],
};

export function accentFor(side) {
  const b = baseFaction(side);
  return (isTwin(side) ? MIRROR_ACCENTS[b] : ACCENTS[b]) || null;
}

function uploadModel(gl, mesh) {
  const vbo = createBuffer(gl, gl.ARRAY_BUFFER, mesh.vertices);
  const ibo = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, mesh.indices);
  const vao = createVAO(gl, [{
    buffer: vbo, stride: VERTEX_STRIDE, attribs: [
      { loc: 0, size: 3, type: gl.FLOAT, offset: 0 },
      { loc: 1, size: 4, type: gl.BYTE, normalized: true, offset: 12 },
      { loc: 2, size: 4, type: gl.UNSIGNED_BYTE, normalized: true, offset: 16 },
      { loc: 3, size: 4, type: gl.UNSIGNED_BYTE, normalized: true, offset: 20 },
    ],
  }], ibo);
  return { vao, count: mesh.indexCount, indexType: mesh.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, tris: mesh.indexCount / 3 };
}

function newVisual(id, modelId, model, seed) {
  return {
    id, modelId, model, seed,
    x: 0, y: 0, z: 0, rot: 0, scale: 1,
    phase: (seed % 628) / 100, walk: 0, aim: 0, aimYaw: 0, aimPitch: 0, recoil: 0, melee: -1, work: 0, workPhase: seed % 7,
    hit: 0, hitSide: 1, death: -1, rise: -1, variant: deathVariant(seed), time: 0,
    tint: ((seed & 255) / 255) * 2 - 1, mud: 0.25 + ((seed >> 8) & 255) / 255 * 0.5, wear: 0.3 + ((seed >> 16) & 255) / 255 * 0.7,
    highlight: 0, accent: [0.4, 0.1, 0.08], fade: 0, packPulse: 0, inTrench: false,
    seenFrame: 0, dirty: true,
    lost: 0, blood: 0, sick: 0, bio: false, gore: null,
    // Phase 3: livestock gait / grazing, cart wheels, getting up after a medic's revive
    gallop: 0, graze: 0, wheel: 0, getUp: -1,
  };
}

const ALL_MODELS = { ...UNIT_MODELS, ...UNIT_MODELS_P3, ...ANIMAL_MODELS };
const CIV_MODELS = ['na_civilian', 'na_civilian_b', 'na_civilian_c', 'na_civilian_d'];
const NEUTRAL_ACCENT = [0.32, 0.29, 0.24];

/** Model of a dead body: the soldier's own look, a livestock carcass, or an old battlefield body. */
function corpseModelId(c) {
  if (c.sp) return SPECIES[c.sp] ? SPECIES[c.sp].model : 'an_sheep';
  const u = UNITS[c.unit];
  if (!u) return 'na_yeoman';
  if (u.model === 'na_civilian') return CIV_MODELS[hash32(c.soldierId || c.id, 5) & 3];
  return u.model;
}

export function createUnitRenderer(gl, program, opts) {
  const models = {};
  const lod0Dist = opts.quality === 'low' ? 30 : opts.quality === 'high' ? 80 : 48;
  const corpseCap = opts.quality === 'low' ? 80 : opts.quality === 'high' ? 300 : 170;
  for (const id in ALL_MODELS) {
    const m0 = ALL_MODELS[id](0), m1 = ALL_MODELS[id](1);
    models[id] = {
      id, rig: m0.rig, weapon: m0.weapon, tool: m0.tool, hunch: m0.hunch || 0, heavy: !!m0.heavy,
      quad: !!m0.quad, rigid: !!m0.rigid, stride: m0.stride || 1, wheelR: m0.wheelR || 0.6,
      lods: [uploadModel(gl, m0.mesh), uploadModel(gl, m1.mesh)],
      height: m0.mesh.height,
    };
  }
  const poseData = new Float32Array(POSE_TEXELS * 4 * TEX_H);
  const poseTex = createTexture2D(gl, POSE_TEXELS, TEX_H, { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: gl.NEAREST });
  const visuals = new Map(); // soldier id -> visual
  const buckets = new Map(); // modelId|lod -> array of visuals
  const corpses = []; // visual corpses (bounded)
  let corpseDirty = true;
  const goreQ = GORE_QUALITY[opts.quality] ? opts.quality : 'balanced';
  const limbs = createLimbPool(goreQ); // bounded detached limbs
  const gibBuckets = new Map();
  let frame = 0;
  const stats = { soldiers: 0, drawn: 0, corpses: 0, triangles: 0 };

  const risenFrom = new Map(); // soldier id -> faction of the corpse it rose from (render-only)
  let sim0 = null;
  // presentation ground (trenches the viewer knows); falls back to the live world for tools
  const groundFn = opts.ground || ((x, z) => (sim0 ? groundHeightAt(sim0.world, sim0.rt.structGrid, x, z) : 0));
  function modelIdFor(sq, m) {
    const def = unitDef(sq.type);
    if (def.model === 'bg_thrall') return (hash32(m.id, 3) & 3) === 0 || baseFaction(risenFrom.get(m.id) || '') === 'new_antioch' ? 'bg_thrall_b' : 'bg_thrall';
    if (def.model === 'na_civilian') return CIV_MODELS[hash32(m.id, 5) & 3];
    return models[def.model] ? def.model : 'na_yeoman';
  }

  function visualFor(sq, m) {
    let v = visuals.get(m.id);
    if (!v) {
      const mid = modelIdFor(sq, m);
      v = newVisual(m.id, mid, models[mid], hash32(m.id, 17));
      v.accent = accentFor(sq.faction) || v.accent;
      v.x = m.x; v.z = m.z; v.rot = m.rot;
      visuals.set(m.id, v);
    }
    return v;
  }

  // ---------------------------------------------------------------- events
  function onEvent(ev, show, sim) {
    const SHOW_SOURCE = 1, SHOW_TARGET = 4;
    switch (ev.type) {
      case 'FIRE': {
        if (show & SHOW_SOURCE) { const v = visuals.get(ev.shooter); if (v) v.recoil = 1; }
        if ((show & SHOW_TARGET) && ev.hit) { const t = visuals.get(ev.target); if (t) { t.hit = 1; t.hitSide = (ev.shooter & 1) ? 1 : -1; } }
        break;
      }
      case 'MELEE': {
        if (show & SHOW_SOURCE) { const v = visuals.get(ev.attacker); if (v) v.melee = 0; }
        if ((show & SHOW_TARGET) && ev.hit) { const t = visuals.get(ev.target); if (t) t.hit = 1; }
        break;
      }
      case 'HIT': {
        const t = visuals.get(ev.id);
        if (t) {
          t.hit = 1; t.hitSide = ev.dx > 0 ? 1 : -1;
          if (ev.cause !== 'swarm' && ev.cause !== 'plague') t.blood = Math.min(0.75, t.blood + 0.22);
        }
        break;
      }
      case 'DEATH': {
        const v = visuals.get(ev.id);
        const plan = planDeath(ev, goreQ);
        if (v) {
          // orient the fall with the killing blow
          if (v.variant === 0 && (ev.dx || ev.dz)) v.rot = Math.atan2(-ev.dx, -ev.dz);
          else if (v.variant === 1 && (ev.dx || ev.dz)) v.rot = Math.atan2(ev.dx, ev.dz);
          v.deathRot = v.rot;
          v.blood = Math.max(v.blood, ev.cause === 'plague' || ev.cause === 'swarm' ? 0.25 : 0.55 + (plan.lost ? 0.35 : 0));
          v.bio = isOrganic(ev.faction);
          if (plan.lost) tearLimbs(v, plan, ev);
        }
        break;
      }
      case 'CORPSE_CREATED': {
        const v = visuals.get(ev.soldierId);
        const c = sim.rt.corpseById.get(ev.id);
        if (c) addCorpseVisual(c, v, sim);
        break;
      }
      case 'CORPSE_REMOVED': removeCorpseVisual(ev.id, ev.reason); break;
      case 'REVIVED': {
        // a medic got him back on his feet: stand up from where he lay
        const v = visuals.get(ev.id);
        if (v) { v.getUp = 0; v.death = -1; }
        break;
      }
      case 'SOLDIER_RISING': {
        // the risen body starts from the exact corpse pose it was lying in
        risenFrom.set(ev.id, ev.fromFaction);
        const cv = corpses.find((k) => k.id === ev.corpseId);
        const sq = sim.rt.squadById.get(ev.sq);
        const m = sq && sq.members.find((mm) => mm.id === ev.id);
        if (sq && m) {
          const v = visualFor(sq, m);
          if (cv) { v.variant = cv.variant; v.rot = cv.rot; }
          v.rise = 0;
        }
        break;
      }
      default: break;
    }
  }

  const J = [0, 0, 0];
  /** Tear limb chains off a dying visual: the stumps stay, each chain becomes a ballistic gib. */
  function tearLimbs(v, plan, ev) {
    v.lost = plan.lost;
    if (!v.model) return;
    // pose at the moment of the blow (upright, before the fall)
    const snap = { ...v, death: 0.04, rise: -1, lost: 0, gib: null, highlight: 0, fade: 0, accent: v.accent.slice() };
    computePose(SCRATCH, 0, v.model, snap);
    const k = ev.cause === 'explosive' ? 3 + 7 * (ev.force || 0) : 1.6 + Math.min(2.5, (ev.ov || 0) * 2);
    const dx = ev.dx || 0, dz = ev.dz || 0;
    let n = 0;
    for (const id of plan.chains) {
      const ch = CHAINS[id];
      jointWorld(ch.root, J);
      const l = limbs.acquire();
      const hsh = hash32(v.id, 91 + n);
      const jit = (i) => (((hsh >>> (i * 8)) & 255) / 255 - 0.5);
      l.age = 0; l.life = GORE_QUALITY[goreQ].limbLife; l.rest = false;
      l.rx = J[0]; l.ry = J[1]; l.rz = J[2];
      l.x = J[0]; l.y = J[1]; l.z = J[2];
      l.vx = dx * k + jit(0) * k * 0.9; l.vz = dz * k + jit(1) * k * 0.9;
      l.vy = (ev.cause === 'explosive' ? 3 + 6 * (ev.force || 0) : 1.2) + jit(2) * 1.5;
      let ax = jit(3), ay = 0.4, az = jit(1) + 0.2;
      const al = Math.hypot(ax, ay, az) || 1;
      l.ax = ax / al; l.ay = ay / al; l.az = az / al;
      l.ang = 0; l.spin = (6 + Math.abs(jit(2)) * 12) * (jit(3) > 0 ? 1 : -1);
      l.chain = id; l.mask = ch.mask; l.root = ch.root; l.bio = !!v.bio; l.trail = 0;
      l.visual = { ...snap, id: v.id * 16 + n, blood: 1, bio: !!v.bio, gib: { mask: ch.mask, root: ch.root, g: l.visual && l.visual.gib ? l.visual.gib.g : new Float32Array(12) } };
      n++;
    }
  }

  /** G = T(p) * R(axis, ang) * T(-r0): rigid world transform of a flying limb. */
  function limbTransform(l) {
    const g = l.visual.gib.g;
    const c = Math.cos(l.ang), s = Math.sin(l.ang), t = 1 - c;
    const x = l.ax, y = l.ay, z = l.az;
    g[0] = t * x * x + c; g[1] = t * x * y - s * z; g[2] = t * x * z + s * y;
    g[4] = t * x * y + s * z; g[5] = t * y * y + c; g[6] = t * y * z - s * x;
    g[8] = t * x * z - s * y; g[9] = t * y * z + s * x; g[10] = t * z * z + c;
    g[3] = l.x - (g[0] * l.rx + g[1] * l.ry + g[2] * l.rz);
    g[7] = l.y - (g[4] * l.rx + g[5] * l.ry + g[6] * l.rz);
    g[11] = l.z - (g[8] * l.rx + g[9] * l.ry + g[10] * l.rz);
  }

  function updateGibs(dt, time) {
    for (const b of gibBuckets.values()) b.length = 0;
    for (const l of limbs.items) {
      if (!l.active) continue;
      if (!stepLimb(l, dt, groundFn)) continue;
      limbTransform(l);
      const vis = l.visual;
      vis.time = time;
      // sink + fade in the last seconds (recycled quietly)
      const left = l.life - l.age;
      vis.fade = left < 3 ? 1 - left / 3 : 0;
      let b = gibBuckets.get(vis.modelId);
      if (!b) { b = []; gibBuckets.set(vis.modelId, b); }
      b.push(vis);
    }
    let row = GIB_BASE;
    for (const [, list] of gibBuckets) {
      list.rowBase = row;
      for (const vis of list) {
        if (row >= TEX_H) break;
        computePose(poseData, row * POSE_TEXELS * 4, vis.model, vis);
        row++;
      }
      list.rowCount = row - list.rowBase;
    }
    const n = row - GIB_BASE;
    stats.gibs = n;
    if (n > 0) {
      gl.bindTexture(gl.TEXTURE_2D, poseTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, GIB_BASE, POSE_TEXELS, n, gl.RGBA, gl.FLOAT, poseData, GIB_BASE * POSE_TEXELS * 4);
    }
  }

  function addCorpseVisual(c, v, sim) {
    if (corpses.some((k) => k.id === c.id)) return;
    const seed = v ? v.seed : hash32(c.soldierId || c.id, 17);
    let modelId = v && v.modelId && !c.sp ? v.modelId : corpseModelId(c);
    if (!models[modelId]) modelId = 'na_yeoman';
    const cv = newVisual(c.id, modelId, models[modelId], seed);
    cv.x = c.x; cv.z = c.z;
    cv.rot = v ? (v.deathRot !== undefined ? v.deathRot : v.rot) : c.rot;
    sim0 = sim;
    cv.y = groundFn(c.x, c.z);
    cv.death = 1;
    cv.variant = v ? v.variant : deathVariant(seed);
    cv.accent = accentFor(c.faction) || cv.accent;
    cv.mud = Math.min(1, (v ? v.mud : 0.5) + 0.25);
    // gore persists on the body the viewer saw fall (presentation only)
    cv.lost = v ? v.lost : 0;
    cv.blood = v ? Math.max(0.35, v.blood) : 0.5;
    cv.bio = isOrganic(c.faction);
    cv.sick = c.infected ? 0.7 : 0;
    if (c.old) { cv.mud = 1; cv.wear = 1; cv.blood = 0.12; cv.sick = 0.3; cv.tint = -0.8; cv.accent = NEUTRAL_ACCENT; }
    if (c.sp) { cv.accent = NEUTRAL_ACCENT; cv.blood = 0.45; cv.scale = 0.9 + ((seed >> 4) & 255) / 255 * 0.2; }
    cv.born = frame;
    cv.fadeOut = -1;
    corpses.push(cv);
    corpseDirty = true;
    // bounded: fade the oldest when over capacity
    let alive = corpses.filter((k) => k.fadeOut < 0).length;
    for (let i = 0; i < corpses.length && alive > corpseCap; i++) {
      if (corpses[i].fadeOut < 0) { corpses[i].fadeOut = 0; alive--; }
    }
  }

  function removeCorpseVisual(id, reason) {
    const i = corpses.findIndex((k) => k.id === id);
    if (i < 0) return;
    if (reason === 'raised') { corpses.splice(i, 1); corpseDirty = true; }
    else if (corpses[i].fadeOut < 0) corpses[i].fadeOut = 0;
  }

  /** The bodies the viewer knows about (kept across a renderer rebuild and in saves). */
  function exportCorpses() {
    return corpses.filter((c) => c.fadeOut < 0).map((c) => ({
      id: c.id, modelId: c.modelId, seed: c.seed, x: c.x, z: c.z, rot: c.rot, variant: c.variant, accent: c.accent.slice(), mud: c.mud,
      lost: c.lost || 0, blood: c.blood || 0, bio: !!c.bio, sick: c.sick || 0,
    }));
  }

  /** Restore remembered bodies — including ones raised or rotted away since, unseen by the viewer. */
  function importCorpses(list, sim) {
    sim0 = sim;
    for (const k of list || []) {
      if (!models[k.modelId] || corpses.some((c) => c.id === k.id)) continue;
      const cv = newVisual(k.id, k.modelId, models[k.modelId], k.seed);
      cv.x = k.x; cv.z = k.z; cv.rot = k.rot; cv.y = groundFn(k.x, k.z);
      cv.death = 1; cv.variant = k.variant; cv.mud = k.mud;
      cv.lost = k.lost || 0; cv.blood = k.blood || 0; cv.bio = !!k.bio; cv.sick = k.sick || 0;
      if (k.accent) cv.accent = k.accent;
      cv.born = frame; cv.fadeOut = -1;
      corpses.push(cv);
    }
    corpseDirty = true;
  }

  /** After load: rebuild visual corpses the player has seen. */
  function syncCorpses(sim, viewer) {
    const known = new Set(corpses.map((k) => k.id));
    for (const c of sim.state.corpses) {
      if (!known.has(c.id) && isCorpseKnownTo(c, viewer)) addCorpseVisual(c, null, sim);
    }
  }

  // ---------------------------------------------------------------- per frame
  const SPH = [0, 0, 0];

  function update(sim, camera, viewer, alpha, dt, selection, time) {
    frame++;
    const { state, rt } = sim;
    sim0 = sim;
    for (const b of buckets.values()) b.length = 0;
    stats.soldiers = 0;
    stats.animals = 0;
    const camX = camera.eye[0], camY = camera.eye[1], camZ = camera.eye[2];
    const tick = state.tick;
    for (const sq of state.squads) {
      if (!isSquadVisibleTo(sq, viewer)) continue;
      const def = unitDef(sq.type);
      const gy = groundFn(sq.cx, sq.cz);
      if (!sphereInFrustum(camera.planes, sq.cx, gy + 1, sq.cz, 14)) {
        for (const m of sq.members) { const v = visuals.get(m.id); if (v) v.seenFrame = frame; }
        continue;
      }
      const dcam = Math.hypot(sq.cx - camX, gy - camY, sq.cz - camZ);
      const lod = dcam < lod0Dist ? 0 : 1;
      const selected = selection && selection.has(sq.id) ? 1 : 0;
      const engaged = !!sq.target && sq.engaged;
      let tgtSq = null;
      if (sq.target && sq.target.k === 'squad') tgtSq = rt.squadById.get(sq.target.id);
      const enemy = sq.faction !== viewer;
      for (const m of sq.members) {
        if (m.state === 'sheltered') continue; // inside a building
        if (enemy && !isSoldierVisibleTo(sim, sq, m, viewer)) continue; // only the members in sight
        stats.soldiers++;
        const v = visualFor(sq, m);
        v.seenFrame = frame;
        // position: interpolate between ticks using the last tick's displacement
        const k = 1 - alpha;
        const x = m.x - m.vx * k, z = m.z - m.vz * k;
        const moved = Math.hypot(x - v.x, z - v.z);
        v.x = x; v.z = z;
        v.y = groundFn(x, z);
        v.inTrench = m.postId !== 0;
        v.time = time;
        v.highlight += ((selected ? 0.55 : 0) - v.highlight) * Math.min(1, dt * 10);
        const speed = Math.hypot(m.vx, m.vz) / DT;
        v.walk += (Math.min(1, speed / (def.speed * 0.9)) - v.walk) * Math.min(1, dt * 8);
        v.phase += moved * (Math.PI * 2) / (def.heavy ? 1.75 : 1.45);
        if (m.state === 'dying') {
          v.death = clamp01(((tick + alpha - m.stateTick) * DT) / DEATH_SECONDS);
          v.walk = 0;
        } else if (m.state === 'wounded') {
          // down, not dead: the fall stops short and he stays on the ground until a medic comes
          v.death = Math.min(0.97, clamp01(((tick + alpha - m.stateTick) * DT) / DEATH_SECONDS));
          v.walk = 0;
          v.getUp = -1;
        } else if (m.state === 'rising') {
          v.rise = clamp01(((tick + alpha - m.stateTick) * DT) / (RISING_TICKS * DT));
          v.death = -1;
        } else {
          v.death = -1;
          if (v.getUp >= 0) {
            v.getUp += dt / 1.1;
            v.rise = Math.min(1, v.getUp);
            if (v.getUp >= 1) { v.getUp = -1; v.rise = -1; }
          } else v.rise = -1;
          v.rot = lerpAngle(v.rot, m.rot, Math.min(1, dt * 12));
        }
        const wantAim = def.weapon && engaged && m.state === 'alive' && speed < 0.4 ? 1 : 0;
        v.aim += (wantAim - v.aim) * Math.min(1, dt * 5);
        v.aimYaw = 0;
        if (wantAim && tgtSq) {
          // aim pitch toward target height difference (trenches / slopes)
          const ty = groundFn(tgtSq.cx, tgtSq.cz);
          const d = Math.hypot(tgtSq.cx - x, tgtSq.cz - z) || 1;
          v.aimPitch = Math.max(-0.3, Math.min(0.3, -(ty - v.y) / d));
        } else v.aimPitch = 0;
        v.recoil = Math.max(0, v.recoil - dt * 7);
        v.hit = Math.max(0, v.hit - dt * 5);
        if (v.melee >= 0) { v.melee += dt / 0.45; if (v.melee > 1) v.melee = -1; }
        const wantWork = m.working ? 1 : 0;
        v.work += (wantWork - v.work) * Math.min(1, dt * 4);
        v.workPhase += dt * 4.2;
        v.packPulse = def.model === 'bg_corpse_guard' ? Math.sin(time * 3 + v.seed) * 0.012 : 0;
        // visible sickness of a soldier the viewer sees (infection stacks)
        v.sick = isPlagueImmune(sq.faction) ? 0 : Math.min(1, m.infection / INFECTION_MAX * 1.4);
        v.bio = isOrganic(sq.faction);
        if (m.state !== 'dying') v.lost = 0;
        const key = v.modelId + '|' + lod;
        let b = buckets.get(key);
        if (!b) { b = []; buckets.set(key, b); }
        b.push(v);
      }
    }
    // livestock and wildlife (only while the viewer sees them) and supply carts on the roads
    livestock(sim, camera, viewer, dt, time, camX, camY, camZ);
    convoys(sim, camera, viewer, dt, time, camX, camY, camZ);
    // extra instances (fortified position crews, gallery)
    if (opts.extras) for (const v of opts.extras(time, dt)) {
      const key = v.modelId + '|' + (v.lod || 0);
      let b = buckets.get(key);
      if (!b) { b = []; buckets.set(key, b); }
      if (!v.model) v.model = models[v.modelId];
      b.push(v);
    }
    // drop visuals not seen for a while (dead / hidden)
    if (frame % 60 === 0) for (const [id, v] of visuals) if (frame - v.seenFrame > 120) visuals.delete(id);
    // write live rows
    let row = 0;
    stats.drawn = 0;
    for (const list of buckets.values()) {
      list.rowBase = row;
      for (const v of list) {
        if (row >= MAX_LIVE_ROWS) break;
        computePose(poseData, row * POSE_TEXELS * 4, v.model, v);
        row++;
      }
      list.rowCount = row - list.rowBase;
      stats.drawn += list.rowCount;
    }
    gl.bindTexture(gl.TEXTURE_2D, poseTex);
    if (row > 0) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, POSE_TEXELS, row, gl.RGBA, gl.FLOAT, poseData, 0);
    updateCorpses(sim, dt, time);
    if (frame % 2 === 0) twitchCorpses(sim, viewer, time);
    updateGibs(dt, time);
  }

  function bucketPush(v, lod) {
    const key = v.modelId + '|' + lod;
    let b = buckets.get(key);
    if (!b) { b = []; buckets.set(key, b); }
    b.push(v);
  }

  function livestock(sim, camera, viewer, dt, time, camX, camY, camZ) {
    for (const a of sim.state.animals) {
      if (!isAnimalVisibleTo(a, viewer)) continue;
      const sp = SPECIES[a.sp];
      if (!sp || !models[sp.model]) continue;
      let v = visuals.get(a.id);
      if (!v) {
        v = newVisual(a.id, sp.model, models[sp.model], hash32(a.id, 29));
        v.x = a.x; v.z = a.z; v.rot = a.rot;
        v.accent = NEUTRAL_ACCENT;
        v.scale = 0.88 + ((v.seed >> 4) & 255) / 255 * 0.24;
        v.mud = 0.35 + ((v.seed >> 12) & 255) / 255 * 0.4;
        visuals.set(a.id, v);
      }
      v.seenFrame = frame;
      const gy = groundFn(a.x, a.z);
      if (!sphereInFrustum(camera.planes, a.x, gy + 0.6, a.z, 2.5)) continue;
      // the herd moves every other tick: glide toward the sim position
      const k = Math.min(1, dt * 9);
      const nx = v.x + (a.x - v.x) * k, nz = v.z + (a.z - v.z) * k;
      const moved = Math.hypot(nx - v.x, nz - v.z);
      v.x = nx; v.z = nz; v.y = groundFn(nx, nz);
      v.rot = lerpAngle(v.rot, a.rot, Math.min(1, dt * 6));
      const speed = Math.hypot(a.vx, a.vz) / (DT * 2);
      v.walk += (Math.min(1, speed / Math.max(0.3, sp.speed)) - v.walk) * Math.min(1, dt * 6);
      v.gallop += ((speed > sp.speed * 1.7 ? 1 : 0) - v.gallop) * Math.min(1, dt * 4);
      v.phase += (moved * Math.PI * 2) / (v.model.stride || 1);
      const grazing = speed < 0.05 && ((time * 0.11 + (v.seed & 1023) / 1023) % 1) < 0.62;
      v.graze += ((grazing ? 1 : 0) - v.graze) * Math.min(1, dt * 1.6);
      v.time = time; v.death = -1; v.rise = -1;
      stats.animals = (stats.animals || 0) + 1;
      const dcam = Math.hypot(a.x - camX, gy - camY, a.z - camZ);
      bucketPush(v, dcam < lod0Dist ? 0 : 1);
    }
  }

  function convoys(sim, camera, viewer, dt, time, camX, camY, camZ) {
    for (const c of sim.state.convoys) {
      if (!isConvoyVisibleTo(c, viewer)) continue;
      const gy = groundFn(c.x, c.z);
      if (!sphereInFrustum(camera.planes, c.x, gy + 1, c.z, 5)) continue;
      let cart = visuals.get(c.id);
      if (!cart) {
        cart = newVisual(c.id, 'cart', models.cart, hash32(c.id, 31));
        cart.x = c.x; cart.z = c.z; cart.rot = c.rot; cart.accent = NEUTRAL_ACCENT;
        visuals.set(c.id, cart);
      }
      let mule = visuals.get(-c.id);
      if (!mule) {
        mule = newVisual(-c.id, 'an_mule', models.an_mule, hash32(c.id, 37));
        mule.accent = NEUTRAL_ACCENT;
        visuals.set(-c.id, mule);
      }
      cart.seenFrame = frame; mule.seenFrame = frame;
      const k = Math.min(1, dt * 8);
      const nx = cart.x + (c.x - cart.x) * k, nz = cart.z + (c.z - cart.z) * k;
      const moved = Math.hypot(nx - cart.x, nz - cart.z);
      cart.x = nx; cart.z = nz; cart.y = groundFn(nx, nz);
      cart.rot = lerpAngle(cart.rot, c.rot, Math.min(1, dt * 4));
      cart.wheel -= moved / (models.cart.wheelR || 0.6);
      cart.time = time;
      const fx = Math.sin(cart.rot), fz = Math.cos(cart.rot);
      mule.x = cart.x + fx * 3.1; mule.z = cart.z + fz * 3.1; mule.y = groundFn(mule.x, mule.z);
      mule.rot = cart.rot;
      mule.walk += (Math.min(1, moved / Math.max(1e-4, dt) / 1.2) - mule.walk) * Math.min(1, dt * 5);
      mule.phase += (moved * Math.PI * 2) / (models.an_mule.stride || 1);
      mule.time = time; mule.death = -1;
      const dcam = Math.hypot(c.x - camX, gy - camY, c.z - camZ);
      const lod = dcam < lod0Dist ? 0 : 1;
      bucketPush(cart, lod);
      bucketPush(mule, lod);
    }
  }

  // corpse rows are rewritten only when the set changes or fades progress
  const corpseBuckets = new Map();
  function updateCorpses(sim, dt, time) {
    let fading = false;
    for (let i = corpses.length - 1; i >= 0; i--) {
      const c = corpses[i];
      if (c.fadeOut >= 0) {
        c.fadeOut += dt / 2.5;
        c.fade = Math.min(1, c.fadeOut);
        fading = true;
        if (c.fadeOut >= 1) { corpses.splice(i, 1); corpseDirty = true; }
      }
    }
    if (!corpseDirty && !(fading && frame % 6 === 0)) return;
    corpseDirty = false;
    for (const b of corpseBuckets.values()) b.length = 0;
    for (const c of corpses) {
      let b = corpseBuckets.get(c.modelId);
      if (!b) { b = []; corpseBuckets.set(c.modelId, b); }
      b.push(c);
    }
    let row = MAX_LIVE_ROWS;
    for (const [, list] of corpseBuckets) {
      list.rowBase = row;
      for (const c of list) {
        if (row >= TEX_H) break;
        c.time = time;
        c.y2 = c.y - (c.fade || 0) * 0.35; // sink into the mud while fading
        const y = c.y;
        c.y = c.y2;
        computePose(poseData, row * POSE_TEXELS * 4, c.model, c);
        c.y = y;
        c.row = row;
        c.tw = 0;
        row++;
      }
      list.rowCount = row - list.rowBase;
    }
    stats.corpses = corpses.length;
    const n = row - MAX_LIVE_ROWS;
    gl.bindTexture(gl.TEXTURE_2D, poseTex);
    if (n > 0) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, MAX_LIVE_ROWS, POSE_TEXELS, n, gl.RGBA, gl.FLOAT, poseData, MAX_LIVE_ROWS * POSE_TEXELS * 4);
  }

  // Phase 4.1: a body about to rise TWITCHES in its last seconds (only bodies the viewer may know
  // are about to rise, sim/corpse_view.js). Just those rows are re-posed and uploaded (bounded).
  const TWITCH_MAX = 16;
  function twitchCorpses(sim, viewer, time) {
    let n = 0;
    for (const cv of corpses) {
      if (cv.fadeOut >= 0 || cv.row === undefined || cv.row >= TEX_H) continue;
      const c = sim.rt.corpseById.get(cv.id);
      const tw = !!c && corpseTwitching(sim, viewer, c);
      if (!tw && !cv.tw) continue;
      if (n++ >= TWITCH_MAX) break;
      const d0 = cv.death, r0 = cv.rise;
      if (tw) {
        const k = Math.sin(time * 11 + cv.seed * 0.01);
        cv.death = -1;
        cv.rise = 0.03 + 0.05 * Math.max(0, k) * Math.max(0, Math.sin(time * 3.1 + cv.seed * 0.02));
      }
      cv.tw = tw ? 1 : 0;
      cv.time = time;
      const y = cv.y;
      cv.y = cv.y2 !== undefined ? cv.y2 : cv.y;
      computePose(poseData, cv.row * POSE_TEXELS * 4, cv.model, cv);
      cv.y = y;
      cv.death = d0; cv.rise = r0;
      gl.bindTexture(gl.TEXTURE_2D, poseTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, cv.row, POSE_TEXELS, 1, gl.RGBA, gl.FLOAT, poseData, cv.row * POSE_TEXELS * 4);
    }
  }

  /** Draw soldiers + corpses. `prog` overrides the program (shadow depth pass). */
  function draw(setCommon, prog) {
    const p = prog || program;
    const depth = !!prog;
    gl.useProgram(p.program);
    setCommon(p);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, poseTex);
    gl.uniform1i(p.u.uPoseTex, 3);
    gl.disable(gl.CULL_FACE);
    if (!depth) stats.triangles = 0;
    for (const [key, list] of buckets) {
      if (!list.rowCount) continue;
      const [mid, lod] = key.split('|');
      // shadow casters use the light LOD (silhouette is what matters in the depth map)
      const m = models[mid].lods[depth ? 1 : Number(lod)];
      gl.bindVertexArray(m.vao);
      gl.uniform1i(p.u.uRowBase, list.rowBase);
      drawElements(gl, gl.TRIANGLES, m.count, m.indexType, list.rowCount);
      if (!depth) stats.triangles += m.tris * list.rowCount;
    }
    for (const [mid, list] of corpseBuckets) {
      if (!list.rowCount) continue;
      const m = models[mid].lods[1];
      gl.bindVertexArray(m.vao);
      gl.uniform1i(p.u.uRowBase, list.rowBase);
      drawElements(gl, gl.TRIANGLES, m.count, m.indexType, list.rowCount);
    }
    if (!depth) for (const [mid, list] of gibBuckets) {
      if (!list.rowCount) continue;
      const m = models[mid].lods[1];
      gl.bindVertexArray(m.vao);
      gl.uniform1i(p.u.uRowBase, list.rowBase);
      drawElements(gl, gl.TRIANGLES, m.count, m.indexType, list.rowCount);
    }
    gl.bindVertexArray(null);
    gl.enable(gl.CULL_FACE);
  }

  /** Muzzle world position for a visible shooter (for muzzle flash / tracer origins). */
  const MZ = [0, 0, 0];
  function muzzleOf(soldierId, out) {
    const v = visuals.get(soldierId);
    if (!v || !v.model) return null;
    computePose(SCRATCH, 0, v.model, v);
    muzzleWorld(v.model, MZ);
    out[0] = MZ[0]; out[1] = MZ[1]; out[2] = MZ[2];
    return out;
  }
  const SCRATCH = new Float32Array(POSE_FLOATS);

  function visualOf(id) {
    return visuals.get(id) || null;
  }

  return { update, draw, onEvent, syncCorpses, exportCorpses, importCorpses, muzzleOf, visualOf, bucketsView: () => buckets, stats, models, corpses, visuals, limbs };
}
