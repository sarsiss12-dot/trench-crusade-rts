import { test, assert } from './harness.js';
import { findPath, cellAt, isPassable, createNav, rebuildNavDynamic } from '../src/world/nav.js';
import { enqueueCommand, CMD } from '../src/sim/commands.js';
import { PATHS_PER_TICK, PATH_WORK_PER_TICK } from '../src/sim/constants.js';
import { requestPath, processPathRequests } from '../src/units/orders.js';
import { riverCenterZ } from '../src/world/mapgen.js';
import { makeSim, clearUnits, spawn, run, addStructure } from './helpers.js';
import { lerp } from '../src/core/dmath.js';

function segmentPassable(nav, ax, az, bx, bz) {
  const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5);
  for (let k = 0; k <= n; k++) {
    if (!isPassable(nav, cellAt(nav, lerp(ax, bx, k / n), lerp(az, bz, k / n)))) return false;
  }
  return true;
}

test('path crosses the river only at fords/bridge; never through deep water', () => {
  const sim = makeSim();
  const nav = sim.rt.nav;
  const R = sim.world.map.river;
  const res = findPath(nav, 'black_grail', 120, 200, 120, 330);
  assert.ok(res && res.points.length >= 2, 'path found');
  let px = 120, pz = 200;
  let crossedAt = null;
  for (let i = 0; i < res.points.length; i += 2) {
    const x = res.points[i], z = res.points[i + 1];
    assert.ok(segmentPassable(nav, px, pz, x, z), `segment ${px},${pz} -> ${x},${z} passable`);
    if ((pz - riverCenterZ(R, px)) * (z - riverCenterZ(R, x)) <= 0 && crossedAt === null) crossedAt = (px + x) / 2;
    px = x; pz = z;
  }
  assert.ok(crossedAt !== null, 'path crosses river');
  const nearCrossing = R.fords.some((f) => crossedAt > f.x0 - 10 && crossedAt < f.x1 + 10) || R.bridges.some((b) => Math.abs(crossedAt - b.x) < 12);
  assert.ok(nearCrossing, 'crossing point ' + crossedAt + ' is a ford or the bridge');
});

test('unreachable goal (inside rock ridge) resolves to nearest reachable point quickly', () => {
  const sim = makeSim();
  const t0 = Date.now();
  const res = findPath(sim.rt.nav, 'new_antioch', 160, 480, 2, 300);
  assert.less(Date.now() - t0, 500);
  assert.ok(res === null || res.reached === false, 'not reported as reached');
});

test('path cache returns identical result and is invalidated by structure changes', () => {
  const sim = makeSim();
  const nav = sim.rt.nav;
  const a = findPath(nav, 'new_antioch', 100, 520, 220, 430);
  const hits = nav.stats.cacheHits;
  const b = findPath(nav, 'new_antioch', 100, 520, 220, 430);
  assert.equal(nav.stats.cacheHits, hits + 1);
  assert.deepEqual(a.points, b.points);
  const v = nav.version;
  addStructure(sim, 'fire_post', 'new_antioch', { x: 160, z: 460, rot: Math.PI, built: true });
  assert.greater(nav.version, v);
  assert.equal(nav.cache.size, 0);
});

test('placed building blocks the path (route goes around)', () => {
  const sim = makeSim();
  const nav = sim.rt.nav;
  addStructure(sim, 'observation_post', 'new_antioch', { x: 160, z: 420, rot: 0, built: true });
  const res = findPath(nav, 'new_antioch', 160, 440, 160, 400);
  let px = 160, pz = 440;
  for (let i = 0; i < res.points.length; i += 2) {
    assert.ok(segmentPassable(nav, px, pz, res.points[i], res.points[i + 1]));
    px = res.points[i]; pz = res.points[i + 1];
  }
});

test('path requests are throttled per tick (squad-level, not per soldier)', () => {
  const sim = makeSim();
  clearUnits(sim);
  const ids = [];
  for (let i = 0; i < 16; i++) ids.push(spawn(sim, 'new_antioch', 'yeoman_rifle', 60 + i * 12, 500, Math.PI).id);
  for (const id of ids) enqueueCommand(sim, { type: CMD.MOVE, faction: 'new_antioch', squadIds: [id], x: 160 + (id % 7), z: 380 });
  const before = sim.rt.nav.stats.searches;
  run(sim, 1 / 20 * 2); // apply commands + first processing tick
  const done = sim.state.squads.filter((q) => q.pathState === 'ready').length;
  assert.ok(done <= PATHS_PER_TICK * 2, 'resolved ' + done);
  assert.ok(sim.rt.nav.stats.searches - before <= PATHS_PER_TICK * 2);
  run(sim, 1);
  assert.equal(sim.state.squads.filter((q) => q.pathState === 'pending').length, 0, 'all resolved within a second');
});

test('same query on fresh navs gives identical paths (deterministic A*)', () => {
  const sim = makeSim();
  const n1 = createNav(sim.world), n2 = createNav(sim.world);
  rebuildNavDynamic(n1, sim.state.structures);
  rebuildNavDynamic(n2, sim.state.structures);
  const a = findPath(n1, 'black_grail', 60, 150, 250, 470);
  const b = findPath(n2, 'black_grail', 60, 150, 250, 470);
  assert.deepEqual(a.points, b.points);
});

// Regression (mobile hitch): a BG wave launched in one tick used to resolve 4 cross-map searches in
// the same tick (tens of ms on a phone). The A* work budget spreads them over ticks.
function crossMapWave(sim) {
  clearUnits(sim);
  const sqs = [];
  for (let i = 0; i < 8; i++) sqs.push(spawn(sim, 'black_grail', 'grail_thrall', 30 + i * 36, 70, 0));
  sqs.forEach((sq, i) => requestPath(sim, sq, 40 + i * 32, 535)); // distinct far goals: no cache hits
  return sqs;
}

test('a wave of cross-map path requests is spread over ticks within the A* work budget', () => {
  const sim = makeSim();
  const sqs = crossMapWave(sim);
  const nav = sim.rt.nav;
  let ticks = 0;
  while (sqs.some((q) => q.pathState === 'pending') && ticks < 40) {
    const before = nav.stats.searches;
    processPathRequests(sim);
    const searches = nav.stats.searches - before;
    assert.ok(searches >= 1 && searches <= PATHS_PER_TICK, 'searches this tick: ' + searches);
    // every search but the last started while the tick was still under budget
    assert.less(sim.rt.pathWork - nav.lastCost, PATH_WORK_PER_TICK);
    ticks++;
  }
  assert.equal(sqs.filter((q) => q.pathState === 'ready').length, 8, 'all paths resolved');
  assert.greater(ticks, 8 / PATHS_PER_TICK, 'long searches were spread over more ticks than the count limit alone');
});

test('the A* budget ignores the path cache: a cold cache (loaded save) makes the same decisions', () => {
  const warm = makeSim(), cold = makeSim();
  const a = crossMapWave(warm), b = crossMapWave(cold);
  for (const sq of a) findPath(warm.rt.nav, sq.faction, sq.x, sq.z, sq.pathGoalX, sq.pathGoalZ); // warm cache
  for (let t = 0; t < 6; t++) {
    processPathRequests(warm);
    processPathRequests(cold);
    assert.equal(warm.rt.pathWork, cold.rt.pathWork, 'tick ' + t + ' work');
    assert.deepEqual(a.map((q) => q.pathState), b.map((q) => q.pathState), 'tick ' + t + ' decisions');
  }
});
