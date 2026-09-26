// Renderer regressions that run headless with a recording WebGL2 stand-in:
//  - canvas size changes are deferred to the next frame (resizing clears the canvas -> black flash)
//  - screen-space bars are drawn with back-face culling off (their pixel-space quads turn clockwise
//    after the y flip; with culling on every health bar silently disappeared)
import { test, assert } from './harness.js';
import { createCanvasSizer, RENDER_SCALE_MIN } from '../src/render/viewport.js';
import { createOverlays } from '../src/render/overlays.js';
import { createCamera, updateCamera } from '../src/render/camera.js';
import { createSession } from '../src/app/session.js';
import { computeTerrainFields, terrainInfluenceBox } from '../src/render/terrain_mesh.js';

/** Minimal recording WebGL2 stand-in: constants are unique numbers, calls are logged. */
function mockGL() {
  const calls = [];
  const enabled = new Set();
  const consts = new Map();
  let gl = null;
  const target = {
    stats: { drawCalls: 0, triangles: 0, instances: 0 },
    enable(cap) { enabled.add(cap); },
    disable(cap) { enabled.delete(cap); },
    isEnabled(cap) { return enabled.has(cap); },
    drawArraysInstanced(mode, first, count, n) { calls.push({ fn: 'drawArraysInstanced', mode, count, n, cull: enabled.has(gl.CULL_FACE) }); },
    drawElementsInstanced(mode, count, type, off, n) { calls.push({ fn: 'drawElementsInstanced', mode, count, n, cull: enabled.has(gl.CULL_FACE) }); },
    bufferSubData(target, off, data, srcOff, len) { calls.push({ fn: 'bufferSubData', data, len }); },
  };
  gl = new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (typeof prop !== 'string') return undefined;
      if (/^[A-Z][A-Z0-9_]*$/.test(prop)) {
        if (!consts.has(prop)) consts.set(prop, 0x8000 + consts.size);
        return consts.get(prop);
      }
      return () => ({ mock: prop });
    },
  });
  return { gl, calls, enabled };
}

test('canvas sizer: first size applies at once, later changes wait for the next frame', () => {
  const canvas = { width: 300, height: 150 };
  const s = createCanvasSizer(canvas, 1.5);
  s.request(800, 400, 3);
  assert.equal(canvas.width, 1200, 'initial size (dpr capped to 1.5)');
  assert.equal(canvas.height, 600);
  assert.equal(s.dpr, 1.5);
  // a resize between frames must not clear the canvas that is about to be composited
  s.request(400, 800, 3);
  assert.equal(canvas.width, 1200, 'unchanged until the next frame');
  assert.ok(s.pending, 'pending size recorded');
  assert.equal(s.apply(), true, 'applied at the start of the next frame');
  assert.equal(canvas.width, 600);
  assert.equal(canvas.height, 1200);
  assert.equal(s.apply(), false, 'nothing pending');
});

test('canvas sizer: dynamic resolution is clamped and also deferred', () => {
  const canvas = { width: 0, height: 0 };
  const s = createCanvasSizer(canvas, 2);
  s.request(1000, 500, 1);
  s.setRenderScale(0.1);
  assert.equal(s.renderScale, RENDER_SCALE_MIN, 'clamped to the minimum');
  assert.equal(canvas.width, 1000, 'deferred');
  s.apply();
  assert.equal(canvas.width, 500);
  s.setRenderScale(7);
  assert.equal(s.renderScale, 1, 'clamped to 1');
  s.apply();
  assert.equal(canvas.width, 1000);
  s.setRenderScale(0.8);
  s.request(1000, 500, 1); // a resize while a scale change is pending keeps the scale
  s.apply();
  assert.equal(canvas.width, 800);
});

test('overlay bars: pixel-space quads are clockwise, so they are drawn with culling off', () => {
  // the overlay vertex shader maps pixels (y down) to clip space (y up); replicate it for one quad
  const W = 1280, H = 720, rect = [100, 100, 40, 6];
  const clip = (cx, cy) => {
    const u = cx * 0.5 + 0.5, v = cy * 0.5 + 0.5;
    const px = rect[0] + u * rect[2], py = rect[1] + v * rect[3];
    return [(px / W) * 2 - 1, 1 - (py / H) * 2];
  };
  const [a, b, c] = [clip(-1, -1), clip(1, -1), clip(-1, 1)]; // first triangle of the strip
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  assert.less(area, 0, 'clockwise in clip space (would be back-face culled)');

  const { gl, calls, enabled } = mockGL();
  const prog = { program: {}, u: { uScreen: {}, uAdditive: {} } };
  const ov = createOverlays(gl, prog, prog, prog);
  const session = createSession({
    scenarioId: 'siege_default', seed: 5,
    settings: { playerFaction: 'new_antioch', prepSeconds: 0, controllers: { new_antioch: 'player', black_grail: 'player' } },
  });
  const { sim } = session;
  const sq = sim.state.squads.find((s) => s.faction === 'new_antioch');
  const camera = createCamera({ x: sq.cx, z: sq.cz, dist: 40 });
  updateCamera(camera, W, H, 0);
  const r = { viewer: 'new_antioch', time: 0, dpr: 1, groundAt: () => 0, forts: { setGhost() {} }, statics: { setGhost() {} } };
  ov.update(sim, camera, r, { selection: new Set([sq.id]), uiScale: 1 });
  assert.greater(ov.stats.bars, 0, 'selected squad gets a health bar');

  gl.enable(gl.CULL_FACE); // the renderer's opaque passes leave culling on
  ov.drawScreen(W, H);
  const draw = calls.find((c) => c.fn === 'drawArraysInstanced');
  assert.ok(draw, 'bars drawn');
  assert.equal(draw.n, ov.stats.bars, 'one instance per bar');
  assert.equal(draw.cull, false, 'culling disabled while drawing the bars');
  assert.ok(enabled.has(gl.CULL_FACE), 'culling restored for later passes');
});

test('overlay bars keep a readable thickness at low render resolution', () => {
  const { gl, calls } = mockGL();
  const prog = { program: {}, u: { uScreen: {}, uAdditive: {} } };
  const ov = createOverlays(gl, prog, prog, prog);
  const session = createSession({
    scenarioId: 'siege_default', seed: 5,
    settings: { playerFaction: 'new_antioch', prepSeconds: 0, controllers: { new_antioch: 'player', black_grail: 'player' } },
  });
  const { sim } = session;
  const sq = sim.state.squads.find((s) => s.faction === 'new_antioch');
  const camera = createCamera({ x: sq.cx, z: sq.cz, dist: 40 });
  updateCamera(camera, 640, 360, 0);
  // low quality + dynamic resolution at its floor: half a device pixel per CSS pixel
  const r = { viewer: 'new_antioch', time: 0, dpr: 0.5, groundAt: () => 0, forts: { setGhost() {} }, statics: { setGhost() {} } };
  ov.update(sim, camera, r, { selection: new Set([sq.id]), uiScale: 1 });
  const up = calls.find((c) => c.fn === 'bufferSubData' && c.len === ov.stats.bars * 12);
  assert.ok(up, 'bar instances uploaded');
  for (let i = 0; i < ov.stats.bars; i++) assert.ok(up.data[i * 12 + 3] >= 2, 'bar ' + i + ' at least 2px tall');
  assert.ok(up.data[3] >= 3, 'health bar at least 3px tall');
});

test('canvas sizer: a quality pixel budget caps big tablet backbuffers', () => {
  const canvas = { width: 0, height: 0 };
  const s = createCanvasSizer(canvas, 2, 1, 2.1e6);
  s.request(1366, 1024, 2); // iPad Pro at DPR 2 would be 5.6 MP
  assert.ok(canvas.width * canvas.height <= 2.1e6 * 1.01, 'within budget: ' + canvas.width + 'x' + canvas.height);
  assert.approx(canvas.width / canvas.height, 1366 / 1024, 0.01, 'aspect kept');
  const phone = { width: 0, height: 0 };
  const p = createCanvasSizer(phone, 1.5, 1, 2.1e6);
  p.request(412, 915, 2.625);
  assert.equal(phone.width, Math.round(412 * 1.5), 'phones stay at the DPR cap');
});

test('terrain fields: a local rebuild after digging equals a full rebuild', () => {
  const session = createSession({ scenarioId: 'siege_default', seed: 5, settings: { playerFaction: 'new_antioch', prepSeconds: 0 } });
  const { sim } = session;
  const world = sim.world;
  const t = world.terrain;
  const structs = sim.state.structures.map((s) => ({ ...s }));
  const fields = computeTerrainFields(world, structs);
  // dig a trench deeper and complete a building, then rebuild only their region
  const tr = structs.find((s) => s.type === 'trench');
  const before = terrainInfluenceBox(t, tr);
  tr.progress = Math.min(1, tr.progress) * 0.4;
  const b = structs.find((s) => s.type === 'supply_depot');
  b.built = !b.built;
  const box = terrainInfluenceBox(t, b);
  const region = { x0: Math.min(before.x0, box.x0), z0: Math.min(before.z0, box.z0), x1: Math.max(before.x1, box.x1), z1: Math.max(before.z1, box.z1) };
  computeTerrainFields(world, structs, fields, region);
  const full = computeTerrainFields(world, structs);
  for (const k of ['height', 'color', 'extra', 'normal']) {
    let diff = 0;
    for (let i = 0; i < full[k].length; i++) if (full[k][i] !== fields[k][i]) diff++;
    assert.equal(diff, 0, k + ' identical');
  }
  assert.less((region.x1 - region.x0 + 1) * (region.z1 - region.z0 + 1), t.vcols * t.vrows / 10, 'a small patch of the map');
});
