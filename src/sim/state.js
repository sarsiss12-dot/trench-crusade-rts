// GameState creation + entity factories. GameState is plain data (JSON-serializable through the
// save codec, which also encodes typed arrays). No DOM / WebGL / functions / class instances.
import { STATE_VERSION, TICK_RATE } from './constants.js';
import { createRngState } from '../core/rng.js';
import { rotateOffset } from '../core/dmath.js';
import { FACTIONS, FACTION_ORDER } from '../data/factions.js';
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
  const warMinutes = settings.warMinutes !== undefined ? settings.warMinutes : scenario.warMinutes;
  const prepSeconds = settings.prepSeconds !== undefined ? settings.prepSeconds : scenario.prepSeconds;
  const playerFaction = settings.playerFaction !== undefined ? settings.playerFaction : 'new_antioch';
  const controllers = {};
  for (const fid of FACTION_ORDER) {
    const forced = settings.controllers && settings.controllers[fid];
    controllers[fid] = forced || (fid === playerFaction ? 'player' : 'ai');
  }
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
    },
    tick: 0,
    match: {
      phase: prepSeconds > 0 ? 'PREPARATION' : 'WAR',
      prepEndTick: Math.round(prepSeconds * TICK_RATE),
      warEndTick: Math.round((prepSeconds + warMinutes * 60) * TICK_RATE),
      winner: null, reason: null, endTick: 0,
    },
    factions: {},
    nextId: 1,
    squads: [],
    structures: [],
    corpses: [],
    nodes: [],
    effects: [],
    fog: createFogState(world.width, world.height, FACTION_ORDER.length),
    infection: {
      cs: INFECTION_CELL,
      cols: Math.ceil(world.width / INFECTION_CELL),
      rows: Math.ceil(world.height / INFECTION_CELL),
      v: new Uint8Array(Math.ceil(world.width / INFECTION_CELL) * Math.ceil(world.height / INFECTION_CELL)),
    },
    weather: { ...scenario.weather },
    objectives: [],
    ai: {},
    rng: { main: createRngState(seed), ai: createRngState((seed ^ 0x51ed27) >>> 0) },
    pending: [],
    commandSeq: 0,
  };
  for (const fid of FACTION_ORDER) {
    const fdef = FACTIONS[fid];
    const abilities = {};
    for (const a of fdef.abilities) abilities[a] = { readyTick: 0 };
    state.factions[fid] = {
      id: fid,
      role: scenario.roles[fid],
      controller: controllers[fid],
      resources: { ...zeroResources(fdef), ...(scenario.resources[fid] || {}) },
      stats: { kills: 0, losses: 0, built: 0, raised: 0, trained: 0, corpsesHarvested: 0 },
      abilities,
      population: 0,
      timers: { econ: 0, food: 0, reinforce: 0, infection: 0 },
    };
    state.ai[fid] = null;
  }
  return state;
}

export function allocId(state) {
  return state.nextId++;
}

export function createSoldier(state, def, slot, x, z, rot, soldierState = 'alive') {
  return {
    id: allocId(state), slot, x, z, vx: 0, vz: 0, rot,
    hp: def.hp, state: soldierState, stateTick: state.tick,
    cooldown: 0, burst: 0, shots: 0, targetId: 0,
    infection: 0, cover: 0, postId: 0, postSlot: -1, working: 0, killer: '', ready: 0,
    // stuck recovery (units/movement.js): progress window origin, rescue detour, attempts
    wx: x, wz: z, dp: null, di: 0, dgx: 0, dgz: 0, dtry: 0, stk: 0,
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
  if (def.weapon) { s.cooldown = 0; s.burst = 0; s.targetId = 0; s.shots = 0; }
  if (params.variant) s.variant = params.variant;
  if (params.objective) s.objective = true;
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
