import { test, assert } from './harness.js';
import { createSimulation, stepSimulation } from '../src/sim/simulation.js';
import { createSquad } from '../src/sim/state.js';
import { unitDef } from '../src/data/units.js';
import { setOrder } from '../src/units/orders.js';
import { EV } from '../src/core/events.js';
import { run } from './helpers.js';

function aiMatch(prep = 6) {
  return createSimulation({ scenarioId: 'siege_default', seed: 21, settings: { prepSeconds: prep, controllers: { new_antioch: 'ai', black_grail: 'ai' } } });
}

test('Black Grail AI: waits/deploys in preparation, assaults immediately when WAR starts', () => {
  const sim = aiMatch(6);
  run(sim, 5.5);
  assert.equal(sim.state.match.phase, 'PREPARATION');
  // no BG squad left its deployment zone during preparation
  for (const sq of sim.state.squads) if (sq.faction === 'black_grail') assert.ok(sq.z <= sim.world.zones.black_grail.z1 + 1);
  run(sim, 3.5); // WAR + 3 seconds
  assert.equal(sim.state.match.phase, 'WAR');
  const bg = sim.state.squads.filter((q) => q.faction === 'black_grail' && unitDef(q.type).combatUnit);
  const ordered = bg.filter((q) => (q.order.t === 'move' && q.order.am) || q.order.t === 'attack');
  assert.equal(ordered.length, bg.length, 'every combat squad has an attack order');
  for (const q of ordered) if (q.order.t === 'move') assert.greater(q.order.z, q.z - 5, 'heading toward the objective (south)');
});

test('Black Grail AI: noncombat squads never join assault groups', () => {
  const sim = aiMatch(2);
  // an engineer-type (combatUnit:false) squad under Grail control (test fixture)
  const sq = createSquad(sim.state, 'black_grail', 'combat_engineer', 160, 200, 0);
  sim.state.squads.push(sq);
  sim.rt.squadById.set(sq.id, sq);
  for (const m of sq.members) sim.rt.soldierIndex.set(m.id, sq);
  run(sim, 8);
  assert.equal(sq.order.t, 'idle');
  for (const g of sim.state.ai.black_grail.groups) assert.ok(g.squadIds.indexOf(sq.id) < 0);
});

test('Black Grail AI: idle squads are re-ordered; failed paths are retried', () => {
  const sim = aiMatch(2);
  run(sim, 6);
  const sq = sim.state.squads.find((q) => q.faction === 'black_grail' && q.members.length);
  setOrder(sim, sq, { t: 'idle' });
  sq.engaged = false;
  run(sim, 1.2);
  assert.notEqual(sq.order.t, 'idle', 'idle squad re-ordered');
  const sq2 = sim.state.squads.filter((q) => q.faction === 'black_grail')[1];
  sq2.pathState = 'failed';
  const seq = sim.state.commandSeq;
  run(sim, 0.6);
  assert.greater(sim.state.commandSeq, seq, 'retry command issued');
});

test('Black Grail AI: does not send everything down one lane', () => {
  const sim = aiMatch(2);
  run(sim, 8);
  const lanes = new Set(sim.state.ai.black_grail.groups.filter((g) => g.squadIds.length).map((g) => g.lane));
  assert.greater(lanes.size, 1);
});

test('New Antioch AI: fortifies during preparation via BUILD and garrisons trenches', () => {
  const sim = createSimulation({ scenarioId: 'siege_default', seed: 21, settings: { prepSeconds: 60, controllers: { new_antioch: 'ai', black_grail: 'player' } } });
  const n0 = sim.state.structures.length;
  const ev = run(sim, 45);
  assert.ok(ev.some((e) => e.type === EV.STRUCTURE_PLACED && e.faction === 'new_antioch'), 'placed defences');
  assert.greater(sim.state.structures.length, n0);
  const entrenched = sim.state.squads.filter((q) => q.faction === 'new_antioch' && q.order.t === 'hold_trench');
  assert.greater(entrenched.length, 1, 'rifle squads occupy trenches');
  const engineersBusy = sim.state.squads.filter((q) => q.type === 'combat_engineer' && (q.order.t === 'build' || q.order.t === 'repair' || q.order.t === 'gather'));
  assert.greater(engineersBusy.length, 0);
});

test('AI vs AI siege runs to a decision without errors (smoke)', () => {
  const sim = createSimulation({ scenarioId: 'siege_default', seed: 8, settings: { prepSeconds: 20, warMinutes: 4, controllers: { new_antioch: 'ai', black_grail: 'ai' } } });
  for (let i = 0; i < 20 * 60 * 5 && sim.state.match.phase !== 'ENDED'; i++) {
    stepSimulation(sim);
    sim.events.length = 0;
  }
  assert.equal(sim.state.match.phase, 'ENDED');
  for (const sq of sim.state.squads) for (const m of sq.members) assert.ok(Number.isFinite(m.x) && Number.isFinite(m.z), 'finite positions');
});
