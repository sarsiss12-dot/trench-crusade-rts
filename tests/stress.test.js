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

test('320-soldier battle within budget (mid step of the 160/320/480 ladder)', () => {
  const sim = stress(320);
  let total = 0;
  const N = 20 * 20;
  for (let i = 0; i < N; i++) {
    const t = performance.now();
    stepSimulation(sim);
    total += performance.now() - t;
    sim.events.length = 0;
  }
  const avg = total / N;
  console.log(`       320 soldiers: avg ${avg.toFixed(3)} ms/tick`);
  assert.less(avg, 6);
});

// CPU side of the Phase 2 presentation: pose rows for 480 live soldiers + 300 corpses (with torn
// limbs) + 64 flying gibs, and the bounded gore pools, per frame.
import { computePose, POSE_FLOATS } from '../src/render/anim.js';
import { UNIT_MODELS } from '../src/render/models/humans.js';
import { createLimbPool, createPoolSet, stepLimb, CHAINS } from '../src/render/gore.js';

test('CPU benchmark: 480 posed soldiers + 300 corpses + 64 gibs + gore pools per frame', () => {
  const m0 = UNIT_MODELS.na_rifle ? UNIT_MODELS.na_rifle(1) : UNIT_MODELS[Object.keys(UNIT_MODELS)[0]](1);
  const model = { rig: m0.rig, weapon: m0.weapon, tool: m0.tool, hunch: m0.hunch || 0, heavy: !!m0.heavy };
  const dst = new Float32Array(POSE_FLOATS * 900);
  const vis = (i, extra) => ({ x: i % 40, y: 0, z: (i / 40) | 0, rot: i * 0.1, scale: 1, phase: i, walk: (i % 3) / 2, aim: i % 2, aimYaw: 0, aimPitch: 0, recoil: 0, melee: -1, work: 0, workPhase: 0, hit: 0, hitSide: 1, death: -1, rise: -1, variant: i % 4, time: 1, tint: 0, mud: 0.4, wear: 0.5, highlight: 0, accent: [0.4, 0.1, 0.08], fade: 0, packPulse: 0, inTrench: false, seed: i, lost: 0, blood: 0.3, sick: 0, bio: false, ...extra });
  const live = [], dead = [], gibs = [];
  for (let i = 0; i < 480; i++) live.push(vis(i));
  for (let i = 0; i < 300; i++) dead.push(vis(i, { death: 1, lost: i % 5 === 0 ? CHAINS.arm_l.mask | CHAINS.leg_r.mask : 0 }));
  const limbs = createLimbPool('high');
  for (let i = 0; i < 64; i++) {
    const l = limbs.acquire();
    Object.assign(l, { x: i, y: 2, z: 0, vx: 1, vy: 3, vz: 0, age: 0, life: 30, rest: false, spin: 4, ang: 0 });
    gibs.push(vis(i, { death: 0.04, gib: { mask: CHAINS.arm_r.mask, root: CHAINS.arm_r.root, g: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]) } }));
  }
  const pools = createPoolSet('high');
  const frames = 30;
  const t0 = performance.now();
  for (let f = 0; f < frames; f++) {
    let row = 0;
    for (const v of live) computePose(dst, (row++) * POSE_FLOATS, model, v);
    if (f % 6 === 0) for (const v of dead) computePose(dst, (row++) * POSE_FLOATS, model, v); // corpses: dirty only
    for (const v of gibs) computePose(dst, (row++) * POSE_FLOATS, model, v);
    for (const l of limbs.items) if (l.active) stepLimb(l, 1 / 60, () => 0);
    pools.add(f, f, 1.2, false);
    pools.step(1 / 60);
  }
  const ms = (performance.now() - t0) / frames;
  console.log(`       presentation CPU: ${ms.toFixed(2)} ms/frame (480 live + corpses/6 frames + 64 gibs)`);
  assert.ok(pools.pool.activeCount() <= pools.pool.cap && limbs.activeCount() <= limbs.cap);
  assert.less(ms, 12, 'pose + gore CPU per frame');
});
