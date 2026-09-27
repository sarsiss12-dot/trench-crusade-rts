// Dynamic fortification meshes (trenches, sandbags, wire, walls, bone barricades) rebuilt from structure data when the
// data changes (placement, dig progress steps, damage, destruction) — never per frame.
import { createBuffer, createVAO, drawElements } from './gl.js';
import { MeshBuilder, VERTEX_STRIDE } from './models/meshbuilder.js';
import { buildTrench, buildSandbags, buildWire } from './models/fortifications.js';
import { WALL_BUILDERS } from './models/walls.js';
import { baseHeightAt } from '../world/terrain.js';
import { isStructureKnownTo } from '../sim/perception.js';

// every linear structure type with a segment-built mesh
const FORT_BUILDERS = { trench: buildTrench, sandbags: buildSandbags, wire: buildWire, ...WALL_BUILDERS };

function layout(gl, vbo, instBuf, ibo) {
  return createVAO(gl, [
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
}

export function buildFortMesh(structures, world, viewer, filter) {
  const mb = new MeshBuilder({ lod: 0, seed: 5 });
  const ground = (x, z) => baseHeightAt(world.terrain, x, z);
  for (const s of structures) {
    if (filter && !filter(s)) continue;
    if (viewer && !isStructureKnownTo(s, viewer) && s.faction !== 'neutral') continue;
    const build = FORT_BUILDERS[s.type];
    if (build) build(mb, s, ground);
  }
  return mb.finish();
}

export function createFortificationRenderer(gl, program, world, sim) {
  const instBuf = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 0, 1, 0.5, 1, 0]));
  const st = { vbo: null, ibo: null, vao: null, count: 0, type: gl.UNSIGNED_SHORT, sig: '' };
  const ghost = { vbo: null, ibo: null, vao: null, count: 0, type: gl.UNSIGNED_SHORT, key: '', color: [0.6, 0.8, 0.5], valid: true };

  function signature(list) {
    let s = '';
    for (const x of list) {
      if (!FORT_BUILDERS[x.type]) continue;
      s += x.id + ':' + Math.floor(x.progress * 10) + ':' + Math.floor((x.hp / x.maxHp) * 5) + ',';
    }
    return s;
  }

  function upload(target, mesh) {
    if (target.vbo) { gl.deleteBuffer(target.vbo); gl.deleteBuffer(target.ibo); gl.deleteVertexArray(target.vao); }
    target.vbo = createBuffer(gl, gl.ARRAY_BUFFER, mesh.vertices);
    target.ibo = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, mesh.indices);
    target.vao = layout(gl, target.vbo, instBuf, target.ibo);
    target.count = mesh.indexCount;
    target.type = mesh.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
  }

  /** `known`: structures as the viewer knows them (fog memory); rebuilt only when data changes. */
  function update(sim2, camera, viewer, dt, known) {
    const list = known || sim2.state.structures.filter((x) => x.faction === viewer || x.faction === 'neutral' || isStructureKnownTo(x, viewer));
    const sig = signature(list);
    if (sig !== st.sig) {
      st.sig = sig;
      upload(st, buildFortMesh(list, world, null));
    }
  }

  /** Placement preview for linear fortifications (params like BUILD command). */
  function setGhost(params) {
    if (!params) { ghost.count = 0; ghost.key = ''; return; }
    const key = JSON.stringify(params);
    ghost.valid = params.valid;
    ghost.color = params.valid ? [0.55, 0.75, 0.5] : [0.85, 0.25, 0.18];
    if (key === ghost.key) return;
    ghost.key = key;
    const fake = { id: 1, type: params.stype, faction: 'ghost', x1: params.x1, z1: params.z1, x2: params.x2, z2: params.z2, front: params.front || 1, progress: 1, built: true, hp: 1, maxHp: 1, occ: [] };
    upload(ghost, buildFortMesh([fake], world, null));
  }

  function draw(setCommon, prog) {
    const p = prog || program;
    gl.useProgram(p.program);
    setCommon(p);
    gl.uniform1f(p.u.uModelHeight, 3);
    if (p.u.uMud) gl.uniform1f(p.u.uMud, -1);
    if (p.u.uBackDim) gl.uniform1f(p.u.uBackDim, 0.6);
    if (p.u.uAccent) gl.uniform3f(p.u.uAccent, 0.4, 0.1, 0.08);
    if (p.u.uGhost) gl.uniform4f(p.u.uGhost, 0, 0, 0, 0);
    gl.disable(gl.CULL_FACE);
    if (st.count) {
      gl.bindVertexArray(st.vao);
      drawElements(gl, gl.TRIANGLES, st.count, st.type, 1);
    }
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }

  function drawGhost(setCommon) {
    if (!ghost.count) return;
    const p = program;
    gl.useProgram(p.program);
    setCommon(p);
    gl.uniform1f(p.u.uModelHeight, 3);
    gl.uniform1f(p.u.uMud, -1);
    gl.uniform1f(p.u.uBackDim, 0.6);
    gl.uniform4f(p.u.uGhost, ghost.color[0], ghost.color[1], ghost.color[2], 0.55);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(ghost.vao);
    drawElements(gl, gl.TRIANGLES, ghost.count, ghost.type, 1);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
    gl.uniform4f(p.u.uGhost, 0, 0, 0, 0);
  }

  return { update, draw, drawGhost, setGhost, onEvent() {}, state: st, sim };
}
