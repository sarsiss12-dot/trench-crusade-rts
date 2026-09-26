import { test, assert } from './harness.js';
import { EV } from '../src/core/events.js';
import { FOG, fogStateAt } from '../src/world/fog.js';
import { eventVisibility, SHOW, isSquadVisibleTo, isNodeKnownTo, presentedEvent, updateVision } from '../src/sim/perception.js';
import { enqueueCommand, CMD } from '../src/sim/commands.js';
import { STRUCTURES } from '../src/data/structures.js';
import { TERRAIN } from '../src/data/terrain_types.js';
import { makeSim, clearUnits, spawn, run } from './helpers.js';

test('three fog states: unexplored / explored / visible', () => {
  const sim = makeSim();
  const fog = sim.state.fog;
  assert.equal(fogStateAt(fog, 0, 160, 480), FOG.VISIBLE, 'own lines visible');
  assert.equal(fogStateAt(fog, 0, 160, 40), FOG.UNEXPLORED, 'Grail altars unexplored');
  clearUnits(sim);
  const sq = spawn(sim, 'new_antioch', 'yeoman_rifle', 60, 420, Math.PI);
  run(sim, 0.4);
  assert.equal(fogStateAt(fog, 0, 60, 400), FOG.VISIBLE);
  enqueueCommand(sim, { type: CMD.MOVE, faction: 'new_antioch', squadIds: [sq.id], x: 60, z: 500 });
  run(sim, 40);
  assert.equal(fogStateAt(fog, 0, 60, 385), FOG.EXPLORED, 'left area stays explored, not visible');
});

test('enemy hidden in fog is not visible; becomes visible when approached', () => {
  const sim = makeSim();
  clearUnits(sim);
  const na = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 500, Math.PI);
  const bg = spawn(sim, 'black_grail', 'grail_thrall', 160, 330, 0);
  run(sim, 0.4);
  assert.ok(!isSquadVisibleTo(bg, 'new_antioch'));
  enqueueCommand(sim, { type: CMD.MOVE, faction: 'new_antioch', squadIds: [na.id], x: 160, z: 362 });
  run(sim, 45, () => !isSquadVisibleTo(bg, 'new_antioch'));
  assert.ok(isSquadVisibleTo(bg, 'new_antioch'));
});

test('forest concealment: units in forest are detected only at close range', () => {
  const sim = makeSim();
  clearUnits(sim);
  const t = sim.world.terrain;
  // find a forest cell far from the edges
  let fx = 0, fz = 0;
  for (let i = 0; i < t.types.length; i++) {
    if (t.types[i] !== TERRAIN.FOREST) continue;
    const x = (i % t.cols) * 2 + 1, z = Math.floor(i / t.cols) * 2 + 1;
    let all = true;
    for (let dz = -4; dz <= 4 && all; dz += 2) for (let dx = -4; dx <= 4 && all; dx += 2) {
      const j = Math.floor((z + dz) / 2) * t.cols + Math.floor((x + dx) / 2);
      if (t.types[j] !== TERRAIN.FOREST) all = false;
    }
    if (all) { fx = x; fz = z; break; }
  }
  assert.ok(fx > 0, 'found forest');
  const hidden = spawn(sim, 'black_grail', 'grail_thrall', fx, fz, 0, { size: 1 });
  const observer = spawn(sim, 'new_antioch', 'yeoman_rifle', fx, fz + 38, Math.PI, { size: 1 });
  run(sim, 0.4);
  assert.ok(!isSquadVisibleTo(hidden, 'new_antioch'), 'concealed at 38m');
  observer.x = observer.cx = observer.members[0].x = fx;
  observer.z = observer.cz = observer.members[0].z = fz + 14;
  run(sim, 0.4);
  assert.ok(isSquadVisibleTo(hidden, 'new_antioch'), 'detected at 14m');
});

test('no information leaks: events from unseen enemies are suppressed for the viewer', () => {
  const sim = makeSim();
  clearUnits(sim);
  const na = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 440, Math.PI);
  const bg = spawn(sim, 'black_grail', 'corpse_guard', 160, 400, 0);
  run(sim, 0.4);
  const fire = { type: EV.FIRE, sq: bg.id, tsq: na.id, hit: true, faction: 'black_grail', x: bg.x, z: bg.z, tx: na.x, tz: na.z };
  // visible shooter
  assert.equal(eventVisibility(sim, fire, 'new_antioch'), SHOW.ALL);
  // hide the shooter: no muzzle/tracer/impact, only our own hit reaction
  bg.visibleTo = 1 << 1;
  assert.equal(eventVisibility(sim, fire, 'new_antioch'), SHOW.TARGET);
  assert.equal(eventVisibility(sim, { ...fire, hit: false }, 'new_antioch'), SHOW.NONE);
  assert.equal(eventVisibility(sim, { type: EV.DEATH, sq: bg.id, faction: 'black_grail', x: 1, z: 1 }, 'new_antioch'), SHOW.NONE);
  assert.equal(eventVisibility(sim, { type: EV.EXPLOSION, x: 160, z: 40, faction: 'black_grail' }, 'new_antioch'), SHOW.NONE, 'explosion in fog');
  assert.equal(eventVisibility(sim, { type: EV.SQUAD_DESTROYED, id: 1, faction: 'black_grail' }, 'new_antioch'), SHOW.NONE);
  assert.equal(eventVisibility(sim, { type: EV.COMMAND_REJECTED, faction: 'black_grail' }, 'new_antioch'), SHOW.NONE);
});

test('undiscovered resources are unknown and cannot be targeted', () => {
  const sim = makeSim();
  const far = sim.state.nodes.find((n) => n.z < 400 && !isNodeKnownTo(n, 'new_antioch'));
  assert.ok(far, 'an unexplored node exists');
  const eng = sim.state.squads.find((q) => q.type === 'combat_engineer');
  enqueueCommand(sim, { type: CMD.GATHER, faction: 'new_antioch', squadIds: [eng.id], nid: far.id });
  const ev = run(sim, 0.2);
  assert.ok(ev.some((e) => e.type === EV.COMMAND_REJECTED && e.reason === 'cmd.invalid_target'));
});

test('observation post sees farther than ordinary buildings', () => {
  assert.greater(STRUCTURES.observation_post.vision, STRUCTURES.fire_post.vision * 1.5);
  assert.greater(STRUCTURES.observation_post.vision, STRUCTURES.supply_depot.vision * 2);
});

// ---------------------------------------------------------------- regression: fog-review findings
test('attack orders never shoot into the fog: a target that disappears is hunted at its last known spot', () => {
  const sim = makeSim();
  clearUnits(sim);
  const na = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 470, Math.PI);
  const bg = spawn(sim, 'black_grail', 'corpse_guard', 160, 432, 0);
  run(sim, 0.5);
  assert.ok(isSquadVisibleTo(bg, 'new_antioch'));
  enqueueCommand(sim, { type: CMD.ATTACK, faction: 'new_antioch', squadIds: [na.id], tk: 'squad', tid: bg.id });
  run(sim, 1);
  const lastX = bg.cx, lastZ = bg.cz;
  // the target is carried far away into the fog
  for (const m of bg.members) { m.x += 0; m.z -= 150; }
  bg.z -= 150; bg.cz -= 150;
  let shotsAtHidden = 0;
  run(sim, 6, (s) => {
    for (const e of s.events) if (e.type === EV.FIRE && e.sq === na.id && e.tsq === bg.id && !isSquadVisibleTo(bg, 'new_antioch')) shotsAtHidden++;
  });
  assert.equal(shotsAtHidden, 0, 'no shots at a hidden squad');
  assert.equal(na.order.t, 'attack', 'order kept while the spot is unseen or not reached');
  assert.less(Math.hypot(na.pathGoalX - lastX, na.pathGoalZ - lastZ), 6, 'heading for the last known position, not the live one');
});

test('a falling soldier does not reveal the rest of its squad', () => {
  const sim = makeSim();
  clearUnits(sim);
  spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 470, Math.PI);
  const bg = spawn(sim, 'black_grail', 'grail_thrall', 160, 330, 0);
  // one member in sight, dying; the others far away in the fog
  const d = bg.members[0];
  d.x = 160; d.z = 445;
  d.state = 'dying'; d.stateTick = sim.state.tick;
  run(sim, 0.4);
  assert.ok(!isSquadVisibleTo(bg, 'new_antioch'), 'squad stays hidden');
});

test('hits from a hidden shooter carry no direction; felt-only shots do not point back at it', () => {
  const sim = makeSim();
  clearUnits(sim);
  const na = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 470, Math.PI);
  const bg = spawn(sim, 'black_grail', 'corpse_guard', 160, 300, 0); // hidden, far away
  updateVision(sim);
  assert.ok(!isSquadVisibleTo(bg, 'new_antioch'));
  const v = na.members[0];
  const hit = { type: EV.HIT, id: v.id, sq: na.id, faction: 'new_antioch', x: v.x, z: v.z, dx: 0.1, dz: 0.99, dmg: 5, src: bg.id };
  const pHit = presentedEvent(sim, hit, eventVisibility(sim, hit, 'new_antioch'), 'new_antioch');
  assert.equal(pHit.dx, 0); assert.equal(pHit.dz, 0);
  const shot = { type: EV.FIRE, shooter: bg.members[0].id, sq: bg.id, faction: 'black_grail', weapon: 'infested_rifle', x: 160, z: 300, tx: v.x, tz: v.z, hit: true, target: v.id, tsq: na.id };
  const show = eventVisibility(sim, shot, 'new_antioch');
  assert.equal(show, SHOW.TARGET, 'felt, not seen');
  const pShot = presentedEvent(sim, shot, show, 'new_antioch');
  assert.ok(Math.hypot(pShot.x - 160, pShot.z - 300) > 20, 'shooter position not presented');
  assert.equal(pShot.shooter, 0);
  // a visible source keeps its direction
  const own = { ...hit, src: na.id };
  assert.equal(presentedEvent(sim, own, SHOW.ALL, 'new_antioch'), own);
});
