// Phase 4 regression tests (brief §61): walking replacements counted only on arrival, auto
// reinforcement, control groups, multi-select UX state, operational lulls (timing, transitions,
// AI), ruin garrisons, field gun, commanders, Black Grail defences, salvage, fog, save v3 -> v4.
import { test, assert } from './harness.js';
import { enqueueCommand, CMD } from '../src/sim/commands.js';
import { EV } from '../src/core/events.js';
import { createSimulation, stepSimulation } from '../src/sim/simulation.js';
import { killSoldier } from '../src/combat/combat.js';
import { squadCounts } from '../src/sim/squad_stats.js';
import { FACTIONS } from '../src/data/factions.js';
import { UNITS } from '../src/data/units.js';
import { LULL } from '../src/data/scenarios.js';
import { planLulls, isLull, warTicks } from '../src/sim/lull.js';
import { matchProgress } from '../src/sim/specialities.js';
import { createControlGroups, DOUBLE_TAP_MS } from '../src/input/control_groups.js';
import { createSelection, multiSelectView } from '../src/input/selection.js';
import { pickNodeAt, pickNode, NODE_PICK } from '../src/input/pick.js';
import { createCamera, updateCamera, projectToScreen } from '../src/render/camera.js';
import { groundHeightAt } from '../src/world/ground.js';
import { updateVision, eventVisibility, effectVisibleTo, SHOW } from '../src/sim/perception.js';
import { builderStatus } from '../src/units/engineers.js';
import { garrisonGeom, garrisonedCount, garrisonCanFire } from '../src/units/garrison.js';
import { protectionAgainst } from '../src/combat/cover.js';
import { COVER_INDEX } from '../src/data/cover.js';
import { damageStructure, damageSoldier } from '../src/combat/combat.js';
import { garrisonPanelData } from '../src/ui/trench_panel.js';
import { findPath } from '../src/world/nav.js';
import { EMPLACEMENT_WEAPONS } from '../src/data/emplacements.js';
import { ABILITIES } from '../src/data/abilities.js';
import { STRUCTURES } from '../src/data/structures.js';
import { addStructure } from './helpers.js';
import { commanderSquad, commanderView } from '../src/sim/commander.js';
import { encodeState, decodeState, serializeSave, deserializeSave } from '../src/save/codec.js';
import { STATE_VERSION } from '../src/sim/constants.js';
import { simulationFromState } from '../src/sim/simulation.js';
import { abilityCooldown } from '../src/sim/abilities.js';
import { ICONS } from '../src/ui/icons.js';
import { TR_P4, EN_P4 } from '../src/ui/i18n_p4.js';
import { trenchPanelData } from '../src/ui/trench_panel.js';
import { networkCapacity, trenchNetwork } from '../src/construction/trench.js';
import { makeSim, clearUnits, spawn, run, alive } from './helpers.js';

const NA = 'new_antioch';
const BG = 'black_grail';

function cmd(sim, type, faction, fields) {
  enqueueCommand(sim, { type, faction, ...fields });
}

function structs(sim, type, faction) {
  return sim.state.structures.filter((s) => s.type === type && s.faction === faction);
}

// ------------------------------------------------------------------ §6-8 reinforcement

test('joining replacement is excluded from squad HP, alive count, strength and trench posts until it arrives', () => {
  const sim = makeSim();
  clearUnits(sim);
  const sq = spawn(sim, NA, 'yeoman_rifle', 160, 470, Math.PI);
  for (let i = 0; i < 2; i++) killSoldier(sim, sq, sq.members[i], BG, 'rifle', 0, 1);
  run(sim, 3);
  const before = squadCounts(sq);
  assert.equal(before.alive, 6);
  sq.lastHitTick = -100000;
  cmd(sim, CMD.REINFORCE, NA, { squadIds: [sq.id] });
  let saw = false;
  const ev = run(sim, 60, () => {
    const c = squadCounts(sq);
    if (c.joining > 0) {
      saw = true;
      // en route: in the world, but not in the squad's numbers
      assert.equal(c.alive + c.joining, sq.members.filter((m) => m.state === 'alive' || m.state === 'joining').length);
      for (const m of sq.members) if (m.state === 'joining') assert.equal(m.postId, 0, 'no trench post while walking');
    }
    return c.alive < 8;
  });
  assert.ok(saw, 'replacements were seen walking');
  const joined = ev.filter((e) => e.type === EV.REINFORCEMENT_JOINED && e.squadId === sq.id);
  assert.equal(joined.length, 2, 'one JOIN event per arrival');
  assert.equal(squadCounts(sq).alive, 8, 'counted after joining');
  assert.equal(squadCounts(sq).joining, 0);
});

test('reinforcement join event: deterministic arrival, counted HP only after it', () => {
  const runOnce = () => {
    const sim = makeSim({ seed: 42 });
    clearUnits(sim);
    const sq = spawn(sim, NA, 'yeoman_rifle', 150, 440, Math.PI);
    killSoldier(sim, sq, sq.members[0], BG, 'rifle', 0, 1);
    run(sim, 3);
    sq.lastHitTick = -100000;
    cmd(sim, CMD.REINFORCE, NA, { squadIds: [sq.id] });
    let joinTick = -1, hpBefore = 0;
    run(sim, 90, (s) => {
      for (const e of s.events) if (e.type === EV.REINFORCEMENT_JOINED) { joinTick = s.state.tick; return false; }
      hpBefore = squadCounts(sq).hp;
      return true;
    });
    return { joinTick, hpBefore, hpAfter: squadCounts(sq).hp };
  };
  const a = runOnce(), b = runOnce();
  assert.ok(a.joinTick > 0, 'joined');
  assert.equal(a.joinTick, b.joinTick, 'same tick in identical runs');
  assert.greater(a.hpAfter, a.hpBefore, 'HP grows only when the man arrives');
});

test('trench panel and HUD data show "+N en route" separately', () => {
  const sim = makeSim();
  clearUnits(sim);
  const seg = structs(sim, 'trench', NA)[1];
  const sq = spawn(sim, NA, 'yeoman_rifle', seg.x, seg.z + 4, Math.PI);
  cmd(sim, CMD.ENTER_TRENCH, NA, { squadIds: [sq.id], sid: seg.id });
  run(sim, 12);
  killSoldier(sim, sq, sq.members[0], BG, 'rifle', 0, 1);
  run(sim, 3);
  sq.lastHitTick = -100000;
  cmd(sim, CMD.REINFORCE, NA, { squadIds: [sq.id] });
  let seen = false;
  run(sim, 40, () => {
    const d = trenchPanelData(sim, NA, seg.id);
    const card = d && d.cards.find((c) => c.id === sq.id);
    if (card && card.enRoute > 0) {
      seen = true;
      assert.equal(card.alive, 7);
      const cap = networkCapacity(sim.state, trenchNetwork(sim.state.structures, seg, NA), NA, null);
      assert.ok(cap.used <= 7, 'the walking man holds no trench slot');
      return false;
    }
    return true;
  });
  assert.ok(seen);
});

test('auto reinforcement: squad override and faction default request replacements without spam', () => {
  const sim = makeSim();
  clearUnits(sim);
  const f = sim.state.factions[NA];
  f.resources.manpower = 50; f.resources.supply = 500;
  const a = spawn(sim, NA, 'yeoman_rifle', 150, 420, Math.PI); // far from every source, not in a trench
  const b = spawn(sim, NA, 'yeoman_rifle', 180, 420, Math.PI);
  for (const sq of [a, b]) for (let i = 0; i < 3; i++) killSoldier(sim, sq, sq.members[i], BG, 'rifle', 0, 1);
  run(sim, 3);
  a.lastHitTick = b.lastHitTick = -100000;
  const size = UNITS.yeoman_rifle.squadSize;
  const requested = (sq) => !!sq.reinf || sq.members.length >= size; // request open, or every man already dispatched
  run(sim, 5);
  assert.ok(!requested(a) && !requested(b), 'default off: no automatic request out in the field');
  cmd(sim, CMD.SET_AUTO_REINFORCE, NA, { squadIds: [a.id], on: 1 });
  run(sim, 5);
  assert.ok(requested(a), 'squad override on -> request');
  assert.ok(!requested(b));
  const t0 = a.autoReinfT;
  cmd(sim, CMD.SET_AUTO_REINFORCE, NA, { squadIds: [b.id], on: 0 });
  cmd(sim, CMD.SET_AUTO_REINFORCE_DEFAULT, NA, { mode: 'all' });
  run(sim, 30);
  assert.ok(!requested(b), 'squad override off wins over the default ALL');
  cmd(sim, CMD.SET_AUTO_REINFORCE, NA, { squadIds: [b.id], on: -1 });
  run(sim, 5);
  assert.ok(requested(b), 'following the default ALL -> request');
  assert.equal(a.autoReinfT, t0, 'no repeated request for a squad already topped up (no spam)');
  cmd(sim, CMD.SET_AUTO_REINFORCE_DEFAULT, BG, { mode: 'all' });
  const ev = run(sim, 0.2);
  assert.ok(ev.some((e) => e.type === EV.COMMAND_REJECTED && e.faction === BG), 'the Grail has no walking replacements');
});

// ------------------------------------------------------------------ §9-12 control groups

function fakeSimWithSquads() {
  const sim = makeSim();
  clearUnits(sim);
  const s1 = spawn(sim, NA, 'yeoman_rifle', 150, 470);
  const s2 = spawn(sim, NA, 'combat_engineer', 160, 470);
  const e1 = spawn(sim, BG, 'grail_thrall', 160, 200);
  return { sim, s1, s2, e1 };
}

test('control groups: save / select / double tap focus; only own squads; plain serializable', () => {
  const { sim, s1, s2, e1 } = fakeSimWithSquads();
  const cg = createControlGroups();
  assert.equal(cg.save(0, [s1.id, s2.id, e1.id, 99999], sim, NA), 2, 'enemy / unknown ids are not stored');
  assert.deepEqual(cg.ids(0, sim, NA), [s1.id, s2.id].sort((a, b) => a - b));
  assert.equal(cg.tap(0, 1000), 'select');
  assert.equal(cg.tap(0, 1000 + DOUBLE_TAP_MS - 10), 'focus', 'second tap in time = camera focus');
  assert.equal(cg.tap(0, 5000), 'select');
  assert.equal(cg.tap(1, 5000), 'empty');
  const c = cg.center(0, sim, NA);
  assert.ok(Math.abs(c[0] - 155) < 6 && Math.abs(c[1] - 470) < 6, 'centre of the group');
  const json = JSON.parse(JSON.stringify(cg.export()));
  const cg2 = createControlGroups();
  cg2.restore(json);
  assert.deepEqual(cg2.ids(0, sim, NA), cg.ids(0, sim, NA), 'survives a save (meta) round trip');
  assert.equal(cg.summary(0, sim, NA).count, 2);
});

test('control groups: dead units drop out; an emptied slot clears', () => {
  const { sim, s1, s2 } = fakeSimWithSquads();
  const cg = createControlGroups();
  cg.save(2, [s1.id, s2.id], sim, NA);
  for (const m of s1.members) killSoldier(sim, s1, m, BG, 'rifle', 0, 1);
  run(sim, 3);
  cg.prune(sim, NA);
  assert.deepEqual(cg.ids(2, sim, NA), [s2.id]);
  for (const m of s2.members) killSoldier(sim, s2, m, BG, 'rifle', 0, 1);
  run(sim, 3);
  assert.equal(cg.ids(2, sim, NA).length, 0);
  assert.equal(cg.tap(2, 100), 'empty');
});

// ------------------------------------------------------------------ §17-23 operational lull

test('multi-select UX: OFF = tap replaces, ON = tap adds / removes; labelled ON state; icon is not a copy glyph', () => {
  const sel = createSelection();
  sel.tapOwn(1, false); sel.tapOwn(2, false);
  assert.equal([...sel.squads].join(','), '2', 'normal tap replaces');
  sel.tapOwn(3, true); sel.tapOwn(4, true);
  assert.equal([...sel.squads].sort().join(','), '2,3,4', 'multi tap adds');
  sel.tapOwn(3, true);
  assert.equal([...sel.squads].sort().join(','), '2,4', 'multi tap on a selected squad removes it');
  sel.applyBox([], true, true);
  assert.equal(sel.squads.size, 2, 'an empty drag in multi mode keeps the selection');
  sel.applyBox([], false, false);
  assert.equal(sel.squads.size, 0, 'an empty drag outside multi mode clears');
  const off = multiSelectView(false), on = multiSelectView(true);
  assert.equal(off.on, false); assert.equal(on.on, true);
  assert.equal(on.labelKey, 'hud.multi_on');
  assert.ok(TR_P4['hud.multi_short'] && TR_P4['hud.multi_on'] && EN_P4['hud.multi_on'], 'labels in both languages');
  assert.ok(/Çoklu/i.test(TR_P4['hud.multi_short'] + TR_P4['hud.multi_tip']), 'Turkish label says Çoklu Seçim');
  assert.ok(ICONS.multi && !/<rect[^>]*>\s*<rect/.test(ICONS.multi), 'no two-overlapping-sheets copy glyph');
});

test('operational lull: seeded deterministic timing inside its windows, hidden plan, 45-60 s', () => {
  const p1 = planLulls(1234, 30, 'auto'), p2 = planLulls(1234, 30, 'auto'), p3 = planLulls(9, 30, 'auto');
  assert.deepEqual(p1, p2, 'same seed, same plan');
  assert.ok(JSON.stringify(p1) !== JSON.stringify(p3), 'another seed, another plan');
  assert.equal(p1.length, 2);
  const war = 30 * 60 * 20;
  assert.ok(p1[0].at >= war * 0.25 && p1[0].at <= war * 0.4 && p1[1].at >= war * 0.55 && p1[1].at <= war * 0.75);
  for (const l of p1) {
    assert.ok(l.dur >= 45 * 20 && l.dur <= 60 * 20, 'duration ' + l.dur);
    assert.ok(l.warn >= 8 * 20 && l.warn <= 12 * 20);
  }
  assert.equal(planLulls(1, 15, 0).length, 0, 'OFF');
  assert.equal(planLulls(1, 5, 'auto').length, 0, 'no lull in the shortest wars');
  assert.equal(planLulls(1, 15, 2).length, 2);
});

test('lull phase transitions: warning -> LULL -> WAR; war clock frozen; attacks refused; building works', () => {
  const sim = makeSim({ lulls: 1, warMinutes: 15 });
  clearUnits(sim);
  const l = sim.state.match.lull;
  const plan = l.plan[0];
  const warEnd0 = sim.state.match.warEndTick;
  const sq = spawn(sim, NA, 'yeoman_rifle', 160, 470, Math.PI);
  const eng = spawn(sim, NA, 'combat_engineer', 150, 480, Math.PI);
  const enemy = spawn(sim, BG, 'grail_thrall', 160, 150, 0);
  const evs = [];
  run(sim, (plan.at + 40) / 20, (s) => { for (const e of s.events) evs.push(e); return !isLull(s.state); });
  assert.ok(evs.some((e) => e.type === EV.PHASE_WARNING && e.phase === 'LULL'), 'warning first');
  assert.ok(isLull(sim.state), 'lull started');
  const p0 = matchProgress(sim.state);
  assert.equal(sim.state.match.warEndTick, warEnd0 + plan.dur, 'war clock extended by the lull');
  cmd(sim, CMD.ATTACK, BG, { squadIds: [enemy.id], tk: 'squad', tid: sq.id });
  cmd(sim, CMD.MOVE, NA, { squadIds: [sq.id], x: 160, z: 300, attackMove: true });
  cmd(sim, CMD.BUILD, NA, { squadIds: [eng.id], stype: 'wire', x1: 140, z1: 452, x2: 150, z2: 452 });
  const ev = run(sim, 1);
  const refused = ev.filter((e) => e.type === EV.COMMAND_REJECTED && e.reason === 'lull.no_attack');
  assert.equal(refused.length, 2, 'attack + attack-move refused');
  assert.ok(!ev.some((e) => e.type === EV.COMMAND_REJECTED && e.cmd === 'BUILD'), 'building allowed');
  run(sim, 20);
  assert.approx(matchProgress(sim.state), p0, 1e-9, 'progress frozen during the lull');
  const rest = run(sim, plan.dur / 20);
  assert.ok(rest.some((e) => e.type === EV.PHASE_WARNING && e.phase === 'WAR'));
  assert.ok(rest.some((e) => e.type === EV.PHASE_CHANGED && e.phase === 'WAR' && e.afterLull === 1));
  assert.ok(!isLull(sim.state));
  assert.equal(warTicks(sim.state), sim.state.tick - sim.state.match.prepEndTick - plan.dur, 'war time excludes the lull');
});

test('lull exploit guard: troops left inside the enemy lines are still shot; no new fights in no man\'s land', () => {
  const sim = makeSim({ lulls: 1 });
  clearUnits(sim);
  const plan = sim.state.match.lull.plan[0];
  // a Grail pack inside New Antioch's zone and a pair of squads facing off in no man's land
  const intruder = spawn(sim, BG, 'grail_thrall', 160, 452, 0);
  const defender = spawn(sim, NA, 'yeoman_rifle', 160, 470, Math.PI);
  const a = spawn(sim, NA, 'yeoman_rifle', 60, 290, Math.PI);
  const b = spawn(sim, BG, 'grail_thrall', 60, 262, 0);
  intruder.order = { t: 'idle' }; b.order = { t: 'idle' };
  sim.state.match.lull.plan[0].at = 0; // start the lull right away
  run(sim, LULL.graceSec + 2);
  assert.ok(isLull(sim.state));
  const aliveInt = alive(intruder), aliveA = alive(a), aliveB = alive(b);
  let nmlFire = 0;
  run(sim, 10, (s) => {
    for (const e of s.events) if ((e.type === 'FIRE' || e.type === 'MELEE') && (e.sq === a.id || e.sq === b.id)) nmlFire++;
    return true;
  });
  assert.less(alive(intruder), aliveInt, 'intruder inside the lines keeps taking fire');
  assert.equal(nmlFire, 0, 'no new engagement off both sides\' ground');
  assert.equal(alive(a), aliveA); assert.equal(alive(b), aliveB);
  void defender; void plan;
});

test('lull AI: the Grail pulls its waves back to form up; New Antioch repairs / reinforces, no fire missions', () => {
  const sim = createSimulation({ scenarioId: 'siege_default', seed: 5, settings: { warMinutes: 15, lulls: 1, controllers: { [NA]: 'ai', [BG]: 'ai' } } });
  const plan = sim.state.match.lull.plan[0];
  const target = sim.state.match.prepEndTick + plan.at + 20 * 20;
  const cmds = [];
  while (sim.state.tick < target) {
    for (const c of sim.state.pending) if (isLull(sim.state)) cmds.push(c);
    stepSimulation(sim);
    sim.events.length = 0;
  }
  assert.ok(isLull(sim.state));
  const ai = sim.state.ai[BG];
  assert.ok(ai.groups.filter((g) => g.squadIds.length).every((g) => g.mode === 'forming'), 'every wave forms up');
  assert.ok(!cmds.some((c) => c.type === 'ATTACK' || (c.type === 'MOVE' && c.attackMove) || (c.type === 'USE_ABILITY' && c.ability !== 'purge')), 'no attack orders while the front is quiet');
});

// ------------------------------------------------------------------ §13-16 resources / salvage

test('mobile resource pick: a finger a few metres off (or on the heap\'s screen image) still hits the heap; a mouse does not', () => {
  const sim = makeSim();
  const n = sim.state.nodes[0];
  n.seenBy |= 1; // discovered by New Antioch
  const ground = (x, z) => groundHeightAt(sim.world, sim.rt.structGrid, x, z);
  const cam = createCamera({ x: n.x, z: n.z + 10, dist: 70 });
  cam.groundFn = ground;
  updateCamera(cam, 1280, 720, 0);
  const off = 6.5; // metres beside the heap: outside the old 4.5 m / mouse radius
  assert.ok(!pickNode(sim, 'new_antioch', n.x + off, n.z), 'old world radius misses');
  const P = [0, 0, 0, 0];
  projectToScreen(cam, n.x + off, ground(n.x + off, n.z), n.z, P);
  assert.equal(pickNodeAt(sim, 'new_antioch', cam, ground, P[0], P[1], n.x + off, n.z, true, 1, false), n, 'finger hits');
  const Q = [0, 0, 0, 0];
  projectToScreen(cam, n.x, ground(n.x, n.z) + 0.8, n.z, Q);
  const px = Math.hypot(P[0] - Q[0], P[1] - Q[1]);
  if (px > NODE_PICK.mousePx) assert.ok(!pickNodeAt(sim, 'new_antioch', cam, ground, P[0], P[1], n.x + off, n.z, false, 1, false), 'mouse stays precise (' + px.toFixed(0) + ' px off)');
  assert.greater(NODE_PICK.touchM, NODE_PICK.mouseM * 1.5);
  assert.greater(NODE_PICK.touchPx, NODE_PICK.mousePx * 1.8);
  // screen fallback: tap on the heap image even when the ground ray lands far behind it
  projectToScreen(cam, n.x, ground(n.x, n.z) + 0.8, n.z, P);
  assert.equal(pickNodeAt(sim, 'new_antioch', cam, ground, P[0] + 20, P[1] - 10, n.x, n.z + 30, true), n, 'screen-space pick');
  // fog: an undiscovered heap can never be picked
  n.seenBy = 0;
  assert.ok(!pickNodeAt(sim, 'new_antioch', cam, ground, P[0], P[1], n.x, n.z, true), 'undiscovered heap not pickable');
});

test('SALVAGE AREA: engineers strip every known heap in the area, then return to a hub; nearest free engineer auto-dispatched', () => {
  const sim = makeSim();
  clearUnits(sim);
  const nodes = sim.state.nodes.slice().sort((a, b) => a.id - b.id);
  const n0 = nodes[0];
  const inArea = nodes.filter((n) => Math.hypot(n.x - n0.x, n.z - n0.z) <= 40);
  for (const n of nodes) { n.seenBy |= 1; }
  for (const n of inArea) n.amount = 12; // small heaps so the test runs quickly
  const eng = spawn(sim, NA, 'combat_engineer', n0.x + 8, n0.z + 8, Math.PI);
  eng.order = { t: 'idle', ready: 1 };
  // no selection: the nearest free engineer is dispatched
  cmd(sim, CMD.SALVAGE_AREA, NA, { x: n0.x, z: n0.z });
  run(sim, 0.2);
  assert.equal(eng.order.t, 'gather');
  assert.equal(eng.order.area, 1);
  assert.equal(builderStatus(sim, eng), 'salvaging', 'engineer strip says Salvage');
  const mat0 = sim.state.factions[NA].resources.material;
  run(sim, 400, () => !inArea.every((n) => n.amount <= 0.001) || eng.order.t === 'gather');
  assert.ok(inArea.every((n) => n.amount <= 0.001), 'every heap in the area stripped (' + inArea.map((n) => n.amount.toFixed(1)).join(',') + ')');
  assert.greater(sim.state.factions[NA].resources.material, mat0 + inArea.length * 12 * 0.9, 'material delivered');
  run(sim, 60, () => eng.order.t !== 'idle');
  assert.notEqual(eng.order.t, 'gather', 'crew left the empty area');
  // an area with nothing known is refused
  cmd(sim, CMD.SALVAGE_AREA, NA, { x: 5, z: 5 });
  const evs = run(sim, 0.1);
  assert.ok(evs.some((e) => e.type === EV.COMMAND_REJECTED && e.reason === 'salvage.none'), 'refused: nothing known there');
});

// ------------------------------------------------------------------ §24-29 ruin garrisons

function ruins(sim) {
  return sim.state.structures.filter((s) => s.type === 'ruin_house' || s.type === 'ruin_chapel');
}

function garrisonInto(sim, sq, st, sec = 45) {
  cmd(sim, CMD.GARRISON, sq.faction, { squadIds: [sq.id], sid: st.id });
  const n = alive(sq);
  run(sim, sec, () => !(sq.order.t === 'garrison' && sq.order.phase === 'inside' && garrisonedCount(sim, sq) >= n));
  return garrisonedCount(sim, sq);
}

test('ruin garrisons exist for every house / chapel ruin; doorways are open on the nav grid; every slot is reachable from outside', () => {
  const sim = makeSim();
  const list = ruins(sim);
  assert.equal(list.length, sim.world.ruins.filter((r) => r.kind !== 'wall').length);
  const nav = sim.rt.nav;
  for (const st of list) {
    const g = garrisonGeom(sim, st);
    assert.ok(g.entrances.length >= 1 && g.slots.length >= 8, st.type + ' has entrances and slots (' + g.slots.length + ')');
    assert.ok(g.slots.filter((x) => x.fire).length >= 4, 'firing slots');
    if (st.type === 'ruin_chapel') { assert.equal(g.cap, 2); assert.equal(g.entrances.length, 2, 'chapel: front + back door'); }
    for (const e of g.entrances) {
      const p = findPath(nav, 'new_antioch', e.ox, e.oz, e.ix, e.iz);
      assert.ok(p && p.reached, 'path through the doorway of ruin ' + st.ruin);
    }
  }
});

test('ruin garrison routing: squads enter through the nearest doorway and reach their slots (no squad stuck at a wall)', () => {
  const sim = makeSim();
  clearUnits(sim);
  let worst = 0;
  for (const st of ruins(sim)) {
    const g = garrisonGeom(sim, st);
    const e = g.entrances[0];
    // start 25 m out, on the far side of the ruin from the door (has to walk around the walls)
    const dx = g.r.x - e.ox, dz = g.r.z - e.oz, dl = Math.hypot(dx, dz);
    const sq = spawn(sim, NA, 'yeoman_rifle', g.r.x + dx / dl * 20, g.r.z + dz / dl * 20, 0);
    const t0 = sim.state.tick;
    const inside = garrisonInto(sim, sq, st, 60);
    assert.equal(inside, alive(sq), 'all ' + alive(sq) + ' men inside ruin ' + st.ruin + ' (got ' + inside + ')');
    run(sim, 4);
    for (const m of sq.members) if (m.gslot >= 0 && m.gslot < g.slots.length) {
      const sl = g.slots[m.gslot];
      assert.less(Math.hypot(m.x - sl.x, m.z - sl.z), 0.8, 'at his slot in ruin ' + st.ruin);
    }
    worst = Math.max(worst, (sim.state.tick - t0) / 20);
    cmd(sim, CMD.UNGARRISON, NA, { squadIds: [sq.id] });
    run(sim, 25, () => sq.order.t !== 'idle');
    assert.equal(garrisonedCount(sim, sq), 0, 'left ruin ' + st.ruin);
    for (const m of sq.members) assert.ok(!m.gexit && m.gslot === -1, 'every man walked out');
    sim.state.squads.splice(sim.state.squads.indexOf(sq), 1); sim.rt.squadById.delete(sq.id);
  }
  assert.less(worst, 60, 'slowest garrison ' + worst.toFixed(1) + ' s');
});

test('ruin garrison capacity: a house takes one squad, the chapel two; one side at a time', () => {
  const sim = makeSim();
  clearUnits(sim);
  const house = ruins(sim).find((s) => s.type === 'ruin_house' && garrisonGeom(sim, s).cap === 1);
  const g = garrisonGeom(sim, house);
  const a = spawn(sim, NA, 'yeoman_rifle', g.entrances[0].ox, g.entrances[0].oz + 4, 0);
  const b = spawn(sim, NA, 'yeoman_rifle', g.entrances[0].ox + 5, g.entrances[0].oz + 5, 0);
  cmd(sim, CMD.GARRISON, NA, { squadIds: [a.id, b.id], sid: house.id });
  run(sim, 30);
  assert.equal(house.occ.length, 1, 'one squad inside');
  assert.equal(house.holder, NA);
  const out = [a, b].find((q) => house.occ.indexOf(q.id) < 0);
  assert.notEqual(out.order.t, 'garrison', 'the second squad was not let in');
  const chapel = ruins(sim).find((s) => s.type === 'ruin_chapel');
  const gc = garrisonGeom(sim, chapel);
  const sqs = [0, 1, 2].map((i) => spawn(sim, NA, 'yeoman_rifle', gc.entrances[0].ox + i * 5 - 5, gc.entrances[0].oz + 4, 0));
  cmd(sim, CMD.GARRISON, NA, { squadIds: sqs.map((q) => q.id), sid: chapel.id });
  run(sim, 40);
  assert.equal(chapel.occ.length, 2, 'two squads in the chapel');
  const used = new Set();
  for (const id of chapel.occ) for (const m of sim.rt.squadById.get(id).members) if (m.gslot >= 0) { assert.ok(!used.has(m.gslot), 'no shared slot'); used.add(m.gslot); }
  // an enemy squad cannot move into a held ruin
  const bg = spawn(sim, BG, 'corpse_guard', gc.entrances[1].ox, gc.entrances[1].oz - 3, 0);
  cmd(sim, CMD.GARRISON, BG, { squadIds: [bg.id], sid: chapel.id });
  run(sim, 20);
  assert.equal(chapel.occ.filter((id) => sim.rt.squadById.get(id).faction === BG).length, 0, 'enemy kept out');
});

test('ruin garrison firing and cover: loophole slots shoot, sheltered slots do not; high cover vs rifles, halved vs heavy MG', () => {
  const sim = makeSim();
  clearUnits(sim);
  const st = ruins(sim).find((s) => s.type === 'ruin_house');
  const g = garrisonGeom(sim, st);
  const sq = spawn(sim, NA, 'yeoman_rifle', g.entrances[0].ox, g.entrances[0].oz + 3, 0);
  garrisonInto(sim, sq, st);
  const m = sq.members.find((x) => x.gslot >= 0 && g.slots[x.gslot].fire);
  const shelt = sq.members.find((x) => x.gslot >= 0 && x.gslot < g.slots.length && !g.slots[x.gslot].fire);
  assert.ok(m && garrisonCanFire(sim, sq, m), 'a loophole soldier can fire');
  if (shelt) assert.ok(!garrisonCanFire(sim, sq, shelt), 'a sheltered soldier cannot');
  const P = { dmg: 0, acc: 0, cover: 0 };
  protectionAgainst(sim, m.x, m.z, g.r.x + 40, g.r.z + 40, P);
  assert.equal(P.cover, COVER_INDEX.garrison);
  assert.greater(P.dmg, 0.45, 'high cover (' + P.dmg.toFixed(2) + ')');
  // a firefight: the garrison actually shoots out of the ruin
  const foe = spawn(sim, BG, 'corpse_guard', g.r.x, g.r.z - 30, 0);
  const shooters = new Set();
  run(sim, 12, (s) => { for (const e of s.events) if (e.type === EV.FIRE && e.sq === sq.id) shooters.add(e.shooter); });
  assert.greater(shooters.size, 0, 'garrison fires');
  for (const id of shooters) { const x = sq.members.find((q) => q.id === id); if (x && x.gslot >= 0 && x.gslot < g.slots.length) assert.ok(g.slots[x.gslot].fire, 'only loophole slots fire'); }
  void foe;
});

test('ruin collapse: garrison takes casualties, survivors suppressed and thrown out; the ruin is rubble (no garrison)', () => {
  const sim = makeSim();
  clearUnits(sim);
  const st = ruins(sim).find((s) => s.type === 'ruin_chapel');
  const g = garrisonGeom(sim, st);
  const sq = spawn(sim, NA, 'yeoman_rifle', g.entrances[0].ox, g.entrances[0].oz + 3, 0);
  garrisonInto(sim, sq, st);
  const before = alive(sq);
  let ev = null;
  damageStructure(sim, st, st.hp + 10, BG);
  ev = sim.events.find((e) => e.type === EV.RUIN_COLLAPSED);
  assert.ok(ev, 'collapse event');
  assert.equal(st.collapsed, 1);
  assert.ok(sim.state.structures.indexOf(st) >= 0, 'the ruin stays (rubble)');
  run(sim, 1);
  assert.greater(before - alive(sq), 0, 'casualties (' + (before - alive(sq)) + ' of ' + before + ')');
  assert.less(before - alive(sq), before, 'not everyone dies');
  assert.greater(sq.suppressUntil, sim.state.tick, 'survivors suppressed');
  assert.notEqual(sq.order.t, 'garrison');
  cmd(sim, CMD.GARRISON, NA, { squadIds: [sq.id], sid: st.id });
  const evs = run(sim, 0.2);
  assert.ok(evs.some((e) => e.type === EV.COMMAND_REJECTED && e.reason === 'garrison.collapsed'), 'no garrison in rubble');
  // deterministic: the same collapse kills the same men
  const sim2 = makeSim(); clearUnits(sim2);
  const st2 = ruins(sim2).find((s) => s.type === 'ruin_chapel');
  const sq2 = spawn(sim2, NA, 'yeoman_rifle', g.entrances[0].ox, g.entrances[0].oz + 3, 0);
  garrisonInto(sim2, sq2, st2);
  damageStructure(sim2, st2, st2.hp + 10, BG);
  run(sim2, 1);
  assert.equal(alive(sq2), alive(sq), 'deterministic casualties');
});

test('ruin garrison fog: a hidden enemy garrison looks exactly like an empty ruin; shells batter the walls either way', () => {
  const sim = makeSim();
  clearUnits(sim);
  const [a, b] = ruins(sim).filter((s) => s.type === 'ruin_house');
  const ga = garrisonGeom(sim, a);
  const sq = spawn(sim, NA, 'yeoman_rifle', ga.entrances[0].ox, ga.entrances[0].oz + 3, 0);
  garrisonInto(sim, sq, a);
  updateVision(sim);
  assert.ok(!(sq.visibleTo & (1 << FACTIONS[BG].index)), 'precondition: hidden from the Grail');
  const pa = garrisonPanelData(sim, BG, a), pb = garrisonPanelData(sim, BG, b);
  const strip = (p) => JSON.stringify({ ...p, segId: 0, total: 0, hp: 0 });
  assert.equal(strip(pa), strip(pb), 'enemy view: held == empty');
  assert.equal(pa.used, -1);
  const own = garrisonPanelData(sim, NA, a);
  assert.equal(own.used, 1, 'own view shows the squad');
  // walls take shell damage whether or not anyone is inside (hp is no tell)
  const hpA = a.hp, hpB = b.hp;
  damageStructure(sim, a, 50, BG); damageStructure(sim, b, 50, BG);
  assert.equal(hpA - a.hp, hpB - b.hp);
});

test('neutral ruin repair: engineers repair a battered ruin (the repairing side pays); auto-dispatch when none selected', () => {
  const sim = makeSim();
  clearUnits(sim);
  const st = ruins(sim)[0];
  st.hp = st.maxHp * 0.5;
  const eng = spawn(sim, NA, 'combat_engineer', st.x + 12, st.z + 12, 0);
  eng.order = { t: 'idle', ready: 1 };
  const mat0 = sim.state.factions[NA].resources.material;
  cmd(sim, CMD.REPAIR, NA, { sid: st.id });
  run(sim, 60, () => st.hp < st.maxHp);
  assert.equal(st.hp, st.maxHp, 'repaired');
  assert.less(sim.state.factions[NA].resources.material, mat0, 'New Antioch paid');
});

// ------------------------------------------------------------------ §30-35 field gun

function gunSetup(targetDist, angle = 0) {
  const sim = makeSim();
  clearUnits(sim);
  const gx = 160, gz = 440;
  const gun = addStructure(sim, 'field_gun', NA, { x: gx, z: gz, rot: Math.PI, built: true });
  const tx = gx + Math.sin(Math.PI + angle) * targetDist, tz = gz + Math.cos(Math.PI + angle) * targetDist;
  return { sim, gun, tx, tz };
}
const seeAll = (sim) => { for (const x of sim.state.squads) if (x.faction === BG) x.visibleTo |= 1; for (const x of sim.state.structures) if (x.faction === BG) x.visibleTo |= 1; };

test('field gun: long range, heavy structure damage, craters + suppression; every round costs supply', () => {
  const { sim, gun, tx, tz } = gunSetup(95);
  const pit = addStructure(sim, 'plague_pit', BG, { x: tx, z: tz, rot: 0, built: true });
  const f = sim.state.factions[NA];
  f.resources.supply = 200;
  const hp0 = pit.hp;
  let prev = f.resources.supply, drops = [];
  const evs = run(sim, 40, (s) => {
    seeAll(sim);
    if (s.events.some((e) => e.type === EV.STRUCTURE_FIRE && e.struct === gun.id)) drops.push(prev - f.resources.supply);
    prev = f.resources.supply;
    return sim.state.structures.indexOf(pit) >= 0;
  });
  const shots = sim.state.factions[NA].stats.gunShots || 0;
  assert.greater(shots, 0, 'the gun fired');
  assert.equal(drops.length, shots);
  for (const d of drops) assert.greater(d, EMPLACEMENT_WEAPONS.field_gun_shell.supplyPerShot - 0.2, 'supply per round (' + d.toFixed(2) + ')');
  assert.ok(sim.state.structures.indexOf(pit) < 0 || pit.hp < hp0 * 0.5, 'the pit is wrecked (' + shots + ' rounds)');
  assert.ok(evs.some((e) => e.type === EV.EXPLOSION && e.ability === 'field_gun_shell' && Math.hypot(e.x - tx, e.z - tz) < 12), 'rounds land at the target (with scatter)');
  assert.ok(evs.some((e) => e.type === EV.STRUCTURE_FIRE && e.struct === gun.id && e.shell), 'discharge event');
  assert.greater((sim.state.craters || []).length, 0, 'craters');
  // squads under the shells are suppressed
  const sq = spawn(sim, BG, 'corpse_guard', tx + 3, tz, 0);
  run(sim, 25, () => { seeAll(sim); return !(sq.suppressUntil > sim.state.tick); });
  assert.greater(sq.suppressUntil, sim.state.tick - 1, 'suppressed');
});

test('field gun: minimum range and crew — cannot hit what is at its wheels; enemies close by silence it', () => {
  const { sim, gun } = gunSetup(0);
  sim.state.factions[NA].resources.supply = 200;
  spawn(sim, BG, 'corpse_guard', gun.x, gun.z - 15, 0); // inside the 28 m minimum range
  run(sim, 20, () => { seeAll(sim); });
  assert.equal(sim.state.factions[NA].stats.gunShots || 0, 0, 'nothing inside the minimum range');
  // a far target + an enemy right at the gun: the crew cannot serve it
  const { sim: s2, gun: g2, tx, tz } = gunSetup(80);
  s2.state.factions[NA].resources.supply = 200;
  spawn(s2, BG, 'corpse_guard', tx, tz, 0);
  const close = spawn(s2, BG, 'grail_thrall', g2.x + 4, g2.z - 5, 0);
  for (const m of close.members) { m.x = g2.x + 3 + (m.id % 3); m.z = g2.z - 4; }
  run(s2, 10, () => { seeAll(s2); for (const m of close.members) { m.x = g2.x + 3; m.z = g2.z - 4; } });
  assert.equal(s2.state.factions[NA].stats.gunShots || 0, 0, 'crew under attack: silent gun');
  assert.greater(EMPLACEMENT_WEAPONS.field_gun_shell.minRange, 20);
});

test('field gun: slow traverse, no supply = no fire; the artillery hierarchy stays distinct', () => {
  const a = gunSetup(90, 0), b = gunSetup(90, 1.1);
  for (const g of [a, b]) { g.sim.state.factions[NA].resources.supply = 200; spawn(g.sim, BG, 'corpse_guard', g.tx, g.tz, 0); }
  const first = (g) => { let t = -1; run(g.sim, 20, () => { seeAll(g.sim); if ((g.sim.state.factions[NA].stats.gunShots || 0) > 0) { t = g.sim.state.tick; return false; } return true; }); return t; };
  const ta = first(a), tb = first(b);
  assert.ok(ta > 0 && tb > 0, 'both fire');
  assert.greater(tb - ta, 1.1 / EMPLACEMENT_WEAPONS.field_gun_shell.traverse * 20 * 0.8, 'a target off its axis takes the traverse time');
  const c = gunSetup(90);
  c.sim.state.factions[NA].resources.supply = 2;
  spawn(c.sim, BG, 'corpse_guard', c.tx, c.tz, 0);
  const evs = run(c.sim, 15, () => { seeAll(c.sim); c.sim.state.factions[NA].resources.supply = 2; });
  assert.equal(c.sim.state.factions[NA].stats.gunShots || 0, 0, 'no supply: silent');
  assert.ok(evs.some((e) => e.type === EV.NOTICE && e.key === 'gun.no_supply'), 'the player is told why');
  // hierarchy: mortar (light, short) < field gun (single heavy round, structure killer) < barrage (area, heaviest total)
  const W = EMPLACEMENT_WEAPONS.field_gun_shell, M = ABILITIES.mortar_barrage, A = ABILITIES.artillery_barrage;
  assert.greater(W.blast.structureDamage, M.structureDamage * 4);
  assert.greater(W.blast.structureDamage, A.structureDamage);
  assert.greater(A.structureDamage * A.shells, W.blast.structureDamage * 2);
  assert.greater(W.reload, 5, 'slow fire');
  assert.ok(STRUCTURES.field_gun.heavyDefense, 'needs an anchor');
});

// ------------------------------------------------------------------ §46-49 Black Grail defences

test('Black Grail organic defences: the Viscera Cannon nest suppresses and sickens; the Belcher denies ground with gas', () => {
  const sim = makeSim();
  clearUnits(sim);
  const nest = addStructure(sim, 'viscera_nest', BG, { x: 160, z: 300, rot: 0, built: true });
  const belch = addStructure(sim, 'belcher_nest', BG, { x: 190, z: 300, rot: 0, built: true });
  const far = spawn(sim, NA, 'yeoman_rifle', 160, 345, Math.PI); // 45 m: viscera range
  const near = spawn(sim, NA, 'yeoman_rifle', 190, 318, Math.PI); // 18 m: belcher range
  const seeNA = () => { for (const x of sim.state.squads) if (x.faction === NA) x.visibleTo |= 2; };
  let clouds = 0, suppressed = false, sickFar = 0, sickNear = 0;
  const sick = (sq) => sq.members.reduce((a, m) => a + (m.infection || 0), 0);
  run(sim, 30, () => {
    seeNA();
    if (far.suppressUntil > sim.state.tick) suppressed = true;
    for (const e of sim.state.effects) if (e.kind === 'plague_cloud' && e.ability === 'belcher_cloud') clouds++;
    sickFar = Math.max(sickFar, sick(far)); sickNear = Math.max(sickNear, sick(near));
  });
  assert.ok(suppressed, 'viscera shots suppress');
  assert.greater(sickFar, 0, 'viscera shots sicken');
  assert.greater(clouds, 0, 'the belcher spews gas');
  assert.greater(sickNear, 0, 'the gas sickens');
  assert.ok(STRUCTURES.viscera_nest.organic && STRUCTURES.belcher_nest.organic, 'organic (fire hurts them)');
  assert.notEqual(STRUCTURES.viscera_nest.lore.status, 'canon', 'not claimed as canon');
  void nest; void belch;
});

// ------------------------------------------------------------------ §36-41 commanders

test('commanders: each side starts with one; limit 1 (no second while he lives or is queued)', () => {
  const sim = makeSim();
  const na = commanderSquad(sim, NA), bg = commanderSquad(sim, BG);
  assert.ok(na && na.type === 'na_lieutenant', 'New Antioch Lieutenant');
  assert.ok(bg && bg.type === 'lord_of_tumours', 'Black Grail Lord of Tumours');
  const bastion = sim.state.structures.find((s) => s.type === 'bastion');
  sim.state.factions[NA].resources.supply = 999; sim.state.factions[NA].resources.manpower = 99;
  cmd(sim, CMD.TRAIN, NA, { sid: bastion.id, unit: 'na_lieutenant' });
  const evs = run(sim, 0.2);
  assert.ok(evs.some((e) => e.type === EV.COMMAND_REJECTED && e.reason === 'train.commander_limit'), 'second commander refused');
  assert.equal(sim.state.squads.filter((q) => q.faction === NA && q.type === 'na_lieutenant').length, 1);
});

test('commander ability: HOLD THE LINE makes the squads around him harder to kill; the area follows him', () => {
  const sim = makeSim();
  clearUnits(sim);
  const lt = spawn(sim, NA, 'na_lieutenant', 160, 470, Math.PI);
  sim.state.factions[NA].cmdr.sq = lt.id;
  const line = spawn(sim, NA, 'yeoman_rifle', 165, 470, Math.PI);
  run(sim, 0.6);
  const m = line.members[0];
  const hit = () => { m.hp = 1000; damageSoldier(sim, line, m, 20, BG, null, 0, 0); return 1000 - m.hp; };
  const before = hit();
  sim.state.factions[NA].resources.supply = 100;
  cmd(sim, CMD.COMMANDER_ABILITY, NA, {});
  run(sim, 0.6);
  assert.ok(sim.state.effects.some((e) => e.kind === 'command' && e.ability === 'hold_the_line'), 'active');
  const during = hit();
  assert.less(during, before * 0.85, 'less damage (' + before.toFixed(1) + ' -> ' + during.toFixed(1) + ')');
  const v = commanderView(sim, NA);
  assert.ok(v.abilityActive && v.abilityCd > 60, 'HUD: active, recharging');
  cmd(sim, CMD.COMMANDER_ABILITY, NA, {});
  const evs = run(sim, 0.2);
  assert.ok(evs.some((e) => e.type === EV.COMMAND_REJECTED && e.reason === 'ability.cooldown'), 'cooldown');
});

test('commander death: morale shock, slower recharge, replacement only after the wait, at double cost, once', () => {
  const sim = makeSim();
  const lt = commanderSquad(sim, NA);
  const near = sim.state.squads.find((q) => q.faction === NA && q !== lt && Math.hypot(q.cx - lt.cx, q.cz - lt.cz) < 30);
  const cd0 = abilityCooldown(sim, NA, 'artillery_barrage');
  for (const m of lt.members) killSoldier(sim, lt, m, BG, 'rifle', 0, 1);
  const evs = run(sim, 1);
  const ev = evs.find((e) => e.type === EV.COMMANDER_FALLEN);
  assert.ok(ev && ev.faction === NA && ev.replaceable === 1, 'fallen event');
  if (near) assert.greater(near.suppressUntil, sim.state.tick, 'shock around him');
  assert.greater(abilityCooldown(sim, NA, 'artillery_barrage'), cd0 * 1.2, 'slower recharge while mourning');
  const bastion = sim.state.structures.find((s) => s.type === 'bastion');
  const f = sim.state.factions[NA];
  f.resources.supply = 999; f.resources.manpower = 99;
  cmd(sim, CMD.TRAIN, NA, { sid: bastion.id, unit: 'na_lieutenant' });
  assert.ok(run(sim, 0.2).some((e) => e.reason === 'train.commander_wait'), 'must wait');
  run(sim, 151);
  const sup0 = f.resources.supply = 999;
  cmd(sim, CMD.TRAIN, NA, { sid: bastion.id, unit: 'na_lieutenant' });
  run(sim, 0.2);
  assert.equal(sup0 - f.resources.supply, UNITS.na_lieutenant.cost.supply * 2, 'double cost');
  run(sim, 40);
  const lt2 = commanderSquad(sim, NA);
  assert.ok(lt2 && lt2 !== lt, 'replacement adopted as commander');
  for (const m of lt2.members) killSoldier(sim, lt2, m, BG, 'rifle', 0, 1);
  const evs2 = run(sim, 1);
  assert.equal(evs2.find((e) => e.type === EV.COMMANDER_FALLEN).replaceable, 0, 'second death: gone for good');
  run(sim, 160);
  f.resources.supply = 999;
  cmd(sim, CMD.TRAIN, NA, { sid: bastion.id, unit: 'na_lieutenant' });
  assert.ok(run(sim, 0.2).some((e) => e.reason === 'train.commander_lost'), 'cannot be replaced again');
});

test('commander save / load: commander state, cooldowns and the live command area survive a save', () => {
  const sim = makeSim();
  sim.state.factions[NA].resources.supply = 100;
  run(sim, 1);
  cmd(sim, CMD.COMMANDER_ABILITY, NA, {});
  run(sim, 1);
  const json = encodeState(sim.state);
  const sim2 = simulationFromState(decodeState(json));
  assert.equal(JSON.stringify(sim2.state.factions[NA].cmdr), JSON.stringify(sim.state.factions[NA].cmdr));
  assert.ok(commanderSquad(sim2, NA), 'commander found after load');
  run(sim, 5); run(sim2, 5);
  assert.equal(encodeState(sim2.state), encodeState(sim.state), 'deterministic after load');
});

// ------------------------------------------------------------------ §57 save v3 -> v4

test('save v3 -> v4 migration: Phase 3 saves load with commanders, ruin garrisons, lull state and new fields', () => {
  const sim = makeSim();
  run(sim, 2);
  const s = JSON.parse(encodeState(sim.state));
  // strip everything Phase 4 added
  s.structures = s.structures.filter((x) => x.type !== 'ruin_house' && x.type !== 'ruin_chapel');
  delete s.match.lull; delete s.settings.lulls;
  for (const fid in s.factions) { delete s.factions[fid].autoReinf; delete s.factions[fid].cmdr; }
  for (const q of s.squads) { delete q.autoReinf; delete q.autoReinfT; delete q.garrison; for (const m of q.members) { delete m.gslot; delete m.gexit; } }
  s.version = 3;
  const hdr = JSON.parse(serializeSave(sim.state));
  const loaded = deserializeSave(JSON.stringify({ ...hdr, version: 3, state: s }));
  const st = loaded.state;
  assert.equal(st.version, STATE_VERSION);
  assert.equal(STATE_VERSION, 4);
  const sim2 = simulationFromState(st);
  assert.equal(ruins(sim2).length, ruins(sim).length, 'ruin garrisons rebuilt from the map');
  assert.ok(commanderSquad(sim2, NA) && commanderSquad(sim2, BG), 'existing leaders adopted as commanders');
  assert.equal(sim2.state.factions[NA].autoReinf, 'off');
  assert.equal(sim2.state.match.lull.plan.length, 0, 'no lulls in a migrated match');
  for (const q of sim2.state.squads) for (const m of q.members) assert.equal(m.gslot, -1);
  for (let i = 0; i < 400; i++) stepSimulation(sim2);
  // loading the migrated state twice gives the same result (ruins added once, deterministically)
  const sim3 = simulationFromState(decodeState(encodeState(sim2.state)));
  assert.equal(ruins(sim3).length, ruins(sim).length, 'no duplicate ruins on reload');
});

test('control groups travel in the save meta and restore', () => {
  const cg = createControlGroups();
  const sim = makeSim();
  const own = sim.state.squads.filter((q) => q.faction === NA && !q.civ).slice(0, 3).map((q) => q.id);
  cg.save(0, own, sim, NA);
  const meta = JSON.parse(JSON.stringify({ groups: cg.export() }));
  const cg2 = createControlGroups();
  cg2.restore(meta.groups);
  assert.equal(cg2.ids(0, sim, NA).join(','), own.slice().sort((a, b) => a - b).join(','));
});

// ------------------------------------------------------------------ §58-59 fog

test('fog: hidden gun fire, hidden shell bursts, reinforcements, garrisons, alarms and a hidden commander never leak', () => {
  const sim = makeSim();
  clearUnits(sim);
  const gun = addStructure(sim, 'field_gun', NA, { x: 160, z: 500, rot: Math.PI, built: true });
  updateVision(sim);
  assert.ok(!(gun.visibleTo & (1 << FACTIONS[BG].index)), 'precondition: the gun is hidden from the Grail');
  const vis = (ev, who) => eventVisibility(sim, ev, who);
  const fire = { type: EV.STRUCTURE_FIRE, struct: gun.id, faction: NA, weapon: 'field_gun_shell', x: 160, z: 498, tx: 160, tz: 380, hit: false, target: 0, tsq: 0, shell: 1 };
  assert.equal(vis(fire, BG), SHOW.NONE, 'a hidden gun firing is not heard / seen');
  assert.notEqual(vis(fire, NA), SHOW.NONE);
  assert.equal(vis({ type: EV.EXPLOSION, x: 20, z: 560, faction: NA, ability: 'field_gun_shell' }, BG), SHOW.NONE, 'a burst in the dark');
  assert.equal(vis({ type: EV.REINFORCEMENT_JOINED, faction: NA, squadId: 1, id: 2, x: 160, z: 480 }, BG), SHOW.NONE, 'replacements are private');
  assert.equal(vis({ type: EV.GARRISON_ENTERED, faction: NA, squadId: 1, sid: 2, x: 100, z: 430 }, BG), SHOW.NONE, 'garrisoning is private');
  assert.equal(vis({ type: EV.CIVILIAN_ALARM, faction: NA, sid: 1, x: 100, z: 430 }, BG), SHOW.NONE, 'alarms are private');
  assert.equal(vis({ type: EV.COMMANDER_FALLEN, faction: NA, x: 160, z: 500 }, BG), SHOW.NONE, 'a commander dying out of sight');
  assert.equal(vis({ type: EV.COMMANDER_FALLEN, faction: NA, x: 160, z: 500 }, NA), SHOW.ALL);
  // the command area of a hidden lieutenant
  const lt = spawn(sim, NA, 'na_lieutenant', 160, 505, Math.PI);
  sim.state.factions[NA].cmdr.sq = lt.id;
  const e = { kind: 'command', ability: 'hold_the_line', faction: NA, sq: lt.id, x: 160, z: 505, radius: 20 };
  assert.ok(!effectVisibleTo(sim, e, BG), 'hold the line unseen by the enemy');
  assert.ok(effectVisibleTo(sim, e, NA));
  // lull warnings are for everyone (both sides feel the front go quiet)
  assert.equal(vis({ type: EV.PHASE_WARNING, phase: 'LULL' }, BG), SHOW.ALL);
});

