import { readFileSync } from 'node:fs';
import { test, assert } from './harness.js';
import { TestElement, installDOM } from './fake_dom.js';
import { makeSim, clearUnits, spawn, run, addStructure, alive } from './helpers.js';
import { createSimulation, stepSimulation, stateHash, simulationFromState } from '../src/sim/simulation.js';
import { createSession } from '../src/app/session.js';
import { createActions } from '../src/app/actions.js';
import { createP3Hud } from '../src/ui/hud_p3.js';
import { createP4Hud } from '../src/ui/hud_p4.js';
import { button } from '../src/ui/dom.js';
import { createSelection, allCombatSquadIds } from '../src/input/selection.js';
import { createControlGroups } from '../src/input/control_groups.js';
import { boxSelect, pickSquad } from '../src/input/pick.js';
import { createCamera, updateCamera, projectToScreen } from '../src/render/camera.js';
import { enqueueCommand, applyCommand, CMD } from '../src/sim/commands.js';
import { serializeSave, deserializeSave, cloneState, encodeState } from '../src/save/codec.js';
import { updateVision } from '../src/sim/perception.js';
import { garrisonGeom, garrisonedCount } from '../src/units/garrison.js';
import { updateAutonomousRisen } from '../src/units/autonomous_risen.js';
import { sanitationTarget, updateAutomaticSanitation } from '../src/units/sanitation.js';
import { forageSpot, habitatSpot, huntThreat } from '../src/units/hunt_targets.js';
import { addCarcass } from '../src/sim/corpses.js';
import { killSoldier } from '../src/combat/combat.js';
import { SPECIES } from '../src/data/animals.js';
import { FACTIONS, sideBit, sideIndex } from '../src/data/factions.js';
import { STRUCTURES } from '../src/data/structures.js';
import { UNITS } from '../src/data/units.js';
import { WEAPONS } from '../src/data/weapons.js';
import { SPECIALITIES, SPEC_TIERS } from '../src/data/specialities.js';
import { unlockedBySpec, specValue, validateSpec, unitCost } from '../src/sim/specialities.js';
import { UNIT_MODELS_SULTANATE } from '../src/render/models/humans_sultanate.js';
import { STRUCTURE_MODELS_SULTANATE } from '../src/render/models/structures_sultanate.js';
import { WALL_BUILDERS } from '../src/render/models/walls.js';
import { SCENARIOS } from '../src/data/scenarios.js';
import { policyFor, ensureDoctrine } from '../src/ai/doctrine.js';
import { settlementRisk, defensePlan } from '../src/ai/settlement_defense.js';
import { economyViewItems, usesResourceSectors } from '../src/sim/economy_view.js';
import { EV } from '../src/core/events.js';
import { STATE_VERSION } from '../src/sim/constants.js';
import { validatePlacement } from '../src/construction/construction.js';
import { ironSultanateLogic } from '../src/factions/iron_sultanate.js';
import { seedInfection, infectionCellAt } from '../src/factions/pestilence.js';
import { selectStructureShortcut } from '../src/input/structure_shortcuts.js';
import { insideRuin } from '../src/world/ruin_geometry.js';

const NA = 'new_antioch', BG = 'black_grail', IS = 'iron_sultanate';
function opts(a, b, ai = false, seed = 51) {
  return { scenarioId: 'siege_default', seed, settings: { prepSeconds: 0, warMinutes: 15, lulls: 0,
    sides: [{ faction: a, role: 'defender', controller: ai ? 'ai' : 'player' }, { faction: b, role: 'attacker', controller: ai ? 'ai' : 'player' }] } };
}
function corpse(sim, x, z, rise = 0, side = BG) {
  const c = addCarcass(sim, x, z, 0, 'sheep', 10, 255);
  c.sp = ''; c.faction = NA; c.unit = 'yeoman_rifle'; c.infected = true; c.plague = side; c.turn = 1; c.riseAt = rise;
  return c;
}
function animal(sim, x, z, sp = 'sheep', hab = '') {
  const a = { id: sim.state.nextId++, sp, x, z, rot: 0, vx: 0, vz: 0, hp: SPECIES[sp].hp, st: 'wild', hab, pen: 0, by: 0,
    tx: x, tz: z, wait: sim.state.tick + 400, panic: 0, shy: 0, px: 0, pz: 0, visibleTo: 255, seenBy: 255 };
  sim.state.animals.push(a); return a;
}
function finite(v, path = 'state') {
  if (typeof v === 'number') { assert.ok(Number.isFinite(v), path); return; }
  if (!v || typeof v !== 'object') return;
  for (const k of Object.keys(v)) finite(v[k], path + '.' + k);
}

test('05C real HUD speciality button opens, selects via command, explains locked tiers for all three factions', () => {
  const restore = installDOM();
  try { for (const fid of [NA, BG, IS]) {
    const session = createSession(opts(fid, fid === BG ? NA : BG)); session.viewer = fid;
    const sim = session.sim, root = new TestElement(), quick = new TestElement(), bottom = new TestElement(); root.append(quick, bottom);
    const game = { session, sim, viewer: fid, selection: createSelection(sim), ui: {}, audio: null };
    game.actions = createActions(game);
    const H = { root, quick, bottom, resBox: new TestElement(), notify() {}, markDirty() {}, toggleLens() {} };
    const hud = createP3Hud(game, H), button = quick.querySelector('[data-action="speciality"]');
    assert.ok(button, fid + ' button connected');
    assert.equal(button.dispatch('pointerdown', { pointerType: 'touch' }).stopped, true, 'tap cannot reach canvas gesture listener');
    button.click();
    const modal = root.querySelector('.specmodal');
    assert.ok(modal.classList.contains('open'), fid + ' panel opened');
    assert.equal(modal.querySelectorAll('.speccard').length, 3);
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.ok(modal.querySelector('.speccard').textContent.length > 60, 'description and lore status');
    modal.querySelectorAll('.speccard')[0].click();
    modal.querySelector('.ok').click();
    assert.equal(session.commandLog.at(-1).type, CMD.CHOOSE_SPECIALITY);
    stepSimulation(sim);
    assert.equal(sim.state.factions[fid].spec[0], SPECIALITIES[fid][0][0].id, fid + ' applies choice');
    hud.update(0.3); button.click();
    assert.equal(modal.querySelectorAll('.speccard').length, 0, 'locked tier has no active cards');
    assert.ok(modal.querySelector('.specnote').textContent.length > 5, 'lock reason shown');
    assert.equal(validateSpec(sim.state, fid, 1, SPECIALITIES[fid][1][0].id), 'spec.locked');
    sim.state.tick = sim.state.match.prepEndTick + Math.ceil(SPEC_TIERS[1].at * 15 * 60 * 20);
    hud.update(0.3);
    assert.ok(modal.classList.contains('open'), 'dirty update does not close dialog');
    assert.equal(modal.querySelectorAll('.speccard').length, 3, 'next tier becomes interactive while open');
    const saved = deserializeSave(serializeSave(sim.state)).state;
    assert.equal(saved.factions[fid].spec[0], SPECIALITIES[fid][0][0].id);
  } } finally { restore(); }
  const css = readFileSync(new URL('../src/ui/style.css', import.meta.url), 'utf8');
  assert.ok(/\.specmodal\s*\{[^}]*z-index: 30[^}]*pointer-events: auto/.test(css), 'dialog above HUD overlays with pointer events');
});

test('05C IS nine specialities unlock buildings and change concrete costs, repair and independent AI policy', () => {
  for (const tier of SPECIALITIES[IS]) for (const spec of tier) {
    const sim = createSimulation(opts(IS, IS)), twin = sim.state.sides[1].id;
    const before = policyFor(sim.state, IS);
    sim.state.factions[IS].spec = [null, null, null]; sim.state.factions[IS].spec[SPECIALITIES[IS].indexOf(tier)] = spec.id;
    const after = policyFor(sim.state, IS);
    assert.notEqual(JSON.stringify(before), JSON.stringify(after), spec.id + ' affects decisions');
    assert.deepEqual(policyFor(sim.state, twin), before, 'mirror doctrine and modifiers isolated');
    for (const id of spec.unlocks?.structures || []) assert.ok(unlockedBySpec(sim.state, IS, STRUCTURES[id]), id);
  }
  const sim = createSimulation(opts(IS, BG)), r = unitCost(sim.state, IS, 'janissary');
  sim.state.factions[IS].spec = ['is_discipline', null, null];
  assert.less(unitCost(sim.state, IS, 'janissary').material, r.material);
  sim.state.factions[IS].spec = ['is_engineering', null, null];
  assert.greater(specValue(sim.state, IS, 'repairSpeed', 1), 1);
  assert.equal(WEAPONS[UNITS.janissary.melee].infect, undefined, 'Sultanate sidearm never spreads Black Grail infection');
});

test('05C IS structure roster, distinct finite procedural models and larger gated wall sector', () => {
  const build = FACTIONS[IS].buildList;
  assert.equal(build.length, 9);
  for (const cat of ['defense', 'economy', 'support']) assert.ok(build.some((id) => STRUCTURES[id].cat === cat), cat);
  const signatures = new Set();
  for (const models of [UNIT_MODELS_SULTANATE, STRUCTURE_MODELS_SULTANATE]) for (const [id, buildMesh] of Object.entries(models)) for (const lod of [0, 1]) {
    const built = buildMesh(lod), mesh = built.mesh || built, f = new Float32Array(mesh.vertices);
    assert.ok(mesh.vertexCount > 100 && mesh.height > 1, id);
    for (let i = 0; i < mesh.vertexCount; i++) for (let k = 0; k < 3; k++) assert.ok(Number.isFinite(f[i * 6 + k]), id + ' finite geometry');
    if (id.startsWith('is_') && !lod) signatures.add(Buffer.from(mesh.vertices).toString('base64'));
  }
  assert.equal(signatures.size, 4, 'four original unit silhouettes');
  assert.notEqual(STRUCTURES.sultanate_citadel.model, STRUCTURES.bastion.model);
  const sc = SCENARIOS.iron_wall_sector, feature = sc.features.find((f) => f.requiresFaction === IS);
  assert.ok(feature.sector.gate.width >= 20 && feature.sector.staging.length, 'future gate and staging metadata');
  assert.ok(WALL_BUILDERS.iron_wall_section);
  const sim = createSimulation({ ...opts(IS, BG), scenarioId: 'iron_wall_sector' });
  const walls = sim.state.structures.filter((s) => s.type === 'iron_wall_section');
  assert.equal(walls.length, 4);
  assert.greater(walls.reduce((n, w) => n + Math.hypot(w.x2 - w.x1, w.z2 - w.z1), 0), 190);
  for (const [a, b] of [[IS, BG], [BG, IS]]) {
    const m = createSimulation(opts(a, b));
    assert.ok(m.state.structures.some((s) => s.faction === IS && s.type === 'sultanate_muster'));
    assert.equal(m.state.structures.some((s) => s.type === 'iron_wall_section'), false);
  }
});

test('05C eight infected dead form an autonomous bounded pack; every selection and direct command route excludes it', () => {
  const sim = makeSim(); clearUnits(sim);
  const victims = spawn(sim, NA, 'yeoman_rifle', 80, 320, 0);
  for (const m of victims.members) { m.infection = 100; m.plague = BG; killSoldier(sim, victims, m, BG, 'plague', 0, 0); }
  run(sim, 2);
  assert.equal(sim.state.corpses.length, 8);
  for (const c of sim.state.corpses) { c.infected = true; c.plague = BG; c.turn = 1; c.riseAt = sim.state.tick + 1; }
  run(sim, 5);
  const packs = sim.state.squads.filter((q) => q.autonomous === 'risen');
  assert.equal(packs.length, 1, 'eight dead do not create eight controllable squads');
  const pack = packs[0]; assert.equal(pack.members.length, 8);
  const sel = createSelection(sim); sel.set([pack.id]); sel.add([pack.id]); sel.toggle(pack.id);
  assert.equal(sel.squads.size, 0);
  assert.ok(!allCombatSquadIds(sim, BG).includes(pack.id));
  const cg = createControlGroups(); cg.save(0, [pack.id], sim, BG); assert.equal(cg.ids(0, sim, BG).length, 0);
  const cam = createCamera({ x: pack.cx, z: pack.cz, dist: 70 }); updateCamera(cam, 1000, 700, 0);
  assert.equal(boxSelect(sim, BG, cam, () => 0, 0, 0, 1000, 700).includes(pack.id), false);
  const p = []; projectToScreen(cam, pack.cx, 0, pack.cz, p);
  assert.notEqual(pickSquad(sim, BG, cam, () => 0, p[0], p[1], 50)?.id, pack.id);
  for (const type of [CMD.MOVE, CMD.ATTACK, CMD.STOP, CMD.REINFORCE, CMD.FORMATION]) {
    const before = JSON.stringify(pack.order);
    applyCommand(sim, { type, faction: BG, squadIds: [pack.id], x: 10, z: 10, tk: 'struct', tid: sim.state.structures[0].id, formation: 'line' });
    assert.equal(JSON.stringify(pack.order), before, type + ' cannot control risen');
  }
  const foe = spawn(sim, NA, 'yeoman_rifle', pack.cx + 12, pack.cz, 0);
  updateVision(sim); pack.risenNext = 0; updateAutonomousRisen(sim);
  assert.equal(pack.order.t, 'attack'); assert.equal(pack.order.tid, foe.id);
  const copy = simulationFromState(deserializeSave(serializeSave(sim.state)).state);
  run(sim, 12); run(copy, 12); assert.equal(stateHash(sim), stateHash(copy), 'pack save continuation');
});

function assaultFixture(risen = false) {
  const sim = makeSim(); clearUnits(sim);
  const st = sim.state.structures.find((s) => s.type === 'ruin_house' && s.z > 350), g = garrisonGeom(sim, st), e = g.entrances[0];
  const def = spawn(sim, NA, 'yeoman_rifle', e.ox, e.oz, 0, { size: 4 }); def.posAuto = 0;
  enqueueCommand(sim, { type: CMD.GARRISON, faction: NA, squadIds: [def.id], sid: st.id }); run(sim, 35);
  applyCommand(sim, { type: CMD.SET_AUTO_REINFORCE, faction: NA, squadIds: [def.id], on: 0 });
  assert.equal(garrisonedCount(sim, def), 4);
  const atk = spawn(sim, BG, 'grail_thrall', e.ox + (e.ox - e.cx) * 4, e.oz + (e.oz - e.cz) * 4, 0, { size: 16 });
  if (risen) { atk.autonomous = 'risen'; atk.risenNext = 0; }
  updateVision(sim);
  if (!risen) enqueueCommand(sim, { type: CMD.ATTACK, faction: BG, squadIds: [atk.id], tk: 'struct', tid: st.id });
  return { sim, st, def, atk };
}
test('05C neutral hostile-holder ruin storms through an entrance and resolves interior combat; risen use same path', () => {
  for (const risen of [false, true]) {
    const { sim, st, def, atk } = assaultFixture(risen);
    let entered = false, contested = false, melee = 0, captured = false;
    run(sim, 100, (s) => {
      entered ||= atk.order.t === 'storm' && atk.order.phase === 'inside'; contested ||= !!st.contested;
      melee += s.events.filter((e) => e.type === EV.MELEE && (e.sq === atk.id || e.tsq === atk.id)).length;
      captured ||= st.holder === BG;
    });
    assert.ok(entered && contested, 'doorway -> contested interior');
    assert.greater(melee, 0, 'visible melee feedback emitted');
    assert.less(alive(def), 4, 'defenders take interior casualties');
    assert.ok(!alive(def) || !alive(atk), 'battle resolves, no indefinite wall jitter');
    if (!risen && !alive(def) && alive(atk)) assert.ok(captured, 'survivors occupy cleared ruin');
  }
});

test('05C sanitation prioritizes imminent rise; does not interrupt build/repair or charge threats; flamer and cleric denial', () => {
  const sim = makeSim(); clearUnits(sim);
  const eng = spawn(sim, NA, 'combat_engineer', 125, 470, 0);
  const c = corpse(sim, 129, 469, 3000), urgent = corpse(sim, 139, 468, 500);
  assert.equal(sanitationTarget(sim, NA, eng.cx, eng.cz).cid, urgent.id);
  for (const t of ['build', 'repair']) {
    eng.order = { t, sid: sim.state.structures[0].id }; sim.state.tick = (40 - eng.id % 40) % 40;
    updateAutomaticSanitation(sim); assert.equal(eng.order.t, t, 'manual ' + t + ' kept');
  }
  eng.order = { t: 'idle' };
  const enemy = spawn(sim, BG, 'grail_thrall', 137, 465, 0); enemy.visibleTo = 255;
  updateAutomaticSanitation(sim); assert.equal(eng.order.t, 'idle', 'no suicidal task');
  for (const m of enemy.members) m.state = 'dead';
  run(sim, 30);
  assert.ok(!sim.rt.corpseById.has(c.id) && !sim.rt.corpseById.has(urgent.id), 'idle engineer burns infected bodies');
  const f = makeSim(); clearUnits(f);
  const flamer = spawn(f, NA, 'shock_flamer', 118, 470, 0), body = corpse(f, 131, 470, 500);
  const far = corpse(f, 160, 420, 500);
  run(f, 14);
  assert.ok(!f.rt.corpseById.has(body.id), 'flamer approaches nearby corpse');
  assert.ok(f.rt.corpseById.has(far.id), 'flamer does not do long engineer sweep');
  const cl = makeSim(); clearUnits(cl); spawn(cl, NA, 'trench_cleric', 95, 400, 0);
  const blessed = corpse(cl, 97, 400, 500); run(cl, 20);
  assert.ok(!cl.rt.corpseById.has(blessed.id) || !blessed.infected, 'cleric passive purification preserved');
});

test('05C AUTO HUNT and SAFE HUNT are independent; shared scoring finds explored distant habitat and avoids gun coverage', () => {
  const sim = makeSim(); clearUnits(sim); const gang = spawn(sim, BG, 'thrall_gang', 162, 120, 0);
  sim.state.fog.seen[sideIndex(BG)].fill(1);
  const h = habitatSpot(sim, BG, gang); assert.ok(h, 'explored habitat found without selecting an area');
  const prey = animal(sim, 210, 160);
  assert.ok(forageSpot(sim, BG, gang));
  const gun = addStructure(sim, 'fire_post', NA, { x: prey.x + 10, z: prey.z, rot: Math.PI, built: true }); gun.seenBy = 255;
  assert.ok(huntThreat(sim, BG, prey.x, prey.z));
  assert.equal(forageSpot(sim, BG, gang), null, 'safe prey scorer rejects weapon coverage');
  applyCommand(sim, { type: CMD.SET_SAFE_HUNT, faction: BG, squadIds: [gang.id], on: 0 });
  assert.equal(gang.autoHunt, 1); assert.equal(gang.safeHunt, 0);
  assert.ok(forageSpot(sim, BG, gang), 'risk toggle allows longer known weapon risks');
  applyCommand(sim, { type: CMD.SET_AUTO_HUNT, faction: BG, squadIds: [gang.id], on: 0 });
  assert.equal(gang.autoHunt, 0); assert.equal(gang.safeHunt, 0);
});

test('05C work gang HUD exposes separate persistent Auto Hunt and Safe Hunt buttons through real actions', () => {
  const restore = installDOM();
  try {
    const session = createSession(opts(BG, NA)); session.viewer = BG;
    const sim = session.sim, gang = spawn(sim, BG, 'thrall_gang', 100, 490);
    const game = { session, sim, viewer: BG, selection: createSelection(sim), ui: {}, controlGroups: createControlGroups() };
    game.selection.set([gang.id]); game.actions = createActions(game);
    const H = { root: new TestElement(), quick: new TestElement(), markDirty() {}, notify() {},
      cmd: (id, text, act, p) => { const b = button('cmd', text, act, p.title); b.dataset.action = id; b.classList.toggle('on', p.on); return b; } };
    const hud = createP4Hud(game, H);
    const buttons = () => { const out = []; hud.squadCommands([gang], out); return out; };
    let bs = buttons(); assert.equal(bs.length, 2); assert.ok(bs[0].classList.contains('on') && bs[1].classList.contains('on'));
    bs[0].dispatch('pointerdown', { pointerType: 'touch' }); bs[0].click(); stepSimulation(sim);
    assert.equal(session.commandLog.at(-1).type, CMD.SET_AUTO_HUNT);
    assert.equal(gang.autoHunt, 0); assert.equal(gang.safeHunt, 1);
    bs = buttons(); assert.ok(!bs[0].classList.contains('on') && bs[1].classList.contains('on'));
    bs[1].click(); stepSimulation(sim);
    assert.equal(session.commandLog.at(-1).type, CMD.SET_SAFE_HUNT);
    assert.equal(gang.autoHunt, 0); assert.equal(gang.safeHunt, 0);
    buttons()[0].click(); stepSimulation(sim);
    assert.equal(gang.autoHunt, 1); assert.equal(gang.safeHunt, 0);
  } finally { restore(); }
});

test('05C victorious melee storm exits through the doorway when its troop cannot occupy ruins', () => {
  for (const risen of [false, true]) {
    const { sim, st, def, atk } = assaultFixture(risen);
    let inside = false;
    run(sim, 35, () => {
      if (atk.order.t !== 'storm' || atk.order.phase !== 'inside') return;
      inside = true;
      for (const m of def.members) if (m.state === 'alive') m.hp = 1;
      return false;
    });
    assert.ok(inside, 'assault enters before weakened defenders fall');
    run(sim, 60);
    assert.equal(alive(def), 0); assert.greater(alive(atk), 0);
    assert.ok(!st.holder && !st.contested, 'cleared neutral ruin no longer contested');
    assert.notEqual(atk.order.t, 'storm');
    const g = garrisonGeom(sim, st);
    assert.equal(atk.members.filter((m) => m.state === 'alive' && insideRuin(g.r, m.x, m.z)).length, 0, 'survivors leave rather than becoming trapped inside');
  }
});

test('05C low-material Sultanate AI uses paid-world salvage to resume its economy', () => {
  const sim = createSimulation(opts(IS, BG, true, 67));
  sim.state.factions[BG].controller = 'player';
  sim.state.factions[IS].resources.material = 0;
  const eng = sim.state.squads.find((q) => q.type === 'sultanate_sapper');
  const node = sim.state.nodes.find((n) => n.amount > 0 && Math.hypot(n.x - eng.cx, n.z - eng.cz) < 140);
  assert.ok(node); node.seenBy |= sideBit(IS);
  let command = false, worked = false;
  run(sim, 120, (s) => {
    command ||= s.state.pending.some((c) => c.type === CMD.SALVAGE_AREA && c.faction === IS);
    worked ||= eng.order.t === 'gather' && eng.carry > 0;
  });
  assert.ok(command && worked, 'Sapper salvages instead of waiting forever for unaffordable construction');
});

test('05C AUTO HUNT travels to distant explored habitat, kills, harvests, delivers, repeats and retreats from new threat', () => {
  const sim = makeSim(); clearUnits(sim); const g = spawn(sim, BG, 'thrall_gang', 160, 120);
  sim.state.fog.seen[sideIndex(BG)].fill(1); g.huntMemo = {};
  for (const h of sim.world.habitats) if (h.id !== 'h_forest_e') g.huntMemo[h.id] = 20000;
  const a = animal(sim, 244, 198, 'sheep', 'h_forest_e'); a.visibleTo = a.seenBy = 0;
  let travelled = false, carried = false, delivered = 0, repeat = false;
  const a0 = [g.cx, g.cz];
  run(sim, 150, (s) => {
    travelled ||= g.order.phase === 'travel' && Math.hypot(g.cx - a0[0], g.cz - a0[1]) > 50;
    carried ||= g.carry > 0;
    for (const e of s.events) if (e.type === EV.RESOURCE_DELIVERED && e.squadId === g.id) delivered += e.amount;
    repeat ||= delivered > 0 && g.order.auto && g.order.phase === 'travel';
  });
  assert.ok(travelled && carried && repeat && delivered > 0, 'full autonomous economy loop');
  assert.equal(sim.state.factions[BG].stats.animalsKilled, 1);
  const enemy = spawn(sim, NA, 'yeoman_rifle', g.cx + 12, g.cz, 0); enemy.visibleTo = 255;
  let fled = false;
  run(sim, 2, (s) => { fled ||= g.order.phase === 'to_drop' || s.events.some((e) => e.key === 'gang.fled'); });
  assert.ok(fled, 'new threat breaks travel and returns toward a drop-off');
  assert.equal(g.autoHunt, 1, 'safety retreat does not consume sticky automation');
});

test('05C selected prey may cross the forage circle but a timed-out chase ends', () => {
  const sim = makeSim(); clearUnits(sim); const g = spawn(sim, BG, 'thrall_gang', 160, 140);
  const a = animal(sim, 200, 140);
  g.order = { t: 'gather', mode: 'forage', fx: 160, fz: 140, fr: 12, phase: 'hunt', aid: a.id, auto: 1, huntStart: 1, t2: 0 };
  run(sim, 0.2);
  assert.equal(g.order.aid, a.id, 'beyond small forage radius does not drop chosen animal');
  g.order.huntStart = -1400;
  run(sim, 0.05);
  assert.notEqual(g.order.aid, a.id, 'bounded chase time');
});

test('05C every IS build-menu structure places, costs resources and completes through BUILD', () => {
  for (const type of FACTIONS[IS].buildList) {
    const sim = createSimulation(opts(IS, BG)); clearUnits(sim);
    const builder = spawn(sim, IS, 'sultanate_sapper', 180, 520);
    const f = sim.state.factions[IS]; f.resources = { material: 9000, supply: 9000, manpower: 99 };
    f.spec = ['is_engineering', 'is_fire_cordon', 'is_preservation'];
    let params = null;
    const d = STRUCTURES[type];
    for (let z = 480; z <= 550 && !params; z += 10) for (let x = 70; x <= 250; x += 10) {
      const p = d.kind === 'linear' ? { x1: x, z1: z, x2: x + 10, z2: z } : { x, z, rot: Math.PI };
      if (validatePlacement(sim, IS, type, p).ok) { params = p; break; }
    }
    assert.ok(params, type + ' legal placement');
    const last = sim.state.nextId;
    applyCommand(sim, { type: CMD.BUILD, faction: IS, squadIds: [builder.id], stype: type, ...params });
    const site = sim.state.structures.find((s) => s.id >= last && s.type === type);
    assert.ok(site, type + ' site created via command'); assert.less(f.resources.material, 9000);
    run(sim, 100);
    assert.ok(site.built, type + ' construction finishes');
  }
});

test('05C IS specialist nodes repair for material, cleanse infection, stop unsafe income and battery fires', () => {
  const sim = createSimulation(opts(IS, BG)); clearUnits(sim);
  const arsenal = addStructure(sim, 'sultanate_arsenal', IS, { x: 240, z: 500, built: true });
  const redoubt = addStructure(sim, 'sultanate_redoubt', IS, { x: 220, z: 500, built: true }); redoubt.hp -= 100;
  const lab = addStructure(sim, 'jabirean_laboratory', IS, { x: 250, z: 460, built: true });
  seedInfection(sim, lab.x, lab.z, 6, 200, BG); const ci = infectionCellAt(sim.state, lab.x, lab.z);
  const infection = sim.state.infection.v[ci];
  sim.state.tick = 105; ironSultanateLogic.tick(sim, IS);
  assert.greater(redoubt.hp, redoubt.maxHp - 100, 'arsenal actually repairs');
  assert.less(sim.state.infection.v[ci], infection, 'laboratory actually cleans');
  const supply = addStructure(sim, 'sultanate_supply', IS, { x: 230, z: 430, built: true });
  const foe = spawn(sim, BG, 'grail_thrall', 230, 408, 0); foe.visibleTo = 255;
  const f = sim.state.factions[IS], before = f.resources.supply;
  sim.state.tick += 20; ironSultanateLogic.tick(sim, IS);
  const safeIncome = sim.state.structures.filter((s) => s.faction === IS && s !== supply).reduce((n, s) => n + (STRUCTURES[s.type].supplyRate || 0), 0);
  assert.approx(f.resources.supply - before, safeIncome, 1e-6, 'threatened node income suspended');
  const battery = addStructure(sim, 'sultanate_battery', IS, { x: 230, z: 475, rot: Math.PI, built: true });
  spawn(sim, IS, 'azeb', 245, 440, Math.PI); run(sim, 22);
  assert.greater(battery.shots || 0, 0, 'new battery targets and fires');
  void arsenal;
});

test('05C IS speciality doctrine changes actual AI build commands and composition; no invalid plan command types', () => {
  const counts = [];
  for (const [doctrine, spec, wanted] of [['engineers', 'is_engineering', 'sultanate_arsenal'], ['alchemists', 'is_alchemy', 'jabirean_laboratory'], ['counterguard', 'is_discipline', null]]) {
    const sim = createSimulation(opts(IS, BG, true, 20)); sim.state.factions[BG].controller = 'player';
    const f = sim.state.factions[IS]; f.spec = [spec, null, null]; f.resources = { material: 3000, supply: 3000, manpower: 150 };
    stepSimulation(sim); sim.state.ai[IS].doctrine = doctrine;
    const built = new Set();
    run(sim, 130, (s) => { for (const c of s.state.pending) {
      assert.ok(Object.values(CMD).includes(c.type), 'valid command kind: ' + c.type);
      if (c.faction === IS && c.type === CMD.BUILD) built.add(c.stype);
    } });
    if (wanted) assert.ok(built.has(wanted), doctrine + ' specialty building used by AI');
    assert.ok(built.has('sultanate_bulwark') || built.has('sultanate_redoubt'), 'layered defence actually built');
    const types = {}; for (const q of sim.state.squads) if (q.faction === IS) types[q.type] = (types[q.type] || 0) + 1;
    counts.push(types);
  }
  assert.greater(counts[0].sultanate_sapper, counts[2].sultanate_sapper);
  assert.greater(counts[1].jabirean_alchemist, counts[2].jabirean_alchemist);
  assert.greater(counts[2].janissary, counts[0].janissary);
});

test('05C IS HQ quick select remains camera invariant in reversed and mirror roles', () => {
  for (const [a, b] of [[NA, IS], [IS, BG], [IS, IS]]) {
    const sim = createSimulation(opts(a, b)), viewer = sim.state.sides.find((s) => s.faction === IS && s.role === 'attacker')?.id || IS;
    const camera = { x: 20, z: 60, tx: 25, tz: 50, yaw: 0.7, pitch: 0.6, dist: 90, zoom: 1.3 };
    const before = JSON.stringify(camera), selection = createSelection(sim);
    const game = { sim, viewer, camera, selection };
    assert.ok(selectStructureShortcut(game, 'HQ')); assert.equal(sim.rt.structById.get(selection.struct).faction, viewer);
    assert.equal(JSON.stringify(camera), before);
  }
});

test('05C economy overlays separate BG habitat/biomass/plague from NA sectors and IS secured nodes', () => {
  for (const fid of [NA, BG, IS]) {
    const sim = createSimulation(opts(fid, fid === BG ? NA : BG));
    sim.state.fog.seen[sideIndex(fid)].fill(1); sim.state.fog.vis[sideIndex(fid)].fill(1);
    for (const s of sim.state.sectors) s.seenBy |= sideBit(fid);
    corpse(sim, 162, 505, 0); animal(sim, 175, 502);
    const kinds = new Set(economyViewItems(sim, fid).map((i) => i.kind));
    if (fid === BG) {
      for (const k of ['habitat', 'corpse', 'animal', 'dropoff', 'plague']) assert.ok(kinds.has(k), k);
      assert.ok(!kinds.has('sector') && !kinds.has('heap')); assert.equal(usesResourceSectors(fid), false);
    } else if (fid === NA) { assert.ok(kinds.has('sector')); assert.ok(usesResourceSectors(fid)); }
    else { assert.ok(kinds.has('fortification') && kinds.has('depot')); assert.ok(!kinds.has('sector')); }
  }
});

test('05C seeded independent doctrines and risk-budgeted enemy-facing settlement arcs', () => {
  const a = createSimulation(opts(NA, NA)), b = createSimulation(opts(NA, NA));
  for (const s of a.state.sides) { a.state.ai[s.id] = {}; ensureDoctrine(a, s.id, a.state.ai[s.id]); }
  for (const s of b.state.sides) { b.state.ai[s.id] = {}; ensureDoctrine(b, s.id, b.state.ai[s.id]); }
  assert.equal(stateHash(a), stateHash(b));
  const st = addStructure(a, 'settlement', NA, { x: 65, z: 370, rot: 0, built: true });
  const low = settlementRisk(a, NA, st);
  const en = spawn(a, a.state.sides[1].id, 'yeoman_rifle', st.x + 35, st.z, 0); en.visibleTo = 255;
  corpse(a, st.x, st.z, 50); st.lastDamageTick = a.state.tick;
  const high = settlementRisk(a, NA, st);
  assert.greater(high.score, low.score); assert.ok(high.budget >= 0.3 && high.budget <= 0.4);
  const plan = defensePlan(a, NA, st, high), wire = plan[0];
  assert.greater((wire.x1 + wire.x2) / 2, st.x, 'arc faces visible eastern threat');
  assert.ok(plan.some((p) => p.stype === 'pillbox' || p.stype === 'fire_post'));
});

test('05C v7 -> v8 preserves independent automation, slots, specialties and per-SIDE mirror infection', () => {
  const sim = createSimulation(opts(BG, BG)); sim.state.version = 7;
  const gang = spawn(sim, BG, 'thrall_gang', 140, 505); gang.autoHunt = 0; delete gang.safeHunt; delete gang.huntMemo;
  const raw = JSON.parse(serializeSave(sim.state)); raw.version = 7;
  const loaded = deserializeSave(JSON.stringify(raw)).state, q = loaded.squads.find((s) => s.id === gang.id);
  assert.equal(loaded.version, STATE_VERSION); assert.equal(q.autoHunt, 0); assert.equal(q.safeHunt, 1);
  assert.deepEqual(loaded.structures.map((s) => s.quickSlot), sim.state.structures.map((s) => s.quickSlot));
  assert.equal(encodeState(loaded.infection), encodeState(sim.state.infection));
  assert.deepEqual(loaded.sides, sim.state.sides);
  const old = spawn(sim, BG, 'grail_thrall', 130, 330, 0, { size: 4 }); old.spawnTick = 25;
  const depleted = spawn(sim, BG, 'grail_thrall', 140, 330); depleted.spawnTick = 25; depleted.members.length = 2;
  const oldSave = JSON.parse(serializeSave(sim.state)); oldSave.version = 7;
  const migrated = deserializeSave(JSON.stringify(oldSave)).state;
  assert.equal(migrated.squads.find((s) => s.id === old.id).autonomous, 'risen', 'legacy reanimation cap migrated');
  assert.ok(!migrated.squads.find((s) => s.id === depleted.id).autonomous, 'depleted paid horde stays player-controlled');
});

test('05C all nine AI matchups produce, build, preserve fog ownership and deterministic save continuation without NaN/deadlock', () => {
  const matrix = [[NA, BG], [BG, NA], [NA, IS], [IS, NA], [BG, IS], [IS, BG], [NA, NA], [BG, BG], [IS, IS]];
  for (let i = 0; i < matrix.length; i++) {
    const [a, b] = matrix[i], sim = createSimulation(opts(a, b, true, 401 + i));
    const commands = new Set();
    run(sim, 55, (s) => { for (const c of s.state.pending) { assert.equal(c.source, 'ai'); commands.add(c.type); } });
    for (const type of [CMD.CHOOSE_SPECIALITY, CMD.TRAIN, CMD.MOVE]) assert.ok(commands.has(type), a + '/' + b + ' ' + type);
    assert.ok(sim.state.sides.every((s) => sim.state.ai[s.id].doctrine && sim.state.factions[s.id].stats.trained > 0));
    assert.notEqual(sideIndex(sim.state.sides[0].id), sideIndex(sim.state.sides[1].id));
    const copy = simulationFromState(deserializeSave(serializeSave(sim.state)).state);
    run(sim, 25); run(copy, 25); assert.equal(stateHash(sim), stateHash(copy), a + '/' + b + ' deterministic continue');
    assert.ok(sim.state.tick >= 1600); finite(sim.state);
    sim.state.match.warEndTick = sim.state.tick + 1; run(sim, 1);
    assert.equal(sim.state.match.phase, 'ENDED', 'objective clock resolves');
    assert.ok(sim.state.sides.some((s) => s.id === sim.state.match.winner));
  }
});
