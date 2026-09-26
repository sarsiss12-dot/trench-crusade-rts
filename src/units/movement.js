// Squad anchor movement along shared squad paths + lightweight per-soldier steering:
// formation slots, trench posts, work spots, melee chase, separation. Soldiers do not path-find;
// only a soldier that stops making progress (cut off behind water, a building or a crowd) gets a
// budgeted rescue detour, and as a last resort rejoins beside its squad anchor.
import { unitDef } from '../data/units.js';
import { FACTIONS } from '../data/factions.js';
import { DT, DETOURS_PER_TICK, PATH_WORK_PER_TICK, STUCK_WINDOW, JOIN_TIMEOUT_TICKS } from '../sim/constants.js';
import { dist, headingOf, turnToward, rotateOffset, dsin, dcos, datan2 } from '../core/dmath.js';
import { moveSpeedMult, isPointPassable, isPassable, cellAt, nearestPassable, findPath } from '../world/nav.js';
import { formationOffsets } from './formation.js';
import { trenchSlot } from '../construction/trench.js';
import { workSpot, approachPoint } from './orders.js';
import { rebuildSoldierGrid } from '../sim/runtime.js';

const OFF = [0, 0];
const SPOT = [0, 0];
const SLOT = {};
const GOAL = [0, 0];
const STEER = [0, 0];
let detourBudget = 0;

function holdsWhenEngaged(sq) {
  const o = sq.order;
  if (o.t === 'move') return !!o.am;
  return o.t === 'attack' || o.t === 'idle' || o.t === 'hold_trench';
}

function advanceAnchor(sim, sq, def) {
  const px = sq.x, pz = sq.z;
  if (sq.pathState !== 'ready' || !sq.path || (sq.engaged && holdsWhenEngaged(sq))) {
    sq.vx = 0; sq.vz = 0;
    return;
  }
  const fIdx = FACTIONS[sq.faction].index;
  let mult = moveSpeedMult(sim.rt.nav, sq.x, sq.z, sq.faction, fIdx, def.heavy);
  if (mult < 0.2) mult = 0.2;
  let cohesion = 1;
  if (sq.lag > 5) cohesion = 0.45;
  else if (sq.lag > 2.6) cohesion = 0.78;
  let speed = def.speed * DT * mult * cohesion;
  const path = sq.path;
  while (speed > 1e-7 && sq.pathIndex * 2 < path.length) {
    const wx = path[sq.pathIndex * 2], wz = path[sq.pathIndex * 2 + 1];
    const dx = wx - sq.x, dz = wz - sq.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d <= speed) {
      sq.x = wx; sq.z = wz;
      speed -= d;
      sq.pathIndex++;
    } else {
      sq.x += (dx / d) * speed;
      sq.z += (dz / d) * speed;
      speed = 0;
    }
  }
  sq.vx = sq.x - px;
  sq.vz = sq.z - pz;
  if (sq.vx * sq.vx + sq.vz * sq.vz > 1e-8) {
    sq.rot = turnToward(sq.rot, headingOf(sq.vx, sq.vz), 3.2 * DT);
  }
  if (sq.pathIndex * 2 >= path.length) {
    sq.path = null;
    sq.pathState = 'done';
  }
}

/** Compute the steering target for soldier m (writes OFF). Returns facing hint or NaN. */
function soldierTarget(sim, sq, m, def, aliveIndex, aliveTotal, offs) {
  const { rt } = sim;
  // 1. melee chase (combat sets m.targetId + sq.melee)
  if (sq.melee && m.targetId) {
    const esq = rt.soldierIndex.get(m.targetId);
    if (esq) {
      for (const e of esq.members) {
        if (e.id === m.targetId && e.state === 'alive') {
          const d = dist(m.x, m.z, e.x, e.z);
          const stand = Math.max(0.9, 1.15 * (def.radius + 0.4));
          if (d > stand) {
            OFF[0] = e.x - ((e.x - m.x) / d) * stand;
            OFF[1] = e.z - ((e.z - m.z) / d) * stand;
          } else { OFF[0] = m.x; OFF[1] = m.z; }
          return datan2(e.x - m.x, e.z - m.z);
        }
      }
    }
  }
  if (sq.melee && sq.target && sq.target.k === 'struct') {
    const st = rt.structById.get(sq.target.id);
    if (st) {
      approachPoint(st, m.x, m.z, OFF, 0.6);
      return datan2(st.x - m.x, st.z - m.z);
    }
  }
  // 2. trench post
  if (m.postId) {
    const seg = rt.structById.get(m.postId);
    if (seg) {
      trenchSlot(seg, m.postSlot, SLOT);
      OFF[0] = SLOT.x; OFF[1] = SLOT.z;
      return SLOT.facing;
    }
    m.postId = 0; m.postSlot = -1;
  }
  // 3. work spots
  const o = sq.order;
  if ((o.t === 'build' || o.t === 'repair') && o.arrived) {
    const st = rt.structById.get(o.sid);
    if (st) {
      workSpot(sim, st, 'struct', aliveIndex, aliveTotal, OFF);
      return datan2(st.x - OFF[0], st.z - OFF[1]);
    }
  }
  if (o.t === 'gather' && o.phase === 'gathering') {
    const node = rt.nodeById.get(o.nid);
    if (node) {
      workSpot(sim, node, 'node', aliveIndex, aliveTotal, OFF);
      return datan2(node.x - OFF[0], node.z - OFF[1]);
    }
  }
  // 4. formation slot
  const i = Math.min(aliveIndex, (offs.length >> 1) - 1);
  rotateOffset(SPOT, offs[i * 2], offs[i * 2 + 1], sq.rot);
  OFF[0] = sq.x + SPOT[0];
  OFF[1] = sq.z + SPOT[1];
  return NaN;
}

function stepSoldier(sim, sq, m, def, fIdx, tx, tz, facingHint) {
  const nav = sim.rt.nav;
  const px = m.x, pz = m.z;
  const dx = tx - m.x, dz = tz - m.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > 0.04) {
    let mult = moveSpeedMult(nav, m.x, m.z, sq.faction, fIdx, def.heavy);
    if (mult <= 0) mult = 0.5; // escape blocked cell
    let sp = def.speed * DT * mult;
    if (d > 2.5) sp *= 1.3;
    if (sq.melee) sp *= 1.12;
    const step = d < sp ? d : sp;
    const nx = m.x + (dx / d) * step, nz = m.z + (dz / d) * step;
    if (isPointPassable(nav, nx, nz)) { m.x = nx; m.z = nz; }
    else if (isPointPassable(nav, nx, m.z)) m.x = nx;
    else if (isPointPassable(nav, m.x, nz)) m.z = nz;
    else if (!isPointPassable(nav, m.x, m.z)) { m.x = nx; m.z = nz; }
  }
  m.vx = m.x - px;
  m.vz = m.z - pz;
  const moving = m.vx * m.vx + m.vz * m.vz > 0.0004;
  let face;
  if (moving && d > 0.6) face = headingOf(m.vx, m.vz);
  else if (facingHint === facingHint) face = facingHint;
  else face = sq.rot;
  // ranged soldiers keep facing their current shot target (set by combat)
  if (!moving && m.targetId && !sq.melee) {
    const esq = sim.rt.soldierIndex.get(m.targetId);
    if (esq) {
      for (const e of esq.members) if (e.id === m.targetId) { face = headingOf(e.x - m.x, e.z - m.z); break; }
    }
  }
  m.rot = turnToward(m.rot, face, 7 * DT);
  return d;
}

/**
 * Keep a steering goal on passable ground: a formation slot that falls into the river or a wall
 * (formation wider than a bridge, slot inside a building) slides back along the anchor -> slot line.
 */
export function passableGoal(nav, ax, az, tx, tz, out) {
  out[0] = tx; out[1] = tz;
  if (isPointPassable(nav, tx, tz) || !isPointPassable(nav, ax, az)) return out;
  const dx = tx - ax, dz = tz - az;
  const n = Math.ceil(Math.sqrt(dx * dx + dz * dz) / 0.5);
  let lx = ax, lz = az;
  for (let k = 1; k <= n; k++) {
    const x = ax + (dx * k) / n, z = az + (dz * k) / n;
    if (!isPointPassable(nav, x, z)) break;
    lx = x; lz = z;
  }
  out[0] = lx; out[1] = lz;
  return out;
}

/** Next point to steer to: the goal itself, or the current waypoint of a rescue detour. */
function steeringPoint(m, gx, gz, dGoal, out) {
  out[0] = gx; out[1] = gz;
  if (!m.dp) return out;
  if (dGoal < 1.2 || dist(m.dgx, m.dgz, gx, gz) > 6) { m.dp = null; return out; } // reached / goal moved on
  if (dist(m.x, m.z, m.dp[m.di * 2], m.dp[m.di * 2 + 1]) < 0.8) {
    m.di++;
    if (m.di * 2 >= m.dp.length) { m.dp = null; return out; }
  }
  out[0] = m.dp[m.di * 2]; out[1] = m.dp[m.di * 2 + 1];
  return out;
}

/**
 * Progress watchdog. Every STUCK_WINDOW ticks a soldier far from its goal that barely moved is
 * flagged; flagged soldiers get a squad-style path to their goal (at most DETOURS_PER_TICK per
 * tick, deterministic order). Repeated failures while far away: rejoin beside the squad anchor.
 */
function watchProgress(sim, sq, m, dGoal, gx, gz) {
  const { state, rt } = sim;
  if (m.wx === undefined) { m.wx = m.x; m.wz = m.z; } // saves from before the watchdog
  if (dGoal < 1.5) { m.dtry = 0; m.stk = 0; }
  if ((state.tick + m.id) % STUCK_WINDOW === 0) {
    const moved = dist(m.x, m.z, m.wx, m.wz);
    m.wx = m.x; m.wz = m.z;
    if (dGoal > 3 && moved < 0.6) { m.dp = null; m.stk = 1; }
  }
  // flagged soldiers wait (flag kept) while this tick's detour count or A* work budget is spent
  if (!m.stk || detourBudget <= 0 || rt.pathWork >= PATH_WORK_PER_TICK) return;
  detourBudget--;
  m.stk = 0;
  m.dtry = (m.dtry || 0) + 1;
  const nav = rt.nav;
  if (m.dtry > 3 && dGoal > 8) {
    // sealed off (pocket behind deep water, boxed in by new structures): rejoin the squad
    let idx = cellAt(nav, sq.x, sq.z);
    if (idx >= 0 && !isPassable(nav, idx)) idx = nearestPassable(nav, idx, 8);
    if (idx >= 0) {
      m.x = ((idx % nav.cols) + 0.5) * nav.cell;
      m.z = (((idx / nav.cols) | 0) + 0.5) * nav.cell;
    }
    m.wx = m.x; m.wz = m.z; m.dtry = 0; m.dp = null;
    return;
  }
  const res = findPath(nav, sq.faction, m.x, m.z, gx, gz);
  rt.pathWork += nav.lastCost;
  if (res && res.points.length) {
    m.dp = res.points; m.di = 0; m.dgx = gx; m.dgz = gz;
  }
}

export function updateMovement(sim) {
  const { state } = sim;
  const nav = sim.rt.nav;
  detourBudget = DETOURS_PER_TICK;
  for (const sq of state.squads) {
    const def = unitDef(sq.type);
    advanceAnchor(sim, sq, def);
  }
  for (const sq of state.squads) {
    const def = unitDef(sq.type);
    const fIdx = FACTIONS[sq.faction].index;
    let aliveTotal = 0;
    for (const m of sq.members) if (m.state === 'alive' || m.state === 'joining') aliveTotal++;
    if (aliveTotal === 0) { sq.lag = 0; continue; }
    const offs = formationOffsets(sq.formation, Math.max(1, aliveTotal), def.spacing);
    let idx = 0, lagSum = 0, cx = 0, cz = 0, working = 0;
    for (const m of sq.members) {
      if (m.state !== 'alive' && m.state !== 'joining') continue;
      const hint = soldierTarget(sim, sq, m, def, idx, aliveTotal, offs);
      passableGoal(nav, sq.x, sq.z, OFF[0], OFF[1], GOAL);
      const gx = GOAL[0], gz = GOAL[1];
      const dGoal = dist(m.x, m.z, gx, gz);
      steeringPoint(m, gx, gz, dGoal, STEER);
      stepSoldier(sim, sq, m, def, fIdx, STEER[0], STEER[1], hint);
      watchProgress(sim, sq, m, dGoal, gx, gz);
      if (m.state === 'joining' && (dGoal < 1.2 || state.tick - m.stateTick > JOIN_TIMEOUT_TICKS)) m.state = 'alive';
      // working flag: at a work spot
      const o = sq.order;
      const atWork = ((o.t === 'build' || o.t === 'repair') && o.arrived) || (o.t === 'gather' && o.phase === 'gathering');
      m.working = atWork && dGoal < 1.3 && m.state === 'alive' ? 1 : 0;
      working += m.working;
      if (!m.postId) lagSum += dGoal;
      cx += m.x; cz += m.z;
      idx++;
    }
    sq.lag = lagSum / aliveTotal;
    sq.cx = cx / aliveTotal;
    sq.cz = cz / aliveTotal;
    // melee squads follow their brawl
    if (sq.melee) {
      sq.x += (sq.cx - sq.x) * 0.15;
      sq.z += (sq.cz - sq.z) * 0.15;
    }
    if (sq.order.t === 'hold_trench') {
      sq.x += (sq.cx - sq.x) * 0.2;
      sq.z += (sq.cz - sq.z) * 0.2;
    }
    sq.working = working;
  }
  rebuildSoldierGrid(sim);
  separate(sim);
}

/**
 * Lightweight soldier separation (no physics engine). Pairs are resolved once (lower id first),
 * soldiers holding trench posts are anchored. Explicit loops: no per-soldier closures/garbage.
 */
function separate(sim) {
  const { rt } = sim;
  const g = rt.soldierGrid;
  const nav = rt.nav;
  const head = g.head, next = g.next, refs = g.refs, owners = g.owners;
  const cols = g.cols, rows = g.rows, cs = g.cs;
  for (let i = 0; i < g.count; i++) {
    const m = refs[i];
    if (m.state !== 'alive') continue;
    const rA = unitDef(owners[i].type).radius;
    const cx0 = Math.max(0, Math.floor((m.x - 1.3) / cs)), cx1 = Math.min(cols - 1, Math.floor((m.x + 1.3) / cs));
    const cz0 = Math.max(0, Math.floor((m.z - 1.3) / cs)), cz1 = Math.min(rows - 1, Math.floor((m.z + 1.3) / cs));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let j = head[cz * cols + cx]; j !== -1; j = next[j]) {
          const o = refs[j];
          if (o.id <= m.id || o.state !== 'alive') continue;
          const minD = (rA + unitDef(owners[j].type).radius) * 0.92;
          let dx = o.x - m.x, dz = o.z - m.z;
          const d2 = dx * dx + dz * dz;
          if (d2 >= minD * minD) continue;
          let d = Math.sqrt(d2), overlap;
          if (d < 1e-4) {
            const a = ((m.id * 7 + o.id * 13) % 628) / 100; // deterministic nudge direction
            dx = dsin(a); dz = dcos(a); d = 1; overlap = minD;
          } else overlap = minD - d;
          const push = overlap * 0.5;
          const ux = dx / d, uz = dz / d;
          const mFixed = m.postId !== 0, oFixed = o.postId !== 0;
          const pm = mFixed ? 0 : oFixed ? push * 2 : push;
          const po = oFixed ? 0 : mFixed ? push * 2 : push;
          if (pm > 0) {
            const nx = m.x - ux * pm, nz = m.z - uz * pm;
            if (isPointPassable(nav, nx, nz)) { m.x = nx; m.z = nz; }
          }
          if (po > 0) {
            const nx = o.x + ux * po, nz = o.z + uz * po;
            if (isPointPassable(nav, nx, nz)) { o.x = nx; o.z = nz; }
          }
        }
      }
    }
  }
}
