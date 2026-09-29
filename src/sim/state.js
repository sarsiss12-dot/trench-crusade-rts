// GameState creation + entity factories. GameState is plain data (JSON-serializable through the
// save codec, which also encodes typed arrays). No DOM / WebGL / functions / class instances.
import { STATE_VERSION, TICK_RATE } from './constants.js';
import { createRngState } from '../core/rng.js';
import { rotateOffset } from '../core/dmath.js';
import { FACTIONS, FOG_LAYERS } from '../data/factions.js';
import { startingPackage } from '../data/packages.js';
import { resolveSides } from './sides.js';
import { AI_DIFFICULTY } from '../data/ai.js';
import { prepSecondsFor, ENDLESS_PACE_MINUTES } from '../data/scenarios.js';
import { createLullState } from './lull.js';
import { createWeatherState } from './weather.js';
import { unitDef } from '../data/units.js';
import { structDef } from '../data/structures.js';
import { createFogState } from '../world/fog.js';
import { formationOffsets } from '../units/formation.js';
import { trenchSlotCount } from '../construction/trench.js';

export const INFECTION_CELL = 8;

export function zeroResources(fdef) {
  const r = {};
  for (const k of fdef.resources) r[k] = 0;
  return r;
}

export function createInitialState({ scenario, settings, seed, world }) {
  // Phase 4.1: an ENDLESS war ('endless' / settings.endless) has no time limit; its pacing formulas
  // (speciality tiers, Pestilence) use a nominal ENDLESS_PACE_MINUTES war
  const endless = settings.endless === true || settings.warMinutes === 'endless';
  const warMinutes = endless ? ENDLESS_PACE_MINUTES : settings.warMinutes !== undefined ? settings.warMinutes : scenario.warMinutes;
  // Phase 3: preparation length follows the match length (data: scenarios PREP_BY_LENGTH)
  const prepDefault = scenario.prepByLength ? prepSecondsFor(warMinutes, scenario.prepSeconds) : scenario.prepSeconds;
  const prepSeconds = settings.prepSeconds !== undefined ? settings.prepSeconds : prepDefault;
  // Phase 5A: the participants come from the setup (Lore preset / Free Setup / explicit sides):
  // SIDE ids own everything; FACTION is content; ROLE picks the start region (sim/sides.js)
  const { sides, player } = resolveSides(scenario, settings);
  const playerFaction = player; // legacy name: the player's SIDE id
  const controllers = {};
  for (const sd of sides) controllers[sd.id] = sd.controller;
  const state = {
    version: STATE_VERSION,
    scenarioId: scenario.id,
    mapId: scenario.map,
    mapSeed: scenario.mapSeed,
    seed: seed >>> 0,
    settings: {
      warMinutes, prepSeconds, playerFaction, controllers,
      sandbox: !!scenario.sandbox,
      stressSoldiers: settings.stressSoldiers || 0,
      lulls: settings.lulls !== undefined ? settings.lulls : 'auto',
      endless,
      rain: settings.rain !== undefined ? settings.rain : 'auto',
      // Phase 5A: how the match was set up (Lore preset / Free Setup) and the AI difficulty
      setupMode: settings.setup && settings.setup.mode === 'free' ? 'free' : 'lore',
      aiDifficulty: AI_DIFFICULTY[settings.aiDifficulty] ? settings.aiDifficulty : 'normal',
    },
    // Phase 5A: match participants in slot order { id, faction, role, region }
    sides: sides.map((sd) => ({ id: sd.id, faction: sd.faction, role: sd.role, region: sd.region })),
    tick: 0,
    match: {
      phase: prepSeconds > 0 ? 'PREPARATION' : 'WAR',
      prepEndTick: Math.round(prepSeconds * TICK_RATE),
      warEndTick: endless ? 0 : Math.round((prepSeconds + warMinutes * 60) * TICK_RATE), // 0 = no time limit
      endless: endless ? 1 : 0, warMinutes,
      winner: null, reason: null, endTick: 0,
      victory: scenario.victory || 'siege', // Phase 5A: 'siege' | 'annihilation' (scenario contract)
      // operational reorganisation windows (seeded, hidden; never a ceasefire — sim/lull.js)
      lull: createLullState(seed, warMinutes, scenario.mode === 'siege' || scenario.mode === 'open' ? (settings.lulls !== undefined ? settings.lulls : 'auto') : 0, endless),
    },
    factions: {},
    nextId: 1,
    squads: [],
    structures: [],
    corpses: [],
    nodes: [],
    effects: [],
    craters: [], // persistent shell craters (sim/abilities.js addCrater, bounded)
    fog: createFogState(world.width, world.height, FOG_LAYERS),
    infection: {
      cs: INFECTION_CELL,
      cols: Math.ceil(world.width / INFECTION_CELL),
      rows: Math.ceil(world.height / INFECTION_CELL),
      v: new Uint8Array(Math.ceil(world.width / INFECTION_CELL) * Math.ceil(world.height / INFECTION_CELL)),
      // Phase 5A: owner layer per cell (sideIndex + 1, 0 = nobody) — a mirror match has two plagues
      o: new Uint8Array(Math.ceil(world.width / INFECTION_CELL) * Math.ceil(world.height / INFECTION_CELL)),
    },
    // Phase 4.1: procedural rain + traffic mud (sim/weather.js)
    ...createWeatherState(scenario.weather, settings.rain, world.width, world.height),
    objectives: [],
    ai: {},
    rng: { main: createRngState(seed), ai: createRngState((seed ^ 0x51ed27) >>> 0), eco: createRngState((seed ^ 0xec0ca5) >>> 0) },
    pending: [],
    commandSeq: 0,
    // Phase 3: resource sectors (richness rolled per match), wildlife, supply convoys
    sectors: [],
    animals: [],
    convoys: [],
  };
  for (const sd of sides) {
    const fid = sd.id;
    const fdef = FACTIONS[sd.faction];
    const abilities = {};
    for (const a of fdef.abilities) abilities[a] = { readyTick: 0 };
    const pkg = startingPackage(sd.faction, sd.role);
    const region = (world.regions || {})[sd.region];
    // per-SIDE state (legacy key "factions"): a mirror twin has its own of everything
    state.factions[fid] = {
      id: fid,
      faction: sd.faction, // content faction
      role: sd.role, // starting strategic role
      region: sd.region, // start region on the map
      zone: region ? { ...region.zone } : { x0: 0, z0: 0, x1: world.width, z1: world.height },
      controller: controllers[fid],
      resources: { ...zeroResources(fdef), ...(pkg.resources || {}), ...((scenario.resources && scenario.resources[sd.role]) || {}) },
      popStart: pkg.population || 0,
      stats: newStats(),
      abilities,
      population: 0, // New Antioch: civilians of the fortress quarter (settlements hold their own)
      pestilence: 0, pestTier: 0, pestLastGain: 0, // Black Grail plague momentum (0..100)
      spec: [null, null, null],
      econ: { mpAcc: 0, mpPopAcc: 0, growAcc: 0, starveAcc: 0, lastManpowerRate: 0, lastFoodRate: 0, safePop: 0, pop: 0, infCells: 0 },
      timers: { econ: 0, food: 0, reinforce: 0, infection: 0 },
      reinfWait: 0, // Phase 4.1: an auto-reinforcement 'waiting for resources' notice was given
    };
    state.ai[fid] = null;
  }
  return state;
}

/** Match statistics per faction (also read by tools/balance.js). */
export function newStats() {
  return {
    kills: 0, losses: 0, built: 0, raised: 0, trained: 0, corpsesHarvested: 0,
    // Phase 3
    civLost: 0, manpowerGained: 0, settlementsBuilt: 0, settlementsLost: 0, firstSettlementTick: -1,
    convoysArrived: 0, convoysLost: 0, animalsKilled: 0, wounded: 0, revived: 0, burned: 0,
    biomass: { passive: 0, animal: 0, corpse: 0, civilian: 0, soldier: 0, old: 0 },
    firstBiomassTick: -1, firstWaveTick: -1, pestMax: 0, greatPestilence: 0, breachTick: -1,
    evacuations: 0, pestBy: {}, pestLostBy: {}, pestTierTick: [0, -1, -1, -1, -1],
  };
}

export function allocId(state) {
  return state.nextId++;
}

export function createSoldier(state, def, slot, x, z, rot, soldierState = 'alive') {
  return {
    id: allocId(state), slot, x, z, vx: 0, vz: 0, rot,
    hp: def.hp, state: soldierState, stateTick: state.tick,
    cooldown: 0, burst: 0, shots: 0, targetId: 0,
    infection: 0, infBy: '', cover: 0, postId: 0, postSlot: -1, working: 0, killer: '', ready: 0,
    gslot: -1, gexit: 0, // Phase 4 ruin garrison slot / leaving through a door
    // stuck recovery (units/movement.js): progress window origin, rescue detour, attempts
    wx: x, wz: z, dp: null, di: 0, dgx: 0, dgz: 0, dtry: 0, stk: 0,
    // Phase 3: burning until tick, plague progression slowed until tick (medic), revive progress
    burn: 0, slow: 0, rev: 0,
  };
}

export function createSquad(state, factionId, unitType, x, z, rot, opts = {}) {
  const def = unitDef(unitType);
  const n = opts.size !== undefined ? opts.size : def.squadSize;
  const sq = {
    id: allocId(state), faction: factionId, type: unitType,
    x, z, rot, vx: 0, vz: 0,
    formation: def.formation,
    members: [],
    order: { t: 'idle' },
    path: null, pathIndex: 0, pathState: 'none', pathReqTick: 0, pathGoalX: x, pathGoalZ: z, pathFails: 0,
    target: null, engaged: false, lastHitTick: -100000, lastFireTick: -100000,
    ammo: def.ammoPerSoldier * n, ammoMax: def.ammoPerSoldier * def.squadSize,
    carry: 0,
    activity: 'idle',
    hordeBonus: 0, debuffUntil: 0,
    visibleTo: 0,
    aiGroup: 0,
    spawnTick: state.tick,
    lag: 0, cx: x, cz: z, working: 0, melee: false,
    reinf: null, suppressUntil: 0,
    // Phase 3: squad size cap (specialities can enlarge new squads), builder queue of site ids,
    // civilian crew state (settlement id + behaviour), tide / fear timers
    cap: opts.cap || n, bq: null, civ: null, tideUntil: 0, fearUntil: 0,
    // biomass source attribution of what a gang carries; next idle auto-forage check (Grail gangs)
    carryBy: null, autoT: 0, autoHunt: 1, // Phase 4.1: work gangs' AUTO SAFE HUNT toggle
    posId: 0, posAuto: 0, garrison: 0, // Phase 4.1 positional auto reinforcement (factions/reinforcement.js)
  };
  const offs = formationOffsets(sq.formation, n, def.spacing);
  const tmp = [0, 0];
  const positions = opts.positions;
  for (let i = 0; i < n; i++) {
    let px, pz;
    if (positions && positions[i]) { px = positions[i][0]; pz = positions[i][1]; }
    else {
      rotateOffset(tmp, offs[2 * i], offs[2 * i + 1], rot);
      px = x + tmp[0]; pz = z + tmp[1];
    }
    sq.members.push(createSoldier(state, def, i, px, pz, rot, opts.soldierState || 'alive'));
  }
  return sq;
}

export function linearLength(p) {
  const dx = p.x2 - p.x1, dz = p.z2 - p.z1;
  return Math.sqrt(dx * dx + dz * dz);
}

export function createStructure(state, type, faction, params) {
  const def = structDef(type);
  const s = {
    id: allocId(state), type, faction,
    x: 0, z: 0, rot: params.rot || 0,
    hp: def.hp, maxHp: def.hp,
    progress: params.built ? (params.progress !== undefined ? params.progress : 1) : (params.progress || 0),
    built: !!params.built,
    work: 0, workRequired: 0,
    visibleTo: 0, seenBy: 0, lastDamageTick: -1000,
  };
  if (def.kind === 'linear') {
    s.x1 = params.x1; s.z1 = params.z1; s.x2 = params.x2; s.z2 = params.z2;
    s.front = params.front === -1 ? -1 : 1;
    s.x = (params.x1 + params.x2) * 0.5;
    s.z = (params.z1 + params.z2) * 0.5;
    s.workRequired = def.workPerM * linearLength(s);
    if (type === 'trench') s.occ = new Array(trenchSlotCount(s)).fill(0);
  } else {
    s.x = params.x; s.z = params.z;
    s.workRequired = def.work || 0;
  }
  if (def.trains) { s.queue = []; s.rally = null; }
  if (def.weapon || def.specWeapon) { s.cooldown = 0; s.burst = 0; s.targetId = 0; s.shots = 0; }
  if (def.emplacement) { s.cooldown = 0; s.aim = s.rot; s.targetId = 0; s.tk = ''; s.shots = 0; }
  // Phase 3 economy runtime fields (economy/settlements.js, factions/civilians.js, sim/wildlife.js)
  if (def.settlement) {
    s.pop = 0; s.stock = { food: 0, material: 0, supply: 0 }; s.threat = -100000; s.evac = 0; s.evacAt = 0;
    s.crew = 0; s.found = 0; s.lastConvoy = state.tick; s.grow = 0; s.lastCrew = state.tick;
  }
  if (def.pen) { s.herdX = s.x; s.herdZ = s.z; s.drover = 0; s.droverT = -100000; }
  if (def.farm || def.pen || def.quarry) s.host = params.host || 0;
  if (params.variant) s.variant = params.variant;
  if (params.objective) s.objective = true;
  // Phase 5A hotfix: optional fixed quick-select identity for starting production/HQ structures.
  // Plain state so save/load keeps A/B/C/HQ bound to the same physical building without moving camera.
  if (params.quickSlot) s.quickSlot = params.quickSlot;
  s.work = s.built ? s.workRequired : s.workRequired * s.progress;
  if (!s.built) s.hp = Math.max(1, Math.round(def.hp * Math.max(0.12, s.progress)));
  return s;
}

export function createNode(state, type, x, z, amount) {
  return { id: allocId(state), type, x, z, amount, max: amount, seenBy: 0 };
}

export function aliveCount(sq) {
  let n = 0;
  for (let i = 0; i < sq.members.length; i++) if (sq.members[i].state === 'alive') n++;
  return n;
}

export function isSquadAlive(sq) {
  for (let i = 0; i < sq.members.length; i++) {
    const st = sq.members[i].state;
    if (st === 'alive' || st === 'rising' || st === 'joining') return true;
  }
  return false;
}
