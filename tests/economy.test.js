import { test, assert } from './harness.js';
import { EV } from '../src/core/events.js';
import { enqueueCommand, CMD } from '../src/sim/commands.js';
import { killSoldier, plagueClaims } from '../src/combat/combat.js';
import { UNITS } from '../src/data/units.js';
import { makeSim, clearUnits, spawn, run } from './helpers.js';
import { dist } from '../src/core/dmath.js';

test('New Antioch: physical income (depot/bastion supply, fields food -> manpower)', () => {
  const sim = makeSim();
  clearUnits(sim);
  const r = sim.state.factions.new_antioch.resources;
  const s0 = r.supply, m0 = r.manpower, f0 = r.food;
  run(sim, 30);
  assert.greater(r.supply, s0 + 20, 'supply from depot + bastion');
  assert.ok(r.manpower > m0 || r.food > f0, 'food / population growth');
});

test('fields are disrupted by nearby enemies (logistic pressure on farming)', () => {
  const food = (withEnemy) => {
    const sim = makeSim();
    clearUnits(sim);
    const field = sim.state.structures.find((s) => s.type === 'field');
    if (withEnemy) spawn(sim, 'black_grail', 'grail_thrall', field.x, field.z - 20, 0);
    sim.state.factions.new_antioch.timers.food = -1e9; // freeze conversion to manpower
    const r = sim.state.factions.new_antioch.resources;
    const f0 = r.food;
    run(sim, 20);
    return r.food - f0;
  };
  assert.less(food(true), food(false));
});

test('engineers gather salvage and deliver it physically to a drop-off', () => {
  const sim = makeSim();
  const eng = sim.state.squads.find((q) => q.type === 'combat_engineer');
  const node = sim.state.nodes.reduce((b, n) => (dist(n.x, n.z, eng.x, eng.z) < dist(b.x, b.z, eng.x, eng.z) ? n : b));
  node.seenBy = 3;
  const r = sim.state.factions.new_antioch.resources;
  const amount0 = node.amount;
  enqueueCommand(sim, { type: CMD.GATHER, faction: 'new_antioch', squadIds: [eng.id], nid: node.id });
  const m0 = r.material;
  let delivered = false;
  run(sim, 150, (s) => { for (const e of s.events) if (e.type === EV.RESOURCE_DELIVERED) delivered = true; return !delivered; });
  assert.ok(delivered, 'delivered');
  assert.less(node.amount, amount0);
  assert.greater(r.material, m0 + 10);
});

test('training at the Bastion costs resources and takes time', () => {
  const sim = makeSim();
  const bastion = sim.state.structures.find((s) => s.type === 'bastion');
  const r = sim.state.factions.new_antioch.resources;
  const mp = r.manpower, sup = r.supply;
  const n0 = sim.state.squads.length;
  enqueueCommand(sim, { type: CMD.TRAIN, faction: 'new_antioch', sid: bastion.id, unit: 'yeoman_rifle' });
  run(sim, 0.2);
  assert.equal(r.manpower, mp - UNITS.yeoman_rifle.cost.manpower);
  assert.less(r.supply, sup + 5 - UNITS.yeoman_rifle.cost.supply + 1);
  run(sim, UNITS.yeoman_rifle.trainTime - 2);
  assert.equal(sim.state.squads.length, n0, 'not yet');
  const ev = run(sim, 3);
  assert.ok(ev.some((e) => e.type === EV.TRAIN_COMPLETED));
  assert.equal(sim.state.squads.length, n0 + 1);
  // unaffordable
  r.manpower = 0;
  enqueueCommand(sim, { type: CMD.TRAIN, faction: 'new_antioch', sid: bastion.id, unit: 'yeoman_rifle' });
  const ev2 = run(sim, 0.2);
  assert.ok(ev2.some((e) => e.type === EV.COMMAND_REJECTED && e.reason === 'train.no_resources'));
});

test('ammunition resupply happens only near supply points and costs supply', () => {
  const sim = makeSim();
  clearUnits(sim);
  const near = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 495, Math.PI);
  const far = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 380, Math.PI);
  near.ammo = 0; far.ammo = 0;
  const r = sim.state.factions.new_antioch.resources;
  const s0 = r.supply;
  run(sim, 6);
  assert.greater(near.ammo, 20);
  assert.equal(far.ammo, 0, 'no magic resupply in the field');
  assert.less(r.supply, s0 + 12, 'supply consumed');
});

test('replacements walk from the rear: squads are not magically refilled', () => {
  const sim = makeSim();
  clearUnits(sim);
  const sq = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 470, Math.PI);
  for (let i = 0; i < 3; i++) killSoldier(sim, sq, sq.members[i], 'black_grail', 'rifle', 0, 1);
  sq.lastHitTick = sim.state.tick; // just took casualties: no replacements while under fire
  run(sim, 3);
  assert.equal(sq.members.length, 5);
  sq.lastHitTick = -100000;
  const r = sim.state.factions.new_antioch.resources;
  const mp = r.manpower;
  let joiningSeen = false;
  run(sim, 20, () => { if (sq.members.some((m) => m.state === 'joining')) joiningSeen = true; });
  assert.ok(joiningSeen, 'replacement walked in (joining state)');
  assert.greater(sq.members.length, 5);
  assert.less(r.manpower, mp + 3);
  // far from any reinforcement point: nothing happens
  const sim2 = makeSim();
  clearUnits(sim2);
  const sq2 = spawn(sim2, 'new_antioch', 'yeoman_rifle', 160, 360, Math.PI);
  for (let i = 0; i < 3; i++) killSoldier(sim2, sq2, sq2.members[i], 'black_grail', 'rifle', 0, 1);
  sq2.lastHitTick = -100000;
  run(sim2, 20);
  assert.equal(sq2.members.length, 5);
});

test('Black Grail: battlefield corpses become biomass (no workers, no mines)', () => {
  const sim = makeSim();
  clearUnits(sim);
  const na = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 380, Math.PI);
  const bg = spawn(sim, 'black_grail', 'grail_thrall', 160, 377, 0);
  // the whole squad lies dead (Phase 3: a Thrall mob of 12 would otherwise overrun the survivors
  // and add fresh, infected bodies during the measurement)
  for (let i = 0; i < 8; i++) killSoldier(sim, na, na.members[i], 'new_antioch', 'rifle', 0, 1); // not infected
  enqueueCommand(sim, { type: CMD.STOP, faction: 'black_grail', squadIds: [bg.id] });
  run(sim, 2.5);
  const bio0 = sim.state.factions.black_grail.resources.biomass;
  const corpses0 = sim.state.corpses.length;
  assert.greater(corpses0, 0);
  run(sim, 8);
  assert.greater(sim.state.factions.black_grail.resources.biomass, bio0 + 3);
  assert.less(sim.state.corpses.length, corpses0 + 1);
});

test('Black Grail: infected corpses reanimate where they fell as Grail Thralls', () => {
  const sim = makeSim();
  clearUnits(sim);
  const na = spawn(sim, 'new_antioch', 'yeoman_rifle', 150, 380, Math.PI);
  const na2 = spawn(sim, 'new_antioch', 'yeoman_rifle', 150, 385, Math.PI);
  spawn(sim, 'black_grail', 'grail_thrall', 150, 360, 0);
  const pos = [];
  // two squads: the plague claims a hashed share of the bodies (independent of entity ids)
  for (const q of [na, na2]) for (let i = 0; i < 8; i++) { pos.push([q.members[i].x, q.members[i].z]); killSoldier(sim, q, q.members[i], 'black_grail', 'claw', 0, 1); }
  run(sim, 3);
  const infected = sim.state.corpses.filter((c) => c.infected).length;
  const claimed = sim.state.corpses.filter((c) => plagueClaims(c.soldierId)).length;
  assert.equal(infected, claimed, 'infected exactly where the plague claims the body');
  assert.greater(infected, 3, 'most bodies infected');
  const n0 = sim.state.squads.filter((q) => q.faction === 'black_grail').length;
  const ev = run(sim, 15);
  const rising = ev.filter((e) => e.type === EV.SOLDIER_RISING);
  assert.greater(rising.length, 3, 'bodies rose');
  const raisedSq = sim.state.squads.filter((q) => q.faction === 'black_grail');
  assert.greater(raisedSq.length, n0);
  const ns = raisedSq[raisedSq.length - 1];
  assert.equal(ns.type, 'grail_thrall');
  // risen where they fell
  for (const e of rising) assert.ok(pos.some((p) => dist(p[0], p[1], e.x, e.z) < 0.01));
  assert.equal(sim.state.corpses.filter((c) => c.infected).length, infected - rising.length);
});

test('Black Grail altars raise hordes from biomass (asymmetric production)', () => {
  const sim = makeSim();
  const altar = sim.state.structures.find((s) => s.type === 'grail_altar');
  const r = sim.state.factions.black_grail.resources;
  r.biomass = 100;
  enqueueCommand(sim, { type: CMD.TRAIN, faction: 'black_grail', sid: altar.id, unit: 'grail_thrall' });
  run(sim, 0.2);
  assert.approx(r.biomass, 100 - UNITS.grail_thrall.cost.biomass, 2);
  const ev = run(sim, UNITS.grail_thrall.trainTime + 1);
  const sp = ev.find((e) => e.type === EV.SQUAD_SPAWNED && e.emerging);
  assert.ok(sp, 'emerging squad');
  // New Antioch cannot use altars and vice versa
  enqueueCommand(sim, { type: CMD.TRAIN, faction: 'new_antioch', sid: altar.id, unit: 'yeoman_rifle' });
  const ev2 = run(sim, 0.2);
  assert.ok(ev2.some((e) => e.type === EV.COMMAND_REJECTED));
});
