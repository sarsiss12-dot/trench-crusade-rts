// Mobile input: gesture recognizer (tap / double tap / long press / drag + inertia / pinch / box),
// selection model ("Tümü" = alive + own + combatUnit), fog-safe picking.
import { test, assert } from './harness.js';
import { createGestures } from '../src/input/gestures.js';
import { createSelection, allCombatSquadIds, squadIdsWithRole } from '../src/input/selection.js';
import { pickSquad, pickStructure, pickNode, boxSelect } from '../src/input/pick.js';
import { createCamera, updateCamera } from '../src/render/camera.js';
import { groundHeightAt } from '../src/world/ground.js';
import { updateVision } from '../src/sim/perception.js';
import { makeSim, clearUnits, spawn, addStructure } from './helpers.js';

function recorder(extra = {}) {
  const log = [];
  const h = {};
  for (const k of ['onTap', 'onDoubleTap', 'onLongPress', 'onDragStart', 'onDrag', 'onDragEnd', 'onBoxStart', 'onBox', 'onBoxEnd', 'onBoxCancel', 'onPinchStart', 'onPinch', 'onPinchEnd', 'onHover', 'onWheel']) {
    h[k] = (...a) => log.push([k, ...a]);
  }
  Object.assign(h, extra);
  return { h, log, names: () => log.map((e) => e[0]) };
}

test('gestures: quick touch = tap; second quick tap nearby = double tap', () => {
  const r = recorder();
  const g = createGestures(r.h);
  g.down(1, 100, 100, 0, { type: 'touch' });
  g.up(1, 102, 101, 120);
  assert.deepEqual(r.names(), ['onTap']);
  g.down(2, 104, 99, 300, { type: 'touch' });
  g.up(2, 104, 99, 380);
  assert.deepEqual(r.names(), ['onTap', 'onDoubleTap']);
  // a third tap later is a plain tap again
  g.down(3, 104, 99, 1500, { type: 'touch' });
  g.up(3, 104, 99, 1560);
  assert.equal(r.names()[2], 'onTap');
});

test('gestures: long press fires once via tick() and suppresses the tap', () => {
  const r = recorder();
  const g = createGestures(r.h);
  g.down(1, 50, 60, 1000, { type: 'touch' });
  g.tick(1300);
  assert.equal(r.log.length, 0);
  g.tick(1600);
  g.tick(1700);
  g.up(1, 50, 60, 1800);
  assert.deepEqual(r.names(), ['onLongPress']);
});

test('gestures: drag past slop pans (deltas sum to movement) and reports release velocity', () => {
  const r = recorder();
  const g = createGestures(r.h);
  g.down(1, 0, 0, 0, { type: 'touch' });
  let t = 0;
  for (let i = 1; i <= 10; i++) { t += 16; g.move(1, i * 10, 0, t); }
  g.up(1, 100, 0, t + 4);
  const drags = r.log.filter((e) => e[0] === 'onDrag');
  const sum = drags.reduce((s, e) => s + e[1], 0);
  assert.approx(sum, 100, 1e-6, 'sum of drag dx');
  const end = r.log.find((e) => e[0] === 'onDragEnd');
  assert.ok(end && end[1] > 400, 'release velocity px/s ' + (end && end[1]));
  assert.ok(!r.names().includes('onTap'), 'no tap after drag');
});

test('gestures: small jitter under the slop is still a tap (fat fingers)', () => {
  const r = recorder();
  const g = createGestures(r.h);
  g.down(1, 10, 10, 0, { type: 'touch' });
  g.move(1, 16, 14, 30);
  g.up(1, 16, 14, 90);
  assert.deepEqual(r.names(), ['onTap']);
});

test('gestures: two fingers = pinch (scale + centroid pan), no tap / drag leaks', () => {
  const r = recorder();
  const g = createGestures(r.h);
  g.down(1, 100, 100, 0, { type: 'touch' });
  g.down(2, 200, 100, 10, { type: 'touch' });
  g.move(2, 300, 100, 30); // distance 100 -> 200
  const p = r.log.find((e) => e[0] === 'onPinch');
  assert.ok(p, 'pinch event');
  assert.approx(p[1], 2, 1e-9, 'scale');
  assert.approx(p[4], 50, 1e-9, 'centroid dx');
  g.up(2, 300, 100, 60);
  g.move(1, 104, 102, 70); // a finger lifted a moment later: no pan, no fling, no tap
  g.up(1, 104, 102, 80);
  const n = r.names();
  assert.ok(n.includes('onPinchStart') && n.includes('onPinchEnd'));
  assert.ok(!n.includes('onTap') && !n.includes('onDragStart'), n.join(','));
});

test('gestures: after a pinch the remaining finger pans (camera only); a finger put back pinches again', () => {
  const r = recorder();
  const g = createGestures(r.h);
  g.down(1, 100, 100, 0, { type: 'touch' });
  g.down(2, 200, 100, 10, { type: 'touch' });
  g.move(2, 260, 100, 30);
  g.up(2, 260, 100, 40);
  g.move(1, 160, 100, 60); // the remaining finger really moves
  const start = r.log.find((e) => e[0] === 'onDragStart');
  assert.ok(start && start[3].pan, 'camera-only pan continues');
  g.down(3, 300, 100, 80, { type: 'touch' }); // finger back down: pinch again
  g.move(3, 360, 100, 100);
  assert.equal(r.names().filter((x) => x === 'onPinchStart').length, 2, 'pinch resumed');
  g.up(3, 360, 100, 120);
  g.up(1, 160, 100, 130);
  assert.ok(!r.names().includes('onTap'));
});

test('gestures: an unused long press still becomes a drag or a slow tap', () => {
  const r = recorder({ onLongPress: () => false });
  const g = createGestures(r.h);
  g.down(1, 100, 100, 0, { type: 'touch' });
  g.tick(700); // long press offered, not wanted
  g.move(1, 160, 100, 750);
  assert.ok(r.names().includes('onDragStart'), 'press-hold-drag pans');
  g.up(1, 160, 100, 800);
  const r2 = recorder({ onLongPress: () => false });
  const g2 = createGestures(r2.h);
  g2.down(1, 100, 100, 0, { type: 'touch' });
  g2.tick(600);
  g2.up(1, 101, 100, 650);
  assert.ok(r2.names().includes('onTap'), 'slow tap');
  const r3 = recorder({ onLongPress: () => true });
  const g3 = createGestures(r3.h);
  g3.down(1, 100, 100, 0, { type: 'touch' });
  g3.tick(600);
  g3.move(1, 160, 100, 650);
  g3.up(1, 160, 100, 700);
  assert.ok(!r3.names().includes('onTap') && !r3.names().includes('onDragStart'), 'a used long press ends the gesture');
});

test('gestures: box mode interrupted by a second finger is cancelled, not committed', () => {
  const r = recorder({ wantsBox: () => true });
  const g = createGestures(r.h);
  g.down(1, 10, 10, 0, { type: 'touch', button: 0 });
  g.move(1, 60, 80, 40);
  g.down(2, 200, 200, 50, { type: 'touch' });
  const n = r.names();
  assert.ok(n.includes('onBoxCancel') && !n.includes('onBoxEnd'), n.join(','));
  assert.ok(n.includes('onPinchStart'));
});

test('gestures: distance thresholds are CSS pixels (scaled to the canvas resolution)', () => {
  const r = recorder();
  const g = createGestures(r.h, { scale: () => 2 }); // 2 canvas px per CSS px
  g.down(1, 100, 100, 0, { type: 'touch' });
  g.move(1, 115, 100, 20); // 7.5 CSS px: still a tap
  g.up(1, 115, 100, 40);
  assert.ok(r.names().includes('onTap') && !r.names().includes('onDragStart'));
});

test('gestures: box-select mode turns a primary drag into a selection rectangle', () => {
  const r = recorder({ wantsBox: () => true });
  const g = createGestures(r.h);
  g.down(1, 10, 10, 0, { type: 'touch', button: 0 });
  g.move(1, 60, 80, 40);
  g.up(1, 60, 80, 60);
  const end = r.log.find((e) => e[0] === 'onBoxEnd');
  assert.deepEqual(end.slice(1), [10, 10, 60, 80]);
  assert.ok(!r.names().includes('onDrag'));
});

test('gestures: mouse hover and wheel pass through; mouse clicks ignore the tap time limit', () => {
  const r = recorder();
  const g = createGestures(r.h);
  g.move(99, 5, 6, 0);
  g.wheel(-120, 5, 6);
  g.down(1, 5, 6, 0, { type: 'mouse', button: 0 });
  g.up(1, 5, 6, 900);
  assert.deepEqual(r.names(), ['onHover', 'onWheel', 'onTap']);
});

// ------------------------------------------------------------------ selection model

test('"Tümü" selects alive + own + combatUnit squads only (never engineers or enemies)', () => {
  const sim = makeSim();
  const ids = allCombatSquadIds(sim, 'new_antioch');
  assert.ok(ids.length >= 6);
  for (const id of ids) {
    const sq = sim.rt.squadById.get(id);
    assert.equal(sq.faction, 'new_antioch');
    assert.ok(sq.type !== 'combat_engineer', 'engineer in Tümü');
  }
  const eng = squadIdsWithRole(sim, 'new_antioch', 'builder');
  assert.ok(eng.length >= 1 && eng.every((id) => sim.rt.squadById.get(id).type === 'combat_engineer'));
  // dead squads drop out
  const victim = sim.rt.squadById.get(ids[0]);
  for (const m of victim.members) m.state = 'dead';
  assert.ok(allCombatSquadIds(sim, 'new_antioch').indexOf(victim.id) < 0);
});

test('selection prune: dead squads and enemies hidden by fog are dropped; enemy only alone', () => {
  const sim = makeSim();
  clearUnits(sim);
  const own = spawn(sim, 'new_antioch', 'yeoman_rifle', 150, 480, Math.PI);
  const own2 = spawn(sim, 'new_antioch', 'yeoman_rifle', 170, 480, Math.PI);
  const enemy = spawn(sim, 'black_grail', 'grail_thrall', 150, 120, 0);
  updateVision(sim);
  const sel = createSelection();
  sel.set([own.id, own2.id, enemy.id]);
  sel.prune(sim, 'new_antioch');
  assert.ok(!sel.has(enemy.id), 'hidden enemy removed');
  assert.ok(sel.has(own.id) && sel.has(own2.id));
  for (const m of own2.members) m.state = 'dead';
  sel.prune(sim, 'new_antioch');
  assert.ok(!sel.has(own2.id), 'dead squad removed');
  const v0 = sel.version;
  sel.toggle(own.id);
  assert.ok(sel.version > v0 && !sel.has(own.id));
});

// ------------------------------------------------------------------ picking (fog-safe)

function viewCamera(sim, x, z) {
  const cam = createCamera({ x, z, dist: 60 });
  cam.groundFn = (gx, gz) => groundHeightAt(sim.world, sim.rt.structGrid, gx, gz);
  updateCamera(cam, 1280, 720, 0);
  return cam;
}

test('picking: own squads are hit-testable; enemies hidden by fog are not', () => {
  const sim = makeSim();
  clearUnits(sim);
  const own = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 470, Math.PI);
  const hidden = spawn(sim, 'black_grail', 'grail_thrall', 160, 420, 0); // outside NA vision (46 m)
  updateVision(sim);
  assert.ok(!(hidden.visibleTo & 1), 'precondition: hidden');
  const cam = viewCamera(sim, 160, 450);
  const ground = cam.groundFn;
  const at = (sq) => {
    const out = [0, 0, 0, 0];
    const m = sq.members[0];
    // same projection the renderer uses
    const P = cam.viewProj;
    const y = ground(m.x, m.z) + 1;
    const X = P[0] * m.x + P[4] * y + P[8] * m.z + P[12], Y = P[1] * m.x + P[5] * y + P[9] * m.z + P[13], W = P[3] * m.x + P[7] * y + P[11] * m.z + P[15];
    out[0] = (X / W * 0.5 + 0.5) * 1280; out[1] = (1 - (Y / W * 0.5 + 0.5)) * 720;
    return out;
  };
  const a = at(own);
  const hit = pickSquad(sim, 'new_antioch', cam, ground, a[0], a[1], 26);
  assert.ok(hit && hit.sq === own, 'own squad picked');
  const b = at(hidden);
  const miss = pickSquad(sim, 'new_antioch', cam, ground, b[0], b[1], 26);
  assert.ok(!miss || miss.sq !== hidden, 'hidden enemy must not be pickable');
  // once visible it can be picked (attack by tap)
  const scout = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 440, Math.PI);
  updateVision(sim);
  assert.ok(hidden.visibleTo & 1, 'now visible');
  const hit2 = pickSquad(sim, 'new_antioch', cam, ground, b[0], b[1], 26, (sq) => sq.faction !== 'new_antioch');
  assert.ok(hit2 && hit2.sq === hidden);
  void scout;
});

test('picking: box select returns own squads only; structures & undiscovered resources respect fog', () => {
  const sim = makeSim();
  clearUnits(sim);
  const a = spawn(sim, 'new_antioch', 'yeoman_rifle', 150, 470, Math.PI);
  const b = spawn(sim, 'new_antioch', 'combat_engineer', 170, 470, Math.PI);
  spawn(sim, 'black_grail', 'grail_thrall', 160, 466, 0);
  updateVision(sim);
  const cam = viewCamera(sim, 160, 460);
  const ids = boxSelect(sim, 'new_antioch', cam, cam.groundFn, 0, 0, 1280, 720);
  assert.deepEqual(ids, [a.id, b.id].sort((x, y) => x - y));
  // enemy altar far in the north is unknown to New Antioch -> not pickable
  const altar = sim.state.structures.find((s) => s.type === 'grail_altar');
  assert.equal(pickStructure(sim, 'new_antioch', altar.x, altar.z), null);
  // own bastion is
  const bastion = sim.state.structures.find((s) => s.type === 'bastion');
  assert.equal(pickStructure(sim, 'new_antioch', bastion.x + 2, bastion.z - 3), bastion);
  // a trench corridor is pickable along its length
  const tr = addStructure(sim, 'trench', 'new_antioch', { x1: 120, z1: 440, x2: 132, z2: 440, built: true, progress: 1 });
  assert.equal(pickStructure(sim, 'new_antioch', 126, 440.6), tr);
  // resource node in unexplored land is not pickable
  const far = sim.state.nodes.find((n) => n.z < 400);
  assert.equal(pickNode(sim, 'new_antioch', far.x, far.z), null);
});

// ------------------------------------------------------------------ Phase 2: facing gesture
function faceRecorder(wants = true) {
  const r = recorder();
  for (const k of ['onFaceStart', 'onFace', 'onFaceEnd', 'onFaceCancel']) r.h[k] = (...a) => r.log.push([k, ...a]);
  r.h.wantsFace = () => wants;
  return r;
}

test('facing gesture: double-tap, hold the second tap and drag -> facing (no double tap, no long press)', () => {
  const r = faceRecorder();
  const g = createGestures(r.h);
  g.down(1, 100, 100, 0, { type: 'touch' });
  g.up(1, 100, 100, 100);
  g.down(2, 102, 101, 250, { type: 'touch' });
  g.tick(1200); // held a long time: still no long press for a facing candidate
  g.move(2, 110, 104, 1250); // under the facing threshold: nothing yet (and no camera drag)
  assert.deepEqual(r.names(), ['onTap']);
  g.move(2, 140, 120, 1300);
  g.move(2, 170, 150, 1350);
  g.up(2, 170, 150, 1400);
  assert.deepEqual(r.names(), ['onTap', 'onFaceStart', 'onFace', 'onFace', 'onFaceEnd']);
  const end = r.log[r.log.length - 1];
  assert.equal(end[1], 170); assert.equal(end[2], 150);
});

test('facing gesture: a released second tap stays a double tap; without a selection it is a drag', () => {
  const r = faceRecorder();
  const g = createGestures(r.h);
  g.down(1, 100, 100, 0, { type: 'touch' });
  g.up(1, 100, 100, 100);
  g.down(2, 101, 100, 250, { type: 'touch' });
  g.up(2, 101, 100, 320);
  assert.deepEqual(r.names(), ['onTap', 'onDoubleTap']);
  // nothing selected (wantsFace false): the held second press pans as before
  const r2 = faceRecorder(false);
  const g2 = createGestures(r2.h);
  g2.down(1, 100, 100, 0, { type: 'touch' });
  g2.up(1, 100, 100, 100);
  g2.down(2, 101, 100, 250, { type: 'touch' });
  g2.move(2, 160, 100, 300);
  g2.up(2, 160, 100, 350);
  assert.ok(r2.names().indexOf('onDragStart') >= 0 && r2.names().indexOf('onFaceStart') < 0);
  // a second finger cancels a facing drag (becomes a pinch)
  const r3 = faceRecorder();
  const g3 = createGestures(r3.h);
  g3.down(1, 100, 100, 0, { type: 'touch' });
  g3.up(1, 100, 100, 100);
  g3.down(2, 100, 100, 250, { type: 'touch' });
  g3.move(2, 150, 100, 300);
  g3.down(3, 300, 300, 320, { type: 'touch' });
  assert.ok(r3.names().indexOf('onFaceCancel') >= 0 && r3.names().indexOf('onPinchStart') >= 0);
});

test('facing gesture: mouse right-button drag is the desktop equivalent', () => {
  const r = faceRecorder();
  const g = createGestures(r.h);
  g.down(1, 100, 100, 0, { type: 'mouse', button: 2 });
  g.move(1, 150, 130, 50);
  g.up(1, 150, 130, 90);
  assert.deepEqual(r.names(), ['onFaceStart', 'onFace', 'onFaceEnd']);
});
