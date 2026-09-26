// Soldier rendering: per-model/LOD instanced skinned draws with CPU-computed procedural poses
// in a float pose texture. Frustum culling per squad, distance LOD, animation state driven by
// sim state + filtered events, bounded visual corpse pool (separate from gameplay corpses).
import { createBuffer, createVAO, createTexture2D, drawElements } from './gl.js';
import { POSE_TEXELS } from './shaders.js';
import { computePose, POSE_FLOATS, deathVariant, muzzleWorld } from './anim.js';
import { UNIT_MODELS } from './models/humans.js';
import { VERTEX_STRIDE } from './models/meshbuilder.js';
import { sphereInFrustum, lerpAngle, clamp01 } from './math3d.js';
import { unitDef } from '../data/units.js';
import { groundHeightAt } from '../world/ground.js';
import { isSquadVisibleTo, isCorpseKnownTo, isSoldierVisibleTo } from '../sim/perception.js';
import { hash32 } from '../core/rng.js';
import { DT, DYING_TICKS, RISING_TICKS } from '../sim/constants.js';

export const MAX_LIVE_ROWS = 720;
export const MAX_CORPSE_ROWS = 300;
const TEX_H = MAX_LIVE_ROWS + MAX_CORPSE_ROWS;
const DEATH_SECONDS = 1.35;

export const ACCENTS = {
  new_antioch: [0.42, 0.1, 0.08],
  black_grail: [0.52, 0.55, 0.24],
};

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
  };
}

export function createUnitRenderer(gl, program, opts) {
  const models = {};
  const lod0Dist = opts.quality === 'low' ? 30 : opts.quality === 'high' ? 80 : 48;
  const corpseCap = opts.quality === 'low' ? 80 : opts.quality === 'high' ? 300 : 170;
  for (const id in UNIT_MODELS) {
    const m0 = UNIT_MODELS[id](0), m1 = UNIT_MODELS[id](1);
    models[id] = {
      id, rig: m0.rig, weapon: m0.weapon, tool: m0.tool, hunch: m0.hunch || 0, heavy: !!m0.heavy,
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
  let frame = 0;
  const stats = { soldiers: 0, drawn: 0, corpses: 0, triangles: 0 };

  const risenFrom = new Map(); // soldier id -> faction of the corpse it rose from (render-only)
  let sim0 = null;
  // presentation ground (trenches the viewer knows); falls back to the live world for tools
  const groundFn = opts.ground || ((x, z) => (sim0 ? groundHeightAt(sim0.world, sim0.rt.structGrid, x, z) : 0));
  function modelIdFor(sq, m) {
    const def = unitDef(sq.type);
    if (def.model === 'bg_thrall') return (hash32(m.id, 3) & 3) === 0 || risenFrom.get(m.id) === 'new_antioch' ? 'bg_thrall_b' : 'bg_thrall';
    return def.model;
  }

  function visualFor(sq, m) {
    let v = visuals.get(m.id);
    if (!v) {
      const mid = modelIdFor(sq, m);
      v = newVisual(m.id, mid, models[mid], hash32(m.id, 17));
      v.accent = ACCENTS[sq.faction] || v.accent;
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
      case 'HIT': { const t = visuals.get(ev.id); if (t) { t.hit = 1; t.hitSide = ev.dx > 0 ? 1 : -1; } break; }
      case 'DEATH': {
        const v = visuals.get(ev.id);
        if (v) {
          // orient the fall with the killing blow
          if (v.variant === 0 && (ev.dx || ev.dz)) v.rot = Math.atan2(-ev.dx, -ev.dz);
          else if (v.variant === 1 && (ev.dx || ev.dz)) v.rot = Math.atan2(ev.dx, ev.dz);
          v.deathRot = v.rot;
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

  function addCorpseVisual(c, v, sim) {
    if (corpses.some((k) => k.id === c.id)) return;
    const seed = v ? v.seed : hash32(c.soldierId || c.id, 17);
    const modelId = v ? v.modelId : (unitDef(c.unit).model === 'bg_thrall' ? 'bg_thrall' : unitDef(c.unit).model);
    const cv = newVisual(c.id, modelId, models[modelId], seed);
    cv.x = c.x; cv.z = c.z;
    cv.rot = v ? (v.deathRot !== undefined ? v.deathRot : v.rot) : c.rot;
    sim0 = sim;
    cv.y = groundFn(c.x, c.z);
    cv.death = 1;
    cv.variant = v ? v.variant : deathVariant(seed);
    cv.accent = ACCENTS[c.faction] || cv.accent;
    cv.mud = Math.min(1, (v ? v.mud : 0.5) + 0.25);
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
        } else if (m.state === 'rising') {
          v.rise = clamp01(((tick + alpha - m.stateTick) * DT) / (RISING_TICKS * DT));
          v.death = -1;
        } else {
          v.death = -1;
          v.rise = -1;
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
        const key = v.modelId + '|' + lod;
        let b = buckets.get(key);
        if (!b) { b = []; buckets.set(key, b); }
        b.push(v);
      }
    }
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
        row++;
      }
      list.rowCount = row - list.rowBase;
    }
    stats.corpses = corpses.length;
    const n = row - MAX_LIVE_ROWS;
    gl.bindTexture(gl.TEXTURE_2D, poseTex);
    if (n > 0) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, MAX_LIVE_ROWS, POSE_TEXELS, n, gl.RGBA, gl.FLOAT, poseData, MAX_LIVE_ROWS * POSE_TEXELS * 4);
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

  return { update, draw, onEvent, syncCorpses, exportCorpses, importCorpses, muzzleOf, visualOf, bucketsView: () => buckets, stats, models, corpses, visuals };
}

