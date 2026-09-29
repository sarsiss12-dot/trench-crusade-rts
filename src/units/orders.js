// Squad order state machine (plain-data orders stored on squads) + throttled path requests +
// trench post assignment + work spots. Movement integration is in units/movement.js.
import { sideDef } from '../data/factions.js';
import { unitDef } from '../data/units.js';
import { STRUCTURES } from '../data/structures.js';
import { EV } from '../core/events.js';
import { dist, dsin, dcos, clamp, lerp } from '../core/dmath.js';
import { findPath } from '../world/nav.js';
import { PATHS_PER_TICK, PATH_WORK_PER_TICK, REPATH_TICKS, MELEE_CHARGE_RANGE } from '../sim/constants.js';
import { WEAPONS } from '../data/weapons.js';
import { ENGINEERING } from '../data/economy.js';
import { factionBit, isPointVisibleTo, visibleCentroid } from '../sim/perception.js';
import { removeCorpse } from '../sim/corpses.js';
import { forageAnimal, damageAnimal, animalById } from '../sim/wildlife.js';
import { specRule } from '../sim/specialities.js';
import {
  trenchSlot, ensureOccupancy, trenchSlotCount, trenchFrame, trenchNetwork, networkCapacity,
} from '../construction/trench.js';

const SLOT = {};
const FR = {};

// ------------------------------------------------------------------ paths

export function requestPath(sim, sq, x, z) {
  sq.pathState = 'pending';
  sq.pathReqTick = sim.state.tick;
  sq.pathGoalX = x;
  sq.pathGoalZ = z;
}

export function clearPath(sq) {
  sq.path = null;
  sq.pathIndex = 0;
  sq.pathState = 'none';
}

const pendingList = [];

/**
 * Resolve up to PATHS_PER_TICK pending requests, oldest first (deterministic), within the tick's
 * A* work budget (PATH_WORK_PER_TICK, shared with stuck-soldier detours): the rest wait a tick.
 */
export function processPathRequests(sim) {
  const { state, rt } = sim;
  rt.pathWork = 0;
  pendingList.length = 0;
  for (const sq of state.squads) if (sq.pathState === 'pending') pendingList.push(sq);
  if (!pendingList.length) return;
  pendingList.sort((a, b) => a.pathReqTick - b.pathReqTick || a.id - b.id);
  const n = Math.min(PATHS_PER_TICK, pendingList.length);
  for (let i = 0; i < n; i++) {
    if (rt.pathWork >= PATH_WORK_PER_TICK) break; // bounded tick cost; the first search always runs
    const sq = pendingList[i];
    const res = findPath(rt.nav, sq.faction, sq.x, sq.z, sq.pathGoalX, sq.pathGoalZ);
    rt.pathWork += rt.nav.lastCost;
    if (res && res.points.length) {
      sq.path = res.points;
      sq.pathIndex = 0;
      sq.pathState = 'ready';
      sq.pathFails = 0;
    } else {
      sq.path = null;
      sq.pathState = 'failed';
      sq.pathFails++;
    }
  }
}

// ------------------------------------------------------------------ helpers

export function engageRange(def) {
  if (def.weapon) return WEAPONS[def.weapon].range * 0.88;
  return MELEE_CHARGE_RANGE * 0.75;
}

/** Point just outside a building footprint nearest to (fx,fz). */
export function approachPoint(st, fx, fz, out, margin = 1.6) {
  const def = STRUCTURES[st.type];
  if (def.kind === 'linear') {
    // back side of the line, nearest along the segment
    const fr = trenchFrameGeneric(st, FR, def);
    let t = (fx - st.x1) * fr.ux + (fz - st.z1) * fr.uz;
    t = clamp(t, 0, fr.len);
    const side = (fx - st.x1) * fr.nx + (fz - st.z1) * fr.nz >= 0 ? 1 : -1;
    out[0] = st.x1 + fr.ux * t + fr.nx * side * ((def.width || 1) * 0.5 + margin);
    out[1] = st.z1 + fr.uz * t + fr.nz * side * ((def.width || 1) * 0.5 + margin);
    return out;
  }
  if (def.kind === 'area') { out[0] = st.x; out[1] = st.z; return out; }
  const s = dsin(st.rot), c = dcos(st.rot);
  const dx = fx - st.x, dz = fz - st.z;
  let lx = -dx * c + dz * s, lz = dx * s + dz * c;
  const hw = def.footprint.w * 0.5 + margin, hd = def.footprint.d * 0.5 + margin;
  // project onto rectangle boundary
  if (Math.abs(lx) / hw > Math.abs(lz) / hd) { lx = lx >= 0 ? hw : -hw; lz = clamp(lz, -hd, hd); }
  else { lz = lz >= 0 ? hd : -hd; lx = clamp(lx, -hw, hw); }
  out[0] = st.x - lx * c + lz * s;
  out[1] = st.z + lx * s + lz * c;
  return out;
}

function trenchFrameGeneric(st, out, def) {
  if (st.type === 'trench') return trenchFrame(st, out);
  const dx = st.x2 - st.x1, dz = st.z2 - st.z1;
  const len = Math.sqrt(dx * dx + dz * dz) || 1e-6;
  out.len = len; out.ux = dx / len; out.uz = dz / len;
  const f = st.front === -1 ? -1 : 1;
  out.nx = -out.uz * f; out.nz = out.ux * f;
  out.cx = (st.x1 + st.x2) * 0.5; out.cz = (st.z1 + st.z2) * 0.5;
  out.halfWidth = (def.width || 1) * 0.5;
  return out;
}

/** Distance from point to a structure's footprint boundary (0 if inside). */
export function distanceToStructure(st, x, z) {
  const def = STRUCTURES[st.type];
  if (def.kind === 'linear') {
    const dx = st.x2 - st.x1, dz = st.z2 - st.z1;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - st.x1) * dx + (z - st.z1) * dz) / len2 : 0;
    t = clamp(t, 0, 1);
    return Math.max(0, dist(x, z, st.x1 + dx * t, st.z1 + dz * t) - (def.width || 1) * 0.5);
  }
  if (def.kind === 'area') return dist(x, z, st.x, st.z);
  const s = dsin(st.rot), c = dcos(st.rot);
  const ddx = x - st.x, ddz = z - st.z;
  const lx = Math.abs(-ddx * c + ddz * s) - def.footprint.w * 0.5;
  const lz = Math.abs(ddx * s + ddz * c) - def.footprint.d * 0.5;
  const ox = Math.max(lx, 0), oz = Math.max(lz, 0);
  return Math.sqrt(ox * ox + oz * oz);
}

/** Nearest friendly drop-off structure (built) for delivering gathered resources. */
export function nearestDropOff(sim, faction, x, z) {
  let best = null, bestD = 1e18;
  for (const st of sim.state.structures) {
    if (st.faction !== faction || !st.built) continue;
    if (!STRUCTURES[st.type].dropOff) continue;
    const d = dist(x, z, st.x, st.z);
    if (d < bestD) { bestD = d; best = st; }
  }
  return best;
}

// ------------------------------------------------------------------ trench posts

export function releasePosts(sim, sq) {
  for (const m of sq.members) releaseSoldierPost(sim, m);
}

export function releaseSoldierPost(sim, m) {
  if (!m.postId) return;
  const seg = sim.rt.structById.get(m.postId);
  if (seg && seg.occ && seg.occ[m.postSlot] === m.id) seg.occ[m.postSlot] = 0;
  m.postId = 0;
  m.postSlot = -1;
}

/** Connected trench network (same faction or neutral), breadth-first, bounded. */
export function connectedTrenches(sim, seg, faction, maxCount = 12) {
  return trenchNetwork(sim.state.structures, seg, faction, maxCount);
}

function presentCount(sq) {
  let n = 0;
  for (const m of sq.members) if (m.state === 'alive') n++; // replacements on the way are not in yet
  return n;
}

/**
 * MULTI-SQUAD TRENCH OCCUPANCY: a trench that can take the WHOLE squad (no half squad left
 * outside). The given segment's network first; with radius > 0, otherwise the nearest other
 * network within radius that has room (slots already promised to incoming squads count as taken).
 */
export function trenchForSquad(sim, sq, seg, x, z, radius) {
  const need = presentCount(sq);
  const seen = new Set();
  if (seg) {
    const net = connectedTrenches(sim, seg, sq.faction);
    if (networkCapacity(sim.state, net, sq.faction, sq).free >= need) return seg;
    for (const s of net) seen.add(s.id);
  }
  if (radius <= 0) return null;
  let best = null, bd = radius;
  for (const s of sim.state.structures) {
    if (s.type !== 'trench' || seen.has(s.id)) continue;
    if (s.faction !== sq.faction && s.faction !== 'neutral') continue;
    if (!s.built && s.progress < 0.35) continue;
    const d = distanceToStructure(s, x, z);
    if (d >= bd) continue;
    const net = connectedTrenches(sim, s, sq.faction);
    if (networkCapacity(sim.state, net, sq.faction, sq).free >= need) { bd = d; best = s; }
    else for (const n of net) seen.add(n.id);
  }
  return best;
}

const cands = [];

/**
 * AUTO TRENCH OCCUPANCY: spread the squad's living soldiers over free slots of the trench
 * network nearest to (px,pz). Slots come from the segment data (single source of truth).
 */
export function assignTrenchPosts(sim, sq, seg, px, pz) {
  releasePosts(sim, sq);
  const segs = connectedTrenches(sim, seg, sq.faction);
  cands.length = 0;
  for (const s of segs) {
    ensureOccupancy(s);
    const n = trenchSlotCount(s);
    for (let k = 0; k < n; k++) {
      if (s.occ[k] !== 0) continue;
      trenchSlot(s, k, SLOT);
      cands.push({ sid: s.id, k, d: dist(SLOT.x, SLOT.z, px, pz) });
    }
  }
  cands.sort((a, b) => a.d - b.d || a.sid - b.sid || a.k - b.k);
  let ci = 0;
  let assigned = 0;
  for (const m of sq.members) {
    if (m.state !== 'alive') continue;
    if (ci >= cands.length) break;
    const c = cands[ci++];
    const s = sim.rt.structById.get(c.sid);
    s.occ[c.k] = m.id;
    m.postId = c.sid;
    m.postSlot = c.k;
    assigned++;
  }
  return assigned;
}

/**
 * Top up a garrison: soldiers without a post (replacements, soldiers whose post was lost) take the
 * free slots of the held network nearest to the squad. Existing posts are kept.
 */
export function fillTrenchPosts(sim, sq, seg) {
  let need = 0;
  for (const m of sq.members) if (m.state === 'alive' && !m.postId) need++;
  if (!need) return 0;
  const segs = connectedTrenches(sim, seg, sq.faction);
  cands.length = 0;
  for (const s of segs) {
    ensureOccupancy(s);
    const n = trenchSlotCount(s);
    for (let k = 0; k < n; k++) {
      if (s.occ[k] !== 0) continue;
      trenchSlot(s, k, SLOT);
      cands.push({ sid: s.id, k, d: dist(SLOT.x, SLOT.z, sq.cx, sq.cz) });
    }
  }
  cands.sort((a, b) => a.d - b.d || a.sid - b.sid || a.k - b.k);
  let ci = 0, assigned = 0;
  for (const m of sq.members) {
    if (m.state !== 'alive' || m.postId) continue;
    if (ci >= cands.length) break;
    const c = cands[ci++];
    const s = sim.rt.structById.get(c.sid);
    s.occ[c.k] = m.id;
    m.postId = c.sid;
    m.postSlot = c.k;
    assigned++;
  }
  return assigned;
}

/** Find a trench of this faction (or neutral) whose corridor is near (x,z). */
export function trenchNear(sim, faction, x, z, radius = 3.5) {
  let best = null, bestD = radius;
  for (const s of sim.state.structures) {
    if (s.type !== 'trench') continue;
    if (s.faction !== faction && s.faction !== 'neutral') continue;
    const d = distanceToStructure(s, x, z);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

// ------------------------------------------------------------------ work spots

/** Engineer k of n working position around a structure / node. */
export function workSpot(sim, target, kind, k, n, out) {
  if (kind === 'node') {
    const a = (k / Math.max(1, n)) * 6.283185307179586 + 0.4;
    out[0] = target.x + dsin(a) * 2.0;
    out[1] = target.z + dcos(a) * 2.0;
    return out;
  }
  const def = STRUCTURES[target.type];
  if (def.kind === 'linear') {
    const fr = trenchFrameGeneric(target, FR, def);
    const t = ((k + 0.5) / Math.max(1, n) - 0.5) * Math.max(0.5, fr.len - 1.0);
    const back = -((def.width || 1) * 0.5 + 0.7);
    out[0] = fr.cx + fr.ux * t + fr.nx * back;
    out[1] = fr.cz + fr.uz * t + fr.nz * back;
    return out;
  }
  // building perimeter
  const w = def.footprint.w * 0.5 + 0.9, d = def.footprint.d * 0.5 + 0.9;
  const per = 2 * (w + d);
  let p = ((k + 0.5) / Math.max(1, n)) * per * 2; // around perimeter (2*(2w+2d)/2)
  let lx, lz;
  const pw = 2 * w, pd = 2 * d;
  p = p % (2 * (pw + pd));
  if (p < pw) { lx = -w + p; lz = d; }
  else if (p < pw + pd) { lx = w; lz = d - (p - pw); }
  else if (p < 2 * pw + pd) { lx = w - (p - pw - pd); lz = -d; }
  else { lx = -w; lz = -d + (p - 2 * pw - pd); }
  const s = dsin(target.rot || 0), c = dcos(target.rot || 0);
  out[0] = target.x - lx * c + lz * s;
  out[1] = target.z + lx * s + lz * c;
  return out;
}

// ------------------------------------------------------------------ order updates

const P2 = [0, 0];
const VC = [0, 0];

export function setOrder(sim, sq, order) {
  if (sq.order.t === 'enter_trench' || sq.members.some((m) => m.postId)) releasePosts(sim, sq);
  for (const m of sq.members) { m.working = 0; }
  sq.order = order;
  sq.target = order.t === 'attack' ? { k: order.tk, id: order.tid } : null;
  sq.pathFails = 0; // a new order gets a fresh retry budget
  clearPath(sq);
}

function resolveOrderTarget(sim, order) {
  if (order.tk === 'squad') return sim.rt.squadById.get(order.tid) || null;
  return sim.rt.structById.get(order.tid) || null;
}

/** Per-tick order logic (arrival, cycles, chase). Called before movement. */
export function updateOrders(sim) {
  const { state, rt } = sim;
  for (const sq of state.squads) {
    const def = unitDef(sq.type);
    const o = sq.order;
    switch (o.t) {
      case 'move': {
        if (sq.pathState === 'none') requestPath(sim, sq, o.x, o.z);
        else if (sq.pathState === 'done') {
          if (o.trench) {
            const seg = rt.structById.get(o.trench);
            // the whole squad has to fit (another squad may have filled the network meanwhile)
            if (seg && trenchForSquad(sim, sq, seg, o.x, o.z, 0)) {
              assignTrenchPosts(sim, sq, seg, o.x, o.z);
              sq.order = { t: 'hold_trench', sid: seg.id };
              clearPath(sq);
            } else {
              const alt = seg && !o.alt ? trenchForSquad(sim, sq, null, o.x, o.z, 30) : null;
              clearPath(sq);
              if (alt) sq.order = { t: 'move', x: alt.x, z: alt.z, am: 0, trench: alt.id, alt: 1 };
              else {
                sq.order = { t: 'idle' };
                if (seg) sim.events.push({ type: EV.NOTICE, faction: sq.faction, key: 'trench.full', squadId: sq.id, x: sq.cx, z: sq.cz });
              }
            }
            break;
          } else if (o.flee) sq.order = { t: 'idle', done: 1 }; // fled engineers resume their queue (units/engineers.js)
          else sq.order = o.fh === undefined ? { t: 'idle' } : { t: 'idle', fh: o.fh }; // keeps its facing
          clearPath(sq);
        } else if (sq.pathState === 'failed') {
          if (sq.pathFails > 3) { sq.order = { t: 'idle' }; clearPath(sq); }
          else if (state.tick - sq.pathReqTick > 20) requestPath(sim, sq, o.x, o.z);
        }
        break;
      }
      case 'attack': {
        const tgt = resolveOrderTarget(sim, o);
        const alive = tgt && (o.tk === 'squad' ? tgt.members.some((m) => m.state === 'alive') : tgt.hp > 0);
        const bit = factionBit(sq.faction);
        // squads: judged by the members actually in sight right now (their centroid is what we know)
        const seen = alive && (tgt.visibleTo & bit) && (o.tk !== 'squad' || visibleCentroid(sim, tgt, sq.faction, VC));
        if (!seen) {
          // out of sight (or gone out of sight): hunt the last known position; the order only ends
          // once that spot is seen and the target is not there — nothing is learned through the fog
          if (typeof o.lx !== 'number') { sq.order = { t: 'idle' }; sq.target = null; clearPath(sq); break; }
          sq.target = null;
          const spotSeen = isPointVisibleTo(sim, sq.faction, o.lx, o.lz);
          // gone and we can see the spot: done; hidden but alive (e.g. concealed): close in first
          if (spotSeen && (!alive || dist(sq.cx, sq.cz, o.lx, o.lz) < 12)) {
            sq.order = { t: 'idle' }; clearPath(sq); break;
          }
          if (sq.pathState === 'none' || sq.pathState === 'done' ||
            (sq.pathState !== 'pending' && state.tick - sq.pathReqTick > REPATH_TICKS && dist(sq.pathGoalX, sq.pathGoalZ, o.lx, o.lz) > 5)) {
            requestPath(sim, sq, o.lx, o.lz);
          } else if (sq.pathState === 'failed' && state.tick - sq.pathReqTick > 30) {
            if (sq.pathFails > 4) { sq.order = { t: 'idle' }; clearPath(sq); } else requestPath(sim, sq, o.lx, o.lz);
          }
          break;
        }
        let tx = tgt.x, tz = tgt.z;
        if (o.tk === 'squad') { o.lx = VC[0]; o.lz = VC[1]; tx = VC[0]; tz = VC[1]; } else { o.lx = tgt.x; o.lz = tgt.z; }
        if (o.tk === 'struct') { approachPoint(tgt, sq.x, sq.z, P2, 0.8); tx = P2[0]; tz = P2[1]; }
        const d = o.tk === 'struct' ? distanceToStructure(tgt, sq.x, sq.z) : dist(sq.x, sq.z, tx, tz);
        const range = def.weapon ? engageRange(def) : 3;
        sq.target = { k: o.tk, id: o.tid };
        if (d <= range && (def.weapon || o.tk === 'squad')) {
          if (sq.pathState !== 'none') clearPath(sq);
        } else if (sq.pathState === 'none' || sq.pathState === 'done' ||
          (sq.pathState !== 'pending' && state.tick - sq.pathReqTick > REPATH_TICKS && dist(sq.pathGoalX, sq.pathGoalZ, tx, tz) > 5)) {
          requestPath(sim, sq, tx, tz);
        } else if (sq.pathState === 'failed' && state.tick - sq.pathReqTick > 30) {
          if (sq.pathFails > 4) { sq.order = { t: 'idle' }; sq.target = null; clearPath(sq); }
          else requestPath(sim, sq, tx, tz);
        }
        break;
      }
      case 'build':
      case 'repair': {
        const st = rt.structById.get(o.sid);
        if (!st || (o.t === 'build' && st.built) || (o.t === 'repair' && (st.hp >= st.maxHp || st.collapsed))) {
          for (const m of sq.members) m.working = 0;
          // job done: units/engineers.js continues with the queue, a nearby site or a hub
          sq.order = { t: 'idle', done: 1 };
          clearPath(sq);
          break;
        }
        const dd = distanceToStructure(st, sq.x, sq.z);
        if (!o.arrived) {
          if (dd < 7) { o.arrived = 1; clearPath(sq); }
          else if (sq.pathState === 'none' || sq.pathState === 'done') {
            approachPoint(st, sq.x, sq.z, P2, 2.5);
            requestPath(sim, sq, P2[0], P2[1]);
          } else if (sq.pathState === 'failed' && state.tick - sq.pathReqTick > 30) {
            if (sq.pathFails > 4) { sq.order = { t: 'idle' }; clearPath(sq); }
            else { approachPoint(st, sq.x, sq.z, P2, 2.5); requestPath(sim, sq, P2[0], P2[1]); }
          }
        } else {
          // anchor drifts toward the work so the formation stays around it — for a building only up
          // to its wall (an anchor inside a blocking footprint strands the squad when it leaves)
          if (STRUCTURES[st.type].kind === 'building') approachPoint(st, sq.x, sq.z, P2, 1.2);
          else { P2[0] = st.x; P2[1] = st.z; }
          sq.x = lerp(sq.x, P2[0], 0.02);
          sq.z = lerp(sq.z, P2[1], 0.02);
        }
        break;
      }
      case 'gather': {
        updateGather(sim, sq, def, o);
        break;
      }
      case 'reinforce': {
        const pt = o.sid ? rt.structById.get(o.sid) : null;
        if (!pt) { sq.order = { t: 'idle' }; clearPath(sq); break; }
        const dd = distanceToStructure(pt, sq.x, sq.z);
        const r = STRUCTURES[pt.type].reinforceRadius || 30;
        if (dd > r * 0.6) {
          if (sq.pathState === 'none' || sq.pathState === 'done') { approachPoint(pt, sq.x, sq.z, P2, 6); requestPath(sim, sq, P2[0], P2[1]); }
          else if (sq.pathState === 'failed' && state.tick - sq.pathReqTick > 30) {
            if (sq.pathFails > 4) { sq.order = { t: 'idle' }; clearPath(sq); break; }
            approachPoint(pt, sq.x, sq.z, P2, 6);
            requestPath(sim, sq, P2[0], P2[1]);
          }
        } else if (sq.pathState !== 'none') clearPath(sq);
        if (sq.members.length >= def.squadSize && !sq.members.some((m) => m.state === 'joining')) sq.order = { t: 'idle' };
        break;
      }
      case 'hold_trench': {
        // garrison upkeep (staggered): replacements and soldiers who lost their post take free
        // slots; if the held segment is gone, hold whatever part of the network is left
        if ((state.tick + sq.id) % 20 !== 0) break;
        let seg = rt.structById.get(o.sid);
        if (!seg) {
          for (const m of sq.members) {
            const s = m.postId ? rt.structById.get(m.postId) : null;
            if (s) { seg = s; break; }
          }
          if (!seg) seg = trenchNear(sim, sq.faction, sq.cx, sq.cz, 6);
          if (!seg) { releasePosts(sim, sq); sq.order = { t: 'idle' }; break; }
          o.sid = seg.id;
        }
        fillTrenchPosts(sim, sq, seg);
        break;
      }
      default:
        break;
    }
  }
}

/** Biomass source class of a body (Black Grail economy statistics and priorities). */
export function corpseKind(c) {
  if (c.sp) return 'animal';
  if (c.old) return 'old';
  if ((sideDef(c.faction) || {}).plagueImmune) return 'corpse'; // the plague's own husks
  return c.unit === 'civilians' ? 'civilian' : 'soldier';
}

/**
 * Corpse gathering (Grail work gangs): the order remembers the field (fx,fz); the gang strips the
 * current body, then the next known, uninfected, not-rising corpse nearby (infected bodies are the
 * plague's: they rise instead). Richer bodies are preferred. Returns the corpse or null.
 */
function corpseTarget(sim, sq, o) {
  const { rt, state } = sim;
  let c = o.cid ? rt.corpseById.get(o.cid) : null;
  if (c && !c.infected && !c.riseAt && c.biomass > 0.01) return c;
  const bit = factionBit(sq.faction);
  const R = o.mode === 'forage' ? o.fr : CORPSE_FIELD_R;
  let best = null, bestS = Infinity;
  const fx = o.fx !== undefined ? o.fx : sq.x, fz = o.fz !== undefined ? o.fz : sq.z;
  for (const k of state.corpses) {
    if (k.infected || k.riseAt || k.biomass <= 0.01 || !(k.seenBy & bit)) continue;
    const d = dist(fx, fz, k.x, k.z);
    if (d > R) continue;
    const sc = d - k.biomass * 1.5;
    if (sc < bestS || (sc === bestS && best && k.id < best.id)) { bestS = sc; best = k; }
  }
  o.cid = best ? best.id : 0;
  return best;
}
const CORPSE_FIELD_R = 16;

/**
 * FORAGE (Black Grail gangs): in an area, hunt living animals and strip bodies — whichever is
 * closer / richer — haul the biomass to the nearest mound / altar, and come back for more until the
 * area is empty. No per-animal / per-corpse orders.
 */
function updateHunt(sim, sq, def, o, cap) {
  const { state } = sim;
  const tick = state.tick;
  if (o.phase === 'seek') {
    if (sq.carry >= cap - 0.001 && sq.carry > 0) { o.phase = 'to_drop'; clearPath(sq); return; }
    const c = corpseTarget(sim, sq, o);
    const a = forageAnimal(sim, sq.faction, o.fx, o.fz, o.fr);
    const dc = c ? dist(sq.cx, sq.cz, c.x, c.z) - c.biomass * 1.5 : Infinity;
    const da = a ? dist(sq.cx, sq.cz, a.x, a.z) : Infinity;
    if (c && dc <= da) { o.phase = 'to_node'; clearPath(sq); return; }
    if (a) { o.aid = a.id; o.cid = 0; o.phase = 'hunt'; o.t2 = tick; requestPath(sim, sq, a.x, a.z); return; }
    // nothing left here
    if (sq.carry > 0) { o.phase = 'to_drop'; clearPath(sq); return; }
    if (o.auto) { sq.order = { t: 'idle', ready: 1 }; clearPath(sq); return; }
    if (dist(sq.cx, sq.cz, o.fx, o.fz) > o.fr * 0.5 && (sq.pathState === 'none' || sq.pathState === 'done')) requestPath(sim, sq, o.fx, o.fz);
    return;
  }
  // hunt
  const an = animalById(state, o.aid);
  if (!an) { o.phase = 'seek'; o.aid = 0; clearPath(sq); return; }
  const reach = specRule(state, sq.faction, 'pounce') ? 5 : 3.2;
  if (dist(sq.cx, sq.cz, an.x, an.z) <= reach) {
    if ((tick + sq.id) % 10 === 0) {
      let n = 0;
      for (const m of sq.members) if (m.state === 'alive') n++;
      const x = an.x, z = an.z;
      damageAnimal(sim, an, n * 9, sq.faction, 'forage');
      if (!animalById(state, an.id)) {
        // the carcass it left is what the gang strips next
        let best = null, bd = 2;
        for (const c of state.corpses) if (c.sp && dist(c.x, c.z, x, z) < bd) { bd = dist(c.x, c.z, x, z); best = c; }
        o.cid = best ? best.id : 0;
        o.aid = 0;
        o.phase = best ? 'to_node' : 'seek';
        clearPath(sq);
      }
    }
    return;
  }
  if (tick - (o.t2 || 0) > 30 || sq.pathState === 'none' || sq.pathState === 'done') { o.t2 = tick; requestPath(sim, sq, an.x, an.z); }
  else if (sq.pathState === 'failed' && tick - sq.pathReqTick > 30) { o.phase = 'seek'; o.aid = 0; clearPath(sq); }
}

/** Salvage radius of the engineers' SALVAGE AREA order (m). */
export const SALVAGE_AREA_R = ENGINEERING.salvageAreaR;

/**
 * Next salvage heap for a SALVAGE AREA order: known to the faction, not depleted, inside the area;
 * nearest to the crew first (ties by id — deterministic). Returns the node or null.
 */
export function nextAreaNode(sim, sq, o) {
  const bit = factionBit(sq.faction);
  let best = null, bd = Infinity;
  for (const n of sim.state.nodes) {
    if (n.amount <= 0 || !(n.seenBy & bit)) continue;
    if (dist(n.x, n.z, o.fx, o.fz) > (o.fr || SALVAGE_AREA_R)) continue;
    const d = dist(n.x, n.z, sq.cx, sq.cz);
    if (d < bd || (d === bd && best && n.id < best.id)) { bd = d; best = n; }
  }
  return best;
}

function updateGather(sim, sq, def, o) {
  const { state, rt } = sim;
  const corpseMode = def.gathers === 'corpse';
  let alive = 0;
  for (const m of sq.members) if (m.state === 'alive') alive++;
  const cap = alive * (def.carryCapacity || 0);
  if (corpseMode && o.mode === 'forage' && (o.phase === 'seek' || o.phase === 'hunt')) { updateHunt(sim, sq, def, o, cap); return; }
  let node = corpseMode ? corpseTarget(sim, sq, o) : rt.nodeById.get(o.nid);
  // SALVAGE AREA (engineers, Phase 4): an emptied heap hands over to the next known heap inside
  // the area; when the area is empty the crew delivers and heads home to a hub (engineer queue)
  if (!corpseMode && o.area && (!node || node.amount <= 0) && o.phase !== 'to_drop') {
    const next = nextAreaNode(sim, sq, o);
    if (next) { node = next; o.nid = next.id; if (o.phase === 'gathering') { o.phase = 'to_node'; clearPath(sq); return; } }
  }
  const amountOf = (n) => (corpseMode ? n.biomass : n.amount);
  const forage = o.mode === 'forage';
  const finished = () => { sq.order = forage && o.auto ? { t: 'idle', ready: 1 } : { t: 'idle', done: 1 }; clearPath(sq); };
  if (o.phase === 'to_node') {
    if (!node || amountOf(node) <= 0) {
      if (sq.carry > 0) { o.phase = 'to_drop'; clearPath(sq); }
      else if (forage) { o.phase = 'seek'; clearPath(sq); }
      else finished();
      return;
    }
    if (dist(sq.x, sq.z, node.x, node.z) < 4.5) { o.phase = 'gathering'; clearPath(sq); return; }
    if (sq.pathState === 'none' || sq.pathState === 'done') requestPath(sim, sq, node.x, node.z);
    else if (sq.pathState === 'failed' && state.tick - sq.pathReqTick > 30) {
      if (sq.pathFails > 4) { if (forage) { o.phase = 'seek'; o.cid = 0; clearPath(sq); } else finished(); } else requestPath(sim, sq, node.x, node.z);
    }
    return;
  }
  if (o.phase === 'gathering') {
    if (node && dist(sq.x, sq.z, node.x, node.z) > 6) { o.phase = 'to_node'; clearPath(sq); return; } // next body
    if (!node || amountOf(node) <= 0 || sq.carry >= cap - 0.001) {
      for (const m of sq.members) m.working = 0;
      // full, or nothing left to strip with something in hand -> deliver; else look further
      o.phase = sq.carry > 0 && (sq.carry >= cap - 0.001 || !node) ? 'to_drop' : forage ? 'seek' : 'to_node';
      clearPath(sq);
      return;
    }
    // working soldiers (at spots) extract material
    let workers = 0;
    for (const m of sq.members) if (m.state === 'alive' && m.working) workers++;
    if (workers > 0) {
      const amt = Math.min(amountOf(node), cap - sq.carry, workers * def.gatherRate * (1 / 20));
      if (corpseMode) {
        const kind = corpseKind(node);
        if (!sq.carryBy) sq.carryBy = {};
        sq.carryBy[kind] = (sq.carryBy[kind] || 0) + amt;
        node.biomass -= amt;
        if (node.biomass <= 0.0001) {
          state.factions[sq.faction].stats.corpsesHarvested++;
          removeCorpse(sim, node, 'consumed');
          o.cid = 0;
        }
      } else node.amount -= amt;
      sq.carry += amt;
    }
    return;
  }
  if (o.phase === 'to_drop') {
    const drop = nearestDropOff(sim, sq.faction, sq.x, sq.z);
    if (!drop) { sq.order = { t: 'idle' }; clearPath(sq); return; }
    if (!sq.dropT) sq.dropT = state.tick; // haul start (balance metric: gang travel time)
    const dd = distanceToStructure(drop, sq.x, sq.z);
    if (dd < 6) {
      const f = state.factions[sq.faction];
      // Phase 4.1 balance metrics: haul time, and where the loads are dropped (mound / altar / ...)
      f.stats.hauls = (f.stats.hauls || 0) + 1;
      f.stats.haulTicks = (f.stats.haulTicks || 0) + (state.tick - sq.dropT);
      sq.dropT = 0;
      if (corpseMode) { const at = f.stats.dropAt || (f.stats.dropAt = {}); at[drop.type] = (at[drop.type] || 0) + Math.floor(sq.carry * 100) / 100; }
      const amount = Math.floor(sq.carry * 100) / 100;
      const res = corpseMode ? 'biomass' : 'material';
      f.resources[res] = (f.resources[res] || 0) + amount;
      if (corpseMode) {
        const by = f.stats.biomass;
        if (sq.carryBy) for (const k in sq.carryBy) by[k] = (by[k] || 0) + sq.carryBy[k];
        if (f.stats.firstBiomassTick < 0 && amount > 0) f.stats.firstBiomassTick = state.tick;
      }
      sq.carryBy = null;
      sim.events.push({ type: EV.RESOURCE_DELIVERED, faction: sq.faction, squadId: sq.id, resource: res, amount, x: sq.x, z: sq.z });
      sq.carry = 0;
      clearPath(sq);
      if (forage) o.phase = 'seek';
      else if (node && amountOf(node) > 0) o.phase = 'to_node';
      else if (o.area && nextAreaNode(sim, sq, o)) o.phase = 'to_node';
      else finished();
      return;
    }
    if (sq.pathState === 'none' || sq.pathState === 'done') {
      approachPoint(drop, sq.x, sq.z, P2, 3);
      requestPath(sim, sq, P2[0], P2[1]);
    } else if (sq.pathState === 'failed' && state.tick - sq.pathReqTick > 30) {
      if (sq.pathFails > 4) { sq.order = { t: 'idle' }; clearPath(sq); }
      else { approachPoint(drop, sq.x, sq.z, P2, 3); requestPath(sim, sq, P2[0], P2[1]); }
    }
  }
}
