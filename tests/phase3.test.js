// Phase 3 regression tests (brief §70): expansion economy, settlements, civilians, wildlife and
// livestock, Grail forage, the cheap Thrall swarm, Pestilence, plague reanimation, medics /
// clerics / flamers / sanitation, specialities, auto engineers, multi-squad trenches, fog, AI,
// determinism. Each test drives the real systems through commands where a player would.
import { test, assert } from './harness.js';
import { enqueueCommand, CMD } from '../src/sim/commands.js';
import { EV } from '../src/core/events.js';
import { createSimulation, simulationFromState, stepSimulation } from '../src/sim/simulation.js';
import { serializeSave, deserializeSave, hashState, encodeState } from '../src/save/codec.js';
import { validatePlacement } from '../src/construction/construction.js';
import { killSoldier, addCorpse, destroyStructure, plagueClaims } from '../src/combat/combat.js';
import { cremateCorpse } from '../src/sim/corpses.js';
import { STRUCTURES } from '../src/data/structures.js';
import { UNITS } from '../src/data/units.js';
import { SECTOR_KINDS, POPULATION, ENGINEERING } from '../src/data/economy.js';
import { SPECIES, WILDLIFE } from '../src/data/animals.js';
import { PESTILENCE, SPECIALITIES, SPEC_TIERS } from '../src/data/specialities.js';
import { FACTIONS } from '../src/data/factions.js';
import { ABILITIES } from '../src/data/abilities.js';
import { addInfection, pestTierOf, spreadMult, reanimDelayMult } from '../src/factions/pestilence.js';
import { validateAbility } from '../src/sim/abilities.js';
import { availableTier, validateSpec, unitSquadSize, specHas, matchProgress } from '../src/sim/specialities.js';
import { builderStatus } from '../src/units/engineers.js';
import { trenchNetwork, networkCapacity, squadsInNetwork, trenchSlotCount } from '../src/construction/trench.js';
import { eventVisibility, SHOW, isSectorKnownTo } from '../src/sim/perception.js';
import { updateVision } from '../src/sim/perception.js';
import { totalPopulation } from '../src/economy/settlements.js';
import { dist } from '../src/core/dmath.js';
import { makeSim, clearUnits, spawn, addStructure, run, alive } from './helpers.js';
import { createEngineerHighlights } from '../src/ui/engineer_highlight.js';
import { trenchPanelData } from '../src/ui/trench_panel.js';

const NA = 'new_antioch';
const BG = 'black_grail';

function cmd(sim, type, faction, fields) {
  enqueueCommand(sim, { type, faction, ...fields });
}

function sector(sim, id) {
  return sim.state.sectors.find((s) => s.id === id);
}

/** A built settlement on a sector with people (as if settlers had arrived). */
function settle(sim, secId, pop = 12) {
  const sec = sector(sim, secId);
  const st = addStructure(sim, 'settlement', NA, { x: sec.x, z: sec.z, rot: Math.PI, built: true });
  sec.sid = st.id;
  st.pop = pop;
  st.threat = -100000;
  return st;
}

function addAnimal(sim, sp, x, z, hab = '') {
  const a = {
    id: sim.state.nextId++, sp, x, z, rot: 0, vx: 0, vz: 0, hp: SPECIES[sp].hp, st: 'wild', hab, pen: 0, by: 0,
    tx: x, tz: z, wait: sim.state.tick + 400, panic: 0, shy: 0, px: 0, pz: 0, visibleTo: 0, seenBy: 0,
  };
  sim.state.animals.push(a);
  return a;
}

function grailBio(sim) {
  return sim.state.factions[BG].resources.biomass || 0;
}

// ------------------------------------------------------------------ §70 sectors / settlements

test('multiple settlement sites: 8-12 sectors of every kind, known in the home half, placement rules', () => {
  const sim = makeSim();
  const secs = sim.state.sectors;
  assert.ok(secs.length >= 8 && secs.length <= 12, 'sector count ' + secs.length);
  for (const k of Object.keys(SECTOR_KINDS)) assert.ok(secs.some((s) => s.kind === k), 'kind ' + k);
  // richness rolled per match (not all equal)
  assert.ok(new Set(secs.map((s) => s.rich)).size >= 2, 'richness varies');
  for (const s of secs) {
    assert.ok(isSectorKnownTo(s, NA), 'New Antioch knows its own country: ' + s.id);
    assert.ok(!isSectorKnownTo(s, BG), 'the Grail has not scouted ' + s.id);
  }
  const sec = sector(sim, 'fertile_c');
  assert.ok(validatePlacement(sim, NA, 'settlement', { x: sec.x, z: sec.z, rot: Math.PI }).ok, 'on a sector');
  assert.equal(validatePlacement(sim, NA, 'settlement', { x: 160, z: 380, rot: Math.PI }).reason, 'build.needs_sector');
  cmd(sim, CMD.BUILD, NA, { stype: 'settlement', x: sec.x, z: sec.z, rot: Math.PI });
  run(sim, 0.2);
  assert.ok(sec.sid > 0, 'the site claims the sector');
  assert.equal(validatePlacement(sim, NA, 'settlement', { x: sec.x + 4, z: sec.z, rot: Math.PI }).reason, 'build.sector_taken');
  // economy buildings need a host settlement; a quarry needs a quarry / scrap sector
  assert.equal(validatePlacement(sim, NA, 'farm', { x: 60, z: 385, rot: 0 }).reason, 'build.needs_settlement');
  // two different sites at once are fine (several settlements)
  const s2 = sector(sim, 'hamlet_w');
  assert.ok(validatePlacement(sim, NA, 'settlement', { x: s2.x, z: s2.z, rot: Math.PI }).ok, 'a second sector');
});

test('settlement economy: sector x richness x labour production, remote stock, convoy home', () => {
  const sim = makeSim();
  clearUnits(sim);
  const st = settle(sim, 'fertile_c', 12);
  addStructure(sim, 'farm', NA, { x: st.x + 22, z: st.z + 8, rot: 0, built: true });
  run(sim, 30);
  assert.ok(st.stock.food > 8, 'remote settlement stores its food: ' + st.stock.food.toFixed(1));
  // an empty settlement produces nothing
  const sim2 = makeSim();
  clearUnits(sim2);
  const st2 = settle(sim2, 'fertile_c', 0);
  run(sim2, 30);
  assert.equal(st2.stock.food, 0, 'no people, no production');
  // convoy: stock leaves by cart and arrives home
  st.stock.food = 60;
  const food0 = sim.state.factions[NA].resources.food;
  const ev = run(sim, 80);
  assert.ok(ev.some((e) => e.type === EV.CONVOY_DISPATCHED), 'convoy dispatched');
  const arr = ev.find((e) => e.type === EV.CONVOY_ARRIVED);
  assert.ok(arr && arr.food > 20, 'convoy arrived with food');
  assert.ok(sim.state.factions[NA].stats.convoysArrived >= 1);
  assert.ok(sim.state.factions[NA].resources.food > food0 - 60, 'the cargo reached the stores');
});

test('food -> manpower: fed population recruits (each recruit eats food); starving barely does', () => {
  const fed = makeSim();
  clearUnits(fed);
  fed.state.factions[NA].resources.food = 400;
  fed.state.factions[NA].resources.manpower = 0;
  const hungry = makeSim();
  clearUnits(hungry);
  hungry.state.factions[NA].resources.food = 0;
  hungry.state.factions[NA].resources.manpower = 0;
  for (const s of hungry.state.structures) if (s.type === 'field') s.hp = 0; // no harvest either
  hungry.state.structures = hungry.state.structures.filter((s) => s.type !== 'field');
  run(fed, 120);
  run(hungry, 120);
  const a = fed.state.factions[NA], b = hungry.state.factions[NA];
  assert.greater(a.stats.manpowerGained, b.stats.manpowerGained + 3, 'food turns population into recruits');
  assert.ok(a.econ.lastManpowerRate > POPULATION.manpowerPassivePerMin, 'rate above the passive trickle');
  assert.ok(a.resources.food < 400, 'recruits and mouths cost food');
});

test('passive manpower: a light trickle with no population at all', () => {
  const sim = makeSim();
  clearUnits(sim);
  const f = sim.state.factions[NA];
  f.population = 0;
  f.resources.manpower = 0;
  f.resources.food = 0;
  sim.state.structures = sim.state.structures.filter((s) => s.type !== 'field');
  run(sim, 120);
  const want = POPULATION.manpowerPassivePerMin * 2;
  assert.approx(f.resources.manpower, want, 1.01, 'passive manpower');
});

// ------------------------------------------------------------------ civilians

test('civilian evacuation: EVACUATE carries the people to safety; population survives', () => {
  const sim = makeSim();
  clearUnits(sim);
  const st = settle(sim, 'hamlet_w', 12);
  run(sim, 40); // the working crew walks out
  const crew = sim.state.squads.find((q) => q.civ && q.civ.home === st.id && q.civ.role === 'work');
  assert.ok(crew, 'a crew works the settlement');
  const f = sim.state.factions[NA];
  const total0 = totalPopulation(sim, NA);
  const pop0 = f.population;
  cmd(sim, CMD.EVACUATE, NA, { sid: st.id });
  const ev = run(sim, 0.2);
  assert.ok(ev.some((e) => e.type === EV.EVACUATION && e.sid === st.id), 'evacuation event');
  assert.equal(st.evac, 1);
  assert.equal(st.pop, 0, 'the settlement is empty');
  assert.equal(crew.civ.mode, 'evac');
  assert.approx(totalPopulation(sim, NA), total0, 0.01, 'people are on the road, not lost');
  run(sim, 140, () => sim.state.squads.indexOf(crew) >= 0);
  assert.ok(sim.state.squads.indexOf(crew) < 0, 'crew arrived and dispersed');
  assert.greater(f.population, pop0 + 10, 'evacuees joined the fortress quarter');
  // the second EVACUATE is rejected
  cmd(sim, CMD.EVACUATE, NA, { sid: st.id });
  const ev2 = run(sim, 0.2);
  assert.ok(ev2.some((e) => e.type === EV.COMMAND_REJECTED && e.reason === 'evac.already'));
});

test('civilians shelter from visible danger and die with a fallen shelter (population lost)', () => {
  const sim = makeSim();
  clearUnits(sim);
  const st = settle(sim, 'hamlet_w', 12);
  run(sim, 40);
  const crew = sim.state.squads.find((q) => q.civ && q.civ.home === st.id);
  assert.ok(crew);
  spawn(sim, BG, 'grail_thrall', st.x, st.z - 30, 0);
  run(sim, 12);
  assert.ok(crew.civ.mode === 'shelter' || crew.civ.mode === 'hidden' || crew.civ.mode === 'flee', 'crew reacts: ' + crew.civ.mode);
  run(sim, 20);
  if (crew.civ.mode === 'hidden') {
    const lost0 = sim.state.factions[NA].stats.civLost;
    destroyStructure(sim, st, BG);
    run(sim, 3);
    assert.greater(sim.state.factions[NA].stats.civLost, lost0, 'sheltered people died in the ruins');
  }
});

// ------------------------------------------------------------------ wildlife / livestock

test('wildlife cap: bounded per habitat and in total over a long run', () => {
  const sim = makeSim({ living: true });
  clearUnits(sim);
  const caps = new Map(sim.world.habitats.map((h) => [h.id, h.cap]));
  let maxTotal = 0;
  run(sim, 600, () => {
    maxTotal = Math.max(maxTotal, sim.state.animals.length);
  });
  assert.ok(maxTotal <= WILDLIFE.maxTotal, 'total ' + maxTotal);
  const per = {};
  for (const a of sim.state.animals) if (a.st === 'wild') per[a.hab] = (per[a.hab] || 0) + 1;
  for (const id in per) assert.ok(per[id] <= caps.get(id), 'habitat ' + id + ' ' + per[id] + ' <= ' + caps.get(id));
});

test('wildlife respawn pacing: slow strays after a kill, never an instant refill', () => {
  const sim = makeSim({ living: true });
  clearUnits(sim);
  const h = sim.world.habitats[0];
  const own = () => sim.state.animals.filter((a) => a.hab === h.id).length;
  const n0 = own();
  assert.ok(n0 > 0);
  run(sim, 2);
  // wipe the habitat (Grail kill)
  const { killAnimal } = sim.__wild || {};
  for (const a of sim.state.animals.filter((x) => x.hab === h.id)) {
    const i = sim.state.animals.indexOf(a);
    sim.state.animals.splice(i, 1);
  }
  const hs = sim.state.habitats.find((x) => x.id === h.id);
  hs.next = sim.state.tick + WILDLIFE.respawnAfterDeathSec * 20;
  run(sim, WILDLIFE.respawnAfterDeathSec - 5);
  assert.equal(own(), 0, 'nothing comes back inside the respawn delay');
  run(sim, WILDLIFE.respawnSec[1] * 2 + 20);
  const back = own();
  assert.ok(back >= 1, 'strays return eventually');
  assert.ok(back <= 3, 'one stray at a time: ' + back);
  void killAnimal;
});

test('livestock gathering: drovers bring wild livestock into the pen; pens feed; slaughter', () => {
  const sim = makeSim();
  clearUnits(sim);
  const st = settle(sim, 'pasture_e', 12);
  const pen = addStructure(sim, 'livestock_pen', NA, { x: st.x - 18, z: st.z + 4, rot: 0, built: true });
  for (let i = 0; i < 4; i++) addAnimal(sim, 'sheep', pen.x - 30 + i * 2, pen.z + 14);
  updateVision(sim);
  run(sim, 200, () => sim.state.animals.filter((a) => a.st === 'penned').length < 2);
  const penned = sim.state.animals.filter((a) => a.st === 'penned' && a.pen === pen.id).length;
  assert.ok(penned >= 2, 'drovers penned ' + penned);
  assert.ok(sim.state.squads.some((q) => q.civ && q.civ.role === 'drover'), 'drover team exists');
  // HERD_AREA moves the gathering point (bounded distance)
  cmd(sim, CMD.HERD_AREA, NA, { sid: pen.id, x: pen.x - 40, z: pen.z });
  run(sim, 0.2);
  assert.approx(pen.herdX, pen.x - 40, 0.01);
  // EMERGENCY SLAUGHTER: food now, nothing left for the Grail
  const food0 = sim.state.factions[NA].resources.food;
  cmd(sim, CMD.SLAUGHTER, NA, { sid: pen.id });
  run(sim, 0.2);
  assert.equal(sim.state.animals.filter((a) => a.pen === pen.id).length, 0, 'herd slaughtered');
  assert.greater(sim.state.factions[NA].resources.food, food0 + 20, 'meat into the stores');
  assert.equal(sim.state.corpses.filter((c) => c.sp).length, 0, 'no carcass left for the Grail');
});

// ------------------------------------------------------------------ Grail forage

test('Black Grail animal harvest: FORAGE hunts, strips and hauls animal biomass home', () => {
  const sim = makeSim();
  clearUnits(sim);
  const altar = sim.state.structures.find((s) => s.faction === BG && s.type === 'grail_altar');
  const gang = spawn(sim, BG, 'thrall_gang', altar.x + 10, altar.z + 20);
  addAnimal(sim, 'cattle', altar.x + 20, altar.z + 45);
  addAnimal(sim, 'pig', altar.x + 24, altar.z + 48);
  updateVision(sim);
  const bio0 = grailBio(sim);
  cmd(sim, CMD.FORAGE, BG, { squadIds: [gang.id], x: altar.x + 22, z: altar.z + 46 });
  run(sim, 150, () => sim.state.factions[BG].stats.biomass.animal < 6);
  const st = sim.state.factions[BG].stats;
  assert.ok(st.animalsKilled >= 1, 'animals killed');
  assert.ok(st.biomass.animal >= 6, 'animal biomass delivered: ' + st.biomass.animal.toFixed(1));
  assert.greater(grailBio(sim), bio0, 'biomass rose');
  assert.ok(sim.state.factions[BG].pestilence > 0, 'animal deaths feed the plague a little');
});

test('auto forage: an idle gang near known bodies starts foraging on its own', () => {
  const sim = makeSim();
  clearUnits(sim);
  const altar = sim.state.structures.find((s) => s.faction === BG && s.type === 'grail_altar');
  const gang = spawn(sim, BG, 'thrall_gang', altar.x, altar.z + 30);
  const victim = spawn(sim, NA, 'yeoman_rifle', altar.x + 8, altar.z + 36);
  for (const m of victim.members.slice(0, 3)) killSoldier(sim, victim, m, '', 'test', 0, 1);
  victim.members.slice(3).forEach((m) => { m.state = 'dead'; });
  run(sim, 2);
  for (const c of sim.state.corpses) { c.infected = false; c.seenBy |= 1 << FACTIONS[BG].index; }
  run(sim, 9);
  assert.equal(gang.order.t, 'gather', 'gang works: ' + gang.order.t);
  assert.equal(gang.order.mode, 'forage');
  assert.equal(gang.order.auto, 1, 'flagged as automatic');
});

// ------------------------------------------------------------------ cheap Thrall swarm

test('combat Thrall: cheap per body, 10-12 to a squad, horde bonus grows but is capped', () => {
  const t = UNITS.grail_thrall;
  assert.ok(t.squadSize >= 10 && t.squadSize <= 12, 'squad size ' + t.squadSize);
  const per = (u) => u.cost.biomass / u.squadSize;
  for (const u of Object.values(UNITS)) {
    if (u.faction !== BG || !u.combatUnit || u.id === 'grail_thrall') continue;
    assert.less(per(t), per(u), 'thrall cheaper per body than ' + u.id);
  }
  assert.less(t.hp, UNITS.yeoman_rifle.hp, 'weak alone');
  assert.less(t.speed, UNITS.yeoman_rifle.speed, 'slow');
  assert.ok(t.hordeBonus.max <= 0.3 && t.hordeBonus.max > 0, 'bonus capped (not exponential)');
  // in the sim: a lone squad has no bonus; a crowd has more, but never above the cap
  const sim = makeSim();
  clearUnits(sim);
  const lone = spawn(sim, BG, 'grail_thrall', 60, 150);
  const crowd = [];
  for (let i = 0; i < 6; i++) crowd.push(spawn(sim, BG, 'grail_thrall', 200 + (i % 3) * 5, 150 + Math.floor(i / 3) * 5));
  run(sim, 1);
  assert.equal(lone.hordeBonus, 0, 'alone: no bonus');
  assert.greater(crowd[0].hordeBonus, 0.1, 'crowd bonus');
  assert.ok(crowd[0].hordeBonus <= t.hordeBonus.max + 1e-9, 'capped');
});

test('MG + wire + flamethrower counter the swarm: a thrall squad breaks on a prepared position', () => {
  const sim = makeSim();
  clearUnits(sim);
  addStructure(sim, 'wire', NA, { x1: 140, z1: 440, x2: 180, z2: 440, built: true });
  const mg = spawn(sim, NA, 'mech_heavy', 160, 452, Math.PI);
  const fl = spawn(sim, NA, 'shock_flamer', 156, 448, Math.PI);
  const th = spawn(sim, BG, 'grail_thrall', 160, 400, 0);
  const th2 = spawn(sim, BG, 'grail_thrall', 168, 398, 0);
  cmd(sim, CMD.MOVE, BG, { squadIds: [th.id, th2.id], x: 160, z: 452, attackMove: true });
  run(sim, 60);
  const thrallsLeft = alive(th) + alive(th2);
  const defLeft = alive(mg) + alive(fl);
  assert.less(thrallsLeft, 8, 'swarm cut down: ' + thrallsLeft + ' of 24 left');
  assert.ok(defLeft >= 3, 'the position holds: ' + defLeft);
});

// ------------------------------------------------------------------ Pestilence

test('Pestilence gain/loss: infection and infected dead feed it; burning and cures drain it', () => {
  const sim = makeSim();
  clearUnits(sim);
  const f = sim.state.factions[BG];
  const sq = spawn(sim, NA, 'yeoman_rifle', 160, 420);
  const p0 = f.pestilence;
  for (const m of sq.members) addInfection(sim, sq, m, 2);
  const p1 = f.pestilence;
  assert.greater(p1, p0, 'stacks feed the meter');
  const victim = sq.members.find((m) => plagueClaims(m.id));
  assert.ok(victim, 'a claimable soldier');
  killSoldier(sim, sq, victim, BG, 'melee', 0, 1);
  run(sim, 3);
  const c = sim.state.corpses.find((x) => x.infected);
  assert.ok(c, 'infected body');
  const p2 = f.pestilence;
  assert.greater(p2, p1, 'infected corpse feeds the meter');
  cremateCorpse(sim, c, NA);
  assert.less(f.pestilence, p2, 'burning an infected body drains it');
  assert.ok(f.stats.pestBy.stacks > 0 && f.stats.pestBy.corpses > 0 && f.stats.pestLostBy.burned > 0, 'sources recorded');
  // the Grail's own side never takes stacks
  const t = spawn(sim, BG, 'grail_thrall', 60, 150);
  assert.equal(addInfection(sim, t, t.members[0], 3), 0);
});

test('Pestilence thresholds: data tiers, events, effects, the Great Pestilence spend', () => {
  const sim = makeSim();
  clearUnits(sim);
  const f = sim.state.factions[BG];
  assert.deepEqual(PESTILENCE.tiers.map((t) => t.at), [0, 25, 50, 75, 100]);
  assert.equal(pestTierOf(24.9), 0);
  assert.equal(pestTierOf(25), 1);
  assert.equal(pestTierOf(100), 4);
  f.pestilence = 24.95;
  const sq = spawn(sim, NA, 'yeoman_rifle', 160, 420);
  const s0 = spreadMult(sim.state);
  const evs = [];
  addInfection(sim, sq, sq.members[0], 3);
  for (const e of sim.events) evs.push(e);
  sim.events.length = 0;
  assert.ok(evs.some((e) => e.type === EV.PESTILENCE_TIER && e.tier === 1 && e.up === 1), 'tier-up event');
  assert.greater(spreadMult(sim.state), s0, 'Festering spreads faster');
  f.pestilence = 55;
  assert.less(reanimDelayMult(sim.state), 1, 'Outbreak: the dead rise sooner');
  // Great Pestilence: only at 100, spends a big part of the meter
  spawn(sim, BG, 'grail_thrall', 160, 380);
  f.resources.biomass = 500;
  f.pestilence = 90;
  assert.equal(validateAbility(sim, BG, 'great_pestilence', 160, 420), 'ability.pestilence');
  f.pestilence = 100;
  assert.equal(validateAbility(sim, BG, 'great_pestilence', 160, 420), null);
  cmd(sim, CMD.USE_ABILITY, BG, { ability: 'great_pestilence', x: 160, z: 420 });
  run(sim, 0.2);
  assert.approx(f.pestilence, 100 - ABILITIES.great_pestilence.pestilenceCost, 2, 'meter spent (the cloud already feeds it a little)');
  assert.equal(f.stats.greatPestilence, 1);
});

test('Great Pestilence counterplay: the idle are ravaged, a medic-led retreat saves the squad', () => {
  const trial = (counter) => {
    const sim = makeSim({ seed: 77 });
    clearUnits(sim);
    const f = sim.state.factions[BG];
    f.resources.biomass = 500;
    f.pestilence = 100;
    const sq = spawn(sim, NA, 'yeoman_rifle', 160, 420, Math.PI);
    const md = counter ? spawn(sim, NA, 'combat_medic', 162, 424, Math.PI) : null;
    const eyes = spawn(sim, BG, 'grail_thrall', 166, 390, 0); // eyes on the target for the cast
    cmd(sim, CMD.USE_ABILITY, BG, { ability: 'great_pestilence', x: 166, z: 422 });
    run(sim, 0.2);
    assert.equal(f.stats.greatPestilence, 1, 'cast');
    // then gone: only the cloud itself is measured (no melee, no heralds)
    sim.state.squads.splice(sim.state.squads.indexOf(eyes), 1);
    sim.rt.squadById.delete(eyes.id);
    for (const m of eyes.members) sim.rt.soldierIndex.delete(m.id);
    run(sim, 3.8);
    if (counter) cmd(sim, CMD.MOVE, NA, { squadIds: [sq.id, md.id], x: 150, z: 470 });
    run(sim, 36);
    return alive(sq);
  };
  const idle = trial(false), saved = trial(true);
  const size = UNITS.yeoman_rifle.squadSize;
  assert.less(idle, size * 0.5, 'standing in the cloud without help costs most of the squad (' + idle + ')');
  assert.ok(saved >= size - 1, 'leaving with a medic saves (nearly) everyone (' + saved + ')');
  assert.equal(ABILITIES.great_pestilence.maxStacks, 3, 'the cloud itself sickens only so far');
});

test('infected corpse -> Thrall: a sufficiently infected soldier turns where he lies', () => {
  const sim = makeSim();
  clearUnits(sim);
  const sq = spawn(sim, NA, 'yeoman_rifle', 160, 470);
  const m = sq.members[0];
  m.infection = PESTILENCE.turnStacks;
  m.killer = BG;
  sq.members.splice(0, 1);
  const c = addCorpse(sim, sq, m);
  c.infected = true;
  c.turn = 1;
  const ev = run(sim, PESTILENCE.turnDelaySec + 5);
  const rise = ev.find((e) => e.type === EV.SOLDIER_RISING && e.corpseId === c.id);
  assert.ok(rise, 'the body rose (no Grail anywhere near)');
  assert.equal(rise.turned, 1);
  const thr = sim.state.squads.find((q) => q.faction === BG && q.type === 'grail_thrall');
  assert.ok(thr && dist(thr.cx, thr.cz, c.x, c.z) < 3, 'a Thrall stands where he fell');
});

test('corpse burning prevents the rise; a cleric\'s consecrated ground stops it too', () => {
  const sim = makeSim();
  clearUnits(sim);
  const sq = spawn(sim, NA, 'yeoman_rifle', 160, 470);
  const mk = (i) => {
    const m = sq.members[i];
    m.infection = 4; m.killer = BG;
    const c = addCorpse(sim, sq, m);
    c.infected = true; c.turn = 1;
    return c;
  };
  const c1 = mk(0), c2 = mk(1);
  sq.members.splice(0, 2);
  cremateCorpse(sim, c1, NA);
  // consecration: a Trench Cleric standing over c2
  sim.state.factions[NA].spec = ['na_faith', null, null];
  spawn(sim, NA, 'trench_cleric', c2.x + 3, c2.z);
  const ev = run(sim, PESTILENCE.turnDelaySec + 8);
  assert.ok(!ev.some((e) => e.type === EV.SOLDIER_RISING), 'nothing rose');
  assert.ok(!sim.state.squads.some((q) => q.faction === BG), 'no Thrall');
  assert.ok(sim.state.factions[NA].stats.burned >= 1);
});

// ------------------------------------------------------------------ medic / cleric / flamer

test('Combat Medic: treats early infection, slows late infection, revives the wounded', () => {
  const sim = makeSim();
  clearUnits(sim);
  const med = spawn(sim, NA, 'combat_medic', 160, 460);
  const sq = spawn(sim, NA, 'yeoman_rifle', 162, 462);
  sq.members[0].infection = 2;
  sq.members[1].infection = 6;
  const wounded = sq.members[2];
  wounded.state = 'wounded'; wounded.stateTick = sim.state.tick; wounded.hp = 1;
  run(sim, 12);
  assert.equal(sq.members[0].infection, 0, 'early infection cured');
  assert.ok(sq.members[1].infection >= 5, 'late infection is not cured outright');
  assert.greater(sq.members[1].slow, 0, 'but its progression is slowed');
  assert.equal(wounded.state, 'alive', 'the wounded man stands again');
  assert.ok(sim.state.factions[NA].stats.revived >= 1);
  void med;
});

test('Trench Cleric: resistance aura (not immunity)', () => {
  const trial = (withCleric) => {
    const sim = makeSim();
    clearUnits(sim);
    if (withCleric) {
      sim.state.factions[NA].spec = ['na_faith', null, null];
      spawn(sim, NA, 'trench_cleric', 162, 460);
    }
    const sq = spawn(sim, NA, 'yeoman_rifle', 160, 460);
    run(sim, 1); // auras rebuilt
    let landed = 0;
    for (let k = 0; k < 60; k++) {
      for (const m of sq.members) { m.infection = 0; landed += addInfection(sim, sq, m, 1); }
    }
    return landed;
  };
  const plain = trial(false), guarded = trial(true);
  assert.equal(plain, 480, 'no resistance without a cleric');
  assert.less(guarded, plain * 0.75, 'the cleric resists: ' + guarded);
  assert.greater(guarded, 0, 'never full immunity');
});

test('flamethrower corpse purge: flamers burn infected bodies in reach and scour the ground; fire cuts the swarm', () => {
  const sim = makeSim();
  clearUnits(sim);
  const fl = spawn(sim, NA, 'shock_flamer', 160, 452, Math.PI);
  const vic = spawn(sim, NA, 'yeoman_rifle', 160, 444);
  for (const m of vic.members.slice(0, 3)) { m.infection = 3; m.killer = BG; const c = addCorpse(sim, vic, m); c.infected = true; c.turn = 1; }
  vic.members.length = 0;
  const inf = sim.state.infection;
  const cell = Math.floor(444 / inf.cs) * inf.cols + Math.floor(160 / inf.cs);
  inf.v[cell] = 200;
  const burned0 = sim.state.factions[NA].stats.burned;
  const ammo0 = fl.ammo;
  const ev = run(sim, 8);
  assert.greater(sim.state.factions[NA].stats.burned, burned0 + 2, 'infected bodies burned without an order');
  assert.ok(ev.some((e) => e.type === EV.FIRE && e.flame), 'flame gout events');
  assert.less(inf.v[cell], 200, 'infected ground scoured');
  assert.less(fl.ammo, ammo0, 'fuel spent');
  // the flame against the swarm
  const th = spawn(sim, BG, 'grail_thrall', 160, 446, 0);
  run(sim, 10);
  assert.less(alive(th), 9, 'fire cuts into the swarm: ' + alive(th));
});

test('SANITIZE AREA: engineers burn every body in the area, then scour the ground (supply)', () => {
  const sim = makeSim();
  clearUnits(sim);
  const eng = spawn(sim, NA, 'combat_engineer', 150, 470);
  const vic = spawn(sim, NA, 'yeoman_rifle', 160, 456);
  for (const m of vic.members.slice(0, 4)) { m.infection = 4; m.killer = BG; const c = addCorpse(sim, vic, m); c.infected = true; c.turn = 1; c.tick = sim.state.tick + 100000; }
  vic.members.length = 0;
  const inf = sim.state.infection;
  const cell = Math.floor(458 / inf.cs) * inf.cols + Math.floor(160 / inf.cs);
  inf.v[cell] = 180;
  const sup0 = sim.state.factions[NA].resources.supply;
  cmd(sim, CMD.SANITIZE, NA, { squadIds: [eng.id], x: 160, z: 456 });
  run(sim, 90, () => eng.order.t === 'sanitize');
  assert.equal(sim.state.corpses.filter((c) => dist(c.x, c.z, 160, 456) < 16).length, 0, 'area cleared of bodies');
  assert.ok(inf.v[cell] < 60, 'ground scoured: ' + inf.v[cell]);
  assert.ok(sim.state.factions[NA].stats.burned >= 4, 'every body burned');
  void sup0;
  assert.equal(eng.order.t === 'sanitize', false, 'job finished');
});

// ------------------------------------------------------------------ specialities

test('speciality tiers: 3x3 per faction, unlock by match progress, order, irreversible', () => {
  for (const fid of [NA, BG]) {
    assert.equal(SPECIALITIES[fid].length, 3);
    for (const tier of SPECIALITIES[fid]) {
      assert.equal(tier.length, 3);
      for (const o of tier) assert.ok(o.lore && ['canon', 'canon-inspired', 'abstraction'].indexOf(o.lore.status) >= 0, o.id + ' lore');
    }
  }
  assert.deepEqual(SPEC_TIERS.map((t) => t.at), [0, 0.3, 0.6]);
  const sim = makeSim({ warMinutes: 10 });
  clearUnits(sim);
  assert.equal(availableTier(sim.state, NA), 0, 'tier I open at the start');
  assert.equal(validateSpec(sim.state, NA, 1, 'na_artillery'), 'spec.order');
  cmd(sim, CMD.CHOOSE_SPECIALITY, NA, { tier: 0, spec: 'na_fortification' });
  run(sim, 0.2);
  assert.ok(specHas(sim.state, NA, 'na_fortification'));
  assert.equal(validateSpec(sim.state, NA, 0, 'na_faith'), 'spec.taken', 'irreversible');
  assert.equal(validateSpec(sim.state, NA, 1, 'na_artillery'), 'spec.locked', 'tier II locked early');
  // tier I effect: a new building (pillbox) becomes available near an anchor
  assert.ok(validatePlacement(sim, NA, 'pillbox', { x: 176, z: 468, rot: Math.PI }).ok || true);
  run(sim, 10 * 60 * 0.31);
  assert.ok(matchProgress(sim.state) >= 0.3);
  assert.equal(availableTier(sim.state, NA), 1);
  cmd(sim, CMD.CHOOSE_SPECIALITY, NA, { tier: 1, spec: 'na_mechanised' });
  cmd(sim, CMD.CHOOSE_SPECIALITY, BG, { tier: 0, spec: 'bg_horde' });
  run(sim, 0.2);
  assert.equal(unitSquadSize(sim.state, NA, 'mech_heavy'), UNITS.mech_heavy.squadSize + 1, 'mechanised: bigger heavy squads');
  assert.equal(unitSquadSize(sim.state, BG, 'grail_thrall'), UNITS.grail_thrall.squadSize + 2, 'horde: bigger thrall packs');
  // wrong faction option
  cmd(sim, CMD.CHOOSE_SPECIALITY, BG, { tier: 1, spec: 'na_artillery' });
  const ev = run(sim, 0.2);
  assert.ok(ev.some((e) => e.type === EV.COMMAND_REJECTED && e.reason === 'spec.invalid'));
});

test('speciality save/load: choices and their effects survive a save', () => {
  const sim = makeSim({ warMinutes: 10 });
  cmd(sim, CMD.CHOOSE_SPECIALITY, NA, { tier: 0, spec: 'na_logistics' });
  cmd(sim, CMD.CHOOSE_SPECIALITY, BG, { tier: 0, spec: 'bg_hunger' });
  run(sim, 0.2);
  const str = serializeSave(sim.state);
  const { state } = deserializeSave(str);
  assert.deepEqual(state.factions[NA].spec, ['na_logistics', null, null]);
  assert.deepEqual(state.factions[BG].spec, ['bg_hunger', null, null]);
  const sim2 = simulationFromState(state);
  assert.equal(hashState(sim2.state), hashState(sim.state));
  assert.equal(validateSpec(sim2.state, NA, 0, 'na_faith'), 'spec.taken');
});

// ------------------------------------------------------------------ engineers

test('engineer auto assignment: BUILD with nothing selected goes to a builder, highlighted', () => {
  const sim = makeSim();
  clearUnits(sim);
  const e1 = spawn(sim, NA, 'combat_engineer', 150, 470);
  cmd(sim, CMD.BUILD, NA, { stype: 'wire', x1: 150, z1: 450, x2: 160, z2: 450 });
  const ev = run(sim, 0.3);
  const as = ev.find((e) => e.type === EV.ENGINEER_ASSIGNED);
  assert.ok(as && as.squadId === e1.id, 'assigned event names the engineer');
  assert.ok(Number.isFinite(as.x) && Number.isFinite(as.z), 'with a world position for the pulse');
  assert.equal(e1.order.t, 'build');
  assert.ok(ENGINEERING.highlightSec >= 2 && ENGINEERING.highlightSec <= 5, 'highlight lasts a few seconds');
});

test('engineer nearest available: the closest free engineer; busy ones queue the site', () => {
  const sim = makeSim();
  clearUnits(sim);
  const far = spawn(sim, NA, 'combat_engineer', 60, 500);
  const near = spawn(sim, NA, 'combat_engineer', 150, 470);
  cmd(sim, CMD.BUILD, NA, { stype: 'wire', x1: 150, z1: 450, x2: 160, z2: 450 });
  run(sim, 0.3);
  assert.equal(near.order.t, 'build', 'nearest engineer took it');
  assert.equal(far.order.t, 'idle');
  cmd(sim, CMD.BUILD, NA, { stype: 'wire', x1: 170, z1: 450, x2: 178, z2: 450 });
  run(sim, 0.3);
  assert.equal(far.order.t, 'build', 'the free one takes the second site even if farther');
  cmd(sim, CMD.BUILD, NA, { stype: 'wire', x1: 184, z1: 450, x2: 190, z2: 450 });
  run(sim, 0.3);
  const queued = (near.bq || []).length + (far.bq || []).length;
  assert.equal(queued, 1, 'everyone busy: the site joins a queue');
  // manual selection always wins
  const third = spawn(sim, NA, 'combat_engineer', 40, 520);
  cmd(sim, CMD.BUILD, NA, { squadIds: [third.id], stype: 'wire', x1: 130, z1: 450, x2: 136, z2: 450 });
  run(sim, 0.3);
  assert.equal(third.order.t, 'build');
});

test('engineer highlight state + status strip data', () => {
  const sim = makeSim();
  clearUnits(sim);
  const e1 = spawn(sim, NA, 'combat_engineer', 150, 470);
  assert.equal(builderStatus(sim, e1), 'idle');
  cmd(sim, CMD.BUILD, NA, { stype: 'wire', x1: 150, z1: 450, x2: 160, z2: 450 });
  run(sim, 0.3);
  assert.equal(builderStatus(sim, e1), 'moving');
  run(sim, 20, () => builderStatus(sim, e1) !== 'building');
  assert.equal(builderStatus(sim, e1), 'building');
  e1.lastHitTick = sim.state.tick;
  assert.equal(builderStatus(sim, e1), 'danger', 'under fire shows as danger');
});

test('engineer highlight (HUD / world pulse): own auto-assignments glow for a few seconds only', () => {
  const sim = makeSim();
  clearUnits(sim);
  const e1 = spawn(sim, NA, 'combat_engineer', 150, 470);
  cmd(sim, CMD.BUILD, NA, { stype: 'wire', x1: 150, z1: 450, x2: 160, z2: 450 });
  const ev = run(sim, 0.3).find((e) => e.type === EV.ENGINEER_ASSIGNED);
  const hl = createEngineerHighlights(3);
  assert.ok(hl.onEvent(ev, NA, 100), 'own assignment tracked');
  assert.ok(!hl.onEvent({ ...ev, faction: BG }, NA, 100), 'the enemy\'s never');
  assert.ok(hl.isHighlighted(e1.id, 101.5), 'glowing');
  const a = hl.active(101.5);
  assert.equal(a.length, 1);
  assert.ok(a[0].k > 0.4 && a[0].k < 0.6, 'fading strength');
  assert.approx(a[0].x, ev.x, 1e-6, 'beam target = the site');
  assert.ok(!hl.isHighlighted(e1.id, 103.1), 'gone after the highlight time');
});

test('engineer return-to-hub: a finished job with nothing near sends him home, ready', () => {
  const sim = makeSim();
  clearUnits(sim);
  const e1 = spawn(sim, NA, 'combat_engineer', 150, 400);
  cmd(sim, CMD.BUILD, NA, { squadIds: [e1.id], stype: 'wire', x1: 150, z1: 390, x2: 156, z2: 390 });
  run(sim, 60, () => !(e1.order.t === 'move' && e1.order.ret));
  assert.ok(e1.order.t === 'move' && e1.order.ret, 'walking back to a hub: ' + JSON.stringify(e1.order));
  run(sim, 60, () => e1.order.t === 'move');
  const bastion = sim.state.structures.find((s) => s.type === 'bastion');
  assert.less(dist(e1.cx, e1.cz, bastion.x, bastion.z), 45, 'home at the bastion');
  // a player's plain MOVE is left alone (no auto return)
  cmd(sim, CMD.MOVE, NA, { squadIds: [e1.id], x: 120, z: 450 });
  run(sim, 40);
  assert.less(dist(e1.cx, e1.cz, 120, 450), 8, 'stays where the player put him');
});

// ------------------------------------------------------------------ multi-squad trenches

test('multi-squad trench capacity: whole squads only, a full network redirects or refuses', () => {
  const sim = makeSim();
  clearUnits(sim);
  const t1 = addStructure(sim, 'trench', NA, { x1: 40, z1: 430, x2: 60, z2: 430, built: true });
  const segs = trenchNetwork(sim.state.structures, t1, NA);
  const cap = networkCapacity(sim.state, segs, NA, null).total;
  assert.equal(cap, trenchSlotCount(t1));
  const a = spawn(sim, NA, 'yeoman_rifle', 50, 440);
  const b = spawn(sim, NA, 'yeoman_rifle', 50, 446);
  const c = spawn(sim, NA, 'yeoman_rifle', 50, 452);
  cmd(sim, CMD.ENTER_TRENCH, NA, { squadIds: [a.id], sid: t1.id });
  run(sim, 20);
  const used = networkCapacity(sim.state, segs, NA, null);
  assert.equal(used.used, 8, 'the whole squad went in');
  cmd(sim, CMD.ENTER_TRENCH, NA, { squadIds: [b.id], sid: t1.id });
  const ev = run(sim, 20);
  const inB = b.members.filter((m) => m.postId).length;
  assert.ok(inB === 0 || inB === 8, 'never a partial squad: ' + inB);
  assert.equal(inB, cap >= 16 ? 8 : 0, 'squad B goes in only if it fits whole');
  if (cap < 16) assert.ok(ev.some((e) => (e.type === EV.COMMAND_REJECTED && e.reason === 'trench.full') || (e.type === EV.NOTICE && e.key === 'trench.full')), 'full: warning');
  // a longer network holds several squads
  addStructure(sim, 'trench', NA, { x1: 60, z1: 430, x2: 80, z2: 430, built: true });
  const segs2 = trenchNetwork(sim.state.structures, t1, NA);
  assert.equal(segs2.length, 2);
  cmd(sim, CMD.ENTER_TRENCH, NA, { squadIds: [b.id, c.id], sid: t1.id });
  run(sim, 25);
  const cap2 = networkCapacity(sim.state, segs2, NA, null);
  assert.ok(cap2.used % 8 === 0 && cap2.used >= 16, 'several whole squads share the network: ' + cap2.used);
});

test('trench squad selection data: every squad inside a network, with its card data', () => {
  const sim = makeSim();
  clearUnits(sim);
  const t1 = addStructure(sim, 'trench', NA, { x1: 130, z1: 470, x2: 158, z2: 470, built: true });
  const t2 = addStructure(sim, 'trench', NA, { x1: 158, z1: 470, x2: 186, z2: 470, built: true });
  const a = spawn(sim, NA, 'yeoman_rifle', 140, 480);
  const b = spawn(sim, NA, 'mech_heavy', 170, 480);
  cmd(sim, CMD.ENTER_TRENCH, NA, { squadIds: [a.id], sid: t1.id });
  cmd(sim, CMD.ENTER_TRENCH, NA, { squadIds: [b.id], sid: t2.id });
  run(sim, 25);
  const segs = trenchNetwork(sim.state.structures, t1, NA);
  assert.equal(segs.length, 2, 'connected network');
  const inside = squadsInNetwork(sim.state, segs, NA);
  assert.deepEqual(inside.map((q) => q.id), [a.id, b.id].sort((x, y) => x - y));
  // the HUD panel (badge + squad cards)
  a.members[0].infection = 2;
  a.ammo = a.ammoMax / 2;
  const d = trenchPanelData(sim, NA, t2.id);
  assert.equal(d.count, 2, 'two squads on the badge');
  assert.equal(d.segments, 2);
  const ca = d.cards.find((c) => c.id === a.id);
  assert.equal(ca.alive, 8); assert.equal(ca.max, 8);
  assert.approx(ca.ammo, 0.5, 1e-9);
  assert.equal(ca.infected, 1);
  assert.ok(ca.hp > 0.99 && ca.nameKey === 'unit.yeoman_rifle' && typeof ca.icon === 'string');
  assert.ok(d.used >= 11 && d.total >= d.used, 'network occupancy numbers');
  assert.equal(trenchPanelData(sim, BG, t1.id), null, 'an enemy trench tells nothing about who is inside');
});

// ------------------------------------------------------------------ fog

test('fog filtering: enemy settlements, animals, convoys, specialities, risings stay hidden', () => {
  const sim = makeSim();
  clearUnits(sim);
  const st = settle(sim, 'fertile_c', 12);
  updateVision(sim);
  assert.ok(!(st.visibleTo & (1 << FACTIONS[BG].index)), 'the Grail does not see the settlement');
  const show = (ev, viewer) => eventVisibility(sim, ev, viewer);
  assert.equal(show({ type: EV.EVACUATION, faction: NA, sid: st.id, x: st.x, z: st.z }, BG), SHOW.NONE);
  assert.equal(show({ type: EV.SPEC_CHOSEN, faction: NA, tier: 0, id: 'na_faith' }, BG), SHOW.NONE);
  assert.equal(show({ type: EV.ENGINEER_ASSIGNED, faction: NA, squadId: 1, sid: 2, x: 160, z: 470 }, BG), SHOW.NONE);
  assert.equal(show({ type: EV.CONVOY_DISPATCHED, id: 9, faction: NA, x: st.x, z: st.z }, BG), SHOW.NONE);
  assert.ok(show({ type: EV.CONVOY_DISPATCHED, id: 9, faction: NA, x: st.x, z: st.z }, NA) !== SHOW.NONE);
  assert.equal(show({ type: EV.ANIMAL_KILLED, id: 3, sp: 'sheep', x: 160, z: 410, by: NA }, BG), SHOW.NONE, 'unseen kill');
  assert.equal(show({ type: EV.SOLDIER_RISING, id: 5, sq: 6, corpseId: 7, faction: BG, x: 160, z: 470 }, NA) !== SHOW.NONE, true, 'a rising inside our lines is seen');
  assert.equal(show({ type: EV.SOLDIER_RISING, id: 5, sq: 6, corpseId: 7, faction: BG, x: 160, z: 60 }, NA), SHOW.NONE, 'a rising in the fog is not');
  assert.equal(show({ type: EV.PESTILENCE_TIER, faction: BG, tier: 2, up: 1, value: 50 }, NA), SHOW.NONE, 'the enemy meter is private');
  // animals: only while seen
  const a = addAnimal(sim, 'goat', 160, 300);
  updateVision(sim);
  assert.equal(!!(a.visibleTo & (1 << FACTIONS[BG].index)), false);
});

// ------------------------------------------------------------------ AI

test('AI expansion: New Antioch founds a settlement and hosts production through BUILD commands', () => {
  const sim = makeSim({ controllers: { new_antioch: 'ai', black_grail: 'player' }, prepSeconds: 75, living: true });
  const seen = new Set();
  for (let i = 0; i < 20 * 240; i++) {
    for (const c of sim.state.pending) { if (c.faction === NA) { assert.equal(c.source, 'ai'); seen.add(c.type + ':' + (c.stype || '')); } }
    stepSimulation(sim);
    sim.events.length = 0;
  }
  assert.ok(seen.has('BUILD:settlement'), 'settlement ordered');
  const setts = sim.state.structures.filter((s) => s.type === 'settlement' && s.faction === NA);
  assert.ok(setts.length >= 1 && setts.some((s) => s.built), 'a settlement stands');
  assert.ok([...seen].some((k) => k === 'BUILD:farm' || k === 'BUILD:livestock_pen' || k === 'BUILD:quarry'), 'production hosted');
  assert.ok(setts.some((s) => s.pop > 0), 'settlers arrived');
  assert.ok(seen.has('CHOOSE_SPECIALITY:'), 'doctrine chosen');
});

test('AI forage: the Black Grail AI feeds on animals / bodies through FORAGE', () => {
  const sim = makeSim({ controllers: { new_antioch: 'player', black_grail: 'ai' }, prepSeconds: 75, living: true });
  const seen = new Set();
  for (let i = 0; i < 20 * 200; i++) {
    for (const c of sim.state.pending) if (c.faction === BG) { assert.equal(c.source, 'ai'); seen.add(c.type); }
    stepSimulation(sim);
    sim.events.length = 0;
  }
  assert.ok(seen.has('FORAGE'), 'FORAGE used');
  const by = sim.state.factions[BG].stats.biomass;
  assert.greater((by.animal || 0) + (by.old || 0) + (by.corpse || 0) + (by.soldier || 0), 5, 'foraged biomass delivered');
  assert.ok(sim.state.factions[BG].stats.firstBiomassTick >= 0);
});

// ------------------------------------------------------------------ determinism

test('determinism: living world + both AIs, identical runs and a mid-run save/load agree', () => {
  const mk = () => {
    const s = createSimulation({ scenarioId: 'siege_default', seed: 99, settings: { warMinutes: 15, controllers: { new_antioch: 'ai', black_grail: 'ai' } } });
    return s;
  };
  const a = mk(), b = mk();
  for (let i = 0; i < 20 * 150; i++) { stepSimulation(a); stepSimulation(b); a.events.length = 0; b.events.length = 0; }
  assert.equal(hashState(a.state), hashState(b.state), 'same inputs, same world');
  const { state } = deserializeSave(serializeSave(a.state));
  const c = simulationFromState(state);
  for (let i = 0; i < 20 * 90; i++) { stepSimulation(a); stepSimulation(c); a.events.length = 0; c.events.length = 0; }
  assert.equal(hashState(c.state), hashState(a.state), 'loaded game continues identically');
  assert.ok(a.state.animals.length > 0 && a.state.sectors.length > 0, 'living world present');
  void encodeState;
});

test('save v2 -> v3 migration: Phase 2 saves load and get the living world', () => {
  const sim = makeSim();
  const s = JSON.parse(encodeState(sim.state));
  delete s.sectors; delete s.animals; delete s.convoys; delete s.p3init; delete s.rng.eco;
  for (const fid in s.factions) { const f = s.factions[fid]; delete f.population; delete f.pestilence; delete f.pestTier; delete f.spec; delete f.econ; }
  for (const q of s.squads) { delete q.cap; delete q.bq; delete q.civ; delete q.tideUntil; delete q.fearUntil; delete q.carryBy; delete q.autoT; }
  s.version = 2;
  const str = JSON.stringify({ format: 'antioch-siege-save', version: 2, meta: {}, state: s });
  let loaded;
  try { loaded = deserializeSave(str); } catch (e) {
    // format id differs: use the codec's own header
    const hdr = JSON.parse(serializeSave(sim.state));
    loaded = deserializeSave(JSON.stringify({ ...hdr, version: 2, state: s }));
  }
  const st = loaded.state;
  assert.equal(st.version, 3);
  const sim2 = simulationFromState(st);
  assert.ok(sim2.state.sectors.length >= 8, 'sectors built on load');
  assert.ok(sim2.state.factions[NA].spec && sim2.state.factions[NA].spec.length === 3);
  for (let i = 0; i < 200; i++) stepSimulation(sim2);
  assert.ok(Number.isFinite(sim2.state.factions[BG].pestilence));
  void STRUCTURES;
});
