// Supply convoys (Phase 3 foundation): remote settlements do not teleport their output home.
// When a settlement's stock is large enough (or has waited long enough) a cart leaves for the
// nearest home drop-off (bastion / depot) along a nav path, carrying what it can. Carts are plain
// state (state.convoys), move at a fixed pace, can be seen through the fog like any unit, and are
// lost with their cargo if hostile soldiers catch them (a mule carcass is left behind).
// Designed so a later phase can extend it (escorts, routes, depots -> front) without redesign.
import { CONVOY } from '../data/economy.js';
import { areHostile, sideBit, sideIndex } from '../data/factions.js';
import { SPECIES } from '../data/animals.js';
import { EV } from '../core/events.js';
import { dist, datan2, turnToward } from '../core/dmath.js';
import { DT, TICK_RATE, PATH_WORK_PER_TICK } from '../sim/constants.js';
import { findPath, moveSpeedMult } from '../world/nav.js';
import { pointGridQuery } from '../sim/runtime.js';
import { addCarcass } from '../sim/corpses.js';
import { specValue } from '../sim/specialities.js';
import { approachPoint } from '../units/orders.js';
import { homeDropOff, isRemote, isSettlement } from './settlements.js';

const P = [0, 0];

function stockTotal(st) {
  return st.stock.food + st.stock.material + st.stock.supply;
}

function activeFrom(state, sid) {
  for (const c of state.convoys) if (c.from === sid) return true;
  return false;
}

/** Dispatch carts from remote settlements (1 Hz). */
export function dispatchConvoys(sim, fid) {
  const { state, rt } = sim;
  const cap = CONVOY.capacity * specValue(state, fid, 'convoyCap', 1);
  for (const st of state.structures) {
    if (st.faction !== fid || !st.built || !isSettlement(st) || !st.stock) continue;
    const total = stockTotal(st);
    if (total < 1) continue;
    const waited = state.tick - st.lastConvoy > CONVOY.maxWaitSec * TICK_RATE;
    if (total < CONVOY.minCargo && !(waited && total >= 5)) continue;
    if (activeFrom(state, st.id) || state.convoys.length >= CONVOY.maxActive) continue;
    if (!isRemote(sim, st)) continue;
    const home = homeDropOff(sim, fid, st.x, st.z);
    if (!home) continue;
    if (rt.pathWork >= PATH_WORK_PER_TICK) return; // budgeted A*: next second
    approachPoint(st, home.x, home.z, P, 2.2);
    const sx = P[0], sz = P[1];
    approachPoint(home, sx, sz, P, 2.5);
    const res = findPath(rt.nav, fid, sx, sz, P[0], P[1]);
    rt.pathWork += rt.nav.lastCost;
    if (!res || !res.points.length) { st.lastConvoy = state.tick; continue; }
    const k = Math.min(1, cap / total);
    const cargo = { food: st.stock.food * k, material: st.stock.material * k, supply: st.stock.supply * k };
    st.stock.food -= cargo.food; st.stock.material -= cargo.material; st.stock.supply -= cargo.supply;
    st.lastConvoy = state.tick;
    const c = {
      id: state.nextId++, faction: fid, from: st.id, to: home.id, x: sx, z: sz, rot: datan2(home.x - sx, home.z - sz),
      path: res.points, pi: 0, cargo, hp: CONVOY.hp, maxHp: CONVOY.hp, visibleTo: sideBit(fid), seenBy: 0, vx: 0, vz: 0,
    };
    state.convoys.push(c);
    sim.events.push({ type: EV.CONVOY_DISPATCHED, id: c.id, faction: fid, x: sx, z: sz });
  }
}

function arrive(sim, c) {
  const f = sim.state.factions[c.faction];
  f.resources.food += c.cargo.food;
  f.resources.material += c.cargo.material;
  f.resources.supply += c.cargo.supply;
  f.stats.convoysArrived++;
  sim.events.push({ type: EV.CONVOY_ARRIVED, id: c.id, faction: c.faction, x: c.x, z: c.z, food: Math.round(c.cargo.food), material: Math.round(c.cargo.material), supply: Math.round(c.cargo.supply) });
}

function lose(sim, c, by) {
  const f = sim.state.factions[c.faction];
  f.stats.convoysLost++;
  sim.events.push({ type: EV.CONVOY_LOST, id: c.id, faction: c.faction, x: c.x, z: c.z, by: by || '' });
  // the draught mule stays in the mud
  addCarcass(sim, c.x, c.z, c.rot, 'mule', SPECIES.mule.biomass, c.visibleTo);
}

/** Move carts along their paths; resolve arrivals and raids. Every tick. */
export function updateConvoys(sim) {
  const { state, rt } = sim;
  if (!state.convoys.length) return;
  const nav = rt.nav;
  for (let i = state.convoys.length - 1; i >= 0; i--) {
    const c = state.convoys[i];
    const fIdx = sideIndex(c.faction);
    // destination lost: head for another home drop-off (or give up: cargo lost)
    let dest = rt.structById.get(c.to);
    if (!dest || dest.hp <= 0) {
      dest = homeDropOff(sim, c.faction, c.x, c.z);
      if (!dest) { state.convoys.splice(i, 1); lose(sim, c, ''); continue; }
      c.to = dest.id;
      approachPoint(dest, c.x, c.z, P, 2.5);
      const res = rt.pathWork < PATH_WORK_PER_TICK ? findPath(nav, c.faction, c.x, c.z, P[0], P[1]) : null;
      if (res) { rt.pathWork += nav.lastCost; c.path = res.points; c.pi = 0; }
    }
    // raid: hostile soldiers on the cart
    if ((state.tick + c.id) % 10 === 0) {
      let n = 0, by = '';
      pointGridQuery(rt.soldierGrid, c.x, c.z, CONVOY.raidRange, (m, sq) => {
        if (m.state === 'alive' && areHostile(c.faction, sq.faction)) { n++; by = sq.faction; }
      });
      if (n) {
        c.hp -= CONVOY.raidDps * 0.5 * Math.min(3, n);
        if (c.hp <= 0) { state.convoys.splice(i, 1); lose(sim, c, by); continue; }
      }
    }
    // travel
    const speed = CONVOY.speed * specValue(state, c.faction, 'convoySpeed', 1) * Math.max(0.35, moveSpeedMult(nav, c.x, c.z, c.faction, fIdx, true)) * DT;
    let left = speed;
    const px = c.x, pz = c.z;
    while (left > 1e-6 && c.pi * 2 < c.path.length) {
      const wx = c.path[c.pi * 2], wz = c.path[c.pi * 2 + 1];
      const d = dist(c.x, c.z, wx, wz);
      if (d <= left) { c.x = wx; c.z = wz; left -= d; c.pi++; }
      else { c.x += ((wx - c.x) / d) * left; c.z += ((wz - c.z) / d) * left; left = 0; }
    }
    c.vx = c.x - px; c.vz = c.z - pz;
    if (c.vx * c.vx + c.vz * c.vz > 1e-8) c.rot = turnToward(c.rot, datan2(c.vx, c.vz), 3 * DT);
    if (c.pi * 2 >= c.path.length) {
      state.convoys.splice(i, 1);
      arrive(sim, c);
    }
  }
}
