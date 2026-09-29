// Phase 2 regression tests (brief §37): faction-aware HOME, Fly Swarm, facing, walking
// reinforcements, new structures / walls, Black Grail construction + thrall economy, craters,
// save migration. Presentation pools (gore / limbs) are tested in render.test.js.
import { test, assert } from './harness.js';
import { enqueueCommand, CMD } from '../src/sim/commands.js';
import { EV } from '../src/core/events.js';
import { STATE_VERSION, MAX_CRATERS } from '../src/sim/constants.js';
import { serializeSave, deserializeSave, encodeState, SAVE_FORMAT, hashState } from '../src/save/codec.js';
import { simulationFromState, stepSimulation } from '../src/sim/simulation.js';
import { factionHome } from '../src/sim/home.js';
import { destroyStructure, killSoldier, damageStructure, addCorpse } from '../src/combat/combat.js';
import { eventVisibility, effectVisibleTo, SHOW } from '../src/sim/perception.js';
import { validatePlacement } from '../src/construction/construction.js';
import { coverAt, protectionAgainst } from '../src/combat/cover.js';
import { COVER_INDEX } from '../src/data/cover.js';
import { STRUCTURES, WALL_TYPES } from '../src/data/structures.js';
import { FACTIONS, sideIndex } from '../src/data/factions.js';
import { UNITS } from '../src/data/units.js';
import { addCrater, abilityCooldown } from '../src/sim/abilities.js';
import { requestReinforcement } from '../src/factions/reinforcement.js';
import { canTrain } from '../src/sim/production.js';
import { isPointPassable } from '../src/world/nav.js';
import { dist } from '../src/core/dmath.js';
import { makeSim, clearUnits, spawn, addStructure, run, alive } from './helpers.js';

function structs(sim, type, faction) {
  return sim.state.structures.filter((s) => s.type === type && (!faction || s.faction === faction));
}

// ------------------------------------------------------------------ §2 HOME

test('HOME is faction-aware: living HQ first, then the next HQ, then the faction anchor', () => {
  const sim = makeSim();
  const na = factionHome(sim, 'new_antioch');
  assert.equal(na.source, 'hq');
  assert.approx(na.x, 160, 0.01);
  assert.approx(na.z, 524 - 38, 0.01); // in front of the bastion, never at the Grail's side
  const bg = factionHome(sim, 'black_grail');
  assert.equal(bg.source, 'hq');
  assert.approx(bg.x, 162, 0.01, 'central altar (nearest to the Grail anchor)');
  assert.less(bg.z, 100, 'Black Grail home is at its altars, not the forest front (old bug: z~180)');
  // central altar destroyed -> the next altar nearest to the anchor (deterministic)
  const central = structs(sim, 'grail_altar').find((s) => s.x === 162);
  destroyStructure(sim, central, 'new_antioch');
  const bg2 = factionHome(sim, 'black_grail');
  assert.equal(bg2.source, 'hq');
  assert.approx(bg2.x, 122, 0.01);
  // all altars gone -> faction anchor, still on the Grail side
  for (const s of structs(sim, 'grail_altar')) destroyStructure(sim, s, 'new_antioch');
  const bg3 = factionHome(sim, 'black_grail');
  assert.equal(bg3.source, 'anchor');
  assert.approx(bg3.z, 72, 0.01);
});

test('HOME survives save/load and AI-controlled matches', () => {
  const sim = makeSim({ controllers: { new_antioch: 'ai', black_grail: 'ai' } });
  run(sim, 20);
  const before = [factionHome(sim, 'new_antioch'), factionHome(sim, 'black_grail')];
  const { state } = deserializeSave(serializeSave(sim.state));
  const sim2 = simulationFromState(state);
  const after = [factionHome(sim2, 'new_antioch'), factionHome(sim2, 'black_grail')];
  assert.deepEqual(after, before);
  assert.greater(before[0].z, 400);
  assert.less(before[1].z, 120);
});

// ------------------------------------------------------------------ §3 Fly Swarm

function swarmSetup() {
  const sim = makeSim();
  clearUnits(sim);
  const na = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 400, Math.PI);
  const bg = spawn(sim, 'black_grail', 'grail_thrall', 160, 350, 0);
  sim.state.factions.black_grail.resources.biomass = 500;
  return { sim, na, bg };
}

test('Fly Swarm: damages and infects enemy soldiers in the area, ignores its own side', () => {
  const { sim, na, bg } = swarmSetup();
  enqueueCommand(sim, { type: CMD.USE_ABILITY, faction: 'black_grail', ability: 'fly_swarm', x: 160, z: 400 });
  const ev = run(sim, 6);
  assert.ok(ev.some((e) => e.type === EV.ABILITY_CAST && e.ability === 'fly_swarm'));
  const hits = ev.filter((e) => e.type === EV.HIT && e.faction === 'new_antioch');
  assert.greater(hits.length, 0);
  assert.ok(hits.some((h) => h.cause === 'swarm'), 'swarm damage is tagged for presentation');
  assert.ok(hits.every((h) => h.cause === 'swarm' || h.cause === 'plague'), 'only swarm / plague damage');
  assert.ok(na.members.some((m) => m.infection > 0), 'infection applied');
  const hp = na.members.reduce((a, m) => a + m.hp, 0);
  assert.less(hp, 8 * 100);
  assert.ok(bg.members.every((m) => m.infection === 0), 'own side untouched');
  // cooldown readable from data x support (fly nest shortens it, never stacks)
  const cd = abilityCooldown(sim, 'black_grail', 'fly_swarm');
  addStructure(sim, 'fly_nest', 'black_grail', { x: 100, z: 120, rot: 0, built: true });
  addStructure(sim, 'fly_nest', 'black_grail', { x: 130, z: 120, rot: 0, built: true });
  assert.approx(abilityCooldown(sim, 'black_grail', 'fly_swarm'), cd * 0.75, 1e-9);
});

test('Fly Swarm fog filtering: a swarm the viewer cannot see is never presented', () => {
  const { sim } = swarmSetup();
  // cast far from any New Antioch eyes
  enqueueCommand(sim, { type: CMD.USE_ABILITY, faction: 'black_grail', ability: 'fly_swarm', x: 160, z: 300 });
  const ev = run(sim, 0.5);
  const cast = ev.find((e) => e.type === EV.ABILITY_CAST);
  assert.ok(cast, 'cast happened');
  assert.equal(eventVisibility(sim, cast, 'new_antioch'), SHOW.NONE);
  assert.equal(eventVisibility(sim, cast, 'black_grail'), SHOW.ALL);
  const eff = sim.state.effects.find((e) => e.kind === 'swarm');
  assert.equal(effectVisibleTo(sim, eff, 'new_antioch'), false, 'continuous swarm VFX stays hidden');
  assert.equal(effectVisibleTo(sim, eff, 'black_grail'), true);
  // over the defenders it is visible (they are inside it)
  const { sim: sim2 } = swarmSetup();
  enqueueCommand(sim2, { type: CMD.USE_ABILITY, faction: 'black_grail', ability: 'fly_swarm', x: 160, z: 400 });
  run(sim2, 0.5);
  const eff2 = sim2.state.effects.find((e) => e.kind === 'swarm');
  assert.equal(effectVisibleTo(sim2, eff2, 'new_antioch'), true);
});

// ------------------------------------------------------------------ §9-10 facing

test('MOVE facing: plain serializable number, squad wheels to it, invalid facing rejected', () => {
  const sim = makeSim();
  clearUnits(sim);
  const sq = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 440, Math.PI);
  const cmd = enqueueCommand(sim, { type: CMD.MOVE, faction: 'new_antioch', squadIds: [sq.id], x: 150, z: 430, face: 1.2 });
  assert.deepEqual(JSON.parse(JSON.stringify(cmd)), cmd, 'command is plain data');
  run(sim, 0.2);
  assert.approx(sq.order.fh, 1.2, 1e-9);
  run(sim, 14);
  assert.equal(sq.order.t, 'idle');
  assert.approx(sq.order.fh, 1.2, 1e-9, 'idle keeps the commanded facing');
  assert.approx(sq.rot, 1.2, 0.02);
  // formation slots follow the facing: the line is spread across the facing direction
  const along = sq.members.map((m) => (m.x - sq.x) * Math.cos(1.2) - (m.z - sq.z) * Math.sin(1.2));
  const spread = Math.max(...along) - Math.min(...along);
  assert.greater(spread, 3, 'line spread perpendicular to the facing');
  // invalid facing
  const ev = [];
  enqueueCommand(sim, { type: CMD.MOVE, faction: 'new_antioch', squadIds: [sq.id], x: 150, z: 430, face: 'north' });
  ev.push(...run(sim, 0.2));
  assert.ok(ev.some((e) => e.type === EV.COMMAND_REJECTED && e.reason === 'cmd.invalid'));
});

test('MOVE facing survives save/load mid-move (identical continuation)', () => {
  const sim = makeSim();
  clearUnits(sim);
  const sq = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 440, Math.PI);
  enqueueCommand(sim, { type: CMD.MOVE, faction: 'new_antioch', squadIds: [sq.id], x: 140, z: 420, face: -0.7 });
  run(sim, 3);
  const { state } = deserializeSave(serializeSave(sim.state));
  const sim2 = simulationFromState(state);
  assert.approx(sim2.state.squads[0].order.fh, -0.7, 1e-9);
  run(sim, 12); run(sim2, 12);
  assert.equal(hashState(sim2.state), hashState(sim.state));
  assert.approx(sim2.state.squads[0].rot, -0.7, 0.02);
});

// ------------------------------------------------------------------ §11-13 reinforcements

test('reinforcement: the squad stays at the front; paid replacements walk from the rear (no teleport)', () => {
  const sim = makeSim();
  clearUnits(sim);
  const sq = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 420, Math.PI);
  for (let i = 0; i < 3; i++) killSoldier(sim, sq, sq.members[i], 'black_grail', 'rifle', 0, 1);
  run(sim, 2.5); // bodies leave the squad
  assert.equal(sq.members.length, 5);
  const r = sim.state.factions.new_antioch.resources;
  const mp = r.manpower, sup = r.supply;
  const x0 = sq.x, z0 = sq.z;
  enqueueCommand(sim, { type: CMD.REINFORCE, faction: 'new_antioch', squadIds: [sq.id] });
  const last = new Map();
  let maxStep = 0, spawnDist = 0;
  const ev = run(sim, 60, () => {
    for (const m of sq.members) {
      const p = last.get(m.id);
      if (p) maxStep = Math.max(maxStep, dist(p[0], p[1], m.x, m.z));
      else if (m.state === 'joining') spawnDist = Math.max(spawnDist, dist(m.x, m.z, sq.x, sq.z));
      last.set(m.id, [m.x, m.z]);
    }
  });
  assert.equal(sq.order.t, 'idle', 'squad order untouched');
  assert.less(dist(sq.x, sq.z, x0, z0), 2, 'squad did not walk back to base');
  assert.greater(spawnDist, 40, 'replacements start at the source, far from the squad');
  assert.less(maxStep, 0.5, 'nobody teleports');
  assert.equal(sq.members.length, 8);
  assert.equal(alive(sq), 8, 'all replacements arrived and joined');
  assert.ok(ev.filter((e) => e.type === EV.SQUAD_SPAWNED && e.reinforcement).length === 3, 'exactly three replacements');
  assert.ok(mp >= 0 && sup >= 0);
  assert.ok(ev.some((e) => e.type === EV.SQUAD_SPAWNED && e.reinforcement), 'replacement spawn events');
});

test('reinforcement in a trench: squad keeps its posts, replacements take the free trench slots', () => {
  const sim = makeSim();
  clearUnits(sim);
  const seg = structs(sim, 'trench', 'new_antioch')[1];
  const sq = spawn(sim, 'new_antioch', 'yeoman_rifle', seg.x, seg.z + 4, Math.PI);
  enqueueCommand(sim, { type: CMD.ENTER_TRENCH, faction: 'new_antioch', squadIds: [sq.id], sid: seg.id });
  run(sim, 12);
  assert.equal(sq.order.t, 'hold_trench');
  for (let i = 0; i < 2; i++) killSoldier(sim, sq, sq.members[i], 'black_grail', 'rifle', 0, 1);
  run(sim, 2.5);
  // (Phase 4: a replacement still walking up holds no post yet — only soldiers present are compared)
  const posts = new Map(sq.members.filter((m) => m.state === 'alive').map((m) => [m.id, m.postId + ':' + m.postSlot]));
  sq.lastHitTick = -100000;
  enqueueCommand(sim, { type: CMD.REINFORCE, faction: 'new_antioch', squadIds: [sq.id] });
  run(sim, 50);
  assert.equal(sq.order.t, 'hold_trench', 'the squad never left the trench');
  assert.equal(sq.members.length, 8);
  for (const m of sq.members) {
    assert.ok(m.postId, 'every soldier holds a post');
    if (posts.has(m.id)) assert.equal(m.postId + ':' + m.postSlot, posts.get(m.id), 'old posts kept');
  }
});

test('reinforcement failure: no source -> impossible; source lost -> cancelled; route cut -> delayed', () => {
  // (a) no living source
  const sim = makeSim();
  clearUnits(sim);
  const sq = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 420, Math.PI);
  killSoldier(sim, sq, sq.members[0], 'black_grail', 'rifle', 0, 1);
  run(sim, 2.5);
  for (const s of sim.state.structures) if (s.faction === 'new_antioch' && STRUCTURES[s.type].reinforceSource) s.built = false;
  assert.equal(requestReinforcement(sim, sq), 'reinf.no_source');
  enqueueCommand(sim, { type: CMD.REINFORCE, faction: 'new_antioch', squadIds: [sq.id] });
  const ev = run(sim, 0.2);
  assert.ok(ev.some((e) => e.type === EV.COMMAND_REJECTED && e.reason === 'reinf.no_source'));
  // (b) source lost after the request
  for (const s of sim.state.structures) if (s.type === 'bastion') s.built = true;
  assert.equal(requestReinforcement(sim, sq), null);
  for (const s of sim.state.structures) if (s.type === 'bastion') s.built = false;
  const ev2 = run(sim, 3);
  assert.equal(sq.reinf, null);
  assert.ok(ev2.some((e) => e.type === EV.NOTICE && e.key === 'reinf.source_lost'));
  assert.equal(sq.members.length, 7, 'nobody appeared');
  // (c) route cut: the squad is walled in (fortified walls block movement)
  const sim3 = makeSim();
  clearUnits(sim3);
  const q = spawn(sim3, 'new_antioch', 'yeoman_rifle', 160, 420, Math.PI);
  const walls = [
    [150, 410, 170, 410], [170, 410, 170, 430], [170, 430, 150, 430], [150, 430, 150, 410],
  ].map(([x1, z1, x2, z2]) => addStructure(sim3, 'fortified_wall', 'new_antioch', { x1, z1, x2, z2, built: true }));
  killSoldier(sim3, q, q.members[0], 'black_grail', 'rifle', 0, 1);
  run(sim3, 2.5);
  enqueueCommand(sim3, { type: CMD.REINFORCE, faction: 'new_antioch', squadIds: [q.id] });
  const ev3 = run(sim3, 8);
  assert.ok(ev3.some((e) => e.type === EV.NOTICE && e.key === 'reinf.route_cut'), 'route cut notice');
  assert.ok(q.reinf, 'request kept (delayed, not cancelled)');
  assert.equal(q.members.length, 7);
  destroyStructure(sim3, walls[0], 'black_grail'); // a gap opens
  run(sim3, 40);
  assert.equal(q.members.length, 8, 'replacement dispatched once the route reopened');
});

// ------------------------------------------------------------------ §7-8 New Antioch structures

test('New Antioch buildings: placement rules, aid station, muster levy, signal post, ammo dump blast', () => {
  const sim = makeSim();
  clearUnits(sim);
  for (const t of ['aid_station', 'workshop', 'ammo_dump', 'signal_post', 'muster_point']) {
    const v = validatePlacement(sim, 'new_antioch', t, { x: 80, z: 470, rot: 0 });
    assert.ok(v.ok, t + ' placeable in the New Antioch zone: ' + v.reason);
    assert.equal(validatePlacement(sim, 'black_grail', t, { x: 80, z: 470, rot: 0 }).reason, 'build.not_faction');
  }
  // fortified wall needs a workshop (Phase 3: and, as a heavy defense, a logistics anchor nearby —
  // this spot is within the bastion's anchor radius)
  const wp = { x1: 120, z1: 470, x2: 128, z2: 470 };
  assert.equal(validatePlacement(sim, 'new_antioch', 'fortified_wall', wp).reason, 'build.requires');
  addStructure(sim, 'workshop', 'new_antioch', { x: 250, z: 500, rot: 0, built: true });
  assert.ok(validatePlacement(sim, 'new_antioch', 'fortified_wall', wp).ok);
  // aid station heals and treats infection
  const aid = addStructure(sim, 'aid_station', 'new_antioch', { x: 120, z: 450, rot: 0, built: true });
  const sq = spawn(sim, 'new_antioch', 'yeoman_rifle', 120, 440, Math.PI);
  sq.lastHitTick = 0;
  for (const m of sq.members) { m.hp = 40; m.infection = 2; }
  run(sim, 12);
  assert.ok(sq.members.every((m) => m.hp > 40), 'healed');
  assert.ok(sq.members.every((m) => m.infection < 2), 'infection treated');
  assert.ok(aid);
  // muster point turns supply into manpower
  const f = sim.state.factions.new_antioch.resources;
  addStructure(sim, 'muster_point', 'new_antioch', { x: 220, z: 500, rot: 0, built: true });
  f.supply = 1000; const mp0 = f.manpower;
  run(sim, 16);
  assert.greater(f.manpower, mp0);
  // signal post shortens artillery (non-stacking)
  const cd = abilityCooldown(sim, 'new_antioch', 'artillery_barrage');
  addStructure(sim, 'signal_post', 'new_antioch', { x: 200, z: 470, rot: 0, built: true });
  addStructure(sim, 'signal_post', 'new_antioch', { x: 210, z: 470, rot: 0, built: true });
  assert.approx(abilityCooldown(sim, 'new_antioch', 'artillery_barrage'), cd * 0.8, 1e-9);
  // ammo dump explodes when destroyed: hurts everyone nearby, wrecks structures
  const dump = addStructure(sim, 'ammo_dump', 'new_antioch', { x: 60, z: 470, rot: 0, built: true });
  const near = spawn(sim, 'black_grail', 'grail_thrall', 62, 476, 0);
  const own = spawn(sim, 'new_antioch', 'yeoman_rifle', 57, 465, 0);
  const cache = addStructure(sim, 'supply_cache', 'new_antioch', { x: 66, z: 462, rot: 0, built: true });
  damageStructure(sim, dump, 99999, 'black_grail');
  const ev = run(sim, 0.5);
  assert.ok(ev.some((e) => e.type === EV.EXPLOSION && e.ability === 'detonation'));
  assert.less(near.members.reduce((a, m) => a + Math.max(0, m.hp), 0), 8 * 60);
  assert.less(own.members.reduce((a, m) => a + Math.max(0, m.hp), 0), 8 * 100);
  assert.less(cache.hp, cache.maxHp);
});

test('wall family: distinct directional cover per type; fortified wall blocks movement', () => {
  const sim = makeSim();
  clearUnits(sim);
  const expect = { low_sandbags: 'low_wall', sandbags: 'sandbag', breastwork: 'breastwork', timber_wall: 'timber', fortified_wall: 'fortified', bone_barricade: 'bone' };
  let z = 440;
  const prot = {};
  for (const t of Object.keys(expect)) {
    assert.ok(WALL_TYPES.indexOf(t) >= 0);
    const w = addStructure(sim, t, t === 'bone_barricade' ? 'black_grail' : 'new_antioch', { x1: 40, z1: z, x2: 50, z2: z, built: true, front: 1 });
    // soldier just behind the wall (+z side), attacker in front (-z)
    const side = STRUCTURES[t].width * 0.5 + 0.4;
    const zz = t === 'fortified_wall' ? z + side + 0.3 : z + side;
    assert.equal(coverAt(sim, 45, zz), COVER_INDEX[expect[t]], t + ' cover type');
    const out = {};
    protectionAgainst(sim, 45, zz, 45, z - 30, out);
    prot[t] = out.dmg;
    protectionAgainst(sim, 45, zz, 45, z + 30, out);
    assert.equal(out.dmg === 0 || out.cover !== COVER_INDEX[expect[t]], true, t + ' is directional');
    if (t === 'fortified_wall') assert.equal(isPointPassable(sim.rt.nav, 45, z), false, 'fortified wall blocks');
    else assert.equal(isPointPassable(sim.rt.nav, 45, z), true, t + ' passable (slows)');
    assert.ok(w);
    z += 12;
  }
  assert.less(prot.low_sandbags, prot.sandbags);
  assert.less(prot.sandbags, prot.breastwork + 0.05);
  assert.less(prot.breastwork, prot.timber_wall);
  assert.less(prot.timber_wall, prot.fortified_wall);
});

// ------------------------------------------------------------------ §5-6 Black Grail

test('Black Grail construction: organic structures on own ground or infected ground, built by thralls', () => {
  const sim = makeSim();
  clearUnits(sim);
  const bgf = sim.state.factions.black_grail.resources;
  bgf.biomass = 1000;
  for (const t of FACTIONS.black_grail.buildList) {
    const def = STRUCTURES[t];
    const p = def.kind === 'linear' ? { x1: 120, z1: 120, x2: 126, z2: 120 } : { x: 120, z: 120, rot: 0 };
    const v = validatePlacement(sim, 'black_grail', t, p);
    assert.ok(v.ok, t + ': ' + v.reason);
    assert.equal(validatePlacement(sim, 'new_antioch', t, p).reason, 'build.not_faction');
  }
  // New Antioch fortifications are not Grail buildings (asymmetry)
  assert.equal(validatePlacement(sim, 'black_grail', 'trench', { x1: 120, z1: 120, x2: 126, z2: 120 }).reason, 'build.not_faction');
  // outside the Grail zone only on heavily infected ground
  assert.equal(validatePlacement(sim, 'black_grail', 'plague_pit', { x: 160, z: 300, rot: 0 }).reason, 'build.out_of_zone');
  const inf = sim.state.infection;
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const i = (Math.floor(300 / inf.cs) + dz) * inf.cols + Math.floor(160 / inf.cs) + dx;
    inf.v[i] = 160;
    inf.o[i] = sideIndex('black_grail') + 1; // Phase 5A: the ground is the Grail's own plague
  }
  assert.ok(validatePlacement(sim, 'black_grail', 'plague_pit', { x: 160, z: 300, rot: 0 }).ok);
  // a thrall work gang raises it with the normal BUILD pipeline
  const gang = spawn(sim, 'black_grail', 'thrall_gang', 126, 175, 0);
  enqueueCommand(sim, { type: CMD.BUILD, faction: 'black_grail', stype: 'corpse_mound', x: 120, z: 160, rot: 0, squadIds: [gang.id] });
  const had = new Set(structs(sim, 'corpse_mound').map((x) => x.id)); // Phase 4.1: one mound stands at the start
  const fresh = () => structs(sim, 'corpse_mound').find((x) => !had.has(x.id));
  const ev = run(sim, 120, () => !(fresh() && fresh().built));
  assert.ok(fresh() && fresh().built, 'mound completed');
  assert.ok(ev.some((e) => e.type === EV.STRUCTURE_COMPLETED && e.stype === 'corpse_mound'));
  // gangs are slower builders than engineers (data)
  assert.less(unitRate('thrall_gang'), unitRate('combat_engineer'));
});

function unitRate(u) { return UNITS[u].buildRate; }

test('Grail Thrall economy: gangs haul corpses to a drop-off for biomass; capped, costed, timed', () => {
  const sim = makeSim();
  clearUnits(sim);
  const bgf = sim.state.factions.black_grail.resources;
  // uninfected bodies lying in the Grail's half, known to the Grail
  const victims = spawn(sim, 'new_antioch', 'yeoman_rifle', 120, 150, 0);
  for (const m of victims.members) { m.infection = 0; killSoldier(sim, victims, m, '', 'rifle', 0, 1); }
  run(sim, 2.5);
  const bodies = sim.state.corpses.filter((c) => !c.infected);
  assert.greater(bodies.length, 3);
  for (const c of bodies) c.seenBy |= 2;
  const gang = spawn(sim, 'black_grail', 'thrall_gang', 118, 120, 0);
  const b0 = bgf.biomass;
  enqueueCommand(sim, { type: CMD.GATHER, faction: 'black_grail', squadIds: [gang.id], cid: bodies[0].id });
  const ev = run(sim, 90);
  const delivered = ev.filter((e) => e.type === EV.RESOURCE_DELIVERED && e.resource === 'biomass');
  assert.greater(delivered.length, 0, 'biomass delivered');
  assert.greater(bgf.biomass, b0);
  assert.less(sim.state.corpses.filter((c) => !c.infected).length, bodies.length, 'bodies consumed');
  // New Antioch engineers cannot haul corpses; gangs cannot mine salvage
  const eng = spawn(sim, 'new_antioch', 'combat_engineer', 150, 440, 0);
  const c2 = addCorpse(sim, victims, { id: 999999, x: 150, z: 430, rot: 0, infection: 0, killer: '' });
  c2.seenBy = 3;
  enqueueCommand(sim, { type: CMD.GATHER, faction: 'new_antioch', squadIds: [eng.id], cid: c2.id });
  const ev2 = run(sim, 0.2);
  assert.ok(ev2.some((e) => e.type === EV.COMMAND_REJECTED && e.reason === 'cmd.no_gatherers'));
  // force cap
  const altar = structs(sim, 'grail_altar')[0];
  bgf.biomass = 10000;
  for (let i = 0; i < 3; i++) spawn(sim, 'black_grail', 'thrall_gang', 100 + i * 5, 100, 0);
  assert.equal(canTrain(sim, 'black_grail', altar, 'thrall_gang'), 'train.cap');
  assert.equal(UNITS.thrall_gang.cost.biomass > 0 && UNITS.thrall_gang.trainTime > 0, true);
  assert.equal(UNITS.thrall_gang.combatUnit, false);
});

// ------------------------------------------------------------------ §19-21 craters, mortar

test('artillery craters: persistent, bounded, merging, known through vision, give light cover', () => {
  const sim = makeSim();
  clearUnits(sim);
  for (let i = 0; i < 400; i++) addCrater(sim, 20 + (i * 37) % 280, 240 + ((i * 53) % 100), 3);
  assert.ok(sim.state.craters.length <= MAX_CRATERS, 'bounded');
  const n = sim.state.craters.length;
  const c = addCrater(sim, sim.state.craters[0].x + 0.5, sim.state.craters[0].z, 3);
  assert.equal(sim.state.craters.length, n, 'a hit on top of a crater merges into it');
  assert.greater(c.d, 1);
  // cover in the crater bowl
  sim.state.craters.length = 0;
  addCrater(sim, 160, 300, 3);
  assert.equal(coverAt(sim, 160, 300), COVER_INDEX.crater);
  // barrage creates craters; the mortar suppresses instead of cratering
  const sim2 = makeSim();
  clearUnits(sim2);
  const na = spawn(sim2, 'new_antioch', 'yeoman_rifle', 160, 380, Math.PI);
  const bg = spawn(sim2, 'black_grail', 'grail_thrall', 160, 350, 0);
  sim2.state.factions.new_antioch.resources.supply = 1000;
  run(sim2, 0.5);
  enqueueCommand(sim2, { type: CMD.USE_ABILITY, faction: 'new_antioch', ability: 'mortar_barrage', x: bg.cx, z: bg.cz });
  run(sim2, 5);
  assert.equal(sim2.state.craters.length, 0, 'mortar leaves no craters');
  assert.greater(bg.suppressUntil, sim2.state.tick, 'mortar pins the target');
  enqueueCommand(sim2, { type: CMD.USE_ABILITY, faction: 'new_antioch', ability: 'artillery_barrage', x: 160, z: 350 });
  run(sim2, 8);
  assert.greater(sim2.state.craters.length, 0, 'artillery leaves craters');
  assert.ok(sim2.state.craters.every((k) => k.seenBy & 1), 'craters under New Antioch eyes are known to it');
  assert.ok(na);
  // saved and restored
  const { state } = deserializeSave(serializeSave(sim2.state));
  assert.equal(state.craters.length, sim2.state.craters.length);
});

// ------------------------------------------------------------------ §35 save migration

test('old v1 saves migrate: reinforce orders become walking requests, new fields appear', () => {
  const sim = makeSim();
  clearUnits(sim);
  const sq = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 420, Math.PI);
  killSoldier(sim, sq, sq.members[0], 'black_grail', 'rifle', 0, 1);
  run(sim, 2.5);
  const bastion = structs(sim, 'bastion')[0];
  const s = JSON.parse(encodeState(sim.state));
  // strip everything Phase 2 added -> a v1 layout
  delete s.craters;
  for (const q of s.squads) { delete q.reinf; delete q.suppressUntil; }
  s.squads[0].order = { t: 'reinforce', sid: bastion.id };
  delete s.factions.new_antioch.abilities.mortar_barrage;
  s.version = 1;
  const str = JSON.stringify({ format: SAVE_FORMAT, version: 1, meta: {}, state: s });
  const { state } = deserializeSave(str);
  assert.equal(state.version, STATE_VERSION);
  assert.ok(Array.isArray(state.craters));
  assert.equal(state.squads[0].order.t, 'idle');
  assert.ok(state.squads[0].reinf && state.squads[0].reinf.src === bastion.id);
  assert.ok(state.factions.new_antioch.abilities.mortar_barrage);
  const sim2 = simulationFromState(state);
  for (let i = 0; i < 20 * 40; i++) stepSimulation(sim2);
  assert.equal(sim2.state.squads[0].members.length, 8, 'migrated request is fulfilled by walking replacements');
});

// ------------------------------------------------------------------ §36 AI

test('AI uses the new command set through the normal pipeline (no cheats)', () => {
  const sim = makeSim({ controllers: { new_antioch: 'ai', black_grail: 'ai' }, prepSeconds: 60 });
  const seen = new Set();
  const byType = (c) => c.faction[0] + ':' + c.type + (c.stype ? ':' + c.stype : '') + (c.ability ? ':' + c.ability : '') + (c.unit ? ':' + c.unit : '') + (c.cid ? ':corpse' : '') + (Number.isFinite(c.face) ? ':face' : '');
  for (let i = 0; i < 20 * 600 && sim.state.match.phase !== 'ENDED'; i++) {
    for (const c of sim.state.pending) { assert.equal(c.source, 'ai'); seen.add(byType(c)); }
    if (i % 20 === 0 && sim.state.squads.some((sq) => sq.faction === 'new_antioch' && sq.reinf)) seen.add('n:walking_request');
    if (i % 20 === 0 && sim.state.squads.some((sq) => sq.faction === 'new_antioch' && sq.reinf && sq.reinf.auto)) seen.add('n:auto_request');
    stepSimulation(sim);
    sim.events.length = 0;
  }
  const has = (k) => [...seen].some((x) => x.startsWith(k));
  // Phase 4.1: squads in trenches / garrisons top up by POSITIONAL auto reinforcement (no command);
  // open-field squads are topped up with explicit REINFORCE
  assert.ok(has('n:REINFORCE') || has('n:auto_request'), 'New Antioch asks for replacements');
  assert.ok(has('n:walking_request'), 'New Antioch requests walking replacements');
  assert.ok(has('n:BUILD:low_sandbags') || has('n:BUILD:breastwork') || has('n:BUILD:aid_station'), 'New Antioch builds Phase 2 structures');
  assert.ok(has('b:TRAIN:thrall_gang'), 'Black Grail raises work gangs');
  assert.ok(has('b:BUILD:corpse_mound') || has('b:BUILD:fly_nest') || has('b:BUILD:plague_pit'), 'Black Grail builds organic structures');
  // Phase 3: gangs harvest by FORAGE (area: animals + bodies, no per-body orders) — the successor
  // of single-body GATHER hauling
  assert.ok(has('b:FORAGE') || [...seen].some((x) => x.startsWith('b:GATHER') && x.endsWith(':corpse')), 'gangs haul corpses');
  assert.ok(has('b:USE_ABILITY:fly_swarm'), 'Fly Swarm used');
  assert.ok(has('n:USE_ABILITY:artillery_barrage') || has('n:USE_ABILITY:mortar_barrage'), 'fire support used');
});

test('Phase 2 state saves and loads: structures, walls, gangs, requests, craters, facing, suppression', () => {
  const sim = makeSim();
  clearUnits(sim);
  addStructure(sim, 'muster_point', 'new_antioch', { x: 220, z: 500, rot: 0, built: true });
  addStructure(sim, 'timber_wall', 'new_antioch', { x1: 150, z1: 450, x2: 158, z2: 450, built: true });
  addStructure(sim, 'plague_pit', 'black_grail', { x: 120, z: 120, rot: 0, built: true });
  const sq = spawn(sim, 'new_antioch', 'yeoman_rifle', 160, 420, Math.PI);
  killSoldier(sim, sq, sq.members[0], 'black_grail', 'rifle', 0, 1);
  spawn(sim, 'black_grail', 'thrall_gang', 126, 175, 0);
  run(sim, 2.5);
  enqueueCommand(sim, { type: CMD.REINFORCE, faction: 'new_antioch', squadIds: [sq.id] });
  enqueueCommand(sim, { type: CMD.MOVE, faction: 'new_antioch', squadIds: [sq.id], x: 150, z: 425, face: 2.2 });
  addCrater(sim, 160, 330, 3);
  sq.suppressUntil = sim.state.tick + 50;
  run(sim, 1);
  const str = serializeSave(sim.state);
  const { state } = deserializeSave(str);
  const sim2 = simulationFromState(state);
  assert.equal(hashState(sim2.state), hashState(sim.state));
  run(sim, 20); run(sim2, 20);
  assert.equal(hashState(sim2.state), hashState(sim.state), 'identical continuation after load');
});
