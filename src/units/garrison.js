// RUIN GARRISONS (Phase 4). Shell-shattered houses and the chapel in no man's land are real
// garrison positions (neutral structures ruin_house / ruin_chapel, created from the map ruins):
//  - capacity in squads (small house 1, large house / chapel 2); one side at a time
//  - a GARRISON order paths the squad to the NEAREST ENTRANCE (outside the doorway), then the men
//    step through the door one by one to their interior slots — never through the walls (the old
//    "walk into the ruin" move got squads stuck against the wall cells)
//  - FIRING slots (broken wall / window height) shoot out; sheltered slots do not
//  - high cover vs small arms (data/cover.js 'garrison'); blasts, flame and heavy weapons hurt
//    more; a ruin knocked down to 0 hp COLLAPSES on its garrison (combat/combat.js collapseRuin)
//  - leaving: any other order releases the slots; the men walk out through a door first
// Deterministic: plain state (st.occ = squad ids, st.holder, m.gslot, m.gexit), fixed iteration.
import { STRUCTURES } from '../data/structures.js';
import { unitDef, hasRole } from '../data/units.js';
import { sideBit } from '../data/factions.js';
import { EV } from '../core/events.js';
import { dist } from '../core/dmath.js';
import { createStructure } from '../sim/state.js';
import { ruinEntrances, nearestEntrance, ruinSlots, ruinCapacity, ruinHp, insideRuin, GARRISON_KINDS } from '../world/ruin_geometry.js';
import { setOrder, requestPath, clearPath } from './orders.js';

const GEOM = new WeakMap(); // world ruin record -> { entrances, slots, cap }

/** The map ruin behind a garrison structure (or null). */
export function ruinOf(sim, st) {
  return st && st.ruin !== undefined ? sim.world.ruins[st.ruin] || null : null;
}

/** Cached geometry of a garrison: { r, entrances, slots, cap }. */
export function garrisonGeom(sim, st) {
  const r = ruinOf(sim, st);
  if (!r) return null;
  let g = GEOM.get(r);
  if (!g) { g = { r, entrances: ruinEntrances(r), slots: ruinSlots(r), cap: ruinCapacity(r) }; GEOM.set(r, g); }
  return g;
}

export function isGarrison(st) {
  return !!(st && STRUCTURES[st.type] && STRUCTURES[st.type].garrison);
}

/** Map setup: one neutral garrison structure per house / chapel ruin (not the lone wall stubs). */
export function addRuinGarrisons(sim) {
  const { state, world } = sim;
  for (const r of world.ruins) {
    if (!GARRISON_KINDS[r.kind]) continue;
    if (state.structures.some((s) => s.ruin === r.index && STRUCTURES[s.type].garrison)) continue; // already there
    const type = r.kind === 'chapel' ? 'ruin_chapel' : 'ruin_house';
    const st = createStructure(state, type, 'neutral', { x: r.x, z: r.z, rot: r.rot, built: true });
    st.ruin = r.index;
    st.hp = st.maxHp = ruinHp(r);
    st.occ = [];
    st.holder = '';
    st.collapsed = 0;
    state.structures.push(st);
  }
}

/** Squads that may hold a ruin: ranged line infantry (not heavies, crews, civilians). */
export function canGarrison(sq) {
  const def = unitDef(sq.type);
  if (sq.civ || !def.combatUnit || !def.weapon || hasRole(def, 'heavy')) return false;
  return true;
}

/** An occupant of st that the faction can see (fog-safe knowledge of an enemy garrison). */
export function visibleOccupant(sim, st, faction) {
  const bit = sideBit(faction);
  for (const id of st.occ) {
    const o = sim.rt.squadById.get(id);
    if (o && o.faction !== faction && (o.visibleTo & bit)) return o;
  }
  return null;
}

/**
 * Why a squad cannot garrison st right now ('' = it can). atDoor = false (command time / en
 * route): an enemy holder counts only when one of its squads is SEEN — otherwise the answer would
 * leak what hides in the fog; the squad finds out at the doorway (atDoor = true).
 */
export function garrisonRefusal(sim, sq, st, atDoor = true) {
  if (!isGarrison(st)) return 'cmd.invalid_target';
  if (st.collapsed) return 'garrison.collapsed';
  if (!canGarrison(sq)) return 'garrison.unit';
  if (st.occ.indexOf(sq.id) >= 0) return '';
  if (st.holder && st.holder !== sq.faction && (atDoor || visibleOccupant(sim, st, sq.faction))) return 'garrison.enemy';
  if (!atDoor && st.holder && st.holder !== sq.faction) return '';
  const g = garrisonGeom(sim, st);
  if (!g) return 'cmd.invalid_target';
  if (st.occ.length >= g.cap) return 'garrison.full';
  return '';
}

/** Start the GARRISON order: path to the nearest entrance (outside the doorway). */
export function startGarrison(sim, sq, st) {
  const g = garrisonGeom(sim, st);
  const e = nearestEntrance(g.entrances, sq.cx, sq.cz);
  setOrder(sim, sq, { t: 'garrison', sid: st.id, phase: 'to_door', door: g.entrances.indexOf(e) });
  requestPath(sim, sq, e.ox, e.oz);
}

function memberUsable(m) {
  return m.state === 'alive' || m.state === 'rising';
}

/** Free slots of a garrison given the current occupants (deterministic order). */
function assignSlots(sim, st, sq, g) {
  const used = new Set();
  for (const id of st.occ) {
    if (id === sq.id) continue;
    const o = sim.rt.squadById.get(id);
    if (o) for (const m of o.members) if (m.gslot >= 0) used.add(m.gslot);
  }
  let k = 0;
  for (const m of sq.members) {
    if (!memberUsable(m) && m.state !== 'joining') { m.gslot = -1; continue; }
    while (k < g.slots.length && used.has(k)) k++;
    m.gslot = k < g.slots.length ? k : g.slots.length + (m.id % 4); // overflow: sheltered centre
    k++;
    m.gexit = 0;
  }
}

function release(sim, st, sq) {
  const i = st.occ.indexOf(sq.id);
  if (i >= 0) st.occ.splice(i, 1);
  if (sq.garrison === st.id) sq.garrison = 0;
  for (const m of sq.members) {
    if (m.gslot !== undefined && m.gslot !== -1) { m.gslot = -1; m.gexit = st.id; }
  }
}

/** Eject a squad (collapse, dead order) — members walk out through a door. */
export function releaseGarrison(sim, st, sq) {
  release(sim, st, sq);
  if (!st.occ.length) st.holder = '';
}

/**
 * Per tick: validate occupancy (squads that got another order, died or were ejected release their
 * slots), move GARRISON orders along (entrance reached -> inside), keep the holder faction.
 */
export function updateGarrisons(sim) {
  const { state, rt } = sim;
  for (const st of state.structures) {
    if (!st.occ) continue;
    if (!isGarrison(st)) continue;
    for (let i = st.occ.length - 1; i >= 0; i--) {
      const sq = rt.squadById.get(st.occ[i]);
      const o = sq && sq.order;
      if (!sq || o.t !== 'garrison' || o.sid !== st.id || o.phase !== 'inside' || !sq.members.some(memberUsable) || st.collapsed) {
        if (sq) release(sim, st, sq);
        else st.occ.splice(i, 1);
      }
    }
    st.holder = st.occ.length ? rt.squadById.get(st.occ[0]).faction : '';
  }
  for (const sq of state.squads) {
    const o = sq.order;
    if (o.t !== 'garrison') continue;
    const st = rt.structById.get(o.sid);
    const why = st ? garrisonRefusal(sim, sq, st, false) : 'cmd.invalid_target';
    if (why) {
      sim.events.push({ type: EV.NOTICE, faction: sq.faction, key: why, squadId: sq.id, x: sq.cx, z: sq.cz });
      sq.order = { t: 'idle' };
      clearPath(sq);
      continue;
    }
    const g = garrisonGeom(sim, st);
    const e = g.entrances[o.door] || g.entrances[0];
    if (o.phase === 'to_door') {
      if (dist(sq.x, sq.z, e.ox, e.oz) < 3.5 || (sq.pathState === 'done' && dist(sq.cx, sq.cz, e.ox, e.oz) < 7)) {
        const late = garrisonRefusal(sim, sq, st, true);
        if (late) {
          sim.events.push({ type: EV.NOTICE, faction: sq.faction, key: late, squadId: sq.id, x: sq.cx, z: sq.cz });
          sq.order = { t: 'idle' };
          clearPath(sq);
          continue;
        }
        o.phase = 'inside';
        clearPath(sq);
        st.occ.push(sq.id);
        st.holder = sq.faction;
        sq.garrison = st.id;
        assignSlots(sim, st, sq, g);
        sq.x = g.r.x; sq.z = g.r.z; // the squad's anchor is the ruin (range / AI / HUD)
        sim.events.push({ type: EV.GARRISON_ENTERED, faction: sq.faction, squadId: sq.id, sid: st.id, x: st.x, z: st.z });
      } else if (sq.pathState === 'none' || sq.pathState === 'done') requestPath(sim, sq, e.ox, e.oz);
      else if (sq.pathState === 'failed' && state.tick - sq.pathReqTick > 30) {
        if (sq.pathFails > 4) {
          sim.events.push({ type: EV.NOTICE, faction: sq.faction, key: 'garrison.no_route', squadId: sq.id, x: sq.cx, z: sq.cz });
          sq.order = { t: 'idle' }; clearPath(sq);
        } else requestPath(sim, sq, e.ox, e.oz);
      }
    } else if (o.phase === 'inside') {
      // walking replacements who arrived later get a slot too
      for (const m of sq.members) if (memberUsable(m) && (m.gslot === undefined || m.gslot === -1)) { assignSlots(sim, st, sq, g); break; }
    }
  }
}

const SL = [0, 0];

/**
 * Set by garrisonSteer for the soldier just steered: 1 = he moves inside the ruin's walls, where the
 * 2 m nav cells of the walls also cover the strip of floor along them (the loopholes) — inside the
 * walls he walks freely (the walls themselves still enclose him: his goals are all inside).
 */
export const GARRISON_STEER = { free: 0 };

/**
 * Steering goal for a garrison soldier (units/movement.js). Writes out[0..1]; returns the facing
 * (a number, NaN = free) or undefined when the garrison logic does not apply to him.
 * Inside the walls he goes straight to his slot; outside he is routed through a doorway: to the
 * outside point, then through the gap to the inside point. Leaving men (m.gexit) do the reverse.
 */
export function garrisonSteer(sim, sq, m, out) {
  const o = sq.order;
  if (o.t === 'garrison' && o.phase === 'inside' && m.gslot >= 0) {
    const st = sim.rt.structById.get(o.sid);
    const g = st && garrisonGeom(sim, st);
    if (!g) return undefined;
    let tx, tz, face = NaN;
    if (m.gslot < g.slots.length) { const s = g.slots[m.gslot]; tx = s.x; tz = s.z; face = s.face; }
    else { const k = m.gslot - g.slots.length; tx = g.r.x + ((k & 1) - 0.5) * 1.2; tz = g.r.z + ((k >> 1) - 0.5) * 1.2; }
    if (insideRuin(g.r, m.x, m.z, 0.15)) { out[0] = tx; out[1] = tz; GARRISON_STEER.free = 1; return face; }
    const e = nearestEntrance(g.entrances, m.x, m.z);
    doorStep(e, m, out, true);
    return NaN;
  }
  if (m.gexit) {
    const st = sim.rt.structById.get(m.gexit);
    const g = st && garrisonGeom(sim, st);
    if (!g || !insideRuin(g.r, m.x, m.z, -0.4)) { m.gexit = 0; return undefined; }
    // still inside (or in the doorway): out through the door nearest to where the squad is going
    const e = nearestEntrance(g.entrances, sq.x, sq.z);
    doorStep(e, m, out, false);
    if (insideRuin(g.r, m.x, m.z, 0.15) && out[0] === e.ix && out[1] === e.iz) GARRISON_STEER.free = 1;
    return NaN;
  }
  if (m.gslot !== undefined && m.gslot !== -1) { m.gexit = sq.garrison || 0; m.gslot = -1; }
  return undefined;
}

/** In: outside point -> inside point. Out: inside point -> outside point. */
function doorStep(e, m, out, entering) {
  const dIn = dist(m.x, m.z, e.ix, e.iz), dOut = dist(m.x, m.z, e.ox, e.oz), dC = dist(m.x, m.z, e.cx, e.cz);
  if (entering) {
    if (dC < 1.6 || dOut < 1.2) { out[0] = e.ix; out[1] = e.iz; } else { out[0] = e.ox; out[1] = e.oz; }
  } else if (dC < 1.6 || dIn < 1.2) { out[0] = e.ox; out[1] = e.oz; } else { out[0] = e.ix; out[1] = e.iz; }
  void dIn;
}

/** A garrison soldier at a FIRING slot (inside, within 1.2 m of it) may shoot; sheltered ones not. */
export function garrisonCanFire(sim, sq, m) {
  if (m.gslot === undefined || m.gslot === -1) return true;
  const o = sq.order;
  const st = o.t === 'garrison' ? sim.rt.structById.get(o.sid) : null;
  const g = st && garrisonGeom(sim, st);
  if (!g) return true;
  if (m.gslot >= g.slots.length) return false;
  const s = g.slots[m.gslot];
  return !!s.fire && dist(m.x, m.z, s.x, s.z) < 1.2;
}

/** The garrison structure a point lies inside (standing, not collapsed), or null. */
export function garrisonAt(sim, x, z, list) {
  for (const st of list || sim.state.structures) {
    if (!st.occ || st.collapsed) continue;
    const g = garrisonGeom(sim, st);
    if (g && insideRuin(g.r, x, z, 0.2)) return st;
  }
  return null;
}

/** Soldiers of a squad inside its garrison (for HUD / tests). */
export function garrisonedCount(sim, sq) {
  const o = sq.order;
  if (o.t !== 'garrison' || o.phase !== 'inside') return 0;
  const st = sim.rt.structById.get(o.sid);
  const g = st && garrisonGeom(sim, st);
  if (!g) return 0;
  let n = 0;
  for (const m of sq.members) if (memberUsable(m) && insideRuin(g.r, m.x, m.z, 0.15)) n++;
  return n;
}

/** Slot position (tests / HUD). */
export function slotPos(sim, st, i, out = SL) {
  const g = garrisonGeom(sim, st);
  const s = g.slots[i];
  out[0] = s.x; out[1] = s.z;
  return out;
}
