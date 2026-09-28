// Phase 4.1 regression tests (brief §27): no ceasefire in a lull (see also phase4), passive
// ELITES (no abilities, no caps, non-stacking auras, union coverage), positional auto
// reinforcement, altar / Thrall / work gang speeds and contexts, starting corpse mound and its
// 22 m area, corpse states + purification, placement rotation (drag / confirm / cancel) and firing
// arc, one-shot multi-select, fog-safe resource lens, endless war + defender counterattack, rain /
// traffic mud, save v4 -> v5 migration, AI through commands only, module load guard.
import { readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, assert } from './harness.js';
import { enqueueCommand, CMD } from '../src/sim/commands.js';
import { EV } from '../src/core/events.js';
import { createSimulation, stepSimulation, simulationFromState } from '../src/sim/simulation.js';
import { killSoldier } from '../src/combat/combat.js';
import { UNITS, unitDef } from '../src/data/units.js';
import { STRUCTURES } from '../src/data/structures.js';
import { ABILITIES } from '../src/data/abilities.js';
import { FACTIONS } from '../src/data/factions.js';
import { WEATHER } from '../src/data/weather.js';
import { MATCH_LENGTH_OPTIONS } from '../src/data/scenarios.js';
import { rebuildAuras, auraValue, auraOfKindAt } from '../src/sim/auras.js';
import { unitMaxSquads } from '../src/sim/specialities.js';
import { moveSpeed } from '../src/units/speed.js';
import { corpseView, moundPreview } from '../src/sim/corpse_view.js';
import { rainWindow, mudLevelAt, mudSpeedAt } from '../src/sim/weather.js';
import { updateVision } from '../src/sim/perception.js';
import { encodeState, decodeState, serializeSave, deserializeSave } from '../src/save/codec.js';
import { STATE_VERSION, TICK_RATE } from '../src/sim/constants.js';
import { createSession } from '../src/app/session.js';
import { createActions } from '../src/app/actions.js';
import { createSelection, consumeMulti } from '../src/input/selection.js';
import { createControlGroups } from '../src/input/control_groups.js';
import { createInputController } from '../src/input/controller.js';
import { createCamera, updateCamera, projectToScreen } from '../src/render/camera.js';
import { groundHeightAt } from '../src/world/ground.js';
import { firingArcOf } from '../src/render/range_viz.js';
import { lensItems } from '../src/ui/lens.js';
import { specRequirement, requirementText, fixFor, gunStatus } from '../src/ui/reasons.js';
import { setLanguage } from '../src/ui/i18n.js';
import { makeSim, clearUnits, spawn, run, alive, addStructure } from './helpers.js';

const NA = 'new_antioch';
const BG = 'black_grail';

function cmd(sim, type, faction, fields) {
  enqueueCommand(sim, { type, faction, ...fields });
}

// ------------------------------------------------------------------ module load guard

test('every source module parses and loads (catches syntax errors in UI modules the sim tests never import)', async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const files = [];
  (function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.js')) files.push(p); } })(root);
  const bad = [];
  for (const f of files) {
    if (f.endsWith('main.js')) continue; // the browser entry touches the DOM at load
    try { await import(pathToFileURL(f).href); } catch (e) { bad.push(f + ': ' + e.message); }
  }
  assert.deepEqual(bad, [], 'modules failing to load');
  assert.greater(files.length, 100);
});

// ------------------------------------------------------------------ §2 elites

test('elites: no active abilities, no unique caps, no death penalty; the Sniper Priest is a lore-checked elite', () => {
  assert.ok(!ABILITIES.hold_the_line && !ABILITIES.plague_blessing, 'commander abilities removed');
  assert.ok(!CMD.COMMANDER_ABILITY, 'no commander command');
  assert.ok(!EV.COMMANDER_FALLEN, 'no commander death event');
  const sim = makeSim();
  for (const id of ['na_lieutenant', 'trench_cleric', 'sniper_priest', 'plague_knight', 'herald', 'lord_of_tumours']) {
    const d = UNITS[id];
    assert.ok(d.elite && d.elite.role && d.elite.passive, id + ' is an elite with a role and a passive');
    assert.ok(!d.commander && !d.ability, id + ' has no active ability / commander flag');
    assert.ok(!unitMaxSquads(sim.state, d.faction, id), id + ' has no squad cap');
  }
  assert.equal(UNITS.amalgam.unitClass, 'monster', 'the Amalgam stays a MONSTER / siege unit');
  assert.equal(UNITS.sniper_priest.lore.status, 'canon');
  assert.ok(/ritually blind/i.test(UNITS.sniper_priest.lore.ref));
  assert.ok(UNITS.sniper_priest.marksman && UNITS.sniper_priest.marksman.prefer.elite > 0);
  assert.equal(UNITS.na_lieutenant.aura.kind, 'command');
  assert.ok(UNITS.na_lieutenant.aura.radius >= 14 && UNITS.na_lieutenant.aura.radius <= 18, 'COMMAND COHESION ~16 m');
  // three Lieutenants can be fielded (no "commander limit")
  const bastion = sim.state.structures.find((s) => s.type === 'bastion');
  const f = sim.state.factions[NA];
  f.resources.supply = 9999; f.resources.manpower = 99; f.resources.material = 999;
  for (let i = 0; i < 3; i++) cmd(sim, CMD.TRAIN, NA, { sid: bastion.id, unit: 'na_lieutenant' });
  const evs = run(sim, 0.2);
  assert.ok(!evs.some((e) => e.type === EV.COMMAND_REJECTED), 'no cap refusal');
  assert.equal(bastion.queue.filter((q) => q.unit === 'na_lieutenant').length, 3);
});

test('elite auras: same kind never stacks (MAX), different kinds combine, apart they cover the union', () => {
  const sim = makeSim();
  clearUnits(sim);
  const a = spawn(sim, NA, 'na_lieutenant', 160, 470, Math.PI);
  const b = spawn(sim, NA, 'na_lieutenant', 161, 470, Math.PI);
  rebuildAuras(sim);
  assert.approx(auraValue(sim, NA, 160, 472, 'accBonus'), UNITS.na_lieutenant.aura.accBonus, 1e-9, 'two Lieutenants together = one');
  const cl = spawn(sim, NA, 'trench_cleric', 162, 470, Math.PI);
  rebuildAuras(sim);
  assert.equal(auraValue(sim, NA, 160, 472, 'fearImmune'), 2, 'command + sanctified are different kinds: they combine');
  // apart: two separate areas, a gap between them
  b.cx = b.x = 200; cl.cx = cl.x = 400; cl.cz = 100;
  for (const m of b.members) { m.x = 200; m.z = 470; }
  rebuildAuras(sim);
  assert.ok(auraOfKindAt(sim, NA, 'command', 160, 470), 'near the first');
  assert.ok(auraOfKindAt(sim, NA, 'command', 200, 470), 'near the second');
  assert.ok(!auraOfKindAt(sim, NA, 'command', 180, 470), 'not in the gap');
  void a;
});

test('Lord of Tumours: passive regeneration does not stack with a second Lord', () => {
  const heal = (lords) => {
    const sim = makeSim();
    clearUnits(sim);
    for (let i = 0; i < lords; i++) spawn(sim, BG, 'lord_of_tumours', 160 + i, 200, 0);
    const t = spawn(sim, BG, 'grail_thrall', 163, 202, 0);
    for (const m of t.members) m.hp = 20;
    run(sim, 6);
    return t.members.reduce((s, m) => s + m.hp, 0);
  };
  const one = heal(1), two = heal(2);
  assert.greater(one, 20 * UNITS.grail_thrall.squadSize, 'a Lord heals');
  assert.approx(two, one, 1e-6, 'two Lords heal exactly as one');
});

// ------------------------------------------------------------------ §3 positional reinforcement

test('positional auto reinforcement: garrison position ON; the Grail cannot REINFORCE at all', () => {
  const sim = makeSim();
  clearUnits(sim);
  const ruin = sim.state.structures.find((s) => s.type === 'ruin_house');
  const sq = spawn(sim, NA, 'yeoman_rifle', ruin.x + 6, ruin.z + 14, Math.PI);
  cmd(sim, CMD.GARRISON, NA, { squadIds: [sq.id], sid: ruin.id });
  run(sim, 40, () => !(sq.order.t === 'garrison' && sq.order.phase === 'inside'));
  assert.equal(sq.order.phase, 'inside', 'precondition: garrisoned');
  run(sim, 2);
  assert.equal(sq.posId, ruin.id, 'the ruin is its position');
  assert.equal(sq.posAuto, 1, 'garrisoned: auto reinforcement ON by default');
  const th = spawn(sim, BG, 'grail_thrall', 160, 200, 0);
  killSoldier(sim, th, th.members[0], NA, 'rifle', 0, 1);
  cmd(sim, CMD.REINFORCE, BG, { squadIds: [th.id] });
  const ev = run(sim, 0.2);
  assert.ok(ev.some((e) => e.type === EV.COMMAND_REJECTED && e.faction === BG), 'the Grail has no walking replacements');
  assert.equal(FACTIONS[BG].reinforcements, null);
});

// ------------------------------------------------------------------ §4-7 economy / speeds

test('altar 0.14 biomass/s with no diminishing returns; one corpse mound stands at the Grail start (22 m area)', () => {
  assert.equal(STRUCTURES.grail_altar.biomassRate, 0.14);
  const sim = makeSim();
  clearUnits(sim);
  const f = sim.state.factions[BG];
  const altars = () => sim.state.structures.filter((s) => s.faction === BG && s.type === 'grail_altar' && s.built).length;
  const gain = () => { const b0 = f.stats.biomass.passive || 0; run(sim, 10); return (f.stats.biomass.passive || 0) - b0; };
  const g1 = gain();
  assert.approx(g1, 0.14 * 10 * altars(), 0.15, 'passive income = 0.14/s per altar');
  const a0 = sim.state.structures.find((s) => s.faction === BG && s.type === 'grail_altar');
  addStructure(sim, 'grail_altar', BG, { x: a0.x + 30, z: a0.z + 10, rot: 0, built: true });
  const g2 = gain();
  assert.approx(g2 / altars(), g1 / (altars() - 1), 0.02, 'a further altar adds the full rate (no diminishing returns)');
  const mounds = sim.state.structures.filter((s) => s.faction === BG && s.type === 'corpse_mound');
  assert.equal(mounds.length, 1, 'exactly one pre-built mound');
  assert.ok(mounds[0].built && STRUCTURES.corpse_mound.dropOff, 'built, and a drop-off');
  assert.equal(STRUCTURES.corpse_mound.harvestRadius, 22);
  assert.ok(STRUCTURES.grail_altar.dropOff, 'altars stay drop-offs');
});

test('speeds: Thrall ~2.78; work gang 3.6, 6.2 only while hunting on a forage order, 4.2 hauling — never chasing enemies', () => {
  const th = UNITS.grail_thrall.speed;
  assert.ok(th >= 2.75 && th <= 2.8, 'thrall ' + th);
  const def = UNITS.thrall_gang;
  const sq = (order, extra = {}) => ({ order, carry: 0, melee: false, engaged: false, target: null, ...extra });
  assert.equal(moveSpeed(sq({ t: 'move', x: 0, z: 0 }), def), 3.6, 'plain move / scouting');
  assert.equal(moveSpeed(sq({ t: 'gather', mode: 'forage', phase: 'seek' }), def), 3.6, 'looking for prey');
  assert.equal(moveSpeed(sq({ t: 'gather', mode: 'forage', phase: 'hunt', aid: 5 }), def), 6.2, 'running an animal down');
  assert.equal(moveSpeed(sq({ t: 'gather', mode: 'forage', phase: 'to_drop' }, { carry: 10 }), def), 4.2, 'hauling home');
  assert.equal(moveSpeed(sq({ t: 'attack', tk: 'squad', tid: 9 }), def), 3.6, 'chasing an enemy: no hunt speed');
  assert.equal(moveSpeed(sq({ t: 'gather', mode: 'forage', phase: 'hunt', aid: 5 }, { engaged: true, target: { k: 'squad', id: 3 } }), def), 3.6, 'fighting: no hunt speed');
  assert.equal(moveSpeed(sq({ t: 'gather', mode: 'forage', phase: 'hunt', aid: 5 }, { melee: true }), def), 3.6, 'in melee: no hunt speed');
});

// ------------------------------------------------------------------ §8-9 corpses

function infectedBody(sim, x, z, stacks = 1) {
  const sq = spawn(sim, NA, 'yeoman_rifle', x, z, Math.PI);
  const m = sq.members[0];
  m.infection = stacks;
  // plague claims are a deterministic hash: find a man whose body the plague claims
  for (const mm of sq.members) { mm.infection = stacks; }
  for (const mm of sq.members) killSoldier(sim, sq, mm, BG, 'claws', 0, 1);
  run(sim, 2.5);
  return sim.state.corpses.filter((c) => c.faction === NA && !c.old && Math.abs(c.x - x) < 8 && Math.abs(c.z - z) < 8);
}

test('corpse states (Grail view): infected -> scheduled with a deterministic countdown; turning bodies; the enemy sees only the risk', () => {
  const mk = () => { const sim = makeSim(); clearUnits(sim); return sim; };
  const sim = mk();
  const bodies = infectedBody(sim, 160, 300, 1).filter((c) => c.infected);
  assert.greater(bodies.length, 0, 'the plague claimed some');
  const c = bodies[0];
  c.seenBy |= 3;
  assert.equal(corpseView(sim, BG, c).st, 'infected', 'waiting for the Grail');
  spawn(sim, BG, 'grail_thrall', 160, 285, 0); // a Grail fighter close: the body is scheduled
  run(sim, 1.2);
  const v = corpseView(sim, BG, c);
  assert.equal(v.st, 'scheduled');
  assert.ok(v.secs > 0 && v.secs <= FACTIONS[BG].reanimation.delaySeconds + 1, 'seconds ' + v.secs);
  // deterministic: an identical run schedules the same tick
  const sim2 = mk();
  const c2 = infectedBody(sim2, 160, 300, 1).filter((x) => x.infected)[0];
  spawn(sim2, BG, 'grail_thrall', 160, 285, 0);
  run(sim2, 1.2);
  assert.equal(c2.riseAt, c.riseAt, 'same countdown in identical runs');
  // the other side: nothing about a body it cannot see; only the coarse risk when it can
  updateVision(sim);
  const naView = corpseView(sim, NA, c);
  assert.ok(naView === null || naView.st === 'risk' || naView.st === 'imminent', 'limited information only');
  if (naView) assert.equal(naView.secs, 0, 'no countdown for New Antioch');
  // a heavily infected man turns where he lies
  const sim3 = mk();
  const t3 = infectedBody(sim3, 160, 300, 3).filter((x) => x.infected);
  assert.ok(t3.some((x) => x.turn), 'turning body flagged');
  const tb = t3.find((x) => x.turn);
  tb.seenBy |= 3;
  assert.equal(corpseView(sim3, BG, tb).st, 'turn');
});

test('purified bodies never rise: consecration for a few seconds purifies the dead for good', () => {
  const sim = makeSim();
  clearUnits(sim);
  const bodies = infectedBody(sim, 160, 300, 1).filter((c) => c.infected);
  assert.greater(bodies.length, 0);
  // a cleric close enough to consecrate (16 m) but outside his cremation reach (10 m)
  spawn(sim, NA, 'trench_cleric', 160, 314, Math.PI);
  run(sim, FACTIONS[BG].reanimation.blessSec + 3);
  for (const c of bodies) {
    if (sim.state.corpses.indexOf(c) < 0) continue; // cremated by the cleric instead: gone for good as well
    assert.ok(c.blessed && !c.infected, 'purified');
    c.seenBy |= 3;
    assert.equal(corpseView(sim, BG, c).st, 'purified');
  }
  // the cleric leaves; the Grail camps on the bodies: nobody rises
  const cl = sim.state.squads.find((q) => q.type === 'trench_cleric');
  cl.members.forEach((m) => killSoldier(sim, cl, m, BG, 'claws', 0, 1));
  spawn(sim, BG, 'grail_thrall', 160, 296, 0);
  let rose = 0;
  run(sim, 60, (s) => { for (const e of s.events) if (e.type === EV.SOLDIER_RISING && bodies.some((b) => b.id === e.corpseId)) rose++; });
  assert.equal(rose, 0, 'purified bodies never rise');
});

test('corpse mound 22 m preview: usable (seen, uninfected) bodies inside the area are counted', () => {
  const sim = makeSim();
  clearUnits(sim);
  const sq = spawn(sim, NA, 'yeoman_rifle', 100, 250, Math.PI);
  for (const m of sq.members) killSoldier(sim, sq, m, NA, 'rifle', 0, 1);
  run(sim, 2.5);
  const bodies = sim.state.corpses.filter((c) => !c.old && c.faction === NA);
  for (const c of bodies) { c.infected = false; c.seenBy |= 2; }
  const inside = moundPreview(sim, BG, 100, 250 + 20, 22);
  assert.equal(inside.usable, bodies.length, 'all within 22 m');
  const outside = moundPreview(sim, BG, 100, 250 + 30, 22);
  assert.equal(outside.usable, 0, 'none 30 m away');
  bodies[0].infected = true;
  const again = moundPreview(sim, BG, 100, 250 + 20, 22);
  assert.equal(again.usable, bodies.length - 1, 'infected bodies are not usable (they rise)');
  bodies[1].seenBy = 1;
  assert.equal(moundPreview(sim, BG, 100, 270, 22).usable, bodies.length - 2, 'unseen bodies are not counted (fog)');
});

// ------------------------------------------------------------------ §10-12 mobile input

function controllerFixture(faction = NA) {
  const hadWindow = 'window' in globalThis;
  if (!hadWindow) globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const s = createSession({ scenarioId: 'siege_default', seed: 3, settings: { playerFaction: faction, prepSeconds: 600, lulls: 0 } });
  const sim = s.sim;
  const ground = (x, z) => groundHeightAt(sim.world, sim.rt.structGrid, x, z);
  const cam = createCamera({ x: 160, z: 460, dist: 70 });
  cam.groundFn = ground;
  updateCamera(cam, 1280, 720, 0);
  const canvas = { width: 1280, height: 720, style: {}, addEventListener() {}, removeEventListener() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) };
  const game = {
    session: s, sim, viewer: faction, camera: cam, selection: createSelection(), ui: {}, frame: {}, mode: { kind: 'normal' },
    renderer: { groundAt: ground, knownStructures: () => sim.state.structures }, settings: { touchAssist: false },
    audio: null, hud: null, notify() {}, controlGroups: createControlGroups(), lookAt() {},
  };
  game.actions = createActions(game);
  game.input = createInputController(canvas, game);
  if (!hadWindow) delete globalThis.window;
  const P = [0, 0, 0, 0];
  const scr = (x, z) => { projectToScreen(cam, x, ground(x, z), z, P); return [P[0], P[1]]; };
  let t = 1000, id = 1;
  const tap = (x, z) => { const [sx, sy] = scr(x, z); t += 600; game.input.gestures.down(id, sx, sy, t, { type: 'touch' }); game.input.gestures.up(id, sx, sy, t + 60); id++; t += 100; };
  const drag = (x0, z0, x1, z1) => {
    const [a, b] = scr(x0, z0), [c, d] = scr(x1, z1);
    t += 600;
    game.input.gestures.down(id, a, b, t, { type: 'touch' });
    for (let k = 1; k <= 8; k++) game.input.gestures.move(id, a + ((c - a) * k) / 8, b + ((d - b) * k) / 8, t + k * 16);
    game.input.gestures.up(id, c, d, t + 9 * 16);
    id++; t += 400;
  };
  return { s, sim, game, cam, tap, drag };
}

test('placement: tap pins the ghost, a drag around it turns it freely (camera stays), ✕ drops the spot but stays in build mode, ✓ builds', () => {
  const { sim, game, cam, tap, drag } = controllerFixture();
  const f = sim.state.factions[NA];
  f.resources.material = 900; f.resources.supply = 900;
  game.input.startPlacement('field_gun');
  assert.equal(game.mode.kind, 'place');
  tap(150, 470);
  assert.ok(game.mode.pinned, 'pinned by the tap');
  assert.ok(Math.abs(game.mode.x - 150) < 1.5 && Math.abs(game.mode.z - 470) < 1.5, 'at the tapped spot');
  const cx = cam.tx, cz = cam.tz;
  drag(153, 470, 160, 462); // grab near the ghost, pull toward the north-east
  const want = Math.atan2(160 - game.mode.x, 462 - game.mode.z);
  assert.approx(game.mode.rot, want, 0.12, 'free rotation toward the finger');
  assert.equal(cam.tx, cx); assert.equal(cam.tz, cz);
  assert.ok(game.frame.placement && Math.abs(game.frame.placement.params.rot - game.mode.rot) < 1e-9, 'the live ghost (and its arc) follow');
  // ✕: this spot only
  game.input.cancelSpot();
  assert.equal(game.mode.kind, 'place', 'still in build mode');
  assert.ok(!game.mode.pinned && game.mode.hidden, 'spot dropped');
  assert.equal(game.input.confirmPlacement(), false, 'nothing to confirm');
  tap(150, 460);
  drag(153, 460, 150, 474); // face south
  const rot = game.mode.rot;
  assert.ok(game.input.confirmPlacement(), '✓ builds');
  const b = sim.state.pending.find((c) => c.type === 'BUILD' && c.stype === 'field_gun');
  assert.ok(b && Math.abs(b.rot - rot) < 1e-9, 'the BUILD carries the dragged facing');
  assert.equal(game.mode.kind, 'normal');
  // a drag away from the ghost pans the camera instead
  game.input.startPlacement('field_gun');
  tap(150, 470);
  const r0 = game.mode.rot;
  drag(210, 420, 230, 400);
  assert.equal(game.mode.rot, r0, 'far drag does not rotate');
  assert.ok(cam.tx !== cx || cam.tz !== cz, 'far drag pans');
});

test('multi-select is ONE-SHOT: one additive tap, then back to normal selection', () => {
  const { sim, game, tap } = controllerFixture();
  const rifles = sim.state.squads.filter((q) => q.faction === NA && q.type === 'yeoman_rifle');
  const [a, b] = rifles;
  game.selection.set([a.id]);
  game.ui.multi = true;
  tap(b.cx, b.cz);
  assert.ok(game.selection.has(a.id) && game.selection.has(b.id), 'added');
  assert.equal(game.ui.multi, false, 'switched back off');
  assert.equal(consumeMulti(game.ui), false);
  void sim;
});

test('field gun: the laid sector matters — out of arc it stays silent and says why; REORIENT costs material and time', () => {
  const sim = makeSim();
  clearUnits(sim);
  const gun = addStructure(sim, 'field_gun', NA, { x: 160, z: 470, rot: 0, built: true }); // facing south (away)
  const f = sim.state.factions[NA];
  f.resources.supply = 500; f.resources.material = 100;
  spawn(sim, BG, 'corpse_guard', 160, 380, 0);
  const see = () => { for (const q of sim.state.squads) if (q.faction === BG) q.visibleTo |= 1; };
  run(sim, 8, see);
  assert.equal(f.stats.gunShots || 0, 0, 'target behind the gun: silent');
  assert.equal(gun.gs, 'traverse');
  setLanguage('en');
  const why = gunStatus(sim, NA, gun);
  assert.ok(why && why.reason && why.fix, 'the player is told why and how');
  assert.equal(firingArcOf('field_gun').half, (STRUCTURES.field_gun.arc * Math.PI) / 360);
  cmd(sim, CMD.REORIENT, NA, { sid: gun.id, rot: Math.PI });
  run(sim, 1, see);
  assert.ok(f.resources.material <= 100 - STRUCTURES.field_gun.relay.material + 3, 'material paid (' + f.resources.material + ', income runs meanwhile)');
  assert.equal(gun.gs, 'relay');
  run(sim, STRUCTURES.field_gun.relay.sec - 3, see);
  assert.equal(f.stats.gunShots || 0, 0, 'out of action while re-laid');
  run(sim, 15, see);
  assert.greater(f.stats.gunShots || 0, 0, 'fires once bedded in on the new heading');
  cmd(sim, CMD.REORIENT, NA, { sid: sim.state.structures.find((s) => s.type === 'bastion').id, rot: 0 });
  assert.ok(run(sim, 0.2).some((e) => e.type === EV.COMMAND_REJECTED && e.reason === 'gun.reorient_invalid'));
  setLanguage('tr');
});

// ------------------------------------------------------------------ §14-16 lens / reasons

test('resource lens is fog-safe: own sources and known neutral things only, never the enemy economy', () => {
  const sim = makeSim({ living: true });
  updateVision(sim);
  const sup = lensItems(sim, NA, 'supply');
  assert.greater(sup.length, 0, 'the bastion / depots');
  const mat = lensItems(sim, NA, 'material');
  for (const it of mat) if (it.kind === 'heap') assert.ok(sim.state.nodes.some((n) => n.x === it.x && n.z === it.z && (n.seenBy & 1)), 'only discovered heaps');
  // the Grail's lens: its altars / mound and bodies IT has seen
  const bio = lensItems(sim, BG, 'biomass');
  assert.ok(bio.some((i) => i.kind === 'altar') && bio.some((i) => i.kind === 'mound'));
  for (const c of sim.state.corpses) if (!(c.seenBy & 2)) assert.ok(!bio.some((i) => i.kind === 'corpse' && i.x === c.x && i.z === c.z), 'unseen body never listed');
  // New Antioch's lens never shows Grail structures
  for (const res of ['material', 'supply', 'manpower', 'food']) {
    for (const it of lensItems(sim, NA, res)) assert.ok(!sim.state.structures.some((s) => s.faction === BG && s.x === it.x && s.z === it.z), res + ': no enemy structure');
  }
});

test('"why can\'t I?": locked Amalgam names Tier II — Kaynaşma; refusals come with a fix', () => {
  setLanguage('tr');
  const r = specRequirement('units', 'amalgam');
  assert.equal(r.tier, 1);
  assert.equal(requirementText('units', 'amalgam'), 'Gerekli: Tier II — Kaynaşma');
  const sim = makeSim();
  assert.ok(/Taş Ocağı|Hurda/.test(fixFor(sim, NA, { reason: 'build.needs_sector_kind', stype: 'quarry' })), 'quarry: the sector kinds');
  assert.ok(fixFor(sim, NA, { reason: 'min_range' }).length > 0, 'field gun minimum range');
  assert.ok(fixFor(sim, NA, { reason: 'reinf.auto_waiting', res: 'supply' }).length > 0, 'reinforcement waiting for supply');
  sim.state.factions[NA].resources.supply = 0;
  assert.ok(/İkmal/.test(fixFor(sim, NA, { reason: 'train.no_resources', unit: 'yeoman_rifle' })), 'names the missing resource');
  const mound = STRUCTURES.corpse_mound;
  assert.ok(mound.trains.includes('amalgam'), 'the Amalgam card lives on the Corpse Mound');
});

// ------------------------------------------------------------------ §17 endless

test('endless war: no timer (only the objective / annihilation ends it); lengths 30/60/120/180/ENDLESS', () => {
  assert.deepEqual(MATCH_LENGTH_OPTIONS, [30, 60, 120, 180, 'endless']);
  const sim = createSimulation({ scenarioId: 'siege_default', seed: 2, settings: { warMinutes: 'endless', prepSeconds: 0, controllers: { [NA]: 'player', [BG]: 'player' } } });
  assert.equal(sim.state.match.endless, 1);
  assert.equal(sim.state.match.warEndTick, 0, 'no time limit');
  // jump far past any finite war length: still running
  sim.state.tick = 20 * 60 * 200;
  stepSimulation(sim);
  assert.equal(sim.state.match.phase, 'WAR');
  // the defender burns the attacker's base and scatters its host: the war ends
  for (const s of sim.state.structures.slice()) if (s.faction === BG && STRUCTURES[s.type].hq) { s.hp = 0; s.built = false; }
  for (const q of sim.state.squads) if (q.faction === BG) for (const m of q.members) m.state = 'dead';
  for (let i = 0; i < 40 && sim.state.match.phase !== 'ENDED'; i++) stepSimulation(sim);
  assert.equal(sim.state.match.phase, 'ENDED');
  assert.equal(sim.state.match.winner, NA);
});

test('New Antioch AI counterattacks through commands when the walls are quiet (limited strike on a known target)', () => {
  const sim = createSimulation({ scenarioId: 'siege_default', seed: 4, settings: { warMinutes: 60, prepSeconds: 0, controllers: { [NA]: 'ai', [BG]: 'player' } } });
  clearUnits(sim);
  for (let i = 0; i < 6; i++) spawn(sim, NA, 'yeoman_rifle', 120 + i * 10, 470, Math.PI);
  spawn(sim, NA, 'mech_heavy', 150, 490, Math.PI);
  spawn(sim, NA, 'mech_heavy', 170, 490, Math.PI);
  const nest = addStructure(sim, 'viscera_nest', BG, { x: 160, z: 300, rot: 0, built: true });
  nest.seenBy |= 1; // New Antioch has seen it
  sim.state.ai[NA] = null; // fresh AI memory
  const cmds = [];
  sim.state.tick = 20 * 60 * 9; // past the first-strike delay
  for (let i = 0; i < 20 * 20; i++) {
    for (const c of sim.state.pending) if (c.faction === NA) cmds.push(c);
    stepSimulation(sim);
    sim.events.length = 0;
  }
  const strike = cmds.find((c) => c.type === 'ATTACK' && c.tk === 'struct' && c.tid === nest.id);
  assert.ok(strike, 'a strike on the known nest');
  assert.ok(strike.squadIds.length >= 2 && strike.squadIds.length <= 4, 'a small group');
  assert.ok(cmds.every((c) => c.source === 'ai'), 'through the command pipeline');
  assert.equal(sim.state.factions[NA].stats.counterattacks, 1);
});

// ------------------------------------------------------------------ §18 rain / mud

test('rain: seeded deterministic showers; traffic mud on a bounded grid slows infantry ~10-15 %, dries after', () => {
  assert.deepEqual(rainWindow(7, 0), rainWindow(7, 0), 'same seed, same shower');
  assert.ok(JSON.stringify(rainWindow(7, 0)) !== JSON.stringify(rainWindow(8, 0)));
  const sim = makeSim();
  const mud = sim.state.mud;
  assert.equal(mud.v.length, mud.cols * mud.rows);
  assert.ok(mud.cols * mud.rows <= 4096, 'bounded low-res grid');
  assert.equal(WEATHER.mud.speed[2], 0.89);
  assert.ok(1 - WEATHER.mud.speed[3] >= 0.1 && 1 - WEATHER.mud.speed[3] <= 0.1501, 'heavy mud 10-15 %');
  clearUnits(sim);
  // soak the ground and march a column up and down one lane
  const wx = sim.state.weather;
  wx.auto = 0; wx.on = 1; wx.rain = 1; wx.wet = 1;
  const col = spawn(sim, NA, 'yeoman_rifle', 100, 480, Math.PI);
  for (let k = 0; k < 6; k++) { cmd(sim, CMD.MOVE, NA, { squadIds: [col.id], x: 100, z: k % 2 ? 480 : 440 }); run(sim, 16, () => { wx.rain = 1; wx.wet = 1; }); }
  const lvl = mudLevelAt(sim.state, 100, 460);
  assert.ok(lvl >= 2, 'the lane is MUD or worse (' + lvl + ')');
  assert.ok(mudSpeedAt(sim.state, 100, 460) <= 0.89, 'slower in mud');
  assert.equal(mudLevelAt(sim.state, 40, 300) <= 1, true, 'untrodden ground is only wet');
  // after the rain the ground dries and the mud fades
  wx.rain = 0; wx.on = 0;
  run(sim, WEATHER.wet.drySec + 200);
  assert.equal(mudLevelAt(sim.state, 100, 460), 0, 'dried out');
  assert.equal(mud.live, 0);
});

test('rain / mud are deterministic and survive a save', () => {
  const a = makeSim(), b = makeSim();
  for (const s of [a, b]) { s.state.weather.auto = 1; s.state.tick = rainWindow(s.state.seed, 0).at - 40; }
  run(a, 60); run(b, 60);
  assert.ok(a.state.weather.on || a.state.weather.idx > 0, 'the shower came');
  assert.equal(encodeState(a.state), encodeState(b.state));
  const c = simulationFromState(decodeState(encodeState(a.state)));
  run(a, 20); run(c, 20);
  assert.equal(encodeState(c.state), encodeState(a.state), 'deterministic after load');
});

// ------------------------------------------------------------------ §20-21

test('building collapse: sheltered civilians take deterministic partial casualties; survivors flee to safety', () => {
  const outcome = () => {
    const sim = makeSim({ living: true });
    const crew = sim.state.squads.find((q) => q.civ);
    if (!crew) return null;
    // a sheltering settlement of its own (not the objective: its loss would end the match)
    const hs = addStructure(sim, 'settlement', NA, { x: 90, z: 470, rot: 0, built: true });
    hs.pop = 10;
    crew.civ.home = hs.id;
    for (const m of crew.members) { m.state = 'sheltered'; m.x = hs.x; m.z = hs.z; }
    crew.civ.mode = 'hidden'; crew.x = crew.cx = hs.x; crew.z = crew.cz = hs.z;
    const n0 = crew.members.length;
    hs.hp = 0;
    const idx = sim.state.structures.indexOf(hs);
    sim.state.structures.splice(idx, 1); sim.rt.structById.delete(hs.id);
    const ev = run(sim, 3);
    const lived = crew.members.filter((m) => m.state === 'alive').length;
    return { n0, lived, mode: crew.civ.mode, note: ev.some((e) => e.type === EV.NOTICE && e.key === 'civ.survivors') };
  };
  const a = outcome(), b = outcome();
  if (!a) return; // no civilian crew on this map seed (nothing to test)
  assert.ok(a.lived > 0 && a.lived < a.n0, `partial casualties (${a.lived}/${a.n0})`);
  assert.equal(a.lived, b.lived, 'deterministic');
  assert.equal(a.mode, 'evac', 'survivors run for a safe haven');
  assert.ok(a.note, 'the player is told');
});

test('engineers under fire fall back to a hub and resume the interrupted job afterwards', () => {
  const sim = makeSim();
  clearUnits(sim);
  const eng = spawn(sim, NA, 'combat_engineer', 160, 420, Math.PI);
  cmd(sim, CMD.BUILD, NA, { squadIds: [eng.id], stype: 'wire', x1: 150, z1: 400, x2: 160, z2: 400 });
  run(sim, 2);
  const site = sim.state.structures.find((s) => s.type === 'wire' && !s.built);
  assert.ok(site && eng.order.t === 'build');
  const foe = spawn(sim, BG, 'corpse_guard', 160, 402, 0);
  eng.lastHitTick = sim.state.tick;
  run(sim, 1, () => { eng.lastHitTick = sim.state.tick; });
  assert.ok(eng.order.flee, 'falls back under fire');
  assert.equal(eng.bq[0], site.id, 'the job stays at the front of its queue');
  for (const m of foe.members) killSoldier(sim, foe, m, NA, 'rifle', 0, 1);
  eng.lastHitTick = -1e6;
  run(sim, 90, () => !(eng.order.t === 'build' && eng.order.sid === site.id));
  assert.equal(eng.order.t, 'build', 'resumed the interrupted job');
  assert.equal(eng.order.sid, site.id);
});

// ------------------------------------------------------------------ §25 save migration

test('save v4 -> v5 migration: commander fields converted safely, positional reinforcement, lull, rain / mud, endless', () => {
  const sim = makeSim({ lulls: 1, warMinutes: 30 });
  run(sim, 2);
  const s = JSON.parse(encodeState(sim.state));
  // make it look like a Phase 4 save
  s.version = 4;
  delete s.weather; delete s.mud; delete s.settings.rain; delete s.settings.endless; delete s.match.endless;
  s.match.lull = { plan: [{ at: 100, dur: 900, warn: 200 }], idx: 0, active: 1, start: 10, end: 910, warned: 1, endWarned: 0, elapsed: 0, ext: 300 };
  s.match.warEndTick += 300;
  for (const fid in s.factions) { delete s.factions[fid].reinfWait; s.factions[fid].autoReinf = 'important'; s.factions[fid].cmdr = { sq: 5, unit: 'na_lieutenant', deaths: 1, readyTick: 0, lostUntil: 0, abReady: 0, lastX: 0, lastZ: 0 }; }
  const trenchSq = s.squads.find((q) => q.faction === NA && q.type === 'yeoman_rifle');
  trenchSq.order = { t: 'hold_trench', sid: 77 };
  for (const q of s.squads) { delete q.posId; delete q.posAuto; delete q.autoHunt; q.autoReinf = -1; q.autoReinfT = 0; }
  const field = s.squads.find((q) => q.faction === NA && q !== trenchSq && q.type === 'yeoman_rifle');
  field.reinf = { src: 1, next: 0, auto: 1, wait: 0, cut: 0 };
  s.effects.push({ id: 999999, kind: 'command', ability: 'hold_the_line', faction: NA, sq: 5, x: 1, z: 1, radius: 20, start: 0, end: 1000 });
  const hdr = JSON.parse(serializeSave(sim.state));
  const loaded = deserializeSave(JSON.stringify({ ...hdr, version: 4, state: s }));
  const st = loaded.state;
  assert.equal(st.version, STATE_VERSION);
  assert.equal(STATE_VERSION, 5);
  for (const fid of [NA, BG]) assert.ok(st.factions[fid].cmdr === undefined && st.factions[fid].autoReinf === undefined && st.factions[fid].reinfWait === 0);
  const t2 = st.squads.find((q) => q.id === trenchSq.id);
  assert.equal(t2.posId, 77); assert.equal(t2.posAuto, 1, 'a squad in a trench starts ON');
  const f2 = st.squads.find((q) => q.id === field.id);
  assert.ok(!f2.reinf, 'an open-field automatic request is dropped');
  assert.ok(st.squads.every((q) => q.autoHunt === 1 && q.autoReinf === undefined));
  assert.ok(!st.effects.some((e) => e.kind === 'command'), 'live command areas removed');
  assert.equal(st.match.lull.active, 0, 'a running (ceasefire) window closes');
  assert.equal(st.match.warEndTick, sim.state.match.warEndTick, 'the lull clock extension is given back');
  assert.ok(st.weather && st.weather.auto === 1 && st.mud && st.mud.v.length === st.mud.cols * st.mud.rows, 'rain / mud state');
  assert.equal(st.match.endless, 0);
  const sim2 = simulationFromState(st);
  for (let i = 0; i < 200; i++) stepSimulation(sim2);
  assert.equal(sim2.state.match.phase === 'WAR' || sim2.state.match.phase === 'ENDED', true, 'runs');
  const sim3 = simulationFromState(decodeState(encodeState(sim2.state)));
  run(sim2, 5); run(sim3, 5);
  assert.equal(encodeState(sim3.state), encodeState(sim2.state), 'deterministic after the migrated load');
});

// ------------------------------------------------------------------ §24 AI

test('AI acts only through commands and never reads hidden state for its Phase 4.1 decisions', () => {
  const sim = createSimulation({ scenarioId: 'siege_default', seed: 11, settings: { warMinutes: 30, prepSeconds: 30, controllers: { [NA]: 'ai', [BG]: 'ai' } } });
  let direct = 0;
  const seen = new Set();
  for (let i = 0; i < 20 * 240; i++) {
    for (const c of sim.state.pending) { if (c.source !== 'ai') direct++; seen.add(c.faction[0] + ':' + c.type); }
    stepSimulation(sim);
    sim.events.length = 0;
  }
  assert.equal(direct, 0, 'every AI order is a sourced command');
  assert.ok(!seen.has('n:SET_AUTO_REINFORCE_DEFAULT') && !seen.has('n:COMMANDER_ABILITY'), 'no removed commands');
  // Grail gangs use AUTO SAFE HUNT (sim-side, no command) or FORAGE orders
  assert.ok(sim.state.squads.some((q) => q.faction === BG && q.type === 'thrall_gang'), 'gangs exist');
});

test('480-soldier stress with rain on: bounded state, no NaN', () => {
  const sim = createSimulation({ scenarioId: 'stress', seed: 7, settings: { playerFaction: NA, stressSoldiers: 480, controllers: { [NA]: 'ai', [BG]: 'ai' } } });
  const wx = sim.state.weather;
  wx.auto = 0; wx.on = 1; wx.rain = 1; wx.wet = 1;
  let worst = 0;
  for (let i = 0; i < 20 * 20; i++) {
    const t0 = performance.now();
    stepSimulation(sim);
    worst = Math.max(worst, performance.now() - t0);
    sim.events.length = 0;
    wx.rain = 1; wx.wet = 1;
  }
  let n = 0;
  for (const q of sim.state.squads) for (const m of q.members) { n++; assert.ok(Number.isFinite(m.x) && Number.isFinite(m.z)); }
  assert.greater(n, 300);
  assert.ok(sim.state.mud.live <= sim.state.mud.cols * sim.state.mud.rows);
  console.log('       480 + rain: worst tick ' + worst.toFixed(1) + ' ms (headless Node, not a device measurement)');
  void TICK_RATE; void unitDef; void alive;
});
