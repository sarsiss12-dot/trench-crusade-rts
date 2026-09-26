import { test, assert } from './harness.js';
import { EV } from '../src/core/events.js';
import { enqueueCommand, CMD } from '../src/sim/commands.js';
import { protectionAgainst } from '../src/combat/cover.js';
import { DYING_TICKS, MAX_CORPSES } from '../src/sim/constants.js';
import { killSoldier, addCorpse, plagueClaims } from '../src/combat/combat.js';
import { FACTIONS } from '../src/data/factions.js';
import { makeSim, clearUnits, spawn, run, alive, addStructure } from './helpers.js';

test('opposing squads in range exchange fire (FIRE/HIT/DEATH events)', () => {
  const sim = makeSim();
  clearUnits(sim);
  spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 440, Math.PI);
  spawn(sim, 'black_grail', 'corpse_guard', 160, 400, 0);
  const ev = run(sim, 25);
  assert.ok(ev.some((e) => e.type === EV.FIRE && e.faction === 'new_antioch'));
  assert.ok(ev.some((e) => e.type === EV.FIRE && e.faction === 'black_grail'));
  assert.ok(ev.some((e) => e.type === EV.HIT));
  assert.ok(ev.some((e) => e.type === EV.DEATH));
  // every FIRE carries shooter + target positions for presentation
  const f = ev.find((e) => e.type === EV.FIRE);
  for (const k of ['shooter', 'x', 'z', 'tx', 'tz', 'hit', 'impact', 'weapon']) assert.ok(k in f, 'FIRE.' + k);
});

test('squad fire is staggered (not 8 robots firing on the same tick)', () => {
  const sim = makeSim();
  clearUnits(sim);
  const a = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 440, Math.PI);
  spawn(sim, 'black_grail', 'plague_knight', 160, 400, 0);
  const ticks = new Map();
  run(sim, 6, (s) => {
    for (const e of s.events) if (e.type === EV.FIRE && e.sq === a.id) ticks.set(s.state.tick, (ticks.get(s.state.tick) || 0) + 1);
  });
  assert.greater(ticks.size, 4, 'shots spread over many ticks');
  assert.less(Math.max(...ticks.values()), 4, 'never the whole squad on one tick');
});

test('death flow: hit -> dying (not removed) -> corpse after collapse time', () => {
  const sim = makeSim();
  clearUnits(sim);
  const sq = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 440, Math.PI);
  const m = sq.members[0];
  killSoldier(sim, sq, m, 'black_grail', 'rifle', 0, 1);
  assert.equal(m.state, 'dying');
  run(sim, (DYING_TICKS - 2) / 20);
  assert.ok(sq.members.indexOf(m) >= 0, 'still present while collapsing');
  assert.equal(sim.state.corpses.length, 0);
  run(sim, 0.3);
  assert.ok(sq.members.indexOf(m) < 0, 'removed after collapse');
  const c = sim.state.corpses.find((c) => c.soldierId === m.id);
  assert.ok(c, 'corpse created at death position');
  assert.equal(c.infected, plagueClaims(m.id), 'killed by the Grail -> infected unless the plague spares the body');
});

test('the plague claims a data-driven share of the Grail\'s victims (deterministic per soldier)', () => {
  const chance = FACTIONS.black_grail.reanimation.chance;
  let n = 0;
  for (let id = 1; id <= 4000; id++) if (plagueClaims(id)) n++;
  assert.approx(n / 4000, chance, 0.03);
  assert.equal(plagueClaims(1234), plagueClaims(1234));
});

test('gameplay corpses are bounded', () => {
  const sim = makeSim();
  clearUnits(sim);
  const sq = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 440, Math.PI);
  for (let i = 0; i < MAX_CORPSES + 50; i++) addCorpse(sim, sq, { ...sq.members[0], id: 100000 + i, infection: 0, killer: '' });
  assert.equal(sim.state.corpses.length, MAX_CORPSES);
});

test('cover: trench strongly reduces damage; open ground gives none', () => {
  const sim = makeSim();
  const seg = sim.state.structures.find((s) => s.type === 'trench' && s.faction === 'new_antioch' && s.built);
  const out = {};
  protectionAgainst(sim, seg.x, seg.z, seg.x, seg.z - 40, out);
  assert.greater(out.dmg, 0.5);
  assert.greater(out.acc, 0.4);
  assert.equal(out.cover, 5, 'trench cover index');
  // open ground in the NA base area (road)
  protectionAgainst(sim, 160, 495, 160, 455, out);
  assert.equal(out.dmg, 0);
});

test('cover: sandbags protect only against fire from the other side (directional)', () => {
  const sim = makeSim();
  addStructure(sim, 'sandbags', 'new_antioch', { x1: 150, z1: 430, x2: 160, z2: 430, built: true });
  const front = {}, back = {};
  protectionAgainst(sim, 155, 431, 155, 400, front); // attacker north, soldier south of the wall
  protectionAgainst(sim, 155, 431, 155, 470, back); // attacker on the same side
  assert.greater(front.dmg, 0.3);
  assert.equal(back.dmg, 0);
});

test('melee: Grail Thralls charge and strike adjacent defenders', () => {
  const sim = makeSim();
  clearUnits(sim);
  spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 440, Math.PI);
  spawn(sim, 'black_grail', 'grail_thrall', 160, 425, 0);
  const ev = run(sim, 12);
  assert.ok(ev.some((e) => e.type === EV.MELEE && e.faction === 'black_grail'));
  assert.ok(ev.some((e) => e.type === EV.MELEE && e.faction === 'new_antioch'), 'defenders use bayonets when engaged');
});

test('structures take damage and can be destroyed; nav updates', () => {
  const sim = makeSim();
  clearUnits(sim);
  const sb = addStructure(sim, 'sandbags', 'new_antioch', { x1: 150, z1: 430, x2: 158, z2: 430, built: true });
  const pk = spawn(sim, 'black_grail', 'plague_knight', 154, 420, 0);
  enqueueCommand(sim, { type: CMD.ATTACK, faction: 'black_grail', squadIds: [pk.id], tk: 'struct', tid: sb.id });
  const v = sim.rt.nav.version;
  const ev = run(sim, 40, () => sim.state.structures.indexOf(sb) >= 0);
  assert.ok(ev.some((e) => e.type === EV.STRUCTURE_DAMAGED && e.id === sb.id));
  assert.ok(ev.some((e) => e.type === EV.STRUCTURE_DESTROYED && e.id === sb.id));
  assert.greater(sim.rt.nav.version, v);
});

test('fortified fire position fires within its arc only', () => {
  const inFront = () => {
    const sim = makeSim();
    clearUnits(sim);
    addStructure(sim, 'fire_post', 'new_antioch', { x: 160, z: 440, rot: Math.PI, built: true });
    spawn(sim, 'black_grail', 'grail_thrall', 160, 395, 0);
    return run(sim, 5).filter((e) => e.type === EV.STRUCTURE_FIRE).length;
  };
  const behind = () => {
    const sim = makeSim();
    clearUnits(sim);
    addStructure(sim, 'fire_post', 'new_antioch', { x: 160, z: 440, rot: Math.PI, built: true });
    spawn(sim, 'black_grail', 'grail_thrall', 160, 485, Math.PI);
    return run(sim, 5).filter((e) => e.type === EV.STRUCTURE_FIRE).length;
  };
  assert.greater(inFront(), 5);
  assert.equal(behind(), 0);
});

test('ammunition is consumed by firing; empty squads fire far less', () => {
  const sim = makeSim();
  clearUnits(sim);
  const a = spawn(sim, 'new_antioch', 'yeoman_rifle', 200, 380, Math.PI);
  spawn(sim, 'black_grail', 'plague_knight', 200, 345, 0);
  const start = a.ammo;
  run(sim, 8);
  assert.less(a.ammo, start);
  // empty ammo -> reduced fire
  const sim2 = makeSim();
  clearUnits(sim2);
  const b = spawn(sim2, 'new_antioch', 'yeoman_rifle', 200, 380, Math.PI);
  spawn(sim2, 'black_grail', 'plague_knight', 200, 345, 0);
  b.ammo = 0;
  const full = run(sim, 8).filter((e) => e.type === EV.FIRE && e.sq === a.id).length;
  const empty = run(sim2, 8).filter((e) => e.type === EV.FIRE && e.sq === b.id).length;
  assert.less(empty, full);
  void alive;
});

test('rifle squads do not stall plinking at fortifications: they storm them with melee weapons', () => {
  const sim = makeSim();
  clearUnits(sim);
  // an unmanned fire post facing away (it cannot shoot the attackers coming from behind)
  const post = addStructure(sim, 'fire_post', 'new_antioch', { x: 160, z: 420, rot: 0, built: true });
  const bg = spawn(sim, 'black_grail', 'corpse_guard', 160, 372, 0);
  enqueueCommand(sim, { type: CMD.MOVE, faction: 'black_grail', squadIds: [bg.id], x: 160, z: 445, attackMove: 1 });
  let minD = 1e9;
  run(sim, 30, (s) => {
    for (const m of bg.members) minD = Math.min(minD, Math.hypot(m.x - post.x, m.z - post.z));
  });
  assert.less(minD, 5, 'closed in on the fortification');
  assert.ok(post.hp <= 0 || post.hp < post.maxHp * 0.5, 'real damage done (hp ' + Math.round(post.hp) + ')');
});
