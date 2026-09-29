// SIDES (Phase 5A): the match participants. Pure helpers over GameState + world.
//   FACTION = who you are (content, data/factions.js)
//   SIDE    = which participant you are (owner id of squads / structures / resources / fog /
//             pestilence / AI memory); id = faction id, or "<faction>~2" for a mirror twin
//   ROLE    = the starting strategic position (attacker / defender), from the setup
//   REGION  = where on the map a role starts (scenario: siege -> defender south, attacker north)
// state.sides = [{ id, faction, role, region }] in slot order (deterministic iteration);
// state.factions[id] is the per-SIDE state (resources, pestilence, stats, zone...). The legacy key
// name "factions" is kept for save compatibility — it is keyed by SIDE id.
import { FACTIONS, mirrorSideId, areHostile } from '../data/factions.js';
import { STRUCTURES } from '../data/structures.js';
import { dsin, dcos } from '../core/dmath.js';

export const ROLES = ['attacker', 'defender'];

/**
 * Resolve the match participants from scenario + settings (pure, deterministic).
 * settings.sides: [{ faction, role, controller? }] (explicit, tools / tests), or
 * settings.setup: { mode, playerFaction, enemyFaction, playerRole } (Match Setup), or legacy:
 * the scenario's Lore preset with settings.playerFaction naming the player's faction.
 * Returns { sides: [{ id, faction, role, region, controller }], player }.
 */
export function resolveSides(scenario, settings = {}) {
  const slots = scenario.slots || ['defender', 'attacker'];
  let want; // role -> { faction, controller }
  if (Array.isArray(settings.sides) && settings.sides.length) {
    want = {};
    for (const s of settings.sides) want[s.role] = { faction: s.faction, controller: s.controller };
  } else if (settings.setup && settings.setup.playerFaction) {
    const su = settings.setup;
    const pr = su.playerRole === 'attacker' ? 'attacker' : 'defender';
    const er = pr === 'attacker' ? 'defender' : 'attacker';
    want = { [pr]: { faction: su.playerFaction, player: true }, [er]: { faction: su.enemyFaction || su.playerFaction } };
  } else {
    const lore = scenario.lore || { defender: 'new_antioch', attacker: 'black_grail' };
    want = { defender: { faction: lore.defender }, attacker: { faction: lore.attacker } };
  }
  const used = {};
  const sides = [];
  for (const role of slots) {
    const w = want[role];
    if (!w || !FACTIONS[w.faction]) throw new Error('Setup: no playable faction for role ' + role);
    used[w.faction] = (used[w.faction] || 0) + 1;
    const id = mirrorSideId(w.faction, used[w.faction]);
    const region = scenario.roles && scenario.roles[role] ? scenario.roles[role].region : role === 'defender' ? 'south' : 'north';
    sides.push({ id, faction: w.faction, role, region, controller: w.controller || '', player: !!w.player });
  }
  // the player's side: Match Setup marks it; legacy settings name the player's faction (or side id)
  let player = sides.find((s) => s.player);
  if (!player) {
    const pf = settings.playerFaction !== undefined ? settings.playerFaction : sides[0].faction;
    player = sides.find((s) => s.id === pf) || sides.find((s) => s.faction === pf) || sides[0];
  }
  const ctl = settings.controllers || {};
  for (const s of sides) {
    s.controller = settings.allAi ? 'ai' : ctl[s.id] || s.controller || (s === player ? 'player' : 'ai');
    delete s.player;
  }
  return { sides, player: player.id };
}

/** Side ids in slot order. */
export function sideIds(state) {
  return state.sides.map((s) => s.id);
}

export function sideRole(state, id) {
  const f = state.factions[id];
  return f ? f.role : null;
}

/** The side holding a role (first in slot order), or null. */
export function sideByRole(state, role) {
  for (const s of state.sides) if (s.role === role) return s.id;
  return null;
}

/** Every side hostile to `id` (2-side matches: the one enemy), slot order. */
export function enemySides(state, id) {
  const out = [];
  for (const s of state.sides) if (s.id !== id) out.push(s.id);
  return out;
}

/**
 * A side's headquarters: its living objective structure if it has one, else its first living
 * HQ-capable structure (STRUCTURES[type].hq — data, never names). Deterministic (lowest id).
 */
export function homeStructure(state, id) {
  let hq = null;
  for (const s of state.structures) {
    if (s.faction !== id || s.hp <= 0) continue;
    if (s.objective) return s;
    if (!hq && STRUCTURES[s.type].hq) hq = s;
  }
  return hq;
}

/** Does the side still hold any HQ-capable structure (built or not)? */
export function hasHq(state, id) {
  for (const s of state.structures) if (s.faction === id && s.hp > 0 && STRUCTURES[s.type].hq) return true;
  return false;
}

/** What `id` marches on: the first hostile side's headquarters (objective first), or null. */
export function enemyTarget(sim, id) {
  const state = sim.state || sim;
  for (const s of state.sides || []) {
    if (!areHostile(id, s.id)) continue;
    const h = homeStructure(state, s.id);
    if (h) return h;
  }
  return null;
}

export function sideRegion(sim, id) {
  const f = sim.state.factions[id];
  const regions = sim.world.regions || {};
  return (f && regions[f.region]) || null;
}

/** Generic anchors of the side's start region (line / base / reserve / mass / support / elite / home). */
export function sideAnchors(sim, id) {
  const r = sideRegion(sim, id);
  return (r && r.anchors) || {};
}

export function sideAnchor(sim, id, name, fallback) {
  const a = sideAnchors(sim, id)[name];
  return a && a.length ? a[0] : fallback || [sim.world.width / 2, sim.world.height / 2];
}

/**
 * Where the enemy comes from — the first hostile side's start-region home anchor (public map
 * knowledge: the setup tells both sides where the other starts, never what is there).
 */
export function enemyHomeAnchor(sim, id) {
  for (const s of sim.state.sides || []) {
    if (!areHostile(id, s.id)) continue;
    const a = sideAnchors(sim, s.id).home;
    if (a && a.length) return a[0];
  }
  return [sim.world.width / 2, sim.world.height / 2];
}

/** Unit vector toward the enemy from the side's region ([sin, cos] of the facing). */
export function sideForward(sim, id) {
  const f = sideFacing(sim, id);
  return [Math.round(dsin(f) * 1e6) / 1e6, Math.round(dcos(f) * 1e6) / 1e6];
}

/** Heading toward the enemy from the side's region (0 = +z / south, PI = -z / north). */
export function sideFacing(sim, id) {
  const r = sideRegion(sim, id);
  return r ? r.facing : 0;
}

/** Build / deployment zone of a side (plain data in its state). */
export function sideZone(state, id) {
  const f = state.factions[id];
  return f ? f.zone : null;
}

// ------------------------------------------------------------------ region transforms

/** Point reflection through the map centre (the other start region). */
export function reflectPoint(world, x, z) {
  return [world.width - x, world.height - z];
}

/** An authored placement moved into `region` (reflected when authored for the other region). */
export function placeInRegion(world, item, authored, region) {
  if (!authored || authored === region) return { ...item };
  const out = { ...item };
  if (item.x1 !== undefined) {
    [out.x1, out.z1] = reflectPoint(world, item.x1, item.z1);
    [out.x2, out.z2] = reflectPoint(world, item.x2, item.z2);
  }
  if (item.x !== undefined) {
    [out.x, out.z] = reflectPoint(world, item.x, item.z);
    out.rot = (item.rot || 0) + Math.PI;
  }
  return out;
}

const PLAN_CACHE = new WeakMap();

/** A doctrine plan ('fortify' | 'organic') placed in the side's region (cached per world). */
export function planFor(sim, id, kind) {
  const world = sim.world;
  const plan = world.plans && world.plans[kind];
  const f = sim.state.factions[id];
  if (!plan || !f) return [];
  let byKey = PLAN_CACHE.get(world);
  if (!byKey) { byKey = new Map(); PLAN_CACHE.set(world, byKey); }
  const key = kind + '|' + f.region;
  let items = byKey.get(key);
  if (!items) {
    items = plan.items.map((it) => placeInRegion(world, it, plan.region, f.region));
    byKey.set(key, items);
  }
  return items;
}

const LANE_CACHE = new WeakMap();

/**
 * Attack lanes from the side's region toward the enemy. The map authors them for a NORTHERN
 * attacker (north -> south); a southern side gets them point-reflected (its own zone edge ->
 * the northern home), the same way doctrine plans and packages move between regions.
 */
export function lanesFor(sim, id) {
  const world = sim.world;
  const f = sim.state.factions[id];
  const lanes = world.lanes || {};
  if (!f || f.region === 'north') return lanes;
  let ref = LANE_CACHE.get(world);
  if (!ref) {
    ref = {};
    for (const k in lanes) ref[k] = lanes[k].map((p) => reflectPoint(world, p[0], p[1]));
    LANE_CACHE.set(world, ref);
  }
  return ref;
}
