import { test, assert } from './harness.js';
import { createSimulation, stepSimulation, simulationFromState, stateHash } from '../src/sim/simulation.js';
import { enqueueCommand, CMD } from '../src/sim/commands.js';
import { serializeSave, deserializeSave } from '../src/save/codec.js';
import { createVisualRng } from '../src/core/rng.js';
import { dsin, dcos, datan2 } from '../src/core/dmath.js';

function aiSim(seed, extra = {}) {
  return createSimulation({ scenarioId: 'siege_default', seed, settings: { prepSeconds: 10, controllers: { new_antioch: 'ai', black_grail: 'ai' }, ...extra } });
}

function steps(sim, n, cb) {
  for (let i = 0; i < n; i++) {
    if (cb) cb(sim);
    stepSimulation(sim);
    sim.events.length = 0;
  }
}

test('same seed + commands + ticks => identical state hash', () => {
  const a = aiSim(99), b = aiSim(99);
  steps(a, 20 * 240);
  steps(b, 20 * 240);
  assert.equal(stateHash(a), stateHash(b));
  assert.greater(a.state.factions.new_antioch.stats.kills + a.state.factions.black_grail.stats.kills, 0, 'combat happened');
});

test('different seeds diverge once combat randomness is involved', () => {
  const a = aiSim(1), b = aiSim(2);
  steps(a, 20 * 240);
  steps(b, 20 * 240);
  assert.notEqual(stateHash(a), stateHash(b));
});

test('save -> load -> continue equals continuing without saving', () => {
  const a = aiSim(7);
  steps(a, 20 * 90);
  const saved = serializeSave(a.state, { slot: 'test' });
  const b = simulationFromState(deserializeSave(saved).state);
  assert.equal(stateHash(b), stateHash(a), 'hash right after load');
  steps(a, 20 * 60);
  steps(b, 20 * 60);
  assert.equal(stateHash(b), stateHash(a), 'hash after continuing 60s');
});

test('player command replay reproduces the same match', () => {
  const script = [
    { at: 30, cmd: (sim) => ({ type: CMD.MOVE, faction: 'new_antioch', squadIds: sim.state.squads.filter((s) => s.faction === 'new_antioch' && s.type === 'yeoman_rifle').slice(0, 2).map((s) => s.id), x: 150, z: 440 }) },
    { at: 400, cmd: () => ({ type: CMD.USE_ABILITY, faction: 'new_antioch', ability: 'artillery_barrage', x: 160, z: 330 }) },
  ];
  const runOnce = () => {
    const sim = createSimulation({ scenarioId: 'siege_default', seed: 5, settings: { prepSeconds: 5, controllers: { new_antioch: 'player', black_grail: 'ai' } } });
    const log = [];
    for (let t = 0; t < 20 * 80; t++) {
      for (const s of script) if (s.at === sim.state.tick) log.push(enqueueCommand(sim, s.cmd(sim)));
      stepSimulation(sim);
      sim.events.length = 0;
    }
    return { hash: stateHash(sim), log };
  };
  const r1 = runOnce();
  assert.equal(r1.log.length, 2);
  // replay purely from the recorded command log (plain data with tick stamps)
  const log = JSON.parse(JSON.stringify(r1.log));
  const sim = createSimulation({ scenarioId: 'siege_default', seed: 5, settings: { prepSeconds: 5, controllers: { new_antioch: 'player', black_grail: 'ai' } } });
  for (let t = 0; t < 20 * 80; t++) {
    for (const c of log) {
      if (c.tick !== sim.state.tick + 1) continue;
      const copy = { ...c };
      delete copy.seq;
      enqueueCommand(sim, copy);
    }
    stepSimulation(sim);
    sim.events.length = 0;
  }
  assert.equal(stateHash(sim), r1.hash);
});

test('visual randomness cannot perturb the simulation', () => {
  const a = aiSim(11), b = aiSim(11);
  const vis = createVisualRng(123);
  steps(a, 20 * 120);
  steps(b, 20 * 120, () => { for (let i = 0; i < 50; i++) vis.next(); });
  assert.equal(stateHash(a), stateHash(b));
});

test('deterministic trig matches IEEE Math within tolerance', () => {
  for (let x = -20; x <= 20; x += 0.0137) {
    assert.approx(dsin(x), Math.sin(x), 1e-7, 'sin ' + x);
    assert.approx(dcos(x), Math.cos(x), 1e-7, 'cos ' + x);
  }
  for (let y = -3; y <= 3; y += 0.37) {
    for (let x = -3; x <= 3; x += 0.41) assert.approx(datan2(y, x), Math.atan2(y, x), 1e-8, `atan2 ${y},${x}`);
  }
});
