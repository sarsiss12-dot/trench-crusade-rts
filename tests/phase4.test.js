// Phase 4 regression tests (brief §61, adapted to the Phase 4.1 design): walking replacements
// counted only on arrival, POSITIONAL auto reinforcement, control groups, multi-select UX state,
// operational lulls (timing, never a ceasefire, bonus, AI), ruin garrisons, field gun, Black Grail
// defences, salvage, fog, save v3 -> current. (Phase 4 commanders were replaced by the passive
// ELITE system in 4.1 — see phase41.test.js.)
import { test, assert } from './harness.js';
import { enqueueCommand, CMD } from '../src/sim/commands.js';
import { EV } from '../src/core/events.js';
import { createSimulation, stepSimulation } from '../src/sim/simulation.js';
import { killSoldier } from '../src/combat/combat.js';
import { squadCounts } from '../src/sim/squad_stats.js';
import { FACTIONS } from '../src/data/factions.js';
import { UNITS } from '../src/data/units.js';
import { LULL } from '../src/data/scenarios.js';
import { planLulls, isLull, lullBonus } from '../src/sim/lull.js';
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

test('positional auto reinforcement: open field OFF, trench ON by default, player OFF kept, leaving clears, re-entry ON', () => {
  const sim = makeSim();
  clearUnits(sim);
  const f = sim.state.factions[NA];
  f.resources.manpower = 50; f.resources.supply = 500;
  const seg = structs(sim, 'trench', NA)[1];
  const field = spawn(sim, NA, 'yeoman_rifle', 150, 420, Math.PI); // out in the open
  const dug = spawn(sim, NA, 'yeoman_rifle', seg.x, seg.z + 4, Math.PI);
  cmd(sim, CMD.ENTER_TRENCH, NA, { squadIds: [dug.id], sid: seg.id });
  run(sim, 12);
  assert.equal(dug.order.t, 'hold_trench', 'precondition: in the trench');
  for (const sq of [field, dug]) for (let i = 0; i < 3; i++) killSoldier(sim, sq, sq.members[i], BG, 'rifle', 0, 1);
  field.lastHitTick = dug.lastHitTick = -100000;
  const size = UNITS.yeoman_rifle.squadSize;
  const requested = (sq) => !!sq.reinf || sq.members.length >= size;
  run(sim, 5);
  assert.ok(!requested(field), 'open field: OFF by default');
  assert.ok(dug.posId === seg.id && dug.posAuto === 1, 'entering a trench switches it ON');
  assert.ok(requested(dug), 'trench squad requests its replacements');
  // the open-field squad cannot be switched on (no position)
  cmd(sim, CMD.SET_AUTO_REINFORCE, NA, { squadIds: [field.id], on: 1 });
  assert.ok(run(sim, 0.2).some((e) => e.type === EV.COMMAND_REJECTED && e.reason === 'autoreinf.no_position'));
  // player OFF: kept while the squad stays in the position; walkers already out keep walking
  run(sim, 40);
  for (let i = 0; i < 2; i++) { const m = dug.members.find((x) => x.state === 'alive'); killSoldier(sim, dug, m, BG, 'rifle', 0, 1); }
  run(sim, 3);
  dug.lastHitTick = -100000;
  cmd(sim, CMD.SET_AUTO_REINFORCE, NA, { squadIds: [dug.id], on: 0 });
  run(sim, 30);
  assert.equal(dug.posAuto, 0);
  assert.ok(!dug.reinf, 'switched off: no automatic request');
  // leaving the trench clears the position (and the choice); coming back defaults to ON again
  cmd(sim, CMD.MOVE, NA, { squadIds: [dug.id], x: seg.x + 20, z: seg.z + 30 });
  run(sim, 10);
  assert.ok(!dug.posId && !dug.posAuto, 'left the position');
  cmd(sim, CMD.ENTER_TRENCH, NA, { squadIds: [dug.id], sid: seg.id });
  run(sim, 15);
  assert.ok(dug.posId && dug.posAuto === 1, 're-entry defaults to ON');
  cmd(sim, CMD.SET_AUTO_REINFORCE, BG, { squadIds: [], on: 1 });
  assert.ok(run(sim, 0.2).some((e) => e.type === EV.COMMAND_REJECTED && e.faction === BG && e.reason === 'reinf.not_available'), 'the Grail has no walking replacements');
});

test('positional auto reinforcement: a resource shortage gives ONE notice with the waiting count, then resumes on its own', () => {
  const sim = makeSim();
  clearUnits(sim);
  const f = sim.state.factions[NA];
  const seg = structs(sim, 'trench', NA)[1];
  const a = spawn(sim, NA, 'yeoman_rifle', seg.x, seg.z + 4, Math.PI);
  cmd(sim, CMD.ENTER_TRENCH, NA, { squadIds: [a.id], sid: seg.id });
  run(sim, 12);
  for (let i = 0; i < 4; i++) killSoldier(sim, a, a.members[i], BG, 'rifle', 0, 1);
  a.lastHitTick = -100000;
  f.resources.supply = 0; f.resources.manpower = 50;
  const ev = run(sim, 60, () => { f.resources.supply = 0; });
  const notes = ev.filter((e) => e.type === EV.NOTICE && e.key === 'reinf.auto_waiting');
  assert.equal(notes.length, 1, 'one notice, then silence (' + notes.length + ')');
  assert.equal(notes[0].res, 'supply');
  assert.equal(notes[0].n, 4, 'waiting men counted');
  f.resources.supply = 500;
  let joined = 0;
  run(sim, 60, (s) => { for (const e of s.events) if (e.type === EV.REINFORCEMENT_JOINED && e.squadId === a.id) joined++; });
  assert.greater(joined, 0, 'resumes automatically once supply flows');
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

test('operational lull: seeded deterministic timing; first window ~9:30-10:30 in a 30 min war; several in long wars; endless keeps going', () => {
  const p1 = planLulls(1234, 30, 'auto'), p2 = planLulls(1234, 30, 'auto'), p3 = planLulls(9, 30, 'auto');
  assert.deepEqual(p1, p2, 'same seed, same plan');
  assert.ok(JSON.stringify(p1) !== JSON.stringify(p3), 'another seed, another plan');
  const min = 60 * 20;
  for (const seed of [1, 2, 3, 1234, 99, 777]) {
    const p = planLulls(seed, 30, 'auto');
    assert.ok(p.length >= 1, 'a 30 min war has a window');
    assert.ok(p[0].at >= 9.5 * min && p[0].at <= 10.5 * min, 'first at ' + (p[0].at / min).toFixed(2) + ' min');
    for (const l of p) {
      assert.ok(l.dur >= 45 * 20 && l.dur <= 60 * 20, 'duration ' + l.dur);
      assert.ok(l.warn >= 8 * 20 && l.warn <= 12 * 20);
      assert.ok(l.at <= (30 - LULL.lastBeforeEndMin) * min, 'none in the last minutes');
    }
  }
  assert.ok(planLulls(1, 120, 'auto').length >= 6, 'long wars get several windows');
  const e = planLulls(5, 60, 'auto', 8, true);
  assert.equal(e.length, 8, 'endless: windows never run out');
  for (let i = 1; i < e.length; i++) assert.ok(e[i].at - e[i - 1].at >= 14.5 * min && e[i].at - e[i - 1].at <= 15.5 * min, 'spacing');
  assert.equal(planLulls(1, 30, 0).length, 0, 'OFF');
  assert.equal(planLulls(1, 15, 'auto').length, 0, 'no window in a short (dev) war');
  assert.equal(planLulls(1, 180, 2).length, 2, 'cap');
});

/** Fast-forward the war clock so window 0 is `lead` seconds away (the sim keeps its own tick). */
function nearLull(sim, lead) {
  const w = planLulls(sim.state.seed, sim.state.match.warMinutes, sim.state.match.lull.cap)[0];
  sim.state.match.prepEndTick = sim.state.tick - (w.at - lead * 20);
  return w;
}

test('lull is NOT a ceasefire: ATTACK, ATTACK-MOVE and artillery accepted; both sides keep taking damage; the war clock runs on', () => {
  const sim = makeSim({ lulls: 1, warMinutes: 30 });
  clearUnits(sim);
  const warEnd0 = sim.state.match.warEndTick;
  const w = nearLull(sim, 15);
  const sq = spawn(sim, NA, 'yeoman_rifle', 160, 440, Math.PI);
  const sq2 = spawn(sim, NA, 'yeoman_rifle', 175, 440, Math.PI);
  const evs = run(sim, 16, (s) => !isLull(s.state));
  assert.ok(evs.some((e) => e.type === EV.PHASE_WARNING && e.phase === 'LULL'), 'warning first');
  assert.ok(isLull(sim.state), 'window open');
  // the Grail walks up DURING the window
  const enemy = spawn(sim, BG, 'grail_thrall', 160, 412, 0);
  const far = spawn(sim, BG, 'grail_thrall', 190, 395, 0);
  run(sim, 0.5);
  const hp = (q) => q.members.reduce((a, m) => a + (m.state === 'alive' ? m.hp : 0), 0);
  const na0 = hp(sq) + hp(sq2), bg0 = hp(enemy);
  const f = sim.state.factions[NA];
  f.resources.supply = 999; f.resources.manpower = 99;
  cmd(sim, CMD.ATTACK, BG, { squadIds: [enemy.id], tk: 'squad', tid: sq.id });
  cmd(sim, CMD.ATTACK, NA, { squadIds: [sq.id], tk: 'squad', tid: enemy.id });
  cmd(sim, CMD.MOVE, NA, { squadIds: [sq2.id], x: 160, z: 300, attackMove: true });
  sim.state.factions[NA].abilities.artillery_barrage.readyTick = 0;
  cmd(sim, CMD.USE_ABILITY, NA, { ability: 'artillery_barrage', x: 172, z: 408 });
  const ev = run(sim, 8);
  const rej = ev.filter((e) => e.type === EV.COMMAND_REJECTED);
  assert.ok(!rej.some((e) => e.cmd === 'ATTACK' || e.cmd === 'MOVE'), 'attack / attack-move accepted: ' + rej.map((e) => e.reason).join(','));
  assert.ok(!rej.some((e) => e.cmd === 'USE_ABILITY'), 'artillery accepted: ' + rej.map((e) => e.reason).join(','));
  assert.ok(ev.some((e) => e.type === EV.EXPLOSION && e.ability === 'artillery_barrage'), 'shells land during the window');
  void far;
  assert.ok(!rej.some((e) => /lull/.test(e.reason || '')), 'no lull refusal of any kind');
  assert.ok(isLull(sim.state));
  assert.less(hp(enemy), bg0, 'the Grail takes damage during the window');
  assert.less(hp(sq) + hp(sq2), na0, 'New Antioch takes damage during the window');
  assert.equal(sim.state.match.warEndTick, warEnd0, 'war clock NOT extended');
  const rest = run(sim, w.dur / 20 + 1);
  assert.ok(rest.some((e) => e.type === EV.PHASE_WARNING && e.phase === 'WAR'));
  assert.ok(rest.some((e) => e.type === EV.PHASE_CHANGED && e.phase === 'WAR' && e.afterLull === 1));
  assert.ok(!isLull(sim.state));
});

test('lull bonus: out-of-combat build / repair / resupply / reinforcement / suppression recovery only, deterministic', () => {
  const sim = makeSim({ lulls: 1, warMinutes: 30 });
  clearUnits(sim);
  assert.equal(lullBonus(sim.state, 'build'), 1, 'no bonus outside a window');
  nearLull(sim, 1);
  run(sim, 2);
  assert.ok(isLull(sim.state));
  for (const k of ['build', 'repair', 'resupply', 'suppressRecover']) assert.equal(lullBonus(sim.state, k, -1e6), LULL.bonus[k], k);
  assert.equal(lullBonus(sim.state, 'reinfInterval', -1e6), LULL.bonus.reinfInterval, 'replacements walk out more often');
  assert.equal(lullBonus(sim.state, 'build', sim.state.tick - 5), 1, 'units in combat get no bonus');
  assert.equal(lullBonus(sim.state, 'attack', -1e6), 1, 'no combat modifier of any kind');
  // two identical runs through a window agree tick for tick
  const a = makeSim({ lulls: 1, warMinutes: 30 }), b = makeSim({ lulls: 1, warMinutes: 30 });
  nearLull(a, 3); nearLull(b, 3);
  run(a, 30); run(b, 30);
  assert.equal(encodeState(a.state), encodeState(b.state), 'deterministic');
});

test('lull AI: may attack and fire during a window; never refused; waves only regroup when idle', () => {
  const sim = createSimulation({ scenarioId: 'siege_default', seed: 5, settings: { warMinutes: 30, lulls: 1, controllers: { [NA]: 'ai', [BG]: 'ai' } } });
  // let both AIs deploy and start fighting, then bring the window close (war clock fast-forward)
  for (let i = 0; i < 20 * 150; i++) { stepSimulation(sim); sim.events.length = 0; }
  const w = nearLull(sim, 10);
  const target = sim.state.match.prepEndTick + w.at + 40 * 20;
  const cmds = [];
  let rejectedLull = 0;
  while (sim.state.tick < target) {
    for (const c of sim.state.pending) if (isLull(sim.state)) cmds.push(c);
    stepSimulation(sim);
    for (const e of sim.events) if (e.type === EV.COMMAND_REJECTED && /lull/.test(e.reason || '')) rejectedLull++;
    sim.events.length = 0;
  }
  assert.ok(isLull(sim.state) || sim.state.match.lull.idx > 0, 'the window came');
  assert.equal(rejectedLull, 0, 'nothing refused for a lull');
  assert.ok(cmds.length > 0, 'the AIs keep issuing commands through the window');
  const offensive = cmds.filter((c) => c.type === 'ATTACK' || (c.type === 'MOVE' && c.attackMove) || c.type === 'USE_ABILITY');
  assert.ok(offensive.length > 0, 'offensive orders during the window: ' + [...new Set(cmds.map((c) => c.faction[0] + ':' + c.type))].join(','));
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
  // (Phase 4.1: the laid sector is 120° — 0.9 rad off axis is still inside it)
  const a = gunSetup(90, 0), b = gunSetup(90, 0.9);
  for (const g of [a, b]) { g.sim.state.factions[NA].resources.supply = 200; spawn(g.sim, BG, 'corpse_guard', g.tx, g.tz, 0); }
  const first = (g) => { let t = -1; run(g.sim, 20, () => { seeAll(g.sim); if ((g.sim.state.factions[NA].stats.gunShots || 0) > 0) { t = g.sim.state.tick; return false; } return true; }); return t; };
  const ta = first(a), tb = first(b);
  assert.ok(ta > 0 && tb > 0, 'both fire');
  assert.greater(tb - ta, 0.9 / EMPLACEMENT_WEAPONS.field_gun_shell.traverse * 20 * 0.8, 'a target off its axis takes the traverse time');
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

// ------------------------------------------------------------------ save v3 -> current

test('save v3 -> current migration: Phase 3 saves load with ruin garrisons, positional reinforcement, lull state, no commanders', () => {
  const sim = makeSim();
  run(sim, 2);
  const s = JSON.parse(encodeState(sim.state));
  // strip everything Phase 4 / 4.1 added
  s.structures = s.structures.filter((x) => x.type !== 'ruin_house' && x.type !== 'ruin_chapel');
  delete s.match.lull; delete s.settings.lulls; delete s.match.endless; delete s.weather; delete s.mud;
  for (const fid in s.factions) { delete s.factions[fid].reinfWait; }
  for (const q of s.squads) { delete q.posId; delete q.posAuto; delete q.autoHunt; delete q.garrison; for (const m of q.members) { delete m.gslot; delete m.gexit; } }
  s.version = 3;
  const hdr = JSON.parse(serializeSave(sim.state));
  const loaded = deserializeSave(JSON.stringify({ ...hdr, version: 3, state: s }));
  const st = loaded.state;
  assert.equal(st.version, STATE_VERSION);
  assert.ok(STATE_VERSION >= 5, 'Phase 4.1 bumped the state version');
  const sim2 = simulationFromState(st);
  assert.equal(ruins(sim2).length, ruins(sim).length, 'ruin garrisons rebuilt from the map');
  for (const fid of [NA, BG]) {
    const f = sim2.state.factions[fid];
    assert.ok(f.cmdr === undefined && f.autoReinf === undefined, 'commander / old auto-reinforce fields dropped');
    assert.equal(f.reinfWait, 0);
  }
  assert.ok(!sim2.state.match.lull.active && sim2.state.match.lull.cap === 0, 'no windows in a migrated Phase 3 match');
  for (const q of sim2.state.squads) {
    for (const m of q.members) assert.equal(m.gslot, -1);
    assert.ok(q.autoReinf === undefined && q.autoReinfT === undefined);
    assert.equal(q.posAuto, 0);
  }
  for (let i = 0; i < 400; i++) stepSimulation(sim2);
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

test('fog: hidden gun fire, hidden shell bursts, reinforcements, garrisons, alarms and private notices never leak', () => {
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
  assert.equal(vis({ type: EV.NOTICE, faction: NA, key: 'reinf.auto_waiting', res: 'supply', n: 4, x: 160, z: 500 }, BG), SHOW.NONE, 'a waiting-reinforcement notice is private');
  // a hidden cleric's consecration is not shown to the enemy
  const e = { kind: 'consecrate', ability: 'consecrate', faction: NA, x: 160, z: 505, radius: 16 };
  assert.ok(!effectVisibleTo(sim, e, BG), 'hidden consecration unseen by the enemy');
  assert.ok(effectVisibleTo(sim, e, NA));
  // lull warnings are for everyone (both sides feel the front go quiet)
  assert.equal(vis({ type: EV.PHASE_WARNING, phase: 'LULL' }, BG), SHOW.ALL);
});

