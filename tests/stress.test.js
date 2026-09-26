import { test, assert } from './harness.js';
import { createSimulation, stepSimulation } from '../src/sim/simulation.js';
import { MAX_CORPSES } from '../src/sim/constants.js';

function soldiers(sim) {
  return sim.state.squads.reduce((n, q) => n + q.members.filter((m) => m.state === 'alive').length, 0);
}

function stress(n) {
  return createSimulation({ scenarioId: 'stress', seed: 77, settings: { stressSoldiers: n, controllers: { new_antioch: 'ai', black_grail: 'ai' } } });
}

test('stress scenario spawns ~160 soldiers in ~20 squads and fights immediately', () => {
  const sim = stress(160);
  const s = soldiers(sim);
  assert.ok(s >= 150 && s <= 175, 'soldiers ' + s);
  assert.ok(sim.state.squads.length >= 18, 'squads ' + sim.state.squads.length);
  assert.equal(sim.state.match.phase, 'WAR');
  assert.ok(sim.state.settings.sandbox, 'stress runs are sandboxed');
});

test('160-soldier battle: tick budget, bounded state, no NaN', () => {
  const sim = stress(160);
  let total = 0, worst = 0, fights = 0;
  for (let i = 0; i < 20 * 60; i++) {
    const t = performance.now();
    stepSimulation(sim);
    const dt = performance.now() - t;
    total += dt;
    if (dt > worst) worst = dt;
    for (const e of sim.events) if (e.type === 'FIRE' || e.type === 'MELEE') fights++;
    sim.events.length = 0;
  }
  const avg = total / (20 * 60);
  console.log(`       160 soldiers: avg ${avg.toFixed(3)} ms/tick, worst ${worst.toFixed(1)} ms, attacks ${fights}`);
  assert.less(avg, 3, 'average tick time');
  assert.greater(fights, 200, 'combat actually happened');
  assert.ok(sim.state.corpses.length <= MAX_CORPSES);
  for (const sq of sim.state.squads) for (const m of sq.members) assert.ok(Number.isFinite(m.x + m.z + m.hp));
});

test('scales toward 500 soldiers (480) within budget', () => {
  const sim = stress(480);
  const s = soldiers(sim);
  assert.ok(s >= 440, 'soldiers ' + s);
  let total = 0;
  const N = 20 * 20;
  for (let i = 0; i < N; i++) {
    const t = performance.now();
    stepSimulation(sim);
    total += performance.now() - t;
    sim.events.length = 0;
  }
  const avg = total / N;
  console.log(`       480 soldiers: avg ${avg.toFixed(3)} ms/tick`);
  assert.less(avg, 8);
});
