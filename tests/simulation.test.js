import { test, assert } from './harness.js';
import { createSimulation, stepSimulation } from '../src/sim/simulation.js';
import { enqueueCommand, CMD } from '../src/sim/commands.js';
import { EV } from '../src/core/events.js';
import { STATE_VERSION } from '../src/sim/constants.js';
import { damageStructure, destroyStructure, killSoldier, plagueClaims } from '../src/combat/combat.js';
import { inZone } from '../src/world/mapgen.js';
import { makeSim, clearUnits, spawn, run, alive } from './helpers.js';

test('new siege match: factions, forces, objective, version', () => {
  const sim = createSimulation({ scenarioId: 'siege_default', seed: 3 });
  const s = sim.state;
  assert.equal(s.version, STATE_VERSION);
  assert.equal(s.match.phase, 'PREPARATION');
  assert.equal(s.factions.new_antioch.role, 'defender');
  assert.equal(s.factions.black_grail.role, 'attacker');
  assert.ok(s.squads.some((q) => q.faction === 'new_antioch'));
  assert.ok(s.squads.some((q) => q.faction === 'black_grail'));
  const obj = s.structures.find((x) => x.objective);
  assert.ok(obj && obj.type === 'bastion', 'objective bastion');
  assert.equal(s.objectives[0].structureId, obj.id);
  // asymmetric resources
  assert.ok('material' in s.factions.new_antioch.resources && !('biomass' in s.factions.new_antioch.resources));
  assert.ok('biomass' in s.factions.black_grail.resources && !('material' in s.factions.black_grail.resources));
});

test('PREPARATION -> WAR after configured seconds, event emitted once', () => {
  const sim = createSimulation({ scenarioId: 'siege_default', seed: 3, settings: { prepSeconds: 4 } });
  let changes = 0;
  for (let i = 0; i < 20 * 6; i++) {
    stepSimulation(sim);
    for (const e of sim.events) if (e.type === EV.PHASE_CHANGED) changes++;
    sim.events.length = 0;
    if (sim.state.tick === 79) assert.equal(sim.state.match.phase, 'PREPARATION');
  }
  assert.equal(sim.state.match.phase, 'WAR');
  assert.equal(changes, 1);
});

test('preparation: no attacks, no damage, attack commands rejected', () => {
  const sim = makeSim({ prepSeconds: 30 });
  clearUnits(sim);
  const a = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 420, Math.PI);
  const b = spawn(sim, 'black_grail', 'grail_thrall', 160, 412, 0);
  const ev = run(sim, 10);
  assert.equal(ev.filter((e) => e.type === EV.FIRE || e.type === EV.HIT || e.type === EV.DEATH || e.type === EV.MELEE).length, 0);
  assert.equal(alive(a), 8);
  assert.equal(alive(b), 8);
  enqueueCommand(sim, { type: CMD.ATTACK, faction: 'new_antioch', squadIds: [a.id], tk: 'squad', tid: b.id });
  const ev2 = run(sim, 0.2);
  assert.ok(ev2.some((e) => e.type === EV.COMMAND_REJECTED && e.reason === 'match.prep_no_attack'));
});

test('preparation: move orders are clamped to the faction deployment zone', () => {
  const sim = makeSim({ prepSeconds: 60 });
  const sq = sim.state.squads.find((q) => q.faction === 'new_antioch' && q.type === 'yeoman_rifle');
  enqueueCommand(sim, { type: CMD.MOVE, faction: 'new_antioch', squadIds: [sq.id], x: 160, z: 100 });
  run(sim, 0.2);
  assert.equal(sq.order.t, 'move');
  assert.ok(inZone(sim.world.zones.new_antioch, sq.order.x, sq.order.z), 'destination inside zone');
});

test('commands for units of another faction are rejected (ownership)', () => {
  const sim = makeSim();
  const bg = sim.state.squads.find((q) => q.faction === 'black_grail');
  const before = JSON.stringify(bg.order);
  enqueueCommand(sim, { type: CMD.MOVE, faction: 'new_antioch', squadIds: [bg.id], x: 10, z: 10 });
  const ev = run(sim, 0.1);
  assert.equal(JSON.stringify(bg.order), before);
  assert.ok(ev.some((e) => e.type === EV.COMMAND_REJECTED));
});

test('siege victory: objective destroyed -> attacker wins', () => {
  const sim = makeSim();
  const obj = sim.state.structures.find((s) => s.objective);
  damageStructure(sim, obj, obj.hp + 10, 'black_grail');
  run(sim, 0.1);
  assert.equal(sim.state.match.phase, 'ENDED');
  assert.equal(sim.state.match.winner, 'black_grail');
  assert.equal(sim.state.match.reason, 'objective_destroyed');
});

test('siege victory: objective held until the timer -> defender wins', () => {
  const sim = makeSim({ warMinutes: 0.05 }); // 3 seconds of war
  run(sim, 4);
  assert.equal(sim.state.match.phase, 'ENDED');
  assert.equal(sim.state.match.winner, 'new_antioch');
  assert.equal(sim.state.match.reason, 'time_held');
});

test('match length is data/settings driven (long wars supported)', () => {
  for (const minutes of [30, 60, 180]) {
    const sim = createSimulation({ scenarioId: 'siege_default', seed: 1, settings: { warMinutes: minutes, prepSeconds: 60 } });
    assert.equal(sim.state.match.warEndTick, (60 + minutes * 60) * 20);
  }
});

test('attacker spent (no forces, no altars, no biomass, nothing rising) -> defender wins early', () => {
  const sim = makeSim();
  clearUnits(sim);
  spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 480, Math.PI);
  sim.state.factions.black_grail.resources.biomass = 0;
  for (const s of sim.state.structures.slice()) if (s.faction === 'black_grail') destroyStructure(sim, s, 'new_antioch');
  run(sim, 2);
  assert.equal(sim.state.match.phase, 'ENDED');
  assert.equal(sim.state.match.reason, 'attacker_spent');
});

test('attacker with living altars is not spent (income rebuilds the horde)', () => {
  const sim = makeSim();
  clearUnits(sim);
  spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 480, Math.PI);
  sim.state.factions.black_grail.resources.biomass = 0;
  for (const s of sim.state.structures) if (s.queue) s.queue.length = 0;
  run(sim, 3);
  assert.equal(sim.state.match.phase, 'WAR', 'altars still earn biomass');
});

test('a lone infected corpse still rises (never flagged forever); decay skips flagged bodies', () => {
  const sim = makeSim();
  clearUnits(sim);
  for (const s of sim.state.structures.slice()) if (s.faction === 'black_grail') destroyStructure(sim, s, 'new_antioch');
  const na = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 470, Math.PI);
  const bg = spawn(sim, 'black_grail', 'grail_thrall', 30, 30, 0);
  // one infected body in the open with the Grail nearby
  const v = na.members.find((mm) => plagueClaims(mm.id));
  v.infection = 2;
  killSoldier(sim, na, v, 'black_grail', 'claw', 0, 0);
  run(sim, 3);
  const c = sim.state.corpses.find((k) => k.soldierId === v.id);
  assert.ok(c && c.infected, 'infected corpse');
  bg.members.forEach((m) => { m.x = c.x + 3; m.z = c.z; });
  bg.x = c.x + 3; bg.z = c.z;
  run(sim, 2);
  assert.ok(c.riseAt > 0, 'claimed for reanimation');
  // an old unflagged corpse queued behind it must still decay
  sim.state.corpses.unshift({ ...c, id: 999999, riseAt: 0, infected: false, tick: -1e7 });
  sim.rt.corpseById.set(999999, sim.state.corpses[0]);
  const old = sim.state.corpses[0];
  c.tick = -1e7 - 1; // the flagged body heads the (creation-ordered) list
  sim.state.corpses.sort((a, b) => a.tick - b.tick);
  run(sim, 3);
  assert.ok(!sim.state.corpses.includes(old), 'decay not blocked by a flagged body');
  run(sim, 50);
  assert.ok(!sim.state.corpses.includes(c), 'the lone body rose');
  assert.ok(sim.state.squads.some((q) => q.faction === 'black_grail' && q.type === 'grail_thrall' && q !== bg), 'risen thrall squad');
});
