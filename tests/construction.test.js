import { test, assert } from './harness.js';
import { EV } from '../src/core/events.js';
import { enqueueCommand, CMD } from '../src/sim/commands.js';
import { validatePlacement } from '../src/construction/construction.js';
import {
  trenchFrame, trenchSlots, trenchSlot, pointInTrench, trenchDepth, trenchFloorAt, linearCellsVisit,
} from '../src/construction/trench.js';
import { groundHeightAt } from '../src/world/ground.js';
import { baseHeightAt } from '../src/world/terrain.js';
import { coverAt } from '../src/combat/cover.js';
import { COVER_INDEX } from '../src/data/cover.js';
import { STRUCTURES } from '../src/data/structures.js';
import { makeSim, clearUnits, spawn, run, addStructure } from './helpers.js';
import { dist } from '../src/core/dmath.js';

function engineers(sim) {
  return sim.state.squads.filter((q) => q.faction === 'new_antioch' && q.type === 'combat_engineer');
}

test('placement validation reasons: zone, terrain, overlap, resources, length', () => {
  const sim = makeSim();
  const f = 'new_antioch';
  assert.equal(validatePlacement(sim, f, 'trench', { x1: 150, z1: 200, x2: 160, z2: 200 }).reason, 'build.out_of_zone');
  assert.equal(validatePlacement(sim, f, 'trench', { x1: 150, z1: 430, x2: 180, z2: 430 }).reason, 'build.too_long');
  assert.equal(validatePlacement(sim, f, 'trench', { x1: 150, z1: 430, x2: 151, z2: 430 }).reason, 'build.too_short');
  const seg = sim.state.structures.find((s) => s.type === 'trench' && s.faction === f);
  assert.equal(validatePlacement(sim, f, 'trench', { x1: seg.x1 + 1, z1: seg.z1 + 0.3, x2: seg.x2 - 1, z2: seg.z2 + 0.3 }).reason, 'build.overlap');
  assert.equal(validatePlacement(sim, f, 'fire_post', { x: 160, z: 524, rot: 0 }).reason, 'build.blocked');
  sim.state.factions[f].resources.material = 0;
  assert.equal(validatePlacement(sim, f, 'sandbags', { x1: 150, z1: 430, x2: 158, z2: 430 }).reason, 'build.no_resources');
  assert.equal(validatePlacement(sim, 'black_grail', 'trench', { x1: 150, z1: 100, x2: 158, z2: 100 }).reason, 'build.not_faction');
});

test('real construction: site -> engineers work -> progress -> completed (not instant)', () => {
  const sim = makeSim();
  const eng = engineers(sim)[0];
  const mat0 = sim.state.factions.new_antioch.resources.material;
  enqueueCommand(sim, { type: CMD.BUILD, faction: 'new_antioch', squadIds: [eng.id], stype: 'sandbags', x1: 140, z1: 470, x2: 148, z2: 469 });
  run(sim, 0.2);
  const st = sim.state.structures[sim.state.structures.length - 1];
  assert.equal(st.type, 'sandbags');
  assert.equal(st.built, false);
  assert.equal(st.progress, 0);
  assert.less(sim.state.factions.new_antioch.resources.material, mat0, 'cost paid on placement');
  run(sim, 3);
  assert.equal(st.built, false, 'not instant');
  let completed = false;
  let last = 0;
  run(sim, 60, (s) => {
    assert.ok(st.progress >= last - 1e-9, 'progress monotonic');
    last = st.progress;
    for (const e of s.events) if (e.type === EV.STRUCTURE_COMPLETED && e.id === st.id) completed = true;
    return !completed;
  });
  assert.ok(completed && st.built, 'completed');
  assert.equal(st.hp, st.maxHp);
});

test('multiple engineer squads help with diminishing returns', () => {
  const buildTime = (n) => {
    const sim = makeSim();
    clearUnits(sim);
    const ids = [];
    for (let i = 0; i < n; i++) ids.push(spawn(sim, 'new_antioch', 'combat_engineer', 150 + i * 4, 452, Math.PI).id);
    enqueueCommand(sim, { type: CMD.BUILD, faction: 'new_antioch', squadIds: ids, stype: 'trench', x1: 146, z1: 445, x2: 160, z2: 445 });
    let ticks = 0;
    run(sim, 200, (s) => { ticks++; const st = s.state.structures[s.state.structures.length - 1]; return !st.built; });
    return ticks;
  };
  const one = buildTime(1), two = buildTime(2);
  assert.less(two, one, 'two squads faster');
  assert.greater(two, one * 0.5, 'but less than twice as fast');
});

test('TRENCH single source of truth: geometry, slots, cover, terrain, nav, minimap all derive from segment data', () => {
  const sim = makeSim();
  const seg = sim.state.structures.find((s) => s.type === 'trench' && s.faction === 'new_antioch' && s.built);
  // frame / minimap endpoints
  const fr = trenchFrame(seg);
  assert.approx(fr.cx - fr.ux * fr.len / 2, seg.x1, 1e-9);
  assert.approx(fr.cz - fr.uz * fr.len / 2, seg.z1, 1e-9);
  // slots lie inside the corridor and face the front normal
  const slots = trenchSlots(seg);
  assert.equal(slots.length, seg.occ.length);
  for (const s of slots) {
    assert.ok(pointInTrench(seg, s.x, s.z), 'slot inside trench corridor');
    assert.approx(Math.sin(s.facing), fr.nx, 1e-6);
    assert.approx(Math.cos(s.facing), fr.nz, 1e-6);
  }
  // cover at the slot = trench
  assert.equal(coverAt(sim, slots[0].x, slots[0].z), COVER_INDEX.trench);
  // terrain: ground height inside = base - depth
  const base = baseHeightAt(sim.world.terrain, seg.x, seg.z);
  const g = groundHeightAt(sim.world, sim.rt.structGrid, seg.x, seg.z);
  assert.approx(g, base - trenchDepth(seg), 1e-6);
  assert.approx(trenchFloorAt(seg, seg.x, seg.z, sim.world.terrain), g, 1e-9);
  // nav: corridor cells reference this segment (or a higher-priority overlapping one)
  let count = 0;
  linearCellsVisit(sim.world.terrain, seg, STRUCTURES.trench.width * 0.5, (idx) => { if (sim.rt.nav.linear[idx] === seg) count++; });
  assert.greater(count, 4);
  // rotation: a rotated copy gives rotated slots (same function)
  const rot = { ...seg, x1: 100, z1: 400, x2: 100, z2: 412, occ: [] };
  const rs = trenchSlot(rot, 0, {});
  assert.approx(rs.x, 100 + trenchFrame(rot).nx * 0.32, 1e-6);
});

test('trench digging deepens progressively with work', () => {
  const sim = makeSim();
  const eng = engineers(sim)[0];
  enqueueCommand(sim, { type: CMD.BUILD, faction: 'new_antioch', squadIds: [eng.id], stype: 'trench', x1: 110, z1: 450, x2: 122, z2: 449 });
  run(sim, 0.2);
  const st = sim.state.structures[sim.state.structures.length - 1];
  let atHalf = -1;
  run(sim, 120, () => {
    if (atHalf < 0 && st.progress >= 0.5) atHalf = trenchDepth(st);
    return !st.built;
  });
  assert.ok(st.built);
  assert.greater(atHalf, 0.3, 'half-dug trench is partially deep');
  assert.less(atHalf, STRUCTURES.trench.depth * 0.8, 'but not yet full depth');
  assert.approx(trenchDepth(st), STRUCTURES.trench.depth, 1e-9);
});

test('trench endpoints snap to existing segments (connect)', () => {
  const sim = makeSim();
  const seg = sim.state.structures.find((s) => s.type === 'trench' && s.faction === 'new_antioch');
  const v = validatePlacement(sim, 'new_antioch', 'trench', { x1: seg.x1 - 1.2, z1: seg.z1 + 1.1, x2: seg.x1 - 12, z2: seg.z1 + 4 });
  assert.ok(v.ok, v.reason);
  assert.equal(v.params.x1, seg.x1);
  assert.equal(v.params.z1, seg.z1);
});

test('repair restores hp and costs material; cancel refunds 75%', () => {
  const sim = makeSim();
  const eng = engineers(sim)[0];
  const seg = sim.state.structures.find((s) => s.type === 'trench' && s.faction === 'new_antioch');
  seg.hp = seg.maxHp * 0.5;
  const mat = sim.state.factions.new_antioch.resources.material;
  enqueueCommand(sim, { type: CMD.REPAIR, faction: 'new_antioch', squadIds: [eng.id], sid: seg.id });
  run(sim, 40);
  assert.greater(seg.hp, seg.maxHp * 0.5);
  assert.less(sim.state.factions.new_antioch.resources.material, mat + 40);
  // cancel
  const f = sim.state.factions.new_antioch.resources;
  const before = f.material;
  enqueueCommand(sim, { type: CMD.BUILD, faction: 'new_antioch', squadIds: [], stype: 'observation_post', x: 120, z: 490, rot: 0 });
  run(sim, 0.1);
  const op = sim.state.structures[sim.state.structures.length - 1];
  assert.equal(op.type, 'observation_post');
  enqueueCommand(sim, { type: CMD.CANCEL_BUILD, faction: 'new_antioch', sid: op.id });
  run(sim, 0.1);
  assert.ok(sim.state.structures.indexOf(op) < 0);
  assert.approx(f.material, before - 60 + Math.floor(60 * 0.75), 1.5);
  void dist;
});

test('linear fortifications chain end to end (wire belts, sandbag walls, short trench runs)', () => {
  const sim = makeSim();
  clearUnits(sim);
  spawn(sim, 'new_antioch', 'combat_engineer', 150, 430, Math.PI);
  sim.state.factions.new_antioch.resources.material = 5000;
  for (const type of ['wire', 'sandbags', 'trench']) {
    const z = type === 'wire' ? 386 : type === 'sandbags' ? 402 : 418; // open ground in the NA zone
    const a = { x1: 145, z1: z, x2: 155, z2: z };
    const v1 = validatePlacement(sim, 'new_antioch', type, a);
    assert.ok(v1.ok, type + ' first segment: ' + v1.reason);
    addStructure(sim, type, 'new_antioch', { ...v1.params });
    // straight continuation of the minimum length, from the previous end
    const len = STRUCTURES[type].minLen;
    const v2 = validatePlacement(sim, 'new_antioch', type, { x1: 155, z1: z, x2: 155 + len, z2: z });
    assert.ok(v2.ok, type + ' straight continuation: ' + v2.reason);
    // a corner is fine too
    const v3 = validatePlacement(sim, 'new_antioch', type, { x1: 155, z1: z, x2: 159, z2: z + 5 });
    assert.ok(v3.ok, type + ' corner: ' + v3.reason);
    // folding back over the previous segment is not
    const v4 = validatePlacement(sim, 'new_antioch', type, { x1: 155, z1: z, x2: 149, z2: z + 0.4 });
    assert.equal(v4.ok, false, type + ' fold back');
    // and a parallel line on top of it (not joined) is not either
    const v5 = validatePlacement(sim, 'new_antioch', type, { x1: 146, z1: z + 0.3, x2: 154, z2: z + 0.3 });
    assert.equal(v5.ok, false, type + ' overlapping');
  }
});
