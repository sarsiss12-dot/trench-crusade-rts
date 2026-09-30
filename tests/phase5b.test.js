// Phase 05B: Iron Sultanate foundation, Black Grail frontline polish and mobile selection UX.
import { test, assert } from './harness.js';
import { createSimulation, stepSimulation, simulationFromState, stateHash } from '../src/sim/simulation.js';
import { createSession } from '../src/app/session.js';
import { createActions } from '../src/app/actions.js';
import { createStructure } from '../src/sim/state.js';
import { structuresChanged } from '../src/sim/runtime.js';
import { enqueueCommand, CMD } from '../src/sim/commands.js';
import { createSelection, toggleAreaSelect, toggleMultiSelect } from '../src/input/selection.js';
import { createControlGroups } from '../src/input/control_groups.js';
import { createInputController } from '../src/input/controller.js';
import { structureQuickSlots, selectStructureShortcut } from '../src/input/structure_shortcuts.js';
import { createCamera, updateCamera, projectToScreen } from '../src/render/camera.js';
import { groundHeightAt } from '../src/world/ground.js';
import { FACTIONS, FOG_LAYERS, PLANNED_FACTIONS, mirrorSideId, sideIndex } from '../src/data/factions.js';
import { PACKAGES } from '../src/data/packages.js';
import { UNITS } from '../src/data/units.js';
import { STRUCTURES } from '../src/data/structures.js';
import { EMPLACEMENT_WEAPONS } from '../src/data/emplacements.js';
import { SCENARIOS } from '../src/data/scenarios.js';
import { STRATEGY } from '../src/data/ai.js';
import { infectionAt, ownInfectionAt } from '../src/factions/black_grail.js';
import { cleanseInfection } from '../src/factions/pestilence.js';
import { serializeSave, deserializeSave, encodeState } from '../src/save/codec.js';
import { STATE_VERSION } from '../src/sim/constants.js';

const NA = 'new_antioch', BG = 'black_grail', IS = 'iron_sultanate';

function makeMatch(defender, attacker, opts = {}) {
  return createSimulation({
    scenarioId: opts.scenarioId || 'siege_default', seed: opts.seed ?? 51,
    settings: {
      sides: [
        { faction: defender, role: 'defender', controller: opts.ai ? 'ai' : 'player' },
        { faction: attacker, role: 'attacker', controller: opts.ai ? 'ai' : 'player' },
      ],
      prepSeconds: opts.prepSeconds ?? 0, warMinutes: opts.warMinutes || 15, lulls: 0,
    },
  });
}

function run(sim, seconds, visit) {
  for (let i = 0, n = Math.round(seconds * 20); i < n; i++) {
    stepSimulation(sim);
    if (visit) visit(sim);
    sim.events.length = 0;
    if (sim.state.match.phase === 'ENDED') break;
  }
}

function addBuilt(sim, type, faction, x, z) {
  const st = createStructure(sim.state, type, faction, { x, z, rot: 0, built: true });
  sim.state.structures.push(st); sim.rt.structById.set(st.id, st); structuresChanged(sim);
  return st;
}

function finiteTree(v, path = 'state', seen = new Set()) {
  if (typeof v === 'number') { assert.ok(Number.isFinite(v), path + ' is not finite'); return; }
  if (!v || typeof v !== 'object' || seen.has(v)) return;
  seen.add(v);
  if (ArrayBuffer.isView(v)) { for (let i = 0; i < v.length; i++) assert.ok(Number.isFinite(v[i]), `${path}[${i}]`); return; }
  for (const k of Object.keys(v)) finiteTree(v[k], path + '.' + k, seen);
}

// ------------------------------------------------------------------ Black Grail base / defence

test('05B BG compact base: A/B/C altars are 35-50 m apart, do not overlap, mound is central in both roles', () => {
  for (const [defender, attacker, side] of [[BG, NA, BG], [NA, BG, BG]]) {
    const sim = makeMatch(defender, attacker);
    const altars = sim.state.structures.filter((s) => s.faction === side && s.type === 'grail_altar').sort((a, b) => a.quickSlot.localeCompare(b.quickSlot));
    assert.equal(altars.length, 3);
    assert.deepEqual(altars.map((s) => s.quickSlot), ['A', 'B', 'C']);
    for (let i = 0; i < 2; i++) {
      const d = Math.hypot(altars[i + 1].x - altars[i].x, altars[i + 1].z - altars[i].z);
      assert.ok(d >= 35 && d <= 50, `${defender === BG ? 'defender' : 'attacker'} altar distance ${d}`);
    }
    for (let i = 0; i < altars.length; i++) for (let j = i + 1; j < altars.length; j++) {
      const a = altars[i], b = altars[j], fa = STRUCTURES[a.type].footprint, fb = STRUCTURES[b.type].footprint;
      assert.ok(Math.abs(a.x - b.x) > (fa.w + fb.w) / 2 || Math.abs(a.z - b.z) > (fa.d + fb.d) / 2, 'altar footprints do not overlap');
    }
    const mound = sim.state.structures.find((s) => s.faction === side && s.type === 'corpse_mound');
    const cx = altars.reduce((n, s) => n + s.x, 0) / 3, cz = altars.reduce((n, s) => n + s.z, 0) / 3;
    assert.ok(mound && mound.built);
    assert.less(Math.hypot(mound.x - cx, mound.z - cz), 35, 'mound is in/behind the organic core');
    assert.greater(Math.min(...altars.map((a) => Math.hypot(a.x - mound.x, a.z - mound.z))), 9, 'mound does not block an altar footprint/spawn edge');
  }
});

test('05B BG defender begins with a working, buildable, visually distinct Viscera Nest', () => {
  const sim = makeMatch(BG, NA);
  const nest = sim.state.structures.find((s) => s.faction === BG && s.type === 'viscera_nest');
  assert.ok(nest && nest.built && nest.hp > 0);
  const def = STRUCTURES.viscera_nest, gun = EMPLACEMENT_WEAPONS[def.emplacement];
  assert.ok(def.buildable && def.cost.biomass > 0 && gun.range >= 55 && gun.kind === 'shell');
  assert.notEqual(def.model, STRUCTURES.belcher_nest.model, 'heavy nest has its own silhouette');
  const foe = sim.state.squads.find((q) => q.faction === NA);
  for (const m of foe.members) { m.x = nest.x; m.z = nest.z - 44; }
  foe.x = foe.cx = nest.x; foe.z = foe.cz = nest.z - 44; foe.visibleTo = 0xff;
  let fired = false;
  run(sim, 14, (s) => { if (s.events.some((e) => e.struct === nest.id && e.weapon === 'viscera_shot')) fired = true; });
  assert.ok(fired && nest.shots > 0, 'starting defender nest acquires and fires');
  assert.less(Math.hypot(nest.x - 162, nest.z - 500), gun.range, 'nest covers the mound/core approach');
});

// ------------------------------------------------------------------ data-driven structure shortcuts / camera invariant

test('05B quick select: BG A/B/C and NA HQ are authored, side-safe, stable and camera-invariant', () => {
  const mirror = makeMatch(BG, BG);
  const twin = mirror.state.sides[1].id;
  const slots = structureQuickSlots(mirror.state, twin);
  assert.deepEqual(Object.keys(slots).sort(), ['A', 'B', 'C']);
  assert.ok(Object.values(slots).every((s) => s.faction === twin));
  const original = { A: slots.A.id, B: slots.B.id, C: slots.C.id };
  addBuilt(mirror, 'grail_altar', twin, 250, 90);
  assert.deepEqual(Object.fromEntries(Object.entries(structureQuickSlots(mirror.state, twin)).map(([k, s]) => [k, s.id])), original, 'later altar cannot steal a slot');

  const selection = createSelection();
  const camera = { x: 37, z: 91, tx: 38, tz: 92, yaw: 1.234, pitch: 0.71, dist: 77, zoom: 1.5 };
  const before = JSON.stringify(camera);
  const game = { sim: mirror, viewer: twin, selection, camera, audio: null, hud: { markDirty() {} } };
  assert.ok(selectStructureShortcut(game, 'B'));
  assert.equal(selection.struct, original.B);
  assert.equal(JSON.stringify(camera), before, 'quick selection never touches camera position/rotation/zoom');

  for (const [defender, attacker, side] of [[NA, BG, NA], [BG, NA, NA]]) {
    const sim = makeMatch(defender, attacker);
    const hq = structureQuickSlots(sim.state, side).HQ;
    assert.ok(hq && STRUCTURES[hq.type].hq && hq.faction === side, `${side} ${defender === NA ? 'defender' : 'attacker'} HQ slot`);
  }
});

// ------------------------------------------------------------------ distinct selection lifecycles

function controllerFixture() {
  const hadWindow = 'window' in globalThis;
  if (!hadWindow) globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const session = createSession({ scenarioId: 'siege_default', seed: 3, settings: { playerFaction: NA, prepSeconds: 600, lulls: 0 } });
  const sim = session.sim;
  const ground = (x, z) => groundHeightAt(sim.world, sim.rt.structGrid, x, z);
  const cam = createCamera({ x: 160, z: 470, dist: 90 }); cam.groundFn = ground; updateCamera(cam, 1280, 720, 0);
  const canvas = { width: 1280, height: 720, style: {}, addEventListener() {}, removeEventListener() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) };
  const game = { session, sim, viewer: NA, camera: cam, selection: createSelection(), ui: { areaSelect: false, multiSelect: false }, frame: {}, mode: { kind: 'normal' }, renderer: { groundAt: ground, knownStructures: () => sim.state.structures }, settings: { touchAssist: false }, audio: null, hud: { showBox() {}, hideBox() {}, onSelectionModesChanged() {}, onModeChanged() {} }, notify() {}, controlGroups: createControlGroups() };
  game.actions = createActions(game); game.input = createInputController(canvas, game);
  if (!hadWindow) delete globalThis.window;
  const p = [0, 0, 0, 0];
  const screen = (x, z) => { projectToScreen(cam, x, ground(x, z), z, p); return [p[0], p[1]]; };
  let t = 1000, id = 1;
  const tap = (x, z) => { const [sx, sy] = screen(x, z); t += 700; game.input.gestures.down(id, sx, sy, t, { type: 'touch' }); game.input.gestures.up(id, sx, sy, t + 50); id++; };
  const drag = (x0, z0, x1, z1) => { const [a, b] = screen(x0, z0), [c, d] = screen(x1, z1); t += 700; game.input.gestures.down(id, a, b, t, { type: 'touch' }); for (let k = 1; k <= 8; k++) game.input.gestures.move(id, a + (c - a) * k / 8, b + (d - b) * k / 8, t + k * 16); game.input.gestures.up(id, c, d, t + 160); id++; };
  return { sim, game, cam, tap, drag };
}

test('05B AREA SELECT is one-shot; completion restores the next drag to camera pan without consuming sticky MULTI', () => {
  const { game, cam, drag } = controllerFixture();
  toggleMultiSelect(game.ui);
  toggleAreaSelect(game.ui);
  assert.ok(game.ui.areaSelect && game.ui.multiSelect);
  drag(90, 450, 230, 520);
  assert.greater(game.selection.squads.size, 0, 'box creates a selection');
  assert.equal(game.ui.areaSelect, false, 'pointer release consumes area mode');
  assert.equal(game.ui.multiSelect, true, 'sticky tap mode is independent');
  const x = cam.tx, z = cam.tz;
  drag(60, 400, 90, 420);
  assert.ok(cam.tx !== x || cam.tz !== z, 'next normal drag pans the camera');
  assert.equal(game.ui.areaSelect, false, 'no second selection rectangle lifecycle');
});

test('05B MULTI SELECT stays on through A/B/C taps, toggles selected units off, and only its button turns it off', () => {
  const { sim, game, tap } = controllerFixture();
  const units = sim.state.squads.filter((q) => q.faction === NA && q.type === 'yeoman_rifle').slice(0, 3);
  assert.equal(units.length, 3);
  assert.equal(toggleMultiSelect(game.ui), true);
  for (const q of units) { tap(q.cx, q.cz); assert.equal(game.ui.multiSelect, true, 'tap must not consume sticky mode'); }
  assert.ok(units.every((q) => game.selection.has(q.id)));
  tap(units[1].cx, units[1].cz);
  assert.ok(!game.selection.has(units[1].id), 'tapping a selected unit removes it');
  assert.equal(game.ui.multiSelect, true);
  assert.equal(toggleMultiSelect(game.ui), false, 'only explicit button transition turns it off');
});

// ------------------------------------------------------------------ bridge plague creep

function bridgePlague(seed = 9, x = 162) {
  const sim = makeMatch(NA, BG, { seed });
  addBuilt(sim, 'plague_pit', BG, x, 232); // north bridge/river entry
  return sim;
}

test('05B bridge plague creep crosses cell-by-cell in 30-90 s, cannot cross broad water, and is deterministic', () => {
  const a = bridgePlague(9), b = bridgePlague(9);
  let crossed = -1;
  for (let sec = 1; sec <= 90; sec++) {
    run(a, 1); run(b, 1);
    if (crossed < 0 && infectionAt(a.state, 162, 284) > 0) crossed = sec;
  }
  assert.ok(crossed >= 30 && crossed <= 90, 'bridge crossing seconds: ' + crossed);
  assert.greater(infectionAt(a.state, 162, 244), 0, 'entry infected');
  assert.greater(infectionAt(a.state, 162, 260), 0, 'bridge middle infected');
  assert.greater(infectionAt(a.state, 162, 284), 0, 'opposite bank reached');
  assert.equal(stateHash(a), stateHash(b), 'same seed gives same infection/state hash');

  const water = bridgePlague(9, 120);
  run(water, 90);
  assert.equal(infectionAt(water.state, 120, 284), 0, 'non-bridge deep water is not crossed');
});

test('05B bridge purge cuts the chain, and mirror plague ownership remains per SIDE', () => {
  const sim = bridgePlague(); run(sim, 50);
  assert.greater(infectionAt(sim.state, 162, 260), 0);
  cleanseInfection(sim, 162, 260, 7, 999);
  assert.equal(infectionAt(sim.state, 162, 260), 0, 'cleanse opens a zeroed gap');
  run(sim, 4);
  assert.equal(infectionAt(sim.state, 162, 276), 0, 'the severed line does not instantly teleport onward');

  const mirror = makeMatch(BG, BG, { seed: 12 });
  const twin = mirror.state.sides[1].id;
  addBuilt(mirror, 'plague_pit', BG, 162, 232);
  addBuilt(mirror, 'plague_pit', twin, 162, 292);
  run(mirror, 50);
  assert.greater(ownInfectionAt(mirror.state, BG, 162, 244), 0);
  assert.equal(ownInfectionAt(mirror.state, twin, 162, 244), 0, 'north layer is not the twin layer');
  assert.greater(ownInfectionAt(mirror.state, twin, 162, 284), 0);
  assert.equal(ownInfectionAt(mirror.state, BG, 162, 284), 0, 'south layer is not the first Grail layer');
});

test('05B attacker AI establishes its authored bridge-entry plague source through the command pipeline', () => {
  const sim = makeMatch(NA, BG, { seed: 5, ai: true });
  sim.state.settings.controllers[NA] = 'player';
  sim.state.factions[BG].resources.biomass = 1000;
  let aiCommands = 0;
  run(sim, 90, (s) => { for (const c of s.state.pending) if (c.faction === BG && c.source === 'ai') aiCommands++; });
  const pit = sim.state.structures.find((s) => s.faction === BG && s.type === 'plague_pit' && Math.hypot(s.x - 162, s.z - 224) < 3);
  assert.ok(pit && pit.progress > 0, 'AI has placed and is building the bridge source');
  assert.greater(aiCommands, 0);
});

// ------------------------------------------------------------------ Iron Sultanate contract / save / match matrix

test('05B Iron Sultanate is playable, has the four-role roster, role strategies/packages, and no fake Salt Tank', () => {
  assert.ok(FACTIONS[IS] && !PLANNED_FACTIONS.some((f) => f.id === IS));
  for (const u of ['azeb', 'janissary', 'sultanate_sapper', 'jabirean_alchemist']) {
    assert.equal(UNITS[u].faction, IS); assert.ok(UNITS[u].lore && UNITS[u].lore.status);
  }
  assert.ok(UNITS.azeb.roles.includes('line') && UNITS.janissary.roles.includes('elite'));
  assert.ok(UNITS.sultanate_sapper.roles.includes('builder') && UNITS.jabirean_alchemist.roles.includes('support'));
  for (const role of ['attacker', 'defender']) {
    assert.ok(PACKAGES[IS][role] && STRATEGY[IS][role]);
    assert.ok(PACKAGES[IS][role].forces.some((f) => f.unit === 'sultanate_sapper'));
  }
  assert.ok(!UNITS.salt_tank && !STRUCTURES.salt_tank);
  assert.ok(!FACTIONS[IS].buildList.includes('iron_wall_section'), 'Iron Wall is not a build menu item');
});

test('05B Iron Wall is a gated scenario feature with future segment metadata, not a universal start', () => {
  const sc = SCENARIOS.iron_wall_sector;
  assert.ok(sc.features.some((f) => f.requiresFaction === IS));
  assert.ok(STRUCTURES.iron_wall_section.scenarioFeature.gateReady && STRUCTURES.iron_wall_section.scenarioFeature.destructible);
  const lore = createSimulation({ scenarioId: 'iron_wall_sector', seed: 2, settings: { prepSeconds: 0, controllers: { [IS]: 'player', [BG]: 'player' } } });
  assert.equal(lore.state.structures.filter((s) => s.type === 'iron_wall_section' && s.faction === IS).length, 4); // 05C: connected local sector, two wings.
  const free = makeMatch(NA, IS);
  assert.equal(free.state.structures.filter((s) => s.type === 'iron_wall_section').length, 0, 'IS attacker has no Iron Wall');
  finiteTree(lore.state);
});

test('05B IS economy/production/AI runs through commands in all required matchups, with 3 fog layers and no NaN/deadlock', () => {
  const matrix = [[NA, IS], [IS, NA], [BG, IS], [IS, BG], [IS, IS]];
  for (let k = 0; k < matrix.length; k++) {
    const [defender, attacker] = matrix[k];
    const sim = makeMatch(defender, attacker, { ai: true, seed: 70 + k });
    assert.equal(sim.state.fog.vis.length, FOG_LAYERS); assert.equal(FOG_LAYERS, 3);
    assert.notEqual(sideIndex(sim.state.sides[0].id), sideIndex(sim.state.sides[1].id));
    const own = sim.state.sides.filter((s) => s.faction === IS).map((s) => s.id);
    const res0 = own.map((id) => ({ ...sim.state.factions[id].resources }));
    let aiCommands = 0;
    run(sim, 45, (s) => { for (const c of s.state.pending) { assert.equal(c.source, 'ai', 'AI uses the command queue'); aiCommands++; } });
    assert.greater(aiCommands, 0, defender + ' vs ' + attacker + ' AI commands');
    for (let i = 0; i < own.length; i++) {
      const f = sim.state.factions[own[i]];
      assert.ok(Number.isFinite(f.resources.material) && Number.isFinite(f.resources.supply) && Number.isFinite(f.resources.manpower));
      assert.ok(JSON.stringify(f.resources) !== JSON.stringify(res0[i]), 'IS economy/production changes resources');
      assert.ok(sim.state.structures.some((s) => s.faction === own[i] && STRUCTURES[s.type].hq));
    }
    assert.ok(sim.state.match.phase === 'WAR' || sim.state.match.phase === 'ENDED');
    assert.ok(defender === IS ? sim.state.objectives.some((o) => o.side === sim.state.sides[0].id) : true);
    finiteTree(sim.state);
  }
});

test('05B IS production completes and deterministic save/load continuation preserves mirror sides', () => {
  const sim = makeMatch(IS, IS, { seed: 91 });
  const side = sim.state.sides[0].id, hq = sim.state.structures.find((s) => s.faction === side && STRUCTURES[s.type].hq);
  const f = sim.state.factions[side]; f.resources.material = 999; f.resources.supply = 999; f.resources.manpower = 99;
  const before = sim.state.squads.filter((q) => q.faction === side && q.type === 'azeb').length;
  enqueueCommand(sim, { type: CMD.TRAIN, faction: side, sid: hq.id, unit: 'azeb' });
  run(sim, UNITS.azeb.trainTime + 2);
  assert.greater(sim.state.squads.filter((q) => q.faction === side && q.type === 'azeb').length, before);
  const loaded = deserializeSave(serializeSave(sim.state)).state;
  const copy = simulationFromState(loaded);
  assert.equal(stateHash(copy), stateHash(sim)); run(copy, 10); run(sim, 10); assert.equal(stateHash(copy), stateHash(sim));
});

test('05B v6 save migration expands fog and restores package-authored quick slots', () => {
  const sim = makeMatch(NA, BG, { seed: 33 });
  const raw = JSON.parse(serializeSave(sim.state));
  raw.version = 6; raw.state.version = 6;
  raw.state.fog.vis.length = 2; raw.state.fog.seen.length = 2;
  for (const s of raw.state.structures) delete s.quickSlot;
  const migrated = deserializeSave(JSON.stringify(raw)).state;
  assert.equal(migrated.version, STATE_VERSION);
  assert.equal(migrated.fog.vis.length, 3); assert.equal(migrated.fog.seen.length, 3);
  assert.deepEqual(Object.keys(structureQuickSlots(migrated, NA)), ['HQ']);
  assert.deepEqual(Object.keys(structureQuickSlots(migrated, BG)).sort(), ['A', 'B', 'C']);
  assert.ok(encodeState(migrated).length > 0);
});

test('05B Thrall mobility only: 3.35 combat speed while Thrall Gang tuning is unchanged', () => {
  assert.equal(UNITS.grail_thrall.speed, 3.35);
  assert.ok(UNITS.grail_thrall.speed >= 3.30 && UNITS.grail_thrall.speed <= 3.45);
  assert.equal(UNITS.thrall_gang.speed, 3.6);
  assert.equal(UNITS.thrall_gang.speeds.hunt, 6.2);
  assert.equal(UNITS.thrall_gang.speeds.carry, 4.2);
});

test('05B 480-soldier IS mirror stress stays bounded and finite', () => {
  const sim = createSimulation({ scenarioId: 'stress', seed: 7, settings: { sides: [{ faction: IS, role: 'defender', controller: 'ai' }, { faction: IS, role: 'attacker', controller: 'ai' }], stressSoldiers: 480 } });
  let worst = 0;
  for (let i = 0; i < 300; i++) { const t = performance.now(); stepSimulation(sim); worst = Math.max(worst, performance.now() - t); sim.events.length = 0; }
  finiteTree(sim.state);
  assert.ok(sim.state.squads.length < 180 && sim.state.effects.length < 500);
  console.log('       480 IS mirror stress: worst tick ' + worst.toFixed(1) + ' ms (headless Node)');
});
