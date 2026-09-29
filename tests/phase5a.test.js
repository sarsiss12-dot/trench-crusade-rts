// Phase 5A: FACTION / SIDE / ROLE / SCENARIO separation — test matrix A..O of the brief.
import { test, assert } from './harness.js';
import { clearUnits, spawn, run, addStructure } from './helpers.js';
import { createSimulation, stepSimulation, simulationFromState, stateHash } from '../src/sim/simulation.js';
import { enqueueCommand, CMD } from '../src/sim/commands.js';
import { serializeSave, deserializeSave, encodeState, decodeState } from '../src/save/codec.js';
import { STATE_VERSION } from '../src/sim/constants.js';
import { STRUCTURES } from '../src/data/structures.js';
import { SCENARIOS } from '../src/data/scenarios.js';
import { PACKAGES } from '../src/data/packages.js';
import { STRATEGY } from '../src/data/ai.js';
import { FACTIONS, PLANNED_FACTIONS, areHostile, baseFaction, sideIndex, sideBit, mirrorSideId, isTwin } from '../src/data/factions.js';
import { resolveSides, enemyTarget, homeStructure, sideFacing, lanesFor, planFor } from '../src/sim/sides.js';
import { factionHome } from '../src/sim/home.js';
import { validatePlacement } from '../src/construction/construction.js';
import { addCorpse, destroyStructure, killSoldier } from '../src/combat/combat.js';
import { pestGain, plagueSides, addInfection } from '../src/factions/pestilence.js';
import { isSquadVisibleTo } from '../src/sim/perception.js';
import { lensItems } from '../src/ui/lens.js';
import { createControlGroups } from '../src/input/control_groups.js';
import { allCombatSquadIds } from '../src/input/selection.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const NA = 'new_antioch', BG = 'black_grail';
const NA2 = mirrorSideId(NA, 2), BG2 = mirrorSideId(BG, 2);

/** A match from explicit sides (AI off unless asked). */
function matchOf(sides, opts = {}) {
  return createSimulation({
    scenarioId: opts.scenarioId || 'siege_default',
    seed: opts.seed !== undefined ? opts.seed : 5,
    settings: {
      sides: sides.map((s) => ({ ...s, controller: opts.ai ? 'ai' : 'player' })),
      prepSeconds: opts.prepSeconds !== undefined ? opts.prepSeconds : 0,
      warMinutes: opts.warMinutes || 15, lulls: 0,
    },
  });
}
const REVERSE = [{ faction: NA, role: 'attacker' }, { faction: BG, role: 'defender' }];
const NA_MIRROR = [{ faction: NA, role: 'defender' }, { faction: NA, role: 'attacker' }];
const BG_MIRROR = [{ faction: BG, role: 'defender' }, { faction: BG, role: 'attacker' }];

function inZone(z, x, y) { return x >= z.x0 && x <= z.x1 && y >= z.z0 && y <= z.z1; }
function aliveOf(sim, id) {
  let n = 0;
  for (const q of sim.state.squads) if (q.faction === id) for (const m of q.members) if (m.state === 'alive') n++;
  return n;
}

// ------------------------------------------------------------------ architecture (§1, §15, §22)

test('5A §1/§22: core code has no faction-id literals outside data / presentation fallbacks / save migration', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  // the simulation / AI / economy / combat layers decide by capability flags and sides, never by a
  // faction name (the per-faction logic / AI modules register themselves by their own id)
  const core = walk(root).filter((f) => /\/(sim|combat|economy|construction|units|world)\//.test(f) && f.endsWith('.js'));
  const offenders = [];
  for (const f of core) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(===|!==)\s*'(new_antioch|black_grail|iron_sultanate)'/g)) offenders.push(f.split('/src/')[1] + ': ' + m[0]);
  }
  assert.equal(offenders.length, 0, offenders.join('; '));
});

test('5A §22: faction registry: planned factions are locked cards only (no fake content)', () => {
  for (const pf of PLANNED_FACTIONS) {
    assert.ok(!FACTIONS[pf.id], pf.id + ' must not have a playable definition yet');
    assert.ok(pf.phase && pf.nameKey);
  }
  // every playable faction has a card, a starting package for both roles and an AI strategy layer
  for (const fid in FACTIONS) {
    const d = FACTIONS[fid];
    assert.ok(d.card && d.card.identityKey && d.card.icon, fid + ' card');
    assert.ok(PACKAGES[fid] && PACKAGES[fid].attacker && PACKAGES[fid].defender, fid + ' packages');
    assert.ok(STRATEGY[fid] && STRATEGY[fid].attacker && STRATEGY[fid].defender, fid + ' strategy');
    const hq = PACKAGES[fid].defender.structures.filter((s) => s.primary);
    assert.equal(hq.length, 1, fid + ' defender has one primary HQ');
    assert.ok(STRUCTURES[hq[0].type].hq, 'primary HQ is HQ-capable (data tag)');
    assert.ok(STRUCTURES[PACKAGES[fid].attacker.structures.find((s) => s.primary).type].hq);
  }
});

test('5A §6: scenario contracts are data (roles -> regions, objectives by ROLE, victory, modes)', () => {
  for (const sc of Object.values(SCENARIOS)) {
    assert.ok(sc.id && sc.map && sc.victory && Array.isArray(sc.objectives) && sc.roles && sc.slots, sc.id);
    for (const o of sc.objectives) assert.ok(o.owner === 'defender' || o.owner === 'attacker', 'objective owned by a ROLE');
    for (const r of sc.slots) assert.ok(sc.roles[r] && sc.roles[r].region, sc.id + ' role ' + r + ' has a region');
    assert.ok(!('objective' in sc) && !(sc.forces && sc.forces[NA]), 'no faction-keyed scenario data left');
  }
  assert.deepEqual(SCENARIOS.siege_default.lore, { defender: NA, attacker: BG });
  assert.ok(SCENARIOS.siege_default.setupModes.includes('free') && SCENARIOS.siege_default.setupModes.includes('lore'));
  assert.equal(SCENARIOS.siege_default.features.length, 0, 'no Iron Wall or other scenario feature in 5A');
});

// ------------------------------------------------------------------ A classic (Lore preset)

test('5A A: classic Lore preset = New Antioch defender (south) vs Black Grail attacker (north)', () => {
  const sim = createSimulation({ scenarioId: 'siege_default', seed: 3, settings: { playerFaction: NA, prepSeconds: 0, lulls: 0 } });
  const { state } = sim;
  assert.deepEqual(state.sides.map((s) => [s.id, s.faction, s.role, s.region]), [[NA, NA, 'defender', 'south'], [BG, BG, 'attacker', 'north']]);
  assert.equal(state.settings.setupMode, 'lore');
  const obj = state.structures.filter((s) => s.objective);
  assert.equal(obj.length, 1);
  assert.equal(obj[0].type, 'bastion'); assert.equal(obj[0].faction, NA);
  assert.deepEqual(state.objectives[0], { id: 'defenderPrimaryObjective', type: 'siege', structureId: obj[0].id, side: NA, role: 'defender' });
  for (const s of state.structures) {
    if (s.faction === NA) assert.ok(s.z > 330, 'NA home in the south');
    if (s.faction === BG) assert.ok(s.z < 228, 'Grail home in the north');
  }
  assert.equal(state.factions[NA].resources.material, 280);
  assert.equal(state.factions[BG].resources.biomass, 110);
  // same setup twice = same state
  const again = createSimulation({ scenarioId: 'siege_default', seed: 3, settings: { playerFaction: NA, prepSeconds: 0, lulls: 0 } });
  assert.equal(stateHash(sim), stateHash(again));
});

// ------------------------------------------------------------------ B reverse roles

test('5A B: New Antioch ATTACKER vs Black Grail DEFENDER: spawns, homes, objective, zones, packages', () => {
  const sim = matchOf(REVERSE);
  const { state } = sim;
  const na = state.factions[NA], bg = state.factions[BG];
  assert.equal(na.role, 'attacker'); assert.equal(na.region, 'north');
  assert.equal(bg.role, 'defender'); assert.equal(bg.region, 'south');
  // the defender's primary HQ is the objective — here a Grail Altar
  const obj = state.structures.find((s) => s.objective);
  assert.equal(obj.faction, BG); assert.equal(obj.type, 'grail_altar');
  assert.ok(obj.z > 330);
  // New Antioch starts from a forward field HQ in the north, not from the bastion
  assert.ok(!state.structures.some((s) => s.type === 'bastion'));
  const fhq = state.structures.find((s) => s.type === 'field_hq');
  assert.ok(fhq && fhq.faction === NA && fhq.z < 228 && !fhq.objective);
  for (const sq of state.squads) {
    if (sq.civ) continue;
    const zone = state.factions[sq.faction].zone;
    assert.ok(inZone(zone, sq.x, sq.z), sq.type + ' of ' + sq.faction + ' starts in its own zone');
  }
  // economy per side: NA logistics / population, Grail biomass (identity unchanged)
  assert.ok(na.resources.supply > 0 && na.resources.manpower > 0 && na.popStart > 0);
  assert.ok(bg.resources.biomass > 0 && !('supply' in bg.resources));
  // homes / camera / placement facing follow the REGION
  assert.ok(factionHome(sim, NA).z < 150 && factionHome(sim, BG).z > 420);
  assert.equal(sideFacing(sim, NA), 0); assert.equal(sideFacing(sim, BG), Math.PI);
  // enemy targets: each side marches on the other's HQ, never its own
  assert.equal(enemyTarget(sim, NA).id, obj.id);
  assert.equal(enemyTarget(sim, BG).id, fhq.id);
  assert.equal(homeStructure(state, BG).id, obj.id);
  // doctrine plans / lanes move with the region
  assert.ok(planFor(sim, NA, 'fortify').every((it) => (it.x1 !== undefined ? it.z1 : it.z) < 288), 'NA fortifies the north');
  assert.ok(planFor(sim, BG, 'organic').every((it) => (it.x1 !== undefined ? it.z1 : it.z) > 288), 'Grail grows in the south');
  const lanes = lanesFor(sim, BG);
  assert.ok(lanes.center[0][1] > 330 && lanes.center[lanes.center.length - 1][1] < 120, 'southern lanes run north');
  // build zones: NA engineers build in the north, not in the south
  assert.ok(validatePlacement(sim, NA, 'trench', { x1: 100, z1: 150, x2: 110, z2: 150 }).ok);
  assert.equal(validatePlacement(sim, NA, 'trench', { x1: 100, z1: 450, x2: 110, z2: 450 }).reason, 'build.out_of_zone');
  assert.ok(validatePlacement(sim, BG, 'fly_nest', { x: 60, z: 440, rot: 0 }).ok, 'Grail builds at home in the south');
});

test('5A B: reversed match runs with AI on both sides: economies, FOW and reinforcement work', () => {
  const sim = matchOf(REVERSE, { ai: true, prepSeconds: 30, seed: 9 });
  run(sim, 30 + 150);
  const { state } = sim;
  const na = state.factions[NA], bg = state.factions[BG];
  assert.ok(na.stats.built > 0, 'NA engineers dig in in the north');
  assert.ok(state.structures.some((s) => s.faction === NA && s.z < 330 && s.type === 'trench' && s.built));
  let earned = 0;
  for (const k in bg.stats.biomass) if (k !== 'passive') earned += bg.stats.biomass[k];
  assert.ok(earned > 0, 'the Grail defender forages / harvests at home');
  assert.ok(na.stats.trained + bg.stats.trained > 0, 'both sides produce');
  assert.ok(aliveOf(sim, NA) > 20 && aliveOf(sim, BG) > 20);
  // every NA structure is on its own half (the NA attacker settles in its own region first)
  for (const s of state.structures) if (s.faction === NA) assert.ok(s.z < 330, s.type + ' at ' + s.z);
});

// ------------------------------------------------------------------ C / D mirror matches

test('5A C: New Antioch mirror: two hostile sides with separate ids, resources, fog layers', () => {
  const sim = matchOf(NA_MIRROR);
  const { state } = sim;
  assert.deepEqual(state.sides.map((s) => s.id), [NA, NA2]);
  assert.ok(isTwin(NA2) && baseFaction(NA2) === NA);
  assert.ok(areHostile(NA, NA2) && !areHostile(NA2, NA2));
  assert.notEqual(sideIndex(NA), sideIndex(NA2));
  assert.notEqual(sideBit(NA), sideBit(NA2));
  assert.ok(state.factions[NA].resources !== state.factions[NA2].resources);
  state.factions[NA].resources.material = 1;
  assert.equal(state.factions[NA2].resources.material, 260, 'separate stockpiles');
  // the twin builds New Antioch content in its own zone
  assert.ok(validatePlacement(sim, NA2, 'trench', { x1: 100, z1: 150, x2: 110, z2: 150 }).ok);
  assert.equal(validatePlacement(sim, NA2, 'grail_altar', { x: 100, z: 150, rot: 0 }).reason, 'build.not_faction');
  // ownership: a side cannot command the other's squads
  const mine = state.squads.find((q) => q.faction === NA && q.type === 'yeoman_rifle');
  const theirs = state.squads.find((q) => q.faction === NA2 && q.type === 'yeoman_rifle');
  enqueueCommand(sim, { type: CMD.MOVE, faction: NA, squadIds: [theirs.id], x: 160, z: 300 });
  run(sim, 0.2);
  assert.notEqual(theirs.order.t === 'move' && theirs.order.z === 300, true, 'foreign squad not moved');
  // they really fight
  clearUnits(sim);
  const a = spawn(sim, NA, 'yeoman_rifle', 160, 300, Math.PI);
  const b = spawn(sim, NA2, 'yeoman_rifle', 160, 272, 0);
  run(sim, 12);
  assert.ok(state.factions[NA].stats.kills + state.factions[NA2].stats.kills > 0, 'mirror sides shoot each other');
  void mine; void a; void b;
});

test('5A D: Black Grail mirror: separate biomass / pestilence, corpse + reanimation ownership', () => {
  const sim = matchOf(BG_MIRROR);
  const { state } = sim;
  assert.deepEqual(plagueSides(state), [BG, BG2]);
  pestGain(sim, 10, 'test', BG2);
  assert.equal(state.factions[BG].pestilence, 0);
  assert.ok(state.factions[BG2].pestilence > 0, 'meters are per side');
  // a plague-immune husk never takes stacks, never leaves an infected corpse
  clearUnits(sim);
  const husk = spawn(sim, BG, 'grail_thrall', 160, 300, 0);
  assert.equal(addInfection(sim, husk, husk.members[0], 3, BG2), 0);
  // corpses claimed by one plague rise only for it (turning bodies: no presence needed)
  const victims = [];
  for (let i = 0; i < 5; i++) {
    const c = { id: state.nextId++, x: 150 + i, z: 250, rot: 0, faction: 'neutral', unit: 'yeoman_rifle', pose: 0, tick: 0, infected: true, plague: BG2, biomass: 6, seenBy: 3, riseAt: 0, soldierId: 0, turn: 1 };
    state.corpses.push(c); sim.rt.corpseById.set(c.id, c); victims.push(c);
  }
  run(sim, 40);
  const risenA = state.squads.filter((q) => q.faction === BG && q.type === 'grail_thrall' && q !== husk).length;
  const risenB = state.squads.filter((q) => q.faction === BG2 && q.type === 'grail_thrall').length;
  assert.equal(risenA, 0, 'the other plague never raises them');
  assert.ok(risenB >= 1, 'their claimant raises them');
  // harvest: an uninfected body near side A's fighters feeds side A only
  clearUnits(sim);
  const eater = spawn(sim, BG, 'corpse_guard', 100, 200, 0);
  void eater;
  const before = { a: state.factions[BG].resources.biomass, b: state.factions[BG2].resources.biomass };
  const food = { id: state.nextId++, x: 101, z: 201, rot: 0, faction: 'neutral', unit: 'yeoman_rifle', pose: 0, tick: 0, infected: false, plague: '', biomass: 30, seenBy: 3, riseAt: 0, soldierId: 0 };
  state.corpses.push(food); sim.rt.corpseById.set(food.id, food);
  run(sim, 3);
  assert.ok(state.factions[BG].resources.biomass > before.a, 'A eats');
  assert.ok(state.factions[BG2].resources.biomass <= before.b + 0.5 + 3 * 1, 'B only has its altar trickle');
  // AI targets: each plague marches on the other's altar
  assert.equal(enemyTarget(sim, BG).faction, BG2);
  assert.equal(enemyTarget(sim, BG2).faction, BG);
});

test('5A D: infected ground belongs to the plague that fed it (owner layer), territory credit per side', () => {
  const sim = matchOf(BG_MIRROR, { prepSeconds: 0 });
  run(sim, 30);
  const inf = sim.state.infection;
  let a = 0, b = 0;
  for (let i = 0; i < inf.v.length; i++) {
    if (!inf.v[i]) continue;
    if (inf.o[i] === sideIndex(BG) + 1) a++;
    if (inf.o[i] === sideIndex(BG2) + 1) b++;
  }
  assert.ok(a > 0 && b > 0, 'both altars rot their own ground');
  // the south defender's ground lies in the south, the north attacker's in the north
  const cz = (i) => (Math.floor(i / inf.cols) + 0.5) * inf.cs;
  for (let i = 0; i < inf.v.length; i++) {
    if (inf.o[i] === sideIndex(BG) + 1) assert.ok(cz(i) > 300);
    if (inf.o[i] === sideIndex(BG2) + 1) assert.ok(cz(i) < 280);
  }
  // building on infected ground (outside the zone): only on the side's OWN plague ground
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    const k = (Math.floor(280 / inf.cs) + dz) * inf.cols + Math.floor(160 / inf.cs) + dx;
    inf.v[k] = 160; inf.o[k] = sideIndex(BG2) + 1;
  }
  assert.ok(validatePlacement(sim, BG2, 'plague_pit', { x: 160, z: 280, rot: 0 }).ok, 'its own festering ground');
  assert.equal(validatePlacement(sim, BG, 'plague_pit', { x: 160, z: 280, rot: 0 }).reason, 'build.out_of_zone', 'not the other plague\'s');
  // territory credit is counted per owner layer
  run(sim, 4);
  assert.ok(sim.state.factions[BG2].econ.infCells >= 20, 'the seeded patch counts for its owner');
});

// ------------------------------------------------------------------ E defender counterattack

test('5A E: the defender wins by destroying the attacker HQ + army (base_destroyed), in both role layouts', () => {
  for (const sides of [null, REVERSE]) {
    const sim = sides ? matchOf(sides) : createSimulation({ scenarioId: 'siege_default', seed: 4, settings: { playerFaction: NA, prepSeconds: 0, lulls: 0 } });
    const { state } = sim;
    const attacker = state.sides.find((s) => s.role === 'attacker').id;
    const defender = state.sides.find((s) => s.role === 'defender').id;
    run(sim, 1);
    for (const st of state.structures.slice()) if (st.faction === attacker && STRUCTURES[st.type].hq) destroyStructure(sim, st, defender);
    for (const q of state.squads.slice()) if (q.faction === attacker) for (const m of q.members.slice()) if (m.state === 'alive') killSoldier(sim, q, m, defender, 'rifle', 0, 1, 0, 0, 0);
    run(sim, 3);
    assert.equal(state.match.phase, 'ENDED');
    assert.equal(state.match.winner, defender);
    assert.ok(state.match.reason === 'base_destroyed' || state.match.reason === 'attacker_spent', state.match.reason);
  }
});

test('5A E: objective destroyed -> the holder\'s enemy wins (reverse: New Antioch razes the altar)', () => {
  const sim = matchOf(REVERSE);
  run(sim, 1);
  const obj = sim.state.structures.find((s) => s.objective);
  destroyStructure(sim, obj, NA);
  assert.equal(sim.state.match.winner, NA);
  assert.equal(sim.state.match.reason, 'objective_destroyed');
});

test('5A E: a defending Grail AI answers enemies at its gates and does not march out blind', () => {
  const sim = matchOf(REVERSE, { ai: true, prepSeconds: 5, seed: 12 });
  run(sim, 5 + 60);
  // no sally in the first minute of the war against an enemy it has not measured
  const bgSquads = sim.state.squads.filter((q) => q.faction === BG && q.type === 'grail_thrall');
  assert.ok(bgSquads.every((q) => q.cz > 330), 'the horde holds home');
  // an enemy strike group at the gates is met
  const home = homeStructure(sim.state, BG);
  const raider = spawn(sim, NA, 'mech_heavy', home.x, home.z - 70, 0);
  run(sim, 6);
  const ai = sim.state.ai[BG];
  assert.equal(ai.defending, raider.id, 'threat registered');
  assert.ok(sim.state.squads.some((q) => q.faction === BG && q.order && q.order.t === 'move' && q.order.am && Math.abs(q.order.z - raider.cz) < 30), 'waves attack-move onto it');
});

// ------------------------------------------------------------------ F endless / open battle

test('5A F: endless wars have no timer victory (siege and open battle); open battle ends by annihilation', () => {
  for (const scenarioId of ['siege_default', 'open_battle']) {
    const sim = createSimulation({ scenarioId, seed: 2, settings: { playerFaction: NA, warMinutes: 'endless', prepSeconds: 0, lulls: 0 } });
    assert.equal(sim.state.match.warEndTick, 0);
    sim.state.tick = 20 * 60 * 400; // far beyond any timer
    run(sim, 1);
    assert.notEqual(sim.state.match.phase, 'ENDED', scenarioId);
  }
  const ob = createSimulation({ scenarioId: 'open_battle', seed: 2, settings: { playerFaction: NA, prepSeconds: 0, lulls: 0 } });
  assert.equal(ob.state.match.victory, 'annihilation');
  assert.ok(!ob.state.structures.some((s) => s.objective), 'no objective in an open battle');
  for (const st of ob.state.structures.slice()) if (st.faction === BG) destroyStructure(ob, st, NA);
  for (const q of ob.state.squads.slice()) if (q.faction === BG) for (const m of q.members.slice()) if (m.state === 'alive') killSoldier(ob, q, m, NA, 'rifle', 0, 1, 0, 0, 0);
  run(ob, 2);
  assert.equal(ob.state.match.winner, NA);
  assert.equal(ob.state.match.reason, 'base_destroyed');
});

// ------------------------------------------------------------------ G / H setup resolution

test('5A G: Lore Setup: the preset decides the roles; the player picks which side to play', () => {
  const sc = SCENARIOS.siege_default;
  const a = resolveSides(sc, { setup: { mode: 'lore', playerFaction: BG, enemyFaction: NA, playerRole: 'attacker' } });
  assert.equal(a.player, BG);
  assert.deepEqual(a.sides.map((s) => [s.id, s.role, s.controller]), [[NA, 'defender', 'ai'], [BG, 'attacker', 'player']]);
  const legacy = resolveSides(sc, { playerFaction: BG });
  assert.equal(legacy.player, BG);
  assert.deepEqual(legacy.sides.map((s) => s.role), ['defender', 'attacker']);
  const sim = createSimulation({ scenarioId: 'siege_default', seed: 1, settings: { setup: { mode: 'lore', playerFaction: BG, enemyFaction: NA, playerRole: 'attacker' }, prepSeconds: 0 } });
  assert.equal(sim.state.settings.setupMode, 'lore');
  assert.equal(sim.state.settings.playerFaction, BG);
});

test('5A H/5B: Free Setup: any playable faction for either side, either role; mirror ids are deterministic', () => {
  const sc = SCENARIOS.siege_default;
  const r = resolveSides(sc, { setup: { mode: 'free', playerFaction: BG, enemyFaction: NA, playerRole: 'defender' } });
  assert.deepEqual(r.sides.map((s) => [s.id, s.faction, s.role, s.region]), [[BG, BG, 'defender', 'south'], [NA, NA, 'attacker', 'north']]);
  const m = resolveSides(sc, { setup: { mode: 'free', playerFaction: NA, enemyFaction: NA, playerRole: 'attacker' } });
  assert.deepEqual(m.sides.map((s) => s.id), [NA, NA2]);
  assert.equal(m.player, NA2, 'the player holds the attacker slot = the twin id');
  const is = resolveSides(sc, { setup: { mode: 'free', playerFaction: 'iron_sultanate', enemyFaction: NA, playerRole: 'attacker' } });
  assert.deepEqual(is.sides.map((s) => [s.faction, s.role]), [[NA, 'defender'], ['iron_sultanate', 'attacker']]);
  assert.throws(() => resolveSides(sc, { setup: { mode: 'free', playerFaction: 'heretic_legion', enemyFaction: NA, playerRole: 'attacker' } }));
  const sim = createSimulation({ scenarioId: 'siege_default', seed: 1, settings: { setup: { mode: 'free', playerFaction: NA, enemyFaction: NA, playerRole: 'attacker' }, aiDifficulty: 'hard', prepSeconds: 0 } });
  assert.equal(sim.state.settings.setupMode, 'free');
  assert.equal(sim.state.settings.aiDifficulty, 'hard');
  assert.equal(sim.state.settings.controllers[NA], 'ai');
  assert.equal(sim.state.settings.controllers[NA2], 'player');
});

// ------------------------------------------------------------------ I / J saves

function downgradeToV5(state) {
  const s = decodeState(encodeState(state));
  delete s.sides;
  delete s.settings.setupMode; delete s.settings.aiDifficulty;
  delete s.match.victory;
  for (const fid in s.factions) { const f = s.factions[fid]; delete f.faction; delete f.role; delete f.region; delete f.zone; delete f.popStart; }
  s.objectives = s.objectives.map((o) => ({ type: 'siege', structureId: o.structureId, defender: NA, attacker: BG }));
  delete s.infection.o;
  for (const q of s.squads) for (const m of q.members) delete m.infBy;
  for (const c of s.corpses) delete c.plague;
  s.version = 5;
  return s;
}

/**
 * Canonical JSON (sorted keys) for key-order-independent comparison. A cured soldier may still
 * remember who infected him (m.infBy) — meaningless without stacks (every reader checks
 * infection > 0 first), so it is normalized away.
 */
function canonState(st) {
  const c = canon(st);
  for (const q of c.squads) for (const m of q.members) if (!m.infection) m.infBy = '';
  return JSON.stringify(c);
}

function canon(v) {
  if (v && ArrayBuffer.isView(v)) return Array.from(v);
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) o[k] = canon(v[k]); return o; }
  return v;
}

test('5A I/5B: save v5 -> current: a classic Phase 4.1 save becomes NA defender / BG attacker, nothing lost', () => {
  assert.equal(STATE_VERSION, 7);
  const sim = createSimulation({ scenarioId: 'siege_default', seed: 21, settings: { playerFaction: NA, prepSeconds: 20, warMinutes: 30, controllers: { [NA]: 'ai', [BG]: 'ai' } } });
  run(sim, 20 + 200);
  const v5 = downgradeToV5(sim.state);
  const hdr = JSON.parse(serializeSave(sim.state));
  const loaded = deserializeSave(JSON.stringify({ ...hdr, version: 5, state: JSON.parse(encodeState(v5)) })).state;
  assert.equal(loaded.version, STATE_VERSION);
  assert.deepEqual(loaded.sides, sim.state.sides);
  // the migrated state IS the live state (resources, units, structures, corpses, pestilence,
  // infection owners, stacks, mud / weather, elites, reinforcement)
  assert.ok(canonState(loaded) === canonState(sim.state), 'migrated state equals the live state');
  // and it continues identically
  const sim2 = simulationFromState(loaded);
  run(sim, 30); run(sim2, 30);
  assert.ok(canonState(sim2.state) === canonState(sim.state), 'and continues identically');
});

test('5A J: save -> load -> continue is deterministic in reversed and mirror matches', () => {
  for (const sides of [REVERSE, NA_MIRROR, BG_MIRROR]) {
    const sim = matchOf(sides, { ai: true, prepSeconds: 10, seed: 17 });
    run(sim, 70);
    const copy = simulationFromState(deserializeSave(serializeSave(sim.state)).state);
    assert.equal(stateHash(copy), stateHash(sim));
    run(sim, 40); run(copy, 40);
    assert.equal(stateHash(copy), stateHash(sim), sides.map((s) => s.faction + '/' + s.role).join(' vs '));
  }
});

test('5A §32: same seed + scenario + factions + roles + duration -> same hash; roles change the match', () => {
  const h = (sides) => { const s = matchOf(sides, { ai: true, prepSeconds: 5, seed: 33 }); run(s, 40); return stateHash(s); };
  assert.equal(h(REVERSE), h(REVERSE));
  assert.equal(h(BG_MIRROR), h(BG_MIRROR));
  assert.notEqual(h(REVERSE), h([{ faction: NA, role: 'defender' }, { faction: BG, role: 'attacker' }]));
});

// ------------------------------------------------------------------ K / L performance, AI

test('5A K: 480-soldier stress as a mirror match: bounded, no NaN (headless, not a device FPS)', () => {
  const sim = createSimulation({ scenarioId: 'stress', seed: 7, settings: { sides: [{ faction: BG, role: 'defender' }, { faction: BG, role: 'attacker' }], stressSoldiers: 480, allAi: true } });
  let n = 0;
  for (const q of sim.state.squads) n += q.members.length;
  assert.greater(n, 400);
  let worst = 0;
  for (let i = 0; i < 20 * 30; i++) { const t0 = performance.now(); stepSimulation(sim); worst = Math.max(worst, performance.now() - t0); sim.events.length = 0; }
  for (const q of sim.state.squads) for (const m of q.members) assert.ok(Number.isFinite(m.x) && Number.isFinite(m.z));
  assert.ok(sim.state.factions[BG].stats.kills + sim.state.factions[BG2].stats.kills > 0, 'the mirror armies fight');
  console.log('       480 mirror stress: worst tick ' + worst.toFixed(1) + ' ms (headless Node)');
});

test('5A L: AI acts only through sourced commands in reversed and mirror matches', () => {
  for (const sides of [REVERSE, NA_MIRROR, BG_MIRROR]) {
    const sim = matchOf(sides, { ai: true, prepSeconds: 20, seed: 8 });
    let direct = 0, ai = 0;
    for (let i = 0; i < 20 * 120; i++) {
      for (const c of sim.state.pending) { if (c.source !== 'ai') direct++; else ai++; }
      stepSimulation(sim);
      sim.events.length = 0;
    }
    assert.equal(direct, 0);
    assert.greater(ai, 20);
  }
});

// ------------------------------------------------------------------ M / N / O mirror safety

test('5A M: fog of war in a mirror match: the twin is hidden until seen', () => {
  const sim = matchOf(NA_MIRROR);
  run(sim, 1);
  const far = sim.state.squads.find((q) => q.faction === NA2);
  assert.ok(!isSquadVisibleTo(far, NA), 'the enemy twin at its home is not visible');
  assert.ok(isSquadVisibleTo(far, NA2), 'but its own side sees it');
  clearUnits(sim);
  const a = spawn(sim, NA, 'yeoman_rifle', 160, 300, Math.PI);
  const b = spawn(sim, NA2, 'yeoman_rifle', 160, 285, 0);
  run(sim, 0.5);
  assert.ok(isSquadVisibleTo(b, NA) && isSquadVisibleTo(a, NA2), 'in sight both ways');
  const c = spawn(sim, NA2, 'yeoman_rifle', 40, 60, 0);
  run(sim, 0.5);
  assert.ok(!isSquadVisibleTo(c, NA), 'no leak of a distant twin squad');
});

test('5A N: resource lens in a mirror match shows only the viewer side', () => {
  const sim = matchOf(NA_MIRROR);
  run(sim, 1);
  for (const res of ['material', 'supply', 'food', 'manpower']) {
    for (const it of lensItems(sim, NA, res)) assert.ok(it.z > 300 || it.kind === 'heap' || it.kind === 'sector', res + ' ' + it.kind + ' ' + it.z);
    for (const it of lensItems(sim, NA2, res)) assert.ok(it.z < 280 || it.kind === 'heap' || it.kind === 'sector', res + ' twin ' + it.kind + ' ' + it.z);
  }
  const own = lensItems(sim, NA2, 'supply');
  assert.ok(own.length > 0 && own.every((it) => it.z < 280));
});

test('5A O: control groups / All in a mirror match select only the player side', () => {
  const sim = matchOf(NA_MIRROR);
  const g = createControlGroups();
  const all = sim.state.squads.map((q) => q.id);
  const n = g.save(0, all, sim, NA2);
  const mine = sim.state.squads.filter((q) => q.faction === NA2 && !q.civ).length;
  assert.equal(n, mine);
  for (const id of g.ids(0, sim, NA2)) assert.equal(sim.rt.squadById.get(id).faction, NA2);
  for (const id of allCombatSquadIds(sim, NA)) assert.equal(sim.rt.squadById.get(id).faction, NA);
  void addStructure;
});
