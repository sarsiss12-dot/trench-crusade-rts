// Presentation-side contracts that can run headless: session fixed timestep + fog-filtered event
// fan-out, fog memory of enemy structures (no information leaks), player actions -> plain data
// commands, localization completeness.
import { test, assert } from './harness.js';
import { createSession } from '../src/app/session.js';
import { createActions } from '../src/app/actions.js';
import { createSelection } from '../src/input/selection.js';
import { createStructureMemory } from '../src/render/fog_memory.js';
import { LANGUAGES, missingKeys, t, setLanguage, formatClock } from '../src/ui/i18n.js';
import { UNITS } from '../src/data/units.js';
import { STRUCTURES } from '../src/data/structures.js';
import { ABILITIES } from '../src/data/abilities.js';
import { FACTIONS } from '../src/data/factions.js';
import { COVER_TYPES } from '../src/data/cover.js';
import { EV } from '../src/core/events.js';
import { DT } from '../src/sim/constants.js';
import { updateVision } from '../src/sim/perception.js';
import { destroyStructure } from '../src/combat/combat.js';
import { spawn, clearUnits, addStructure } from './helpers.js';
import { createStructGrid, structGridRebuild } from '../src/world/structgrid.js';
import { groundHeightAt } from '../src/world/ground.js';
import { baseHeightAt } from '../src/world/terrain.js';
import { isNodeKnownTo, isPointVisibleTo } from '../src/sim/perception.js';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function newSession(extra = {}) {
  return createSession({
    scenarioId: 'siege_default', seed: 99,
    settings: { playerFaction: 'new_antioch', prepSeconds: 0, warMinutes: 15, controllers: { new_antioch: 'player', black_grail: 'player' }, ...extra },
  });
}

test('session: fixed timestep independent of frame rate; pause stops the simulation', () => {
  const a = newSession(), b = newSession();
  for (let i = 0; i < 60; i++) a.update(1 / 60);
  for (let i = 0; i < 20; i++) b.update(1 / 20);
  assert.equal(a.sim.state.tick, b.sim.state.tick, 'same game time -> same ticks');
  assert.equal(a.sim.state.tick, Math.round(1 / DT));
  a.setSpeed(0);
  const t0 = a.sim.state.tick;
  a.update(0.5);
  assert.equal(a.sim.state.tick, t0, 'paused');
  a.setSpeed(4);
  a.update(0.1);
  assert.equal(a.sim.state.tick, t0 + 8, '4x speed');
  // huge frame hitch is clamped (no spiral of death)
  a.setSpeed(1);
  const t1 = a.sim.state.tick;
  a.update(5);
  assert.ok(a.sim.state.tick - t1 <= 5, 'clamped catch-up');
});

test('session: presentation only receives events the viewer may perceive', () => {
  const s = newSession();
  const sim = s.sim;
  clearUnits(sim);
  const mine = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 470, Math.PI);
  // hidden Black Grail riflemen out of New Antioch vision fire at each other far away
  spawn(sim, 'black_grail', 'corpse_guard', 60, 120, 0);
  spawn(sim, 'new_antioch', 'yeoman_rifle', 60, 90, 0); // this NA squad sees them, but it's a different area
  updateVision(sim);
  const got = [];
  s.subscribe((ev, show) => got.push([ev, show]));
  // inject synthetic events as the simulation would emit them
  sim.events.push({ type: EV.FIRE, shooter: 1, sq: 999999, faction: 'black_grail', weapon: 'infested_rifle', x: 60, z: 120, tx: 60, tz: 90, hit: false, target: 0, tsq: 0 });
  sim.events.push({ type: EV.EXPLOSION, x: 300, z: 20, size: 'heavy', faction: 'new_antioch' });
  sim.events.push({ type: EV.COMMAND_REJECTED, faction: 'black_grail', cmd: 'MOVE', reason: 'cmd.invalid' });
  sim.events.push({ type: EV.COMMAND_REJECTED, faction: 'new_antioch', cmd: 'MOVE', reason: 'cmd.invalid' });
  s.step(); // step() dispatches after the tick; injected events are filtered like real ones
  const types = got.map(([ev]) => ev.type + ':' + (ev.faction || ''));
  assert.ok(!types.includes('FIRE:black_grail'), 'unknown shooter from an unknown squad is not presented');
  assert.ok(!types.includes('EXPLOSION:new_antioch'), 'explosion in unexplored/unseen area hidden');
  assert.ok(!types.includes('COMMAND_REJECTED:black_grail'), 'enemy UI feedback never leaks');
  assert.ok(types.includes('COMMAND_REJECTED:new_antioch'), 'own feedback delivered');
  void mine;
});

test('session: fast-forward keeps match-flow events (end screen) and stops at the end', () => {
  const s = createSession({
    scenarioId: 'siege_default', seed: 4,
    settings: { playerFaction: 'black_grail', prepSeconds: 2, warMinutes: 0.1, controllers: { new_antioch: 'ai', black_grail: 'ai' } },
  });
  const got = [];
  s.subscribe((ev) => got.push(ev.type));
  s.fastForward(60);
  assert.ok(got.includes(EV.PHASE_CHANGED), 'phase change delivered');
  assert.equal(got.filter((t) => t === EV.MATCH_ENDED).length, 1, 'match end delivered once');
  assert.ok(!got.includes(EV.FIRE) && !got.includes(EV.DEATH), 'per-shot events are skipped');
  assert.ok(s.ended, 'session knows the match ended');
  const endTick = s.sim.state.tick;
  assert.less(endTick, Math.round(60 / DT), 'stopped at the end instead of running the full minute');
  s.fastForward(10);
  assert.equal(s.sim.state.tick, endTick, 'no ticks after the end');
});

test('fog memory: enemy structure destroyed behind the fog stays remembered until re-scouted', () => {
  const s = newSession();
  const sim = s.sim;
  clearUnits(sim);
  const altar = sim.state.structures.find((x) => x.type === 'grail_altar');
  const mem = createStructureMemory();
  // scout sees the altar
  const scout = spawn(sim, 'new_antioch', 'yeoman_rifle', altar.x, altar.z + 24, 0);
  updateVision(sim);
  mem.update(sim, 'new_antioch');
  assert.ok(mem.list(sim, 'new_antioch').some((x) => x.id === altar.id), 'visible altar listed');
  // scout leaves; altar destroyed out of sight
  scout.members.forEach((m) => { m.x = 160; m.z = 520; });
  scout.cx = 160; scout.cz = 520;
  updateVision(sim);
  destroyStructure(sim, altar, 'new_antioch');
  sim.events.length = 0;
  mem.update(sim, 'new_antioch');
  const ghost = mem.list(sim, 'new_antioch').find((x) => x.id === altar.id);
  assert.ok(ghost && ghost.memory, 'still shown as last seen (no leak)');
  // re-scout: now the viewer learns it is gone
  scout.members.forEach((m) => { m.x = altar.x; m.z = altar.z + 20; });
  scout.cx = altar.x; scout.cz = altar.z + 20;
  updateVision(sim);
  mem.update(sim, 'new_antioch');
  assert.ok(!mem.list(sim, 'new_antioch').some((x) => x.id === altar.id), 'forgotten after re-scouting');
});

test('fog memory: hidden enemy construction progress / damage are not updated', () => {
  const s = newSession();
  const sim = s.sim;
  clearUnits(sim);
  // an enemy (New Antioch) trench seen by Black Grail, then damaged while hidden
  const tr = addStructure(sim, 'trench', 'new_antioch', { x1: 150, z1: 300, x2: 162, z2: 300, built: true, progress: 1 });
  const watcher = spawn(sim, 'black_grail', 'grail_thrall', 156, 285, 0);
  updateVision(sim);
  const mem = createStructureMemory();
  mem.update(sim, 'black_grail');
  watcher.members.forEach((m) => { m.x = 156; m.z = 60; });
  watcher.cx = 156; watcher.cz = 60;
  updateVision(sim);
  tr.hp = 10;
  mem.update(sim, 'black_grail');
  const seen = mem.list(sim, 'black_grail').find((x) => x.id === tr.id);
  assert.ok(seen.memory && seen.hp === seen.maxHp, 'last-known hp, not the live value');
});

test('player actions issue plain-data commands through the session (INPUT -> COMMAND)', () => {
  const s = newSession();
  const sim = s.sim;
  const selection = createSelection();
  const game = { session: s, selection, sim, viewer: 'new_antioch', renderer: null, audio: null, notify() {} };
  const actions = createActions(game);
  const yeo = sim.state.squads.find((q) => q.type === 'yeoman_rifle');
  selection.set([yeo.id]);
  assert.ok(actions.moveTo(150, 460, true));
  assert.ok(actions.stop());
  assert.ok(actions.formation('column'));
  const cmds = sim.state.pending;
  assert.deepEqual(cmds.map((c) => c.type), ['MOVE', 'STOP', 'FORMATION']);
  for (const c of cmds) {
    assert.deepEqual(JSON.parse(JSON.stringify(c)), c, 'serializable');
    assert.equal(c.faction, 'new_antioch');
  }
  assert.equal(s.commandLog.length, 3, 'command log for replay / lockstep');
  // construction goes through the same validation as the simulation
  const bad = actions.validate('trench', { x1: 150, z1: 100, x2: 160, z2: 100 });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'build.out_of_zone');
  const ok = actions.build('trench', { x1: 120, z1: 470, x2: 132, z2: 468 });
  assert.ok(ok);
  const b = sim.state.pending[sim.state.pending.length - 1];
  assert.equal(b.type, 'BUILD');
  assert.ok(!b.squadIds, 'no builder selected: the simulation auto-dispatches (Phase 3)');
  s.step();
  assert.ok(sim.state.structures.some((x) => x.type === 'trench' && !x.built), 'construction site placed');
  assert.ok(sim.state.squads.some((q) => q.type === 'combat_engineer' && q.order.t === 'build'), 'nearest engineer assigned automatically');
});

// ------------------------------------------------------------------ localization

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '..', 'src');
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (f.endsWith('.js')) out.push(p);
  }
  return out;
}

test('i18n: Turkish and English tables are complete and every referenced key exists', () => {
  const miss = missingKeys();
  assert.deepEqual(miss.inEn, [], 'keys missing in EN');
  assert.deepEqual(miss.inTr, [], 'keys missing in TR');
  const keys = new Set();
  for (const d of [...Object.values(UNITS), ...Object.values(STRUCTURES), ...Object.values(ABILITIES), ...Object.values(FACTIONS)]) {
    if (d.nameKey) keys.add(d.nameKey);
    if (d.descKey) keys.add(d.descKey);
  }
  for (const c of Object.values(COVER_TYPES)) keys.add(c.key);
  // rejection reasons produced by the simulation / validators are shown to the player
  for (const f of walk(srcRoot)) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:reject\(sim, cmd, |fail\()'([a-z_]+\.[a-z_]+)'/g)) keys.add(m[1]);
    for (const m of src.matchAll(/return '((?:train|ability|build)\.[a-z_]+)'/g)) keys.add(m[1]);
  }
  for (const k of keys) {
    assert.ok(k in LANGUAGES.tr, 'TR missing ' + k);
    assert.ok(k in LANGUAGES.en, 'EN missing ' + k);
  }
  assert.ok(keys.size > 40, 'scanned keys: ' + keys.size);
  setLanguage('en');
  assert.equal(t('hud.all'), 'All');
  setLanguage('tr');
  assert.equal(t('hud.all'), 'Tümü');
  assert.equal(t('menu.minutes', { n: 15 }), '15 dk');
  assert.equal(formatClock(3725), '1:02:05');
});

// ---------------------------------------------------------------- regression: fog-review findings
test('fog memory survives a renderer rebuild / reload: a ruin destroyed out of sight is still remembered', () => {
  const s = newSession();
  const sim = s.sim;
  clearUnits(sim);
  const altar = sim.state.structures.find((x) => x.type === 'grail_altar');
  const scout = spawn(sim, 'new_antioch', 'yeoman_rifle', altar.x, altar.z + 24, 0);
  updateVision(sim);
  const mem = createStructureMemory();
  mem.update(sim, 'new_antioch');
  scout.members.forEach((m) => { m.x = 160; m.z = 520; });
  scout.cx = 160; scout.cz = 520;
  updateVision(sim);
  const hpSeen = altar.hp;
  altar.hp = altar.maxHp * 0.25; // damaged unseen
  mem.update(sim, 'new_antioch');
  destroyStructure(sim, altar, 'new_antioch');
  sim.events.length = 0;
  // GPU context lost / save reloaded: a fresh memory built from the exported one
  const again = createStructureMemory(JSON.parse(JSON.stringify(mem.exportState())));
  again.update(sim, 'new_antioch');
  const ghost = again.list(sim, 'new_antioch').find((x) => x.id === altar.id);
  assert.ok(ghost && ghost.memory, 'still remembered after the rebuild');
  assert.equal(ghost.hp, hpSeen, 'with the hit points last seen');
  // the remembered structure stays selectable: the selection cannot test the fog
  const sel = createSelection();
  sel.setStruct(altar.id);
  sel.prune(sim, 'new_antioch', (id) => again.known(sim, 'new_antioch', id));
  assert.equal(sel.struct, altar.id);
});

test('fog memory: infected ground and resource heaps are only refreshed where the viewer sees', () => {
  const s = newSession();
  const sim = s.sim;
  updateVision(sim);
  const mem = createStructureMemory();
  mem.update(sim, 'new_antioch');
  const inf = sim.state.infection;
  // a cell deep in Black Grail territory (never seen by New Antioch) and one on the NA lines (in sight)
  const far = Math.floor(40 / inf.cs) * inf.cols + Math.floor(160 / inf.cs);
  const near = Math.floor(480 / inf.cs) * inf.cols + Math.floor(160 / inf.cs);
  inf.v[far] = 230; inf.v[near] = 99;
  const known = mem.infection(sim, 'new_antioch');
  assert.equal(known[far], 0, 'unseen rot stays unknown');
  assert.equal(known[near], 99, 'rot in sight is shown');
  // a heap scouted once, then drained out of sight, keeps the amount last seen
  clearUnits(sim);
  const n = sim.state.nodes.find((x) => x.z < 400);
  const scout = spawn(sim, 'new_antioch', 'yeoman_rifle', n.x, n.z + 12, 0);
  updateVision(sim);
  mem.update(sim, 'new_antioch');
  assert.ok(isNodeKnownTo(n, 'new_antioch'));
  const seen = mem.nodes().find((x) => x.id === n.id).amount;
  scout.members.forEach((m) => { m.x = 160; m.z = 540; });
  scout.cx = 160; scout.cz = 540;
  updateVision(sim);
  assert.ok(!isPointVisibleTo(sim, 'new_antioch', n.x, n.z), 'out of sight now');
  n.amount = 0;
  mem.update(sim, 'new_antioch');
  assert.equal(mem.nodes().find((x) => x.id === n.id).amount, seen, 'amount as last seen');
});

test('presentation ground is carved only by trenches the viewer knows', () => {
  const s = createSession({
    scenarioId: 'siege_default', seed: 99,
    settings: { playerFaction: 'black_grail', prepSeconds: 0, controllers: { new_antioch: 'player', black_grail: 'player' } },
  });
  const sim = s.sim;
  updateVision(sim);
  const trench = sim.state.structures.find((x) => x.type === 'trench' && x.faction === 'new_antioch');
  const mem = createStructureMemory();
  mem.update(sim, 'black_grail');
  const known = mem.list(sim, 'black_grail');
  assert.ok(!known.some((x) => x.id === trench.id), 'the Grail has never seen the New Antioch trench');
  const grid = createStructGrid(sim.world.width, sim.world.height, 8);
  structGridRebuild(grid, known);
  const live = groundHeightAt(sim.world, sim.rt.structGrid, trench.x, trench.z);
  const shown = groundHeightAt(sim.world, grid, trench.x, trench.z);
  assert.less(live, shown - 0.5, 'the real trench is dug');
  assert.approx(shown, baseHeightAt(sim.world.terrain, trench.x, trench.z), 1e-9, 'but the Grail player sees untouched ground');
});
