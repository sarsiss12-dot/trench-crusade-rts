// Vision + fog-of-war information security.
// updateVision(): stamps faction vision into the fog grid and computes per-entity visibility
// bitmasks (squad.visibleTo, structure.visibleTo/seenBy, corpse.seenBy, node.seenBy).
// The same bitmasks drive AI targeting AND everything the player can see (render, HUD, minimap,
// picking, VFX, audio) via the filter functions below — nothing leaks from behind the fog.
import { unitDef } from '../data/units.js';
import { STRUCTURES } from '../data/structures.js';
import { FACTIONS, FACTION_ORDER } from '../data/factions.js';
import { TERRAIN_TYPES } from '../data/terrain_types.js';
import { EV } from '../core/events.js';
import { clearVisible, stampVision, fogIndex, isVisibleAt, isExploredAt } from '../world/fog.js';
import { cellIndex } from '../world/terrain.js';
import { dsin, dcos } from '../core/dmath.js';
import { hash32 } from '../core/rng.js';

const ALL_BITS = (1 << FACTION_ORDER.length) - 1;

export function factionBit(fid) {
  return FACTIONS[fid] ? 1 << FACTIONS[fid].index : ALL_BITS;
}

function squadPresent(sq) {
  for (let i = 0; i < sq.members.length; i++) {
    const s = sq.members[i].state;
    if (s === 'alive' || s === 'rising' || s === 'joining') return true;
  }
  return false;
}

/**
 * Is soldier m seen by faction index j? In a visible fog cell, and — in concealing terrain
 * (forest / ruins) — close enough to one of that faction's observers.
 */
export function soldierDetectedBy(sim, m, j) {
  const { state, world, rt } = sim;
  const fog = state.fog;
  const fi = fogIndex(fog, m.x, m.z);
  if (fi < 0 || !fog.vis[j][fi]) return false;
  const t = world.terrain;
  const ci = cellIndex(t, m.x, m.z);
  const conceal = ci >= 0 ? TERRAIN_TYPES[t.types[ci]].conceal : 0;
  if (conceal <= 0) return true;
  const src = rt.visionSources[j];
  for (let k = 0; k < src.length; k += 3) {
    const dx = src[k] - m.x, dz = src[k + 1] - m.z;
    const r = src[k + 2] * (1 - conceal);
    if (dx * dx + dz * dz <= r * r) return true;
  }
  return false;
}

function squadDetectedBy(sim, sq, j) {
  for (const m of sq.members) {
    // a falling body does not give its squad away
    if (m.state === 'dead' || m.state === 'dying') continue;
    if (soldierDetectedBy(sim, m, j)) return true;
  }
  return false;
}

function structureSeenBy(fog, st, j) {
  const def = STRUCTURES[st.type];
  if (isVisibleAt(fog, j, st.x, st.z)) return true;
  if (def.kind === 'linear') {
    // any stretch of the line in sight (a soldier seen inside a long trench shows its trench too)
    const dx = st.x2 - st.x1, dz = st.z2 - st.z1;
    const n = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dz * dz) / 4));
    for (let k = 0; k <= n; k++) if (isVisibleAt(fog, j, st.x1 + (dx * k) / n, st.z1 + (dz * k) / n)) return true;
    return false;
  }
  if (!def.footprint) return false;
  const hw = def.footprint.w * 0.5, hd = def.footprint.d * 0.5;
  const s = dsin(st.rot), c = dcos(st.rot);
  const pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  for (const p of pts) {
    const x = st.x - p[0] * c + p[1] * s, z = st.z + p[0] * s + p[1] * c;
    if (isVisibleAt(fog, j, x, z)) return true;
  }
  return false;
}

export function updateVision(sim) {
  const { state, rt } = sim;
  const fog = state.fog;
  clearVisible(fog);
  const sources = rt.visionSources;
  for (let j = 0; j < sources.length; j++) sources[j].length = 0;
  for (const sq of state.squads) {
    if (!squadPresent(sq)) continue;
    const j = FACTIONS[sq.faction].index;
    const r = unitDef(sq.type).vision;
    // anchor-centric vision plus the squad's actual spread (centroid)
    stampVision(fog, j, sq.cx, sq.cz, r);
    sources[j].push(sq.cx, sq.cz, r);
  }
  for (const st of state.structures) {
    const f = FACTIONS[st.faction];
    if (!f) continue;
    const def = STRUCTURES[st.type];
    const r = st.built ? def.vision || 10 : 10;
    if (r <= 0) continue;
    stampVision(fog, f.index, st.x, st.z, r);
    sources[f.index].push(st.x, st.z, r);
  }
  for (const sq of state.squads) {
    const own = FACTIONS[sq.faction].index;
    let bits = 1 << own;
    for (let j = 0; j < FACTION_ORDER.length; j++) {
      if (j !== own && squadDetectedBy(sim, sq, j)) bits |= 1 << j;
    }
    sq.visibleTo = bits;
  }
  for (const st of state.structures) {
    const f = FACTIONS[st.faction];
    if (!f) { st.visibleTo = ALL_BITS; st.seenBy = ALL_BITS; continue; }
    let bits = 1 << f.index;
    for (let j = 0; j < FACTION_ORDER.length; j++) {
      if (j !== f.index && structureSeenBy(fog, st, j)) bits |= 1 << j;
    }
    st.visibleTo = bits;
    st.seenBy |= bits;
  }
  for (const c of state.corpses) {
    for (let j = 0; j < FACTION_ORDER.length; j++) if (isVisibleAt(fog, j, c.x, c.z)) c.seenBy |= 1 << j;
  }
  for (const n of state.nodes) {
    for (let j = 0; j < FACTION_ORDER.length; j++) if (isExploredAt(fog, j, n.x, n.z)) n.seenBy |= 1 << j;
  }
}

// ------------------------------------------------------------------ viewer filters

export function isSquadVisibleTo(sq, viewer) {
  return !!sq && (sq.faction === viewer || (sq.visibleTo & factionBit(viewer)) !== 0);
}

export function isStructureVisibleTo(st, viewer) {
  return !!st && (st.faction === viewer || (st.visibleTo & factionBit(viewer)) !== 0);
}

/** Structures the viewer knows about (seen before). Live info only when currently visible. */
export function isStructureKnownTo(st, viewer) {
  return !!st && (st.faction === viewer || (st.seenBy & factionBit(viewer)) !== 0);
}

export function isCorpseKnownTo(c, viewer) {
  return (c.seenBy & factionBit(viewer)) !== 0;
}

export function isNodeKnownTo(n, viewer) {
  return (n.seenBy & factionBit(viewer)) !== 0;
}

export function isPointVisibleTo(sim, viewer, x, z) {
  const f = FACTIONS[viewer];
  return !!f && isVisibleAt(sim.state.fog, f.index, x, z);
}

/**
 * Presentation gate per soldier: an enemy squad that is detected is still only drawn / picked /
 * summarized through the members actually in sight (a squad strung out into the fog does not
 * reveal its far end). A falling soldier stays visible where the viewer can see the spot.
 */
export function isSoldierVisibleTo(sim, sq, m, viewer) {
  if (sq.faction === viewer) return true;
  const f = FACTIONS[viewer];
  if (!f) return true;
  if (m.state === 'dying') return isVisibleAt(sim.state.fog, f.index, m.x, m.z);
  return (sq.visibleTo & (1 << f.index)) !== 0 && soldierDetectedBy(sim, m, f.index);
}

/** Centroid of the members of sq the viewer can see (false when none). Writes out[0..1]. */
export function visibleCentroid(sim, sq, viewer, out) {
  if (sq.faction === viewer) { out[0] = sq.cx; out[1] = sq.cz; return true; }
  let n = 0, x = 0, z = 0;
  for (const m of sq.members) {
    if (m.state !== 'alive' && m.state !== 'rising' && m.state !== 'joining') continue;
    if (!isSoldierVisibleTo(sim, sq, m, viewer)) continue;
    x += m.x; z += m.z; n++;
  }
  if (!n) return false;
  out[0] = x / n; out[1] = z / n;
  return true;
}

/** Presentation flags for an event from the viewer's perspective. */
export const SHOW = Object.freeze({ NONE: 0, SOURCE: 1, IMPACT: 2, TARGET: 4, ALL: 7 });

/**
 * Decide what part of an event the viewer may perceive. Call right after the tick that emitted it.
 *  SOURCE: muzzle flash / tracer / firing sound / attacker animation
 *  IMPACT: impact particles at the hit point
 *  TARGET: hit reaction on the viewer's own unit (never reveals the shooter)
 */
export function eventVisibility(sim, ev, viewer) {
  const { rt } = sim;
  switch (ev.type) {
    case EV.FIRE:
    case EV.MELEE: {
      const src = rt.squadById.get(ev.sq);
      if (src && isSquadVisibleTo(src, viewer)) return SHOW.ALL;
      const tgt = ev.tsq ? rt.squadById.get(ev.tsq) : null;
      if (tgt && tgt.faction === viewer && ev.hit) return SHOW.TARGET;
      if (ev.struct) {
        const st = rt.structById.get(ev.struct);
        if (st && st.faction === viewer && ev.hit) return SHOW.TARGET;
      }
      return SHOW.NONE;
    }
    case EV.STRUCTURE_FIRE: {
      const st = rt.structById.get(ev.struct);
      if (st && isStructureVisibleTo(st, viewer)) return SHOW.ALL;
      const tgt = ev.tsq ? rt.squadById.get(ev.tsq) : null;
      if (tgt && tgt.faction === viewer && ev.hit) return SHOW.TARGET;
      return SHOW.NONE;
    }
    case EV.HIT:
    case EV.DEATH: {
      if (ev.faction === viewer) return SHOW.ALL;
      const sq = rt.squadById.get(ev.sq);
      return sq && isSquadVisibleTo(sq, viewer) ? SHOW.ALL : SHOW.NONE;
    }
    case EV.SOLDIER_RISING:
    case EV.SQUAD_SPAWNED: {
      if (ev.faction === viewer) return SHOW.ALL;
      return isPointVisibleTo(sim, viewer, ev.x, ev.z) ? SHOW.ALL : SHOW.NONE;
    }
    case EV.SQUAD_DESTROYED:
      return ev.faction === viewer ? SHOW.ALL : SHOW.NONE;
    case EV.EXPLOSION:
    case EV.ABILITY_CAST:
      if (ev.faction === viewer && ev.type === EV.ABILITY_CAST) return SHOW.ALL;
      return isPointVisibleTo(sim, viewer, ev.x, ev.z) ? SHOW.ALL : SHOW.NONE;
    case EV.CORPSE_CREATED: {
      const c = rt.corpseById.get(ev.id);
      return c && isCorpseKnownTo(c, viewer) ? SHOW.ALL : SHOW.NONE;
    }
    case EV.CORPSE_REMOVED:
      return isPointVisibleTo(sim, viewer, ev.x, ev.z) ? SHOW.ALL : SHOW.NONE;
    case EV.STRUCTURE_PLACED:
    case EV.STRUCTURE_PROGRESS:
    case EV.STRUCTURE_COMPLETED:
    case EV.STRUCTURE_DAMAGED: {
      if (ev.faction === viewer) return SHOW.ALL;
      const st = rt.structById.get(ev.id);
      return st && isStructureVisibleTo(st, viewer) ? SHOW.ALL : SHOW.NONE;
    }
    case EV.STRUCTURE_DESTROYED:
      if (ev.faction === viewer) return SHOW.ALL;
      return isPointVisibleTo(sim, viewer, ev.x, ev.z) ? SHOW.ALL : SHOW.NONE;
    case EV.PHASE_CHANGED:
    case EV.MATCH_ENDED:
      return SHOW.ALL;
    default:
      return ev.faction === viewer ? SHOW.ALL : SHOW.NONE;
  }
}

function sourceVisibleTo(sim, src, viewer) {
  if (!src) return true;
  if (src > 0) return isSquadVisibleTo(sim.rt.squadById.get(src), viewer);
  return isStructureVisibleTo(sim.rt.structById.get(-src), viewer);
}

function hashAngle(a, b, c) {
  return (hash32(a, b, c) / 4294967296) * 6.283185307179586;
}

/**
 * The event as the viewer may experience it. Shots the viewer only feels (a hidden shooter hitting
 * the viewer's soldier or fortification) and hits / deaths from a hidden source are stripped of
 * everything that points back at the shooter: its position, the shot direction, and — on linear
 * fortifications — the impact point (the shooter's projection onto the line).
 */
export function presentedEvent(sim, ev, show, viewer) {
  switch (ev.type) {
    case EV.HIT:
    case EV.DEATH:
      if (!ev.src || !(ev.dx || ev.dz) || sourceVisibleTo(sim, ev.src, viewer)) return ev;
      return { ...ev, dx: 0, dz: 0, src: 0 };
    case EV.FIRE:
    case EV.MELEE:
    case EV.STRUCTURE_FIRE: {
      if (show & SHOW.SOURCE) return ev;
      const a = hashAngle(ev.target || 0, ev.shooter || ev.attacker || ev.struct || 0, sim.state.tick);
      let tx = ev.tx, tz = ev.tz;
      const st = ev.struct ? sim.rt.structById.get(ev.struct) : null;
      if (st && STRUCTURES[st.type].kind === 'linear') {
        const u = 0.15 + 0.7 * (a / 6.283185307179586);
        tx = st.x1 + (st.x2 - st.x1) * u; tz = st.z1 + (st.z2 - st.z1) * u;
      } else if (st) { tx = st.x + dsin(a) * 1.2; tz = st.z + dcos(a) * 1.2; }
      return { ...ev, tx, tz, x: tx - dsin(a) * 12, z: tz - dcos(a) * 12, shooter: 0, attacker: 0 };
    }
    default:
      return ev;
  }
}
