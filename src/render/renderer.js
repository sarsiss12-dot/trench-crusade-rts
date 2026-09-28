// Renderer orchestration: owns GL state, programs, shared textures, sub-renderers and the
// frame order (shadow pass -> opaque -> decals -> water -> particles -> overlays -> grade).
// Reads simulation state (never writes it) and consumes fog-filtered sim events.
import { createGL, createPrograms, createTexture2D, createBuffer, createVAO, drawElements, drawArrays, resetStats } from './gl.js';
import * as SH from './shaders.js';
import { createNoiseTexture } from './textures.js';
import { createTerrainRenderer, createHeightTexture, createWaterMesh, createSkirtMesh } from './terrain_mesh.js';
import { createUnitRenderer } from './units_renderer.js';
import { createStaticRenderer } from './static_renderer.js';
import { createFortificationRenderer } from './fortifications_renderer.js';
import { createFx } from './fx.js';
import { createOverlays } from './overlays.js';
import { createRain } from './rain.js';
import { createStructureMemory } from './fog_memory.js';
import { createCraterMemory } from './craters.js';
import { createCanvasSizer } from './viewport.js';
import { updateCamera, viewFootprint } from './camera.js';
import { mat4, aabbInFrustum, mat4LookAt, mat4Mul, mat4Invert, mat4Ortho, frustumPlanes, transformPoint4 } from './math3d.js';
import { FACTIONS } from '../data/factions.js';
import { groundHeightAt } from '../world/ground.js';
import { createStructGrid, structGridRebuild } from '../world/structgrid.js';

export const QUALITY = {
  // maxPixels caps the backbuffer whatever the screen (tablets at DPR 2 would otherwise ask for 5+ MP)
  low: { dprCap: 1.0, antialias: false, particles: 700, decals: 160, grass: 0, shadow: 0, clutter: 0.35, maxPixels: 1.0e6 },
  balanced: { dprCap: 1.5, antialias: true, particles: 1500, decals: 300, grass: 1, shadow: 1536, clutter: 0.7, maxPixels: 2.1e6 },
  high: { dprCap: 2.0, antialias: true, particles: 2600, decals: 480, grass: 2, shadow: 2048, clutter: 1, maxPixels: 4.2e6 },
};

function srgbToLinear(c) {
  return c.map((v) => Math.pow(v, 2.2));
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function createShadowMap(gl, size) {
  const n = Math.max(1, size);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, n, n);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  let fbo = null;
  if (size > 0) {
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) fbo = null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  return { tex, fbo, size: fbo ? size : 0, view: mat4(), proj: mat4(), mat: mat4(), planes: new Float32Array(24), radius: 0 };
}

export function createRenderer(canvas, opts = {}) {
  const quality = opts.quality || 'balanced';
  const Q = QUALITY[quality];
  const gl = createGL(canvas, { antialias: Q.antialias, preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
  if (!gl) return null;
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  // all programs compiled / linked in one batch (parallel compilation where the driver supports it)
  const P = createPrograms(gl, {
    terrain: ['terrain', SH.TERRAIN_VS, SH.TERRAIN_FS],
    skinned: ['skinned', SH.SKINNED_VS, SH.SKINNED_FS],
    // world, props, clutter, fortifications: no discard; construction sites: the cut variant
    static: ['static', SH.STATIC_VS, SH.withDefine(SH.STATIC_FS, 'CONSTRUCTION_CUT')],
    staticFast: ['staticFast', SH.STATIC_VS, SH.STATIC_FS],
    water: ['water', SH.WATER_VS, SH.WATER_FS],
    particle: ['particle', SH.PARTICLE_VS, SH.PARTICLE_FS],
    decal: ['decal', SH.DECAL_VS, SH.DECAL_FS],
    overlay: ['overlay', SH.OVERLAY_VS, SH.OVERLAY_FS],
    line: ['line', SH.LINE_VS, SH.LINE_FS],
    vignette: ['vignette', SH.VIGNETTE_VS, SH.VIGNETTE_FS],
    shadowStatic: ['shadowStatic', SH.SHADOW_STATIC_VS, SH.withDefine(SH.SHADOW_STATIC_FS, 'CONSTRUCTION_CUT')],
    shadowStaticFast: ['shadowStaticFast', SH.SHADOW_STATIC_VS, SH.SHADOW_STATIC_FS],
    shadowSkinned: ['shadowSkinned', SH.SHADOW_SKINNED_VS, SH.SHADOW_FS],
    shadowTerrain: ['shadowTerrain', SH.SHADOW_TERRAIN_VS, SH.SHADOW_FS],
  });

  const noiseTex = createNoiseTexture(gl);
  const shadow = createShadowMap(gl, opts.shadows === false ? 0 : Q.shadow);
  const quad = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
  const quadVao = createVAO(gl, [{ buffer: quad, stride: 8, attribs: [{ loc: 0, size: 2, type: gl.FLOAT, offset: 0 }] }]);
  const baseSun = normalize([-0.78, 0.56, 0.26]);
  const env = {
    sunDir: baseSun.slice(),
    sunColor: [2.15, 1.86, 1.48],
    skyColor: [0.25, 0.265, 0.29],
    groundColor: [0.11, 0.09, 0.066],
    fogColor: srgbToLinear([0.43, 0.43, 0.4]),
    fogParams: [1 / 520, 0.9, 0.3, 0.8],
  };
  const r = {
    gl, P, env, quality, Q, noiseTex, shadow,
    sim: null, world: null, viewer: 'new_antioch',
    terrain: null, water: null, skirt: null, heightTex: null,
    fowTex: null, fowData: null, fowDisplay: null, infTex: null, infData: null,
    units: null, statics: null, forts: null, fx: null, overlays: null,
    fogEnabled: true, time: 0, width: 1, height: 1, dpr: 1,
    frameStats: { drawCalls: 0, triangles: 0, shadowCalls: 0 },
    vignette: 0.55,
  };

  /**
   * memory (optional): the viewer's fog memory from before a renderer rebuild or from a save —
   * { structs, nodes, inf, corpses } — so a lost GPU context or a reload never refreshes it.
   */
  r.attach = (sim, viewer, yaw = 0, memory = null) => {
    r.sim = sim;
    r.world = sim.world;
    r.viewer = viewer;
    // keep the same screen-relative light for either side (presentation only)
    const c = Math.cos(yaw), s = Math.sin(yaw);
    env.sunDir = normalize([baseSun[0] * c + baseSun[2] * s, baseSun[1], -baseSun[0] * s + baseSun[2] * c]);
    const world = sim.world;
    // everything presented is built from what the viewer KNOWS (fog memory), never from the live
    // world: terrain carving of trenches, ground heights, clutter, remembered structures
    r.memory = createStructureMemory(memory);
    r.memory.update(sim, viewer);
    const known = r.memory.list(sim, viewer);
    r.viewGrid = createStructGrid(world.width, world.height, 8);
    structGridRebuild(r.viewGrid, known);
    r.viewSig = knownSignature(known);
    // shell craters as the viewer last saw them (carved ground + presentation height)
    r.craters = createCraterMemory(memory && memory.craters);
    r.craters.update(sim, viewer, r.fogEnabled);
    r.craterSig = r.craters.signature();
    r.terrain = createTerrainRenderer(gl, world, known, quality, r.craters.list());
    r.heightTex = createHeightTexture(gl, world);
    r.water = createWaterMesh(gl, world);
    r.skirt = createSkirtMesh(gl, world);
    const fog = sim.state.fog;
    r.fowData = new Uint8Array(fog.cols * fog.rows * 2);
    r.fowDisplay = new Float32Array(fog.cols * fog.rows * 2);
    r.fowTex = createTexture2D(gl, fog.cols, fog.rows, { internal: gl.RG8, format: gl.RG, data: r.fowData });
    const inf = sim.state.infection;
    r.infData = new Uint8Array(inf.cols * inf.rows);
    r.infTex = createTexture2D(gl, inf.cols, inf.rows, { internal: gl.R8, format: gl.RED, data: r.infData });
    // Phase 4.1 traffic mud (low-res grid) as the viewer has SEEN it (tracks reveal movement)
    const mud = sim.state.mud;
    r.mudData = new Uint8Array(mud ? mud.cols * mud.rows : 1);
    if (memory && memory.mud && mud && memory.mud.length === r.mudData.length) r.mudData.set(memory.mud);
    r.mudTex = createTexture2D(gl, mud ? mud.cols : 1, mud ? mud.rows : 1, { internal: gl.R8, format: gl.RED, data: r.mudData });
    r.mudVer = -1;
    r.rain = createRain(gl, P.line, quality);
    syncFow(true);
    const ground = (x, z) => r.groundAt(x, z);
    r.units = createUnitRenderer(gl, P.skinned, { quality, ground, extras: (t, dt) => r.extraInstances(t, dt) });
    r.statics = createStaticRenderer(gl, P.static, world, sim, {
      quality, grass: Q.grass, clutter: Q.clutter, ground, grid: r.viewGrid,
      fast: { main: P.staticFast, shadow: P.shadowStaticFast, shadowCut: P.shadowStatic },
    });
    r.forts = createFortificationRenderer(gl, P.static, world, sim);
    r.fx = createFx(gl, P.particle, P.decal, { particles: Q.particles, decals: Q.decals, renderer: r, quality });
    r.fx.setupSmokers(world);
    r.overlays = createOverlays(gl, P.overlay, P.line, P.decal);
    if (memory && memory.corpses) r.units.importCorpses(memory.corpses, sim);
    else r.units.syncCorpses(sim, viewer);
  };

  /** The viewer's knowledge for a save / a renderer rebuild (presentation only; not GameState). */
  r.exportMemory = () => ({ ...r.memory.exportState(), corpses: r.units ? r.units.exportCorpses() : [], craters: r.craters ? r.craters.exportState() : [], mud: r.mudData ? Array.from(r.mudData) : [] });

  function knownSignature(list) {
    let h = list.length;
    for (const st of list) h = (h * 31 + st.id * 7 + Math.round((st.progress || 0) * 10) + (st.memory ? 3 : 0)) >>> 0;
    return h;
  }

  /** Structures as the viewer knows them (live own/visible + fog memory of enemy ones). */
  r.knownStructures = () => r.memory.list(r.sim, r.viewer);

  r.extraInstances = (t, dt) => (r.statics ? r.statics.crewInstances(r.sim, r.viewer, t, dt) : []);

  function syncFow(instant, dt = 0) {
    const fog = r.sim.state.fog;
    const j = FACTIONS[r.viewer] ? FACTIONS[r.viewer].index : 0;
    const vis = fog.vis[j], seen = fog.seen[j];
    const n = fog.cols * fog.rows;
    const k = instant ? 1 : Math.min(1, dt * 6);
    const d = r.fowDisplay, out = r.fowData;
    for (let i = 0; i < n; i++) {
      const tv = r.fogEnabled ? vis[i] : 1, ts = r.fogEnabled ? seen[i] : 1;
      d[i * 2] += (tv - d[i * 2]) * k;
      d[i * 2 + 1] += (ts - d[i * 2 + 1]) * k;
      out[i * 2] = (d[i * 2] * 255) | 0;
      out[i * 2 + 1] = (d[i * 2 + 1] * 255) | 0;
    }
    gl.bindTexture(gl.TEXTURE_2D, r.fowTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, fog.cols, fog.rows, gl.RG, gl.UNSIGNED_BYTE, out);
  }

  function syncMud() {
    const mud = r.sim.state.mud;
    if (!mud || mud.ver === r.mudVer) return;
    r.mudVer = mud.ver;
    const fog = r.sim.state.fog;
    const vis = fog.vis[FACTIONS[r.viewer] ? FACTIONS[r.viewer].index : 0];
    const d = r.mudData, v = mud.v;
    for (let j = 0; j < mud.rows; j++) {
      const fz = Math.min(fog.rows - 1, Math.floor(((j + 0.5) * mud.cs) / fog.cs));
      for (let i = 0; i < mud.cols; i++) {
        const k = j * mud.cols + i;
        if (!r.fogEnabled) { d[k] = v[k]; continue; }
        const fx = Math.min(fog.cols - 1, Math.floor(((i + 0.5) * mud.cs) / fog.cs));
        if (vis[fz * fog.cols + fx]) d[k] = v[k]; // unseen ground keeps the mud last seen there
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, r.mudTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, mud.cols, mud.rows, gl.RED, gl.UNSIGNED_BYTE, d);
  }

  function syncInfection() {
    const inf = r.sim.state.infection;
    // infected ground as the viewer last saw it (live only where it is in sight right now)
    const known = r.fogEnabled ? r.memory.infection(r.sim, r.viewer) : inf.v;
    r.infData.set(known);
    gl.bindTexture(gl.TEXTURE_2D, r.infTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, inf.cols, inf.rows, gl.RED, gl.UNSIGNED_BYTE, r.infData);
  }

  // Canvas size requests (resize, orientation, dynamic resolution) are applied at the start of the
  // next render — resizing clears the canvas, so never between a draw and compositing (no black flash).
  const sizer = createCanvasSizer(canvas, Q.dprCap, opts.renderScale || 1, Q.maxPixels);
  function syncSize() {
    r.width = sizer.width; r.height = sizer.height; r.dpr = sizer.dpr; r.renderScale = sizer.renderScale;
  }
  function applySize() {
    if (!sizer.pending) return;
    sizer.apply();
    syncSize();
  }
  syncSize();
  r.resize = (cssW, cssH, dpr) => { sizer.request(cssW, cssH, dpr); syncSize(); };
  /** Dynamic resolution: 0.5..1 of the quality's device-pixel cap. */
  r.setRenderScale = (k) => { sizer.setRenderScale(k); syncSize(); };

  function setCommon(p, camera) {
    const u = p.u;
    gl.uniformMatrix4fv(u.uViewProj, false, camera.viewProj);
    if (u.uCamPos) gl.uniform3fv(u.uCamPos, camera.eye);
    if (u.uSunDir) gl.uniform3fv(u.uSunDir, env.sunDir);
    if (u.uSunColor) gl.uniform3fv(u.uSunColor, env.sunColor);
    if (u.uSkyColor) gl.uniform3fv(u.uSkyColor, env.skyColor);
    if (u.uGroundColor) gl.uniform3fv(u.uGroundColor, env.groundColor);
    if (u.uFogColor) gl.uniform3fv(u.uFogColor, env.fogColor);
    if (u.uFogParams) gl.uniform4fv(u.uFogParams, env.fogParams);
    if (u.uMapParams) gl.uniform4f(u.uMapParams, 1 / r.world.width, 1 / r.world.height, r.fogEnabled ? 1 : 0, r.time);
    if (u.uNoiseTex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, noiseTex); gl.uniform1i(u.uNoiseTex, 0); }
    if (u.uFowTex) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, r.fowTex); gl.uniform1i(u.uFowTex, 1); }
    if (u.uHeightTex) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, r.heightTex); gl.uniform1i(u.uHeightTex, 2); }
    if (u.uInfTex) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, r.infTex); gl.uniform1i(u.uInfTex, 4); }
    if (u.uMudTex) { gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, r.mudTex); gl.uniform1i(u.uMudTex, 6); }
    if (u.uWeather) { const wx = r.sim && r.sim.state.weather; gl.uniform4f(u.uWeather, wx ? wx.rain || 0 : 0, wx ? wx.wet || 0 : 0, 0, 0); }
    if (u.uShadowTex) {
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, shadow.tex);
      gl.uniform1i(u.uShadowTex, 5);
      gl.uniformMatrix4fv(u.uShadowMat, false, shadow.mat);
      gl.uniform4f(u.uShadowParams, shadow.size && r.shadowsOn ? (quality === 'high' ? 2 : 1) : 0, 1 / Math.max(1, shadow.size), 0.00035, 1);
    }
    if (u.uView) gl.uniformMatrix4fv(u.uView, false, camera.view);
  }
  r.setCommon = setCommon;
  r.shadowsOn = true;

  // presentation ground (camera, soldiers, marks, VFX): carved only by trenches the viewer knows
  r.groundAt = (x, z) => groundHeightAt(r.world, r.viewGrid, x, z) + (r.craters ? r.craters.offsetAt(x, z) : 0);

  /** Presentation event (already fog-filtered): show flags from perception.eventVisibility. */
  r.onEvent = (ev, show) => {
    if (!r.sim) return;
    r.units.onEvent(ev, show, r.sim);
    r.fx.onEvent(ev, show, r.sim);
    r.statics.onEvent(ev, show, r.sim);
    r.forts.onEvent(ev, show, r.sim);
  };

  // ------------------------------------------------------------------ camera shake
  r.shake = 0;
  r.shakeTarget = [0, 0];
  r.shakeAt = (x, z, amount) => {
    const [tx, tz] = r.shakeTarget;
    const d = Math.hypot(x - tx, z - tz);
    const k = Math.max(0, 1 - d / 110);
    r.shake = Math.min(1.4, Math.max(r.shake, amount * k));
  };
  const JE = [0, 0, 0], JT = [0, 0, 0], UP = [0, 1, 0];
  function applyShake(camera, dt) {
    if (r.shake < 0.01) { r.shake = 0; return; }
    const s = r.shake * r.shake * 0.35 * (camera.dist / 80);
    const t = r.time * 31;
    const jx = Math.sin(t) * s, jy = Math.sin(t * 1.37 + 1.1) * s * 0.6, jz = Math.cos(t * 0.83 + 0.4) * s;
    JE[0] = camera.eye[0] + jx; JE[1] = camera.eye[1] + jy; JE[2] = camera.eye[2] + jz;
    JT[0] = camera.tx + jx * 0.4; JT[1] = camera.ty + jy * 0.4; JT[2] = camera.tz + jz * 0.4;
    mat4LookAt(camera.view, JE, JT, UP);
    mat4Mul(camera.viewProj, camera.proj, camera.view);
    mat4Invert(camera.invViewProj, camera.viewProj);
    frustumPlanes(camera.planes, camera.viewProj);
    r.shake *= Math.exp(-dt * 6);
  }

  // ------------------------------------------------------------------ shadow map fitting + pass
  const FP = new Float32Array(8);
  const T4 = [0, 0, 0, 0];
  const SE = [0, 0, 0], SC = [0, 0, 0];
  function fitShadow(camera) {
    viewFootprint(camera, FP);
    let cx = 0, cz = 0;
    const maxD = 230;
    for (let i = 0; i < 4; i++) {
      let x = FP[i * 2], z = FP[i * 2 + 1];
      const dx = x - camera.tx, dz = z - camera.tz;
      const d = Math.hypot(dx, dz);
      if (d > maxD) { x = camera.tx + (dx / d) * maxD; z = camera.tz + (dz / d) * maxD; }
      FP[i * 2] = x; FP[i * 2 + 1] = z;
      cx += x; cz += z;
    }
    cx /= 4; cz /= 4;
    let R = 0;
    for (let i = 0; i < 4; i++) R = Math.max(R, Math.hypot(FP[i * 2] - cx, FP[i * 2 + 1] - cz));
    R = Math.ceil((R + 8) / 12) * 12;
    shadow.radius = R;
    const cy = camera.ty;
    SC[0] = cx; SC[1] = cy; SC[2] = cz;
    SE[0] = cx + env.sunDir[0] * 200; SE[1] = cy + env.sunDir[1] * 200; SE[2] = cz + env.sunDir[2] * 200;
    mat4LookAt(shadow.view, SE, SC, UP);
    // snap the light-space center to whole texels (no shimmering while panning)
    transformPoint4(T4, shadow.view, cx, cy, cz);
    const texel = (2 * R) / shadow.size;
    const lx = Math.floor(T4[0] / texel) * texel, ly = Math.floor(T4[1] / texel) * texel;
    mat4Ortho(shadow.proj, lx - R, lx + R, ly - R, ly + R, 20, 420);
    mat4Mul(shadow.mat, shadow.proj, shadow.view);
    frustumPlanes(shadow.planes, shadow.mat);
  }

  function renderShadows() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadow.fbo);
    gl.viewport(0, 0, shadow.size, shadow.size);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.4, 2.5);
    const before = gl.stats.drawCalls;
    const setShadow = (p) => {
      gl.uniformMatrix4fv(p.u.uViewProj, false, shadow.mat);
      if (p.u.uNoiseTex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, noiseTex); gl.uniform1i(p.u.uNoiseTex, 0); }
    };
    const pt = P.shadowTerrain;
    gl.useProgram(pt.program);
    setShadow(pt);
    for (const ch of r.terrain.chunks) {
      const b = ch.bounds;
      if (!aabbInFrustum(shadow.planes, b[0], b[1], b[2], b[3], b[4], b[5])) continue;
      gl.bindVertexArray(ch.vao);
      drawElements(gl, gl.TRIANGLES, ch.count, gl.UNSIGNED_SHORT);
    }
    r.statics.draw(setShadow, P.shadowStatic);
    r.forts.draw(setShadow, P.shadowStaticFast);
    r.units.draw(setShadow, P.shadowSkinned);
    gl.bindVertexArray(null);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    r.frameStats.shadowCalls = gl.stats.drawCalls - before;
  }

  // ------------------------------------------------------------------ frame
  let infTimer = 0;
  r.render = (camera, frame) => {
    const { sim } = r;
    const realDt = frame.dt;
    // visual time follows game speed (frozen while paused); the camera always uses real time
    const dt = frame.visDt !== undefined ? frame.visDt : realDt;
    r.time += dt;
    applySize();
    resetStats(gl);
    updateCamera(camera, r.width, r.height, realDt);
    r.shakeTarget[0] = camera.tx; r.shakeTarget[1] = camera.tz;
    applyShake(camera, realDt);
    r.memory.update(sim, r.viewer);
    const known = r.memory.list(sim, r.viewer);
    const vsig = knownSignature(known);
    r.craters.update(sim, r.viewer, r.fogEnabled);
    const csig = r.craters.signature();
    if (vsig !== r.viewSig || csig !== r.craterSig) {
      const craterChange = csig !== r.craterSig;
      r.viewSig = vsig;
      r.craterSig = csig;
      structGridRebuild(r.viewGrid, known);
      // terrain carving follows KNOWN trenches and craters; only the changed patch is rebuilt
      r.terrain.update(known, craterChange ? r.craters.list() : null);
    }
    syncFow(false, dt);
    infTimer -= realDt;
    if (infTimer <= 0) { infTimer = 0.5; syncInfection(); syncMud(); }

    r.units.update(sim, camera, r.viewer, frame.alpha, dt, frame.selection, r.time);
    r.statics.update(sim, camera, r.viewer, dt, r.time, known, vsig, r.memory.nodes());
    r.forts.update(sim, camera, r.viewer, dt, known);
    r.fx.update(sim, camera, r.viewer, dt, r.time);
    r.overlays.update(sim, camera, r, frame);
    r.rain.update(camera, sim.state.weather ? sim.state.weather.rain : 0, r.time, r.groundAt);

    const shadowsActive = shadow.size > 0 && r.shadowsOn;
    if (shadowsActive) {
      fitShadow(camera);
      renderShadows();
    }

    gl.viewport(0, 0, r.width, r.height);
    const fc = env.fogColor;
    gl.clearColor(Math.pow(fc[0], 1 / 2.2) * 0.9, Math.pow(fc[1], 1 / 2.2) * 0.9, Math.pow(fc[2], 1 / 2.2) * 0.9, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    gl.depthMask(true);

    // opaque: what stands on the ground first, the ground last — the heavy terrain shader then
    // skips every pixel already covered (early depth rejection on mobile GPUs)
    const skip = r.debugSkip || {};
    // soldiers + corpses
    if (!skip.units) r.units.draw((p) => setCommon(p, camera));
    // static world + structures + fortifications
    if (!skip.statics) r.statics.draw((p) => setCommon(p, camera));
    if (!skip.forts) r.forts.draw((p) => setCommon(p, camera), P.staticFast);
    // terrain
    const pt = P.terrain;
    gl.useProgram(pt.program);
    setCommon(pt, camera);
    const ch = skip.terrain ? [] : r.terrain.chunks;
    for (let i = 0; i < ch.length; i++) {
      const b = ch[i].bounds;
      if (!aabbInFrustum(camera.planes, b[0], b[1], b[2], b[3], b[4], b[5])) continue;
      gl.bindVertexArray(ch[i].vao);
      drawElements(gl, gl.TRIANGLES, ch[i].count, gl.UNSIGNED_SHORT);
    }
    gl.bindVertexArray(r.skirt.vao);
    drawElements(gl, gl.TRIANGLES, r.skirt.count, gl.UNSIGNED_INT);

    // decals (blood, scorch, contact shadows, rings) — alpha, no depth write
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-2, -6);
    if (!skip.decals) r.fx.drawDecals((p) => setCommon(p, camera), false);
    r.overlays.drawGroundMarks((p) => setCommon(p, camera));
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // water
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const pw = P.water;
    gl.useProgram(pw.program);
    setCommon(pw, camera);
    gl.bindVertexArray(r.water.vao);
    if (!skip.water) drawElements(gl, gl.TRIANGLES, r.water.count, gl.UNSIGNED_SHORT);

    // additive ground light splats, particles
    gl.enable(gl.POLYGON_OFFSET_FILL);
    r.fx.drawDecals((p) => setCommon(p, camera), true);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    if (!skip.particles) r.fx.drawParticles((p) => setCommon(p, camera));
    // rain streaks (depth-tested, no depth writes)
    if (!skip.rain) r.rain.draw((p) => setCommon(p, camera));

    // placement ghosts & debug lines
    r.overlays.drawWorld((p) => setCommon(p, camera), r);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    // depth is not needed past this point: tile-based GPUs can skip writing it back to memory
    if (gl.invalidateFramebuffer) gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.DEPTH]);
    // grade: vignette (multiply), then screen-space bars on top
    if (r.vignette > 0) {
      const pv = P.vignette;
      gl.useProgram(pv.program);
      const a = r.width / r.height;
      gl.uniform2f(pv.u.uAspect, a > 1 ? 1 : a, a > 1 ? 1 / a : 1);
      gl.uniform1f(pv.u.uStrength, r.vignette);
      gl.blendFunc(gl.DST_COLOR, gl.ZERO);
      gl.bindVertexArray(quadVao);
      drawArrays(gl, gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
    }
    r.overlays.drawScreen(r.width, r.height);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    r.frameStats.drawCalls = gl.stats.drawCalls;
    r.frameStats.triangles = gl.stats.triangles;
  };

  return r;
}
