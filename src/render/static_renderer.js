// Static & structure rendering: instanced props (per-frame frustum culled, 2 LODs), structures
// from sim state (construction clip + damage), resource nodes (only when discovered), unique
// world mesh (houses / ruins / bridge), render-only wreckage left by destroyed structures,
// and fortified-position crews (virtual soldiers fed to the unit renderer).
import { createBuffer, createVAO, drawElements } from './gl.js';
import { VERTEX_STRIDE, MeshBuilder, MAT } from './models/meshbuilder.js';
import { C } from './models/palette.js';
import { PROP_MODELS, propModelKey } from './models/props.js';
import { STRUCTURE_MODELS, buildWorldStatic } from './models/structures.js';
import { sphereInFrustum } from './math3d.js';
import { STRUCTURES } from '../data/structures.js';
import { isStructureKnownTo, isStructureVisibleTo, isNodeKnownTo } from '../sim/perception.js';
import { groundHeightAt } from '../world/ground.js';
import { baseHeightAt } from '../world/terrain.js';
import { hash32 } from '../core/rng.js';
import { deathVariant } from './anim.js';
import { createClutter } from './clutter.js';
import { structGridQuery } from '../world/structgrid.js';

const DEFAULT_CAP = 96;
const NODE_MODEL = { salvage_rubble: 'rubble_1', salvage_wreck: 'cart_0', salvage_gun: 'wreck_gun' };

function upload(gl, mesh, instBuf) {
  const vbo = createBuffer(gl, gl.ARRAY_BUFFER, mesh.vertices);
  const ibo = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, mesh.indices);
  const vao = createVAO(gl, [
    {
      buffer: vbo, stride: VERTEX_STRIDE, attribs: [
        { loc: 0, size: 3, type: gl.FLOAT, offset: 0 },
        { loc: 1, size: 4, type: gl.BYTE, normalized: true, offset: 12 },
        { loc: 2, size: 4, type: gl.UNSIGNED_BYTE, normalized: true, offset: 16 },
      ],
    },
    {
      buffer: instBuf, stride: 32, attribs: [
        { loc: 4, size: 4, type: gl.FLOAT, offset: 0, divisor: 1 },
        { loc: 5, size: 4, type: gl.FLOAT, offset: 16, divisor: 1 },
      ],
    },
  ], ibo);
  return { vao, count: mesh.indexCount, type: mesh.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, height: mesh.height, radius: mesh.radius };
}

export function createStaticRenderer(gl, program, world, sim, opts) {
  // per-model dynamic instance buffers sized from the world content (+ headroom for wrecks)
  const models = {};
  const need = {};
  for (const p of world.props) { const k = propModelKey(p); if (k) need[k] = (need[k] || 0) + 1; }
  const addModel = (key, builder) => {
    const cap = (need[key] || 0) + DEFAULT_CAP + (key.startsWith('rubble') || key === 'beam_0' ? 220 : 0);
    const lods = [];
    for (let l = 0; l < 2; l++) {
      const mesh = builder(l);
      const inst = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(8 * cap), gl.DYNAMIC_DRAW);
      const m = upload(gl, mesh, inst);
      m.inst = inst;
      m.cap = cap;
      m.data = new Float32Array(8 * cap);
      m.n = 0;
      lods.push(m);
    }
    models[key] = { key, lods, height: lods[0].height, radius: Math.max(lods[0].radius, 1), foliage: /^(grass|shrub|tree|stump)/.test(key) };
  };
  for (const k in PROP_MODELS) addModel(k, PROP_MODELS[k]);
  for (const k in STRUCTURE_MODELS) addModel(k, STRUCTURE_MODELS[k]);
  addModel('wreck_gun', wreckGunBuilder);

  // unique world mesh (houses / ruins / bridge)
  const worldInst = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 0, 1, 0.5, 1, 0]));
  const worldMesh = upload(gl, buildWorldStatic(world, (x, z) => baseHeightAt(world.terrain, x, z)), worldInst);

  // static props: precompute placement
  const props = [];
  for (const p of world.props) {
    const key = propModelKey(p);
    if (!key || !models[key]) continue;
    const y = baseHeightAt(world.terrain, p.x, p.z);
    props.push({ key, x: p.x, y: y - 0.05, z: p.z, rot: p.rot, s: p.s, tint: (hash32(p.seed, 5) & 255) / 255 });
  }
  const wrecks = []; // render-only remains of destroyed structures (persistent battlefield)
  const crews = new Map(); // fire post id -> [visual, visual]; field gun id -> [layer, loader, spotter]
  const gunRecoil = new Map(); // field gun id -> recoil 1..0 (presentation only)
  const lodDist = opts.quality === 'low' ? 60 : opts.quality === 'high' ? 140 : 95;
  const clutter = createClutter(gl, world, { density: opts.clutter !== undefined ? opts.clutter : 0.7, quality: opts.quality });
  let clutterSig = null;
  // presentation ground: carved only by trenches the viewer knows (see renderer.groundAt)
  const ground = opts.ground || ((x, z) => groundHeightAt(world, sim.rt.structGrid, x, z));

  function push(key, x, y, z, rot, s, tint, prog, dmg, camera) {
    const m = models[key];
    if (prog < 0.999) m.cut = true; // needs the discard variant this frame
    if (!m) return;
    const r = m.radius * s + 2;
    if (!sphereInFrustum(camera.planes, x, y + m.height * s * 0.5, z, r + m.height * s * 0.5)) return;
    const d = Math.hypot(x - camera.eye[0], y - camera.eye[1], z - camera.eye[2]);
    const l = m.lods[d < lodDist + r ? 0 : 1];
    if (l.n >= l.cap) return;
    const o = l.n * 8;
    l.data[o] = x; l.data[o + 1] = y; l.data[o + 2] = z; l.data[o + 3] = rot;
    l.data[o + 4] = s; l.data[o + 5] = tint; l.data[o + 6] = prog; l.data[o + 7] = dmg;
    l.n++;
  }

  function structureModel(st) {
    const def = STRUCTURES[st.type];
    if (def.kind === 'linear') return null;
    if (st.type === 'bastion') return st.hp / st.maxHp < 0.55 ? 'bastion_damaged' : 'bastion';
    return def.model;
  }

  /**
   * known: structures as the viewer knows them; knownSig: its signature (clutter is re-filtered
   * against KNOWN structures only when it changes); nodes: resource heaps as last seen.
   */
  function update(sim2, camera, viewer, dt, time, known, knownSig, nodes) {
    if (knownSig !== clutterSig) { clutterSig = knownSig; clutter.refilter(opts.grid || sim2.rt.structGrid, structGridQuery); }
    clutter.update(camera);
    for (const k in models) { models[k].cut = false; for (const l of models[k].lods) l.n = 0; }
    for (const p of props) push(p.key, p.x, p.y, p.z, p.rot, p.s, p.tint, 1, 0, camera);
    for (const w of wrecks) push(w.key, w.x, w.y, w.z, w.rot, w.s, 0.2, 1, 0.8, camera);
    for (const st of known || sim2.state.structures) {
      const key = structureModel(st);
      if (!key) continue;
      if (!known && !isStructureKnownTo(st, viewer)) continue;
      const y = ground(st.x, st.z);
      const dmg = st.built ? Math.max(0, 1 - st.hp / st.maxHp) : 0;
      const prog = st.built ? 1 : Math.max(0.02, st.progress);
      if (st.type === 'field_gun') {
        // the whole gun traverses (trail shifted); the barrel runs back on recoil and returns
        const aim = st.aim !== undefined ? st.aim : st.rot;
        const rc = gunRecoil.get(st.id) || 0;
        if (rc > 0) gunRecoil.set(st.id, Math.max(0, rc - dt * 2.2));
        const back = rc > 0.6 ? (1 - rc) * 2.5 * 0.55 : rc * 0.55 / 0.6; // snap back, then slow run-out
        push(key, st.x, y, st.z, aim, 1, 0.5, prog, dmg, camera);
        if (prog > 0.6) push('field_gun_barrel', st.x - Math.sin(aim) * back, y, st.z - Math.cos(aim) * back, aim, 1, 0.5, 1, dmg, camera);
        continue;
      }
      push(key, st.x, y, st.z, st.rot, 1, 0.5, prog, dmg, camera);
    }
    for (const n of nodes || sim2.state.nodes) {
      if (n.amount <= 0 || (!nodes && !isNodeKnownTo(n, viewer))) continue;
      const key = NODE_MODEL[n.type];
      const y = baseHeightAt(world.terrain, n.x, n.z);
      const s = 0.55 + 0.45 * (n.amount / n.max);
      push(key, n.x, y, n.z, (n.id * 1.3) % 6.28, s, 0.3, 1, 0.3, camera);
    }
    for (const k in models) {
      for (const l of models[k].lods) {
        if (!l.n) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, l.inst);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, l.data, 0, l.n * 8);
      }
    }
  }

  function begin(p, setCommon) {
    gl.useProgram(p.program);
    setCommon(p);
    if (p.u.uAccent) gl.uniform3f(p.u.uAccent, 0.42, 0.1, 0.08);
    if (p.u.uGhost) gl.uniform4f(p.u.uGhost, 0, 0, 0, 0);
  }

  function drawModels(p, depth, cut) {
    if (p.u.uMud) gl.uniform1f(p.u.uMud, 0.22);
    for (const k in models) {
      const m = models[k];
      if (!!m.cut !== cut) continue;
      if (depth && m.noShadow) continue;
      if (p.u.uBackDim) gl.uniform1f(p.u.uBackDim, m.foliage ? 1 : 0.35);
      gl.uniform1f(p.u.uModelHeight, m.height);
      for (let li = 0; li < m.lods.length; li++) {
        const l = m.lods[li];
        if (!l.n) continue;
        gl.bindVertexArray(l.vao);
        drawElements(gl, gl.TRIANGLES, l.count, l.type, l.n);
      }
    }
  }

  /**
   * Draw all static instances. `prog` is given for the shadow depth pass. Everything fully built is
   * drawn with the discard-free variant; only models with a construction site this frame use the
   * construction-cut variant.
   */
  function draw(setCommon, prog) {
    const depth = !!prog;
    const fast = opts.fast ? (depth ? opts.fast.shadow : opts.fast.main) : (prog || program);
    const cutP = depth ? prog : program;
    const p = fast;
    begin(p, setCommon);
    gl.disable(gl.CULL_FACE);
    gl.uniform1f(p.u.uModelHeight, 40);
    if (p.u.uMud) gl.uniform1f(p.u.uMud, -1);
    if (p.u.uBackDim) gl.uniform1f(p.u.uBackDim, 0.35);
    gl.bindVertexArray(worldMesh.vao);
    drawElements(gl, gl.TRIANGLES, worldMesh.count, worldMesh.type, 1);
    drawModels(p, depth, false);
    if (p.u.uMud) gl.uniform1f(p.u.uMud, -1);
    if (p.u.uBackDim) gl.uniform1f(p.u.uBackDim, 1);
    if (clutter) clutter.draw(p, depth);
    let anyCut = false;
    for (const k in models) if (models[k].cut) { anyCut = true; break; }
    if (anyCut) {
      begin(cutP, setCommon);
      drawModels(cutP, depth, true);
      if (cutP.u.uMud) gl.uniform1f(cutP.u.uMud, -1);
      if (cutP.u.uBackDim) gl.uniform1f(cutP.u.uBackDim, 1);
    }
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }

  function onEvent(ev, show, sim2) {
    if (ev.type === 'RUIN_COLLAPSED' && show) {
      // the walls come down: heaps of masonry inside the ruin (the wall mesh stays as the stumps)
      const def = STRUCTURES[ev.stype];
      const y = ground(ev.x, ev.z);
      const r = Math.max(def.footprint.w, def.footprint.d);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * 6.28 + ev.id * 0.7;
        wrecks.push({ key: i % 2 ? 'rubble_0' : 'rubble_2', x: ev.x + Math.cos(a) * r * 0.22, y, z: ev.z + Math.sin(a) * r * 0.22, rot: a, s: 0.9 + r / 14 });
      }
      return;
    }
    if (ev.type === 'STRUCTURE_DESTROYED' && !ev.cancelled && show) {
      const def = STRUCTURES[ev.stype];
      if (def.kind === 'building') {
        const y = ground(ev.x, ev.z);
        const r = Math.max(def.footprint.w, def.footprint.d);
        const n = Math.max(1, Math.round(r / 5));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * 6.28 + ev.id;
          wrecks.push({ key: i % 2 ? 'rubble_0' : 'rubble_2', x: ev.x + Math.cos(a) * r * 0.25, y, z: ev.z + Math.sin(a) * r * 0.25, rot: a, s: 0.6 + r / 16 });
        }
        if (ev.stype === 'fire_post' || ev.stype === 'obs_post') wrecks.push({ key: 'beam_0', x: ev.x, y: y + 0.2, z: ev.z, rot: ev.id, s: 1 });
        while (wrecks.length > 200) wrecks.shift();
      }
      crews.delete(ev.id);
    }
    if (ev.type === 'STRUCTURE_FIRE' && (show & 1)) {
      const c = crews.get(ev.struct);
      if (c) c[0].recoil = 1;
      if (ev.weapon === 'field_gun_shell') gunRecoil.set(ev.struct, 1);
    }
  }

  /** Crew figures for fortified fire positions (render-only virtual soldiers). */
  const out = [];
  function crewInstances(sim2, viewer, time, dt) {
    out.length = 0;
    for (const st of sim2.state.structures) {
      if (st.type === 'field_gun' && st.built && isStructureVisibleTo(st, viewer)) { gunCrew(st, time, dt); continue; }
      if (st.type !== 'fire_post' || !st.built || !isStructureVisibleTo(st, viewer)) continue;
      let c = crews.get(st.id);
      if (!c) {
        c = [0, 1].map((k) => crewVisual(st, k));
        crews.set(st.id, c);
      }
      const y = ground(st.x, st.z);
      const fx = Math.sin(st.rot), fz = Math.cos(st.rot);
      const rx = -Math.cos(st.rot), rz = Math.sin(st.rot);
      const gunner = c[0], loader = c[1];
      gunner.x = st.x + fx * 0.05 + rx * 0.05; gunner.z = st.z + fz * 0.05 + rz * 0.05; gunner.y = y - 0.35;
      gunner.rot = st.rot; gunner.aim = 1; gunner.time = time;
      loader.x = st.x - fx * 0.3 + rx * 0.85; loader.z = st.z - fz * 0.3 + rz * 0.85; loader.y = y - 0.4;
      loader.rot = st.rot + 0.5; loader.aim = 0; loader.time = time; loader.work = 0.4; loader.workPhase += dt * 1.2;
      gunner.recoil = Math.max(0, gunner.recoil - dt * 8);
      out.push(gunner, loader);
    }
    return out;
  }

  /** Field gun crew: the layer at the sight, the loader at the breech, a spotter at the pit edge. */
  function gunCrew(st, time, dt) {
    let c = crews.get(st.id);
    if (!c) { c = [0, 1, 2].map((k) => crewVisual(st, k)); crews.set(st.id, c); }
    const aim = st.aim !== undefined ? st.aim : st.rot;
    const y = ground(st.x, st.z);
    const fx = Math.sin(aim), fz = Math.cos(aim), rx = -Math.cos(aim), rz = Math.sin(aim);
    const place = (v, f, r, rot, work) => {
      v.x = st.x + fx * f + rx * r; v.z = st.z + fz * f + rz * r; v.y = y - 0.05;
      v.rot = rot; v.time = time; v.aim = 0; v.work = work; v.workPhase += dt * (work ? 1.6 : 0);
    };
    const rc = gunRecoil.get(st.id) || 0;
    place(c[0], -0.3, -0.55, aim, 0);
    place(c[1], -1.1, 0.45, aim + 0.4, rc > 0.2 ? 0.8 : 0.3);
    place(c[2], -1.9, -1.6, aim - 0.3, 0);
    c[2].aim = 0;
    out.push(c[0], c[1], c[2]);
  }

  function crewVisual(st, k) {
    const seed = hash32(st.id, k + 1);
    return {
      id: -st.id * 10 - k, modelId: 'na_yeoman', model: null, seed, lod: 0,
      x: 0, y: 0, z: 0, rot: 0, scale: 1, phase: 0, walk: 0, aim: 0, aimYaw: 0, aimPitch: 0, recoil: 0, melee: -1,
      work: 0, workPhase: 0, hit: 0, hitSide: 1, death: -1, rise: -1, variant: deathVariant(seed), time: 0,
      tint: ((seed & 255) / 255) * 2 - 1, mud: 0.6, wear: 0.7, highlight: 0, accent: [0.42, 0.1, 0.08], fade: 0, packPulse: 0,
    };
  }

  // placement preview for buildings: lazily uploaded LOD0 copies bound to a 1-instance buffer
  const ghostInst = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(8), gl.DYNAMIC_DRAW);
  const ghostData = new Float32Array(8);
  const ghostModels = {};
  let ghost = null;
  function setGhost(g) {
    if (!g) { ghost = null; return; }
    const def = STRUCTURES[g.stype];
    const key = def && def.model;
    if (!key || !STRUCTURE_MODELS[key]) { ghost = null; return; }
    let gm = ghostModels[key];
    if (!gm) { gm = upload(gl, STRUCTURE_MODELS[key](0), ghostInst); ghostModels[key] = gm; }
    ghost = { gm, x: g.x, z: g.z, rot: g.rot || 0, valid: !!g.valid };
  }

  function drawGhost(setCommon) {
    if (!ghost) return;
    const p = program;
    const y = baseHeightAt(world.terrain, ghost.x, ghost.z);
    ghostData[0] = ghost.x; ghostData[1] = y; ghostData[2] = ghost.z; ghostData[3] = ghost.rot;
    ghostData[4] = 1; ghostData[5] = 0.5; ghostData[6] = 1; ghostData[7] = 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, ghostInst);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, ghostData);
    gl.useProgram(p.program);
    setCommon(p);
    gl.uniform1f(p.u.uModelHeight, ghost.gm.height || 4);
    gl.uniform1f(p.u.uMud, -1);
    gl.uniform1f(p.u.uBackDim, 0.35);
    const c = ghost.valid ? [0.55, 0.75, 0.5] : [0.85, 0.25, 0.18];
    gl.uniform4f(p.u.uGhost, c[0], c[1], c[2], 0.5);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(ghost.gm.vao);
    drawElements(gl, gl.TRIANGLES, ghost.gm.count, ghost.gm.type, 1);
    gl.bindVertexArray(null);
    gl.enable(gl.CULL_FACE);
    gl.uniform4f(p.u.uGhost, 0, 0, 0, 0);
  }

  return { update, draw, onEvent, crewInstances, setGhost, drawGhost, models, wrecks, clutter };
}

function wreckGunBuilder(lod) {
  // wrecked field gun: salvage node model
  return buildWreckGun(lod);
}

function buildWreckGun(lod) {
  const mb = new MeshBuilder({ lod, seed: 71 });
  mb.col(C.steelDark, MAT.DARKMETAL);
  mb.push(0, 0.9, 0, -0.25, 0.3, 0.15).cyl(0.16, 0.12, 2.8, lod ? 6 : 10).pop();
  mb.col(C.rust, MAT.METAL).push(0, 0.8, -0.3).box(0.6, 0.35, 1.0, { bevel: 0.05 }).pop();
  mb.col(C.woodDark, MAT.WOOD);
  mb.push(0.75, 0.75, -0.2, 0, Math.PI / 2, 0).push(0, 0, 0, Math.PI / 2, 0, 0).lathe([[0.72, -0.05], [0.72, 0.05]], lod ? 8 : 16).pop().pop();
  mb.push(-0.7, 0.3, -0.5, 0.2, Math.PI / 2, 1.3).push(0, 0, 0, Math.PI / 2, 0, 0).lathe([[0.72, -0.05], [0.72, 0.05]], lod ? 8 : 16).pop().pop();
  mb.cylBetween([0, 0.5, -0.6], [0.2, 0.1, -2.6], 0.08, 0.06, 5);
  mb.col(C.armor, MAT.METAL).push(0, 1.1, 0.25, 0.3, 0, 0.4).box(1.3, 0.9, 0.05).pop();
  return mb.finish();
}
