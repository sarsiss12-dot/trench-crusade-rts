import { test, assert } from './harness.js';
import { enqueueCommand, CMD } from '../src/sim/commands.js';
import { moveSpeedMult, isPointPassable } from '../src/world/nav.js';
import { passableGoal } from '../src/units/movement.js';
import { trenchSlot } from '../src/construction/trench.js';
import { formationOffsets } from '../src/units/formation.js';
import { TERRAIN } from '../src/data/terrain_types.js';
import { makeSim, clearUnits, spawn, run, addStructure } from './helpers.js';
import { dist } from '../src/core/dmath.js';
import { destroyStructure } from '../src/combat/combat.js';

test('MOVE: squad reaches destination and becomes idle', () => {
  const sim = makeSim();
  clearUnits(sim);
  const sq = spawn(sim, 'new_antioch', 'yeoman_rifle', 150, 500, Math.PI);
  enqueueCommand(sim, { type: CMD.MOVE, faction: 'new_antioch', squadIds: [sq.id], x: 96, z: 486 });
  run(sim, 40, () => sq.order.t !== 'idle' || sim.state.tick < 5);
  assert.equal(sq.order.t, 'idle');
  assert.less(dist(sq.x, sq.z, 96, 486), 1.0);
  // soldiers settle into their formation slots
  run(sim, 4);
  for (const m of sq.members) assert.less(dist(m.x, m.z, sq.x, sq.z), 6);
});

test('individual soldiers keep separation (no stacking)', () => {
  const sim = makeSim();
  clearUnits(sim);
  const a = spawn(sim, 'new_antioch', 'yeoman_rifle', 150, 470, Math.PI);
  const b = spawn(sim, 'new_antioch', 'yeoman_rifle', 170, 470, Math.PI);
  enqueueCommand(sim, { type: CMD.MOVE, faction: 'new_antioch', squadIds: [a.id, b.id], x: 160, z: 440 });
  run(sim, 30);
  const all = [...a.members, ...b.members];
  let minD = 99;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) minD = Math.min(minD, dist(all[i].x, all[i].z, all[j].x, all[j].z));
  assert.greater(minD, 0.55, 'min soldier distance');
  // group destinations were spread, not piled on one point
  assert.greater(dist(a.x, a.z, b.x, b.z), 6);
});

test('formation offsets are centered and distinct for every formation', () => {
  for (const f of ['line', 'column', 'spread', 'wedge', 'cluster', 'horde']) {
    const o = formationOffsets(f, 8, 1.7);
    let cx = 0, cz = 0;
    for (let i = 0; i < 8; i++) { cx += o[i * 2]; cz += o[i * 2 + 1]; }
    assert.approx(cx / 8, 0, 1e-9, f + ' centered x');
    assert.approx(cz / 8, 0, 1e-9, f + ' centered z');
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
      assert.greater(dist(o[i * 2], o[i * 2 + 1], o[j * 2], o[j * 2 + 1]), 0.5, f + ' slots distinct');
    }
  }
});

test('terrain slows movement: mud / shallow water slower than dry ground', () => {
  const sim = makeSim();
  const t = sim.world.terrain;
  const find = (type) => {
    for (let i = 0; i < t.types.length; i++) if (t.types[i] === type && !t.blocked[i]) return [(i % t.cols) * 2 + 1, Math.floor(i / t.cols) * 2 + 1];
    return null;
  };
  const earth = find(TERRAIN.EARTH), mud = find(TERRAIN.MUD), shallow = find(TERRAIN.SHALLOW), deep = find(TERRAIN.DEEP);
  const nav = sim.rt.nav;
  const e = moveSpeedMult(nav, earth[0], earth[1], 'new_antioch', 0, false);
  assert.greater(e, moveSpeedMult(nav, mud[0], mud[1], 'new_antioch', 0, false));
  assert.greater(moveSpeedMult(nav, mud[0], mud[1], 'new_antioch', 0, false), moveSpeedMult(nav, shallow[0], shallow[1], 'new_antioch', 0, false));
  assert.equal(moveSpeedMult(nav, deep[0], deep[1], 'new_antioch', 0, false), 0, 'deep water impassable');
});

test('barbed wire slows enemy infantry but is not an impassable wall', () => {
  const sim = makeSim();
  clearUnits(sim);
  const timeToCross = (withWire) => {
    const s2 = makeSim();
    clearUnits(s2);
    if (withWire) addStructure(s2, 'wire', 'new_antioch', { x1: 120, z1: 440, x2: 200, z2: 440, built: true });
    const sq = spawn(s2, 'black_grail', 'grail_thrall', 160, 420, 0);
    enqueueCommand(s2, { type: CMD.MOVE, faction: 'black_grail', squadIds: [sq.id], x: 160, z: 470 });
    let t = 0;
    // time until every soldier is through the wire belt
    run(s2, 90, () => { t++; return sq.members.some((m) => m.z < 446); });
    assert.ok(sq.members.every((m) => m.z >= 446), 'crossed the wire');
    return t;
  };
  const plain = timeToCross(false), wired = timeToCross(true);
  assert.greater(wired, plain * 1.2, `wire slows (${plain} vs ${wired} ticks)`);
  // friendly wire modifier is milder than the enemy modifier (data driven)
  const s3 = makeSim();
  addStructure(s3, 'wire', 'new_antioch', { x1: 120, z1: 440, x2: 200, z2: 440, built: true });
  const fr = moveSpeedMult(s3.rt.nav, 160, 440, 'new_antioch', 0, false);
  const en = moveSpeedMult(s3.rt.nav, 160, 440, 'black_grail', 1, false);
  const heavy = moveSpeedMult(s3.rt.nav, 160, 440, 'black_grail', 1, true);
  assert.greater(fr, en);
  assert.greater(heavy, en, 'heavy units push through wire more easily');
});

test('AUTO TRENCH OCCUPANCY: soldiers spread over distinct trench slots', () => {
  const sim = makeSim();
  clearUnits(sim);
  const seg = sim.state.structures.find((s) => s.type === 'trench' && s.faction === 'new_antioch');
  const sq = spawn(sim, 'new_antioch', 'yeoman_rifle', seg.x, seg.z + 25, Math.PI);
  enqueueCommand(sim, { type: CMD.MOVE, faction: 'new_antioch', squadIds: [sq.id], x: seg.x, z: seg.z });
  run(sim, 25);
  assert.equal(sq.order.t, 'hold_trench');
  const slots = new Set();
  const slot = {};
  for (const m of sq.members) {
    assert.ok(m.postId > 0, 'soldier has a post');
    const key = m.postId + ':' + m.postSlot;
    assert.ok(!slots.has(key), 'unique slot ' + key);
    slots.add(key);
    const s = sim.rt.structById.get(m.postId);
    trenchSlot(s, m.postSlot, slot);
    assert.less(dist(m.x, m.z, slot.x, slot.z), 0.7, 'standing on its slot');
    assert.equal(s.occ[m.postSlot], m.id, 'occupancy recorded in segment data');
  }
  assert.equal(slots.size, 8);
  // leaving the trench frees the slots
  enqueueCommand(sim, { type: CMD.MOVE, faction: 'new_antioch', squadIds: [sq.id], x: seg.x, z: seg.z + 30 });
  run(sim, 0.2);
  for (const m of sq.members) assert.equal(m.postId, 0);
  const occupied = sim.state.structures.filter((s) => s.type === 'trench').reduce((n, s) => n + s.occ.filter((v) => v !== 0).length, 0);
  assert.equal(occupied, 0);
});

// ---------------------------------------------------------------- stuck-soldier recovery
// A U-shaped pocket of blocking buildings with its mouth facing away from the squad: straight-line
// slot steering alone can never leave it (the reviewer's soldier sat behind deep water for 15 min).
function pocket(sim, sealed) {
  addStructure(sim, 'supply_depot', 'new_antioch', { x: 160, z: 408, rot: 0 });
  addStructure(sim, 'supply_depot', 'new_antioch', { x: 151, z: 398, rot: Math.PI / 2 });
  addStructure(sim, 'supply_depot', 'new_antioch', { x: 169, z: 398, rot: Math.PI / 2 });
  if (sealed) addStructure(sim, 'supply_depot', 'new_antioch', { x: 160, z: 388, rot: 0 });
}

test('a soldier trapped in a pocket walks out around it and rejoins its squad', () => {
  const sim = makeSim();
  clearUnits(sim);
  pocket(sim, false);
  const sq = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 426, 0);
  const m = sq.members[0];
  m.x = 160; m.z = 398; m.wx = m.x; m.wz = m.z;
  let rejoined = -1;
  run(sim, 45, (s) => {
    if (rejoined < 0 && dist(m.x, m.z, sq.x, sq.z) < 6) rejoined = s.state.tick;
  });
  assert.greater(rejoined, 0, 'soldier rejoined its squad');
  assert.less(rejoined / 20, 35, 'within a reasonable time');
  assert.less(sq.lag, 2.5, 'squad no longer dragged by a straggler');
});

test('a soldier sealed in (no way out) rejoins beside its squad anchor instead of staying stuck', () => {
  const sim = makeSim();
  clearUnits(sim);
  pocket(sim, true);
  const sq = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 426, 0);
  const m = sq.members[1];
  m.x = 160; m.z = 398; m.wx = m.x; m.wz = m.z;
  run(sim, 25);
  assert.less(dist(m.x, m.z, sq.x, sq.z), 6, 'rejoined');
});

test('a replacement that cannot reach its squad still joins (never invulnerable / blocking)', () => {
  const sim = makeSim();
  clearUnits(sim);
  pocket(sim, true);
  const sq = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 426, 0);
  const m = sq.members[2];
  m.x = 160; m.z = 398; m.wx = m.x; m.wz = m.z;
  m.state = 'joining'; m.stateTick = sim.state.tick;
  run(sim, 45);
  assert.equal(m.state, 'alive');
});

test('formation slots over impassable ground slide back toward the anchor (bridge crossing)', () => {
  const sim = makeSim();
  clearUnits(sim);
  const nav = sim.rt.nav;
  addStructure(sim, 'supply_depot', 'new_antioch', { x: 169, z: 398, rot: Math.PI / 2 });
  const out = [0, 0];
  // slot 6 m inside the building, anchor outside: the goal slides back to the wall along the line
  passableGoal(nav, 158, 398, 170, 398, out);
  assert.ok(isPointPassable(nav, out[0], out[1]), 'clamped goal is passable');
  assert.approx(out[1], 398, 1e-9, 'stays on the anchor -> slot line');
  assert.greater(out[0], 161, 'as close to the slot as the ground allows');
  assert.less(out[0], 166, 'outside the footprint');
  // passable slots are untouched
  passableGoal(nav, 158, 398, 150, 390, out);
  assert.deepEqual(out, [150, 390]);
  // and a whole squad next to the wall settles without phantom lag or rescue detours
  const sq = spawn(sim, 'new_antioch', 'yeoman_rifle', 163.6, 398, Math.PI);
  sq.formation = 'line';
  run(sim, 8);
  assert.less(sq.lag, 1.5, 'no phantom lag');
  assert.ok(sq.members.every((mm) => !mm.dp && !mm.dtry), 'no rescue detours needed');
});

test('garrison upkeep: soldiers without a post take free trench slots; a lost trench is let go', () => {
  const sim = makeSim();
  clearUnits(sim);
  const seg = sim.state.structures.find((s) => s.type === 'trench' && s.faction === 'new_antioch');
  const sq = spawn(sim, 'new_antioch', 'yeoman_rifle', seg.x, seg.z + 25, Math.PI);
  enqueueCommand(sim, { type: CMD.MOVE, faction: 'new_antioch', squadIds: [sq.id], x: seg.x, z: seg.z });
  run(sim, 25);
  assert.equal(sq.order.t, 'hold_trench');
  // a soldier loses his post (e.g. his segment was repaired away) and a replacement arrives
  const m = sq.members[3];
  const occ = sim.rt.structById.get(m.postId);
  occ.occ[m.postSlot] = 0;
  m.postId = 0; m.postSlot = -1;
  run(sim, 2);
  assert.ok(m.postId > 0, 'post re-assigned while holding the trench');
  // the whole held network destroyed: the squad stands down instead of holding nothing forever
  for (const s of sim.state.structures.slice()) if (s.type === 'trench' && s.faction === 'new_antioch') destroyStructure(sim, s, 'black_grail');
  run(sim, 2);
  assert.equal(sq.order.t, 'idle');
  assert.ok(sq.members.every((mm) => mm.postId === 0));
});
