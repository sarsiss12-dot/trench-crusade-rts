// Simulation core: fixed-tick deterministic step over plain-data GameState.
// Same initial state + seed + commands + ticks => same result (tested).
// Render / UI / audio never mutate state; they consume sim.events after each tick.
import { scenarioDef } from '../data/scenarios.js';
import { mapDef } from '../data/maps.js';
import { generateWorld } from '../world/mapgen.js';
import { FOG_INTERVAL } from './constants.js';
import { createInitialState } from './state.js';
import { createRuntime, reindexAll, structuresChanged, rebuildSoldierGrid } from './runtime.js';
import { setupScenario } from './scenario.js';
import { applyCommand } from './commands.js';
export { enqueueCommand } from './commands.js';
import { updateMatch, checkVictory } from './match.js';
import { processPathRequests, updateOrders } from '../units/orders.js';
import { updateMovement } from '../units/movement.js';
import { updateCombat, updateDeaths } from '../combat/combat.js';
import { updateConstruction } from '../construction/construction.js';
import { updateProduction } from './production.js';
import { updateEffects } from './abilities.js';
import { updateFactions, setupFactions } from '../factions/registry.js';
import { updateVision } from './perception.js';
import { runAI } from '../ai/ai.js';
import { hashState } from '../save/codec.js';
import { updateEngineers } from '../units/engineers.js';
import { updateWildlife, setupWildlife } from './wildlife.js';
import { setupSectors } from '../economy/sectors.js';
import { rebuildAuras } from './auras.js';

const worldCache = new Map();

/** Static world is a pure function of (map, seed): cache it (never mutated). */
export function getWorld(mapId, mapSeed) {
  const key = mapId + ':' + mapSeed;
  let w = worldCache.get(key);
  if (!w) {
    w = generateWorld(mapDef(mapId), mapSeed);
    worldCache.set(key, w);
  }
  return w;
}

function finishInit(sim) {
  reindexAll(sim);
  structuresChanged(sim);
  for (const sq of sim.state.squads) {
    let n = 0, cx = 0, cz = 0;
    for (const m of sq.members) { cx += m.x; cz += m.z; n++; }
    if (n) { sq.cx = cx / n; sq.cz = cz / n; }
  }
  rebuildSoldierGrid(sim);
}

/**
 * Create a new match.
 * opts: { scenarioId, seed, settings: { playerFaction, warMinutes, prepSeconds, controllers, stressSoldiers } }
 */
export function createSimulation(opts = {}) {
  const scenario = scenarioDef(opts.scenarioId || 'siege_default');
  const seed = (opts.seed !== undefined ? opts.seed : 1337) >>> 0;
  const world = getWorld(scenario.map, scenario.mapSeed);
  const state = createInitialState({ scenario, settings: opts.settings || {}, seed, world });
  const sim = { state, world, rt: null, events: [], scenario };
  createRuntime(sim);
  setupScenario(sim, scenario);
  // Phase 3 living world: sectors (per-match richness), wildlife, faction setup (civilians)
  setupSectors(state, world);
  if (scenario.mode !== 'stress') {
    // the battle benchmark stays a pure soldier load (living-world cost is measured separately)
    setupWildlife(sim);
    setupFactions(sim);
  } else state.habitats = [];
  finishInit(sim);
  rebuildAuras(sim);
  updateVision(sim);
  sim.events.length = 0;
  return sim;
}

/** Rebuild a simulation around an existing (e.g. loaded) GameState. */
export function simulationFromState(state) {
  const scenario = scenarioDef(state.scenarioId);
  const world = getWorld(state.mapId, state.mapSeed);
  const sim = { state, world, rt: null, events: [], scenario };
  createRuntime(sim);
  // a save migrated from Phase 2 has no living world yet: build it deterministically from its seed
  if (state.p3init === 0) {
    setupSectors(state, world);
    setupWildlife(sim);
    reindexAll(sim);
    setupFactions(sim);
    state.p3init = 1;
  }
  reindexAll(sim);
  structuresChanged(sim);
  rebuildSoldierGrid(sim);
  rebuildAuras(sim);
  return sim;
}

const due = [];

function applyPending(sim) {
  const { state } = sim;
  if (!state.pending.length) return;
  due.length = 0;
  let w = 0;
  for (const c of state.pending) {
    if (c.tick <= state.tick) due.push(c);
    else state.pending[w++] = c;
  }
  state.pending.length = w;
  due.sort((a, b) => a.tick - b.tick || a.seq - b.seq);
  for (const c of due) applyCommand(sim, c);
}

export function stepSimulation(sim) {
  const { state } = sim;
  state.tick++;
  applyPending(sim);
  updateMatch(sim);
  if (state.match.phase !== 'ENDED') {
    runAI(sim);
    processPathRequests(sim);
    updateOrders(sim);
    updateEngineers(sim);
    updateMovement(sim);
    updateWildlife(sim);
    updateCombat(sim);
    updateConstruction(sim);
    updateProduction(sim);
    updateEffects(sim);
    updateFactions(sim);
  }
  updateDeaths(sim);
  if (state.tick % FOG_INTERVAL === 0) updateVision(sim);
  checkVictory(sim);
}

/** Run n ticks, discarding events (headless use: tests, balance tools). */
export function runTicks(sim, n, onTick) {
  for (let i = 0; i < n; i++) {
    stepSimulation(sim);
    if (onTick) onTick(sim);
    sim.events.length = 0;
  }
}

export function stateHash(sim) {
  return hashState(sim.state);
}
