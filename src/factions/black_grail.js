// Black Grail faction logic: DEATH / DISEASE / INFECTION / ORGANIC WARFARE.
// No mines, no barracks chain. The economy is fed by death — and (Phase 3) not only by the dead
// behind the enemy's trenches:
//  - BIOMASS sources: animal carcasses (low), old battlefield bodies (low-mid), civilians (mid),
//    enemy soldiers (high), heavies / elites (higher), a small passive trickle from the altars
//    (enough for the first waves, never the main economy)
//  - corpses near fighting Grail soldiers are consumed; work gangs forage animals and haul bodies
//  - INFECTED corpses rise as Grail Thralls (canon: infected dead "lurch to their feet"); a soldier
//    who dies SUFFICIENTLY infected turns where he lies after a delay — inside the enemy's lines,
//    Grail nearby or not — unless his body is burned, sanitized or lies on consecrated ground
//  - PESTILENCE (factions/pestilence.js): plague momentum meter with tiers and a Great Pestilence
//  - infected ground heals the Grail and seeds infection into New Antioch soldiers
//  - speciality leaders: Heralds of Beelzebub (fly-cloud aura), the Lord of Tumours (regen aura)
import { STRUCTURES } from '../data/structures.js';
import { sideDef, sideBit, sideIndex, FOG_LAYERS } from '../data/factions.js';
import { unitDef } from '../data/units.js';
import { PESTILENCE } from '../data/specialities.js';
import { EV } from '../core/events.js';
import { dist, datan2 } from '../core/dmath.js';
import { rngFloat } from '../core/rng.js';
import { TICK_RATE } from '../sim/constants.js';
import { createSquad } from '../sim/state.js';
import { pointGridQuery } from '../sim/runtime.js';
import { removeCorpse, damageSoldier, killSoldier } from '../combat/combat.js';
import { corpseKind, setOrder } from '../units/orders.js';
import { forageAnimal } from '../sim/wildlife.js';
import { auraValue } from '../sim/auras.js';
import { specValue } from '../sim/specialities.js';
import {
  addInfection, pestGain, pestTier, spreadMult, reanimDelayMult, turnDelayTicks, updatePestilence,
  plagueSides, plagueFaction, plagueImmune, isPlagueSide,
} from './pestilence.js';
import { enemyTarget } from '../sim/sides.js';
import { TERRAIN } from '../data/terrain_types.js';
import { forageSpot, habitatSpot, huntThreat } from '../units/hunt_targets.js';

let scratch = null;
const PLAGUE = { kind: 'plague', infect: 0 };

function infectionTerrain(sim, inf, cx, cz) {
  const t = sim.world.terrain;
  const x = (cx + 0.5) * inf.cs, z = (cz + 0.5) * inf.cs;
  const tx = Math.max(0, Math.min(t.cols - 1, Math.floor(x / t.cell)));
  const tz = Math.max(0, Math.min(t.rows - 1, Math.floor(z / t.cell)));
  return t.types[tz * t.cols + tx];
}

function infectionPassable(sim, inf, cx, cz) {
  const ty = infectionTerrain(sim, inf, cx, cz);
  return ty !== TERRAIN.DEEP && ty !== TERRAIN.ROCK;
}

function bridgeCell(sim, inf, cx, cz) {
  return infectionTerrain(sim, inf, cx, cz) === TERRAIN.BRIDGE;
}

/** A radial source may feed a cell only along connected terrain; it cannot paint the far bank. */
function sourceConnected(sim, inf, ax, az, bx, bz) {
  const steps = Math.max(Math.abs(bx - ax), Math.abs(bz - az));
  if (!steps) return infectionPassable(sim, inf, ax, az);
  for (let k = 0; k <= steps; k++) {
    const x = Math.round(ax + ((bx - ax) * k) / steps);
    const z = Math.round(az + ((bz - az) * k) / steps);
    if (!infectionPassable(sim, inf, x, z)) return false;
  }
  return true;
}

// Fighting soldiers of this plague side feed on the dead around them; work gangs (combatUnit
// false) do not — they haul bodies to an altar / corpse mound instead (units/orders.js).
function anyGrailSoldierNear(sim, fid, x, z, r) {
  let found = false;
  pointGridQuery(sim.rt.soldierGrid, x, z, r, (m, sq) => {
    if (!found && sq.faction === fid && m.state === 'alive' && unitDef(sq.type).combatUnit) found = true;
  });
  return found;
}

/** Built own structure with harvestRadius (corpse mound) whose radius holds (x,z), else null. */
function moundNear(sim, fid, x, z) {
  for (const st of sim.state.structures) {
    if (st.faction !== fid || !st.built) continue;
    const d = STRUCTURES[st.type];
    if (d.harvestRadius && dist(x, z, st.x, st.z) <= d.harvestRadius * specValue(sim.state, fid, 'moundHarvest', 1)) return d;
  }
  return null;
}

export function infectionAt(state, x, z) {
  const inf = state.infection;
  const cx = Math.floor(x / inf.cs), cz = Math.floor(z / inf.cs);
  if (cx < 0 || cz < 0 || cx >= inf.cols || cz >= inf.rows) return 0;
  return inf.v[cz * inf.cols + cx];
}

/** Infection at a point counted only when the cell belongs to `side`'s plague (0 otherwise). */
export function ownInfectionAt(state, side, x, z) {
  const inf = state.infection;
  const cx = Math.floor(x / inf.cs), cz = Math.floor(z / inf.cs);
  if (cx < 0 || cz < 0 || cx >= inf.cols || cz >= inf.rows) return 0;
  const i = cz * inf.cols + cx;
  if (inf.o && inf.o[i] !== sideIndex(side) + 1) return 0;
  return inf.v[i];
}

/** Consecrated ground (Trench Cleric aura / aid station with Faith & Medicine): no body rises there. */
export function consecrated(sim, x, z) {
  for (const fid in sim.rt.auras || {}) {
    if (isPlagueSide(sim.state, fid)) continue;
    for (const a of sim.rt.auras[fid]) {
      if (a.consecrate && dist(a.x, a.z, x, z) <= a.consecrate) return true;
    }
  }
  return false;
}

function gain(f, kind, amount, tick) {
  f.resources.biomass += amount;
  f.stats.biomass[kind] = (f.stats.biomass[kind] || 0) + amount;
  if (kind !== 'passive' && f.stats.firstBiomassTick < 0) f.stats.firstBiomassTick = tick;
}

function income(sim, fid) {
  const { state } = sim;
  const f = state.factions[fid];
  const H = sideDef(fid).harvest;
  for (const st of state.structures) {
    if (st.faction !== fid || !st.built) continue;
    const d = STRUCTURES[st.type];
    if (d.biomassRate) gain(f, 'passive', d.biomassRate, state.tick);
  }
  const rot = pestTier(state, fid) >= 3 ? PESTILENCE.tide.corpseRot : 1;
  // harvest corpses (uninfected ones; infected corpses are reserved for reanimation)
  for (let i = state.corpses.length - 1; i >= 0; i--) {
    const c = state.corpses[i];
    if (c.riseAt) continue;
    let rate = 0, viaMound = false;
    if (!c.infected && anyGrailSoldierNear(sim, fid, c.x, c.z, H.radius)) rate = H.ratePerSecond;
    else {
      const mound = c.infected ? null : moundNear(sim, fid, c.x, c.z);
      if (mound) { rate = mound.harvestRate * specValue(state, fid, 'moundHarvest', 1); viaMound = true; } // bodies near a corpse mound render down
      else if (!c.infected && ownInfectionAt(state, fid, c.x, c.z) > 110) rate = 0.12 * rot; // rot seeps into infected ground
    }
    if (rate <= 0) continue;
    const take = Math.min(c.biomass, rate);
    c.biomass -= take;
    gain(f, corpseKind(c), take, state.tick);
    if (viaMound) f.stats.moundBio = (f.stats.moundBio || 0) + take; // balance metric: corpse mound contribution
    if (c.biomass <= 0.0001) {
      f.stats.corpsesHarvested++;
      removeCorpse(sim, c, 'consumed');
    }
  }
}

function reanimate(sim, fid) {
  const { state, rt } = sim;
  const R = sideDef(fid).reanimation;
  const delay = Math.round(R.delaySeconds * TICK_RATE * reanimDelayMult(state, fid));
  const turnDelay = turnDelayTicks(state, fid);
  const first = plagueFaction(state);
  // schedule: turning bodies rise where they lie; other infected bodies need Grail presence or
  // festering ground. A body on consecrated ground cannot rise while it lies there (a scheduled
  // one is stopped); after R.blessSec seconds (cumulative) of consecration it is PURIFIED for good
  // (Phase 4.1: before, a body left consecrated ground and could still rise — the old comment
  // "consecrated bodies never rise" only held inside the area). A purified body is no longer
  // infected (the Grail can still strip it for biomass).
  for (const c of state.corpses) {
    // only the bodies THIS plague claimed (a mirror match has two claimants)
    if (!c.infected || (c.plague || first) !== fid) continue;
    if (consecrated(sim, c.x, c.z)) {
      c.riseAt = 0; c.sched = 0;
      c.cons = (c.cons || 0) + 1;
      if (c.cons >= R.blessSec) {
        c.infected = false; c.plague = ''; c.turn = 0; c.blessed = 1;
        sim.events.push({ type: EV.CORPSE_PURIFIED, id: c.id, x: c.x, z: c.z, faction: c.faction });
      }
      continue;
    }
    if (c.riseAt) continue;
    if (c.turn) c.riseAt = Math.max(state.tick + 20, c.tick + turnDelay);
    else if (anyGrailSoldierNear(sim, fid, c.x, c.z, R.searchRadius) || ownInfectionAt(state, fid, c.x, c.z) > 150) c.riseAt = state.tick + delay;
    if (c.riseAt) c.sched = state.tick; // countdown start (world-space corpse UI)
  }
  // rise in clusters (turning bodies may rise alone: the plague does not wait for company)
  const ready = [];
  for (const c of state.corpses) if (c.riseAt && state.tick >= c.riseAt && (c.plague || first) === fid) ready.push(c);
  const used = new Set();
  for (const seed of ready) {
    if (used.has(seed.id)) continue;
    const cluster = [];
    for (const c of ready) {
      if (used.has(c.id)) continue;
      if (dist(seed.x, seed.z, c.x, c.z) <= R.clusterRadius) cluster.push(c);
      if (cluster.length >= R.maxBodies) break;
    }
    const waited = state.tick - seed.riseAt;
    const turning = cluster.every((c) => c.turn);
    // bodies rise in hordes; stragglers still rise after a while (never left flagged forever)
    if (!turning && cluster.length < R.minBodies && !(cluster.length >= 2 && waited > 400) && waited <= R.loneRiseTicks) continue;
    let cx = 0, cz = 0;
    for (const c of cluster) { cx += c.x; cz += c.z; used.add(c.id); }
    cx /= cluster.length; cz /= cluster.length;
    const positions = cluster.map((c) => [c.x, c.z]);
    // face toward the enemy's objective / headquarters (whatever the side's role)
    const obj = enemyTarget(sim, fid);
    const rot = obj ? datan2(obj.x - cx, obj.z - cz) : 0;
    const raised = createSquad(state, fid, R.unit, cx, cz, rot, { size: cluster.length, positions, soldierState: 'rising' });
    // Append to the first stable-id nearby young pack; never grow past 16 members.
    let sq = state.squads.find((q) => q.autonomous === 'risen' && q.faction === fid && state.tick - q.spawnTick < 480 &&
      q.order.t !== 'storm' && q.members.length + cluster.length <= 16 && dist(q.cx, q.cz, cx, cz) <= 18);
    const members = raised.members;
    if (!sq) {
      sq = raised; sq.autonomous = 'risen'; sq.risenState = 'RISE'; sq.risenNext = state.tick;
      state.squads.push(sq); rt.squadById.set(sq.id, sq);
    } else {
      const offset = sq.members.length;
      for (const m of members) { m.slot += offset; sq.members.push(m); }
      sq.cap = sq.members.length;
    }
    for (let k = 0; k < members.length; k++) { members[k].rot = cluster[k].rot; rt.soldierIndex.set(members[k].id, sq); }
    state.factions[fid].stats.raised += cluster.length;
    pestGain(sim, PESTILENCE.gain.rise * cluster.length, 'risen', fid);
    for (let k = 0; k < cluster.length; k++) {
      const c = cluster[k];
      sim.events.push({ type: EV.SOLDIER_RISING, id: members[k].id, sq: sq.id, corpseId: c.id, faction: fid, x: c.x, z: c.z, fromFaction: c.faction, fromUnit: c.unit, turned: c.turn ? 1 : 0 });
      removeCorpse(sim, c, 'raised');
    }
    sim.events.push({ type: EV.SQUAD_SPAWNED, id: sq.id, faction: fid, unit: R.unit, x: cx, z: cz, risen: true });
  }
}

/**
 * Ground infection (one grid for the match, run ONCE per step by the first plague side). Each plague
 * side feeds its own layer (its altars / pits, the infected bodies it claimed, spread from cells it
 * owns); a cell's owner is the layer that fed it most this step (ties: the current owner, then the
 * lowest layer). Returns the festering cells (>= 120) per owner layer.
 */
function updateInfection(sim) {
  const { state } = sim;
  const inf = state.infection;
  const n = inf.cols * inf.rows;
  const L = FOG_LAYERS;
  if (!inf.o || inf.o.length !== n) inf.o = new Uint8Array(n);
  const own = inf.o;
  if (!scratch || scratch.length !== n * L) scratch = new Int16Array(n * L);
  const add = scratch;
  add.fill(0);
  const sides = plagueSides(state);
  const firstLayer = sides.length ? sideIndex(sides[0]) : 0;
  for (const fid of sides) {
    const base = sideIndex(fid) * n;
    const pitR = specValue(state, fid, 'pitRadius', 1);
    // sources: altars / plague pits
    for (const st of state.structures) {
      if (st.faction !== fid || !st.built) continue;
      const src = STRUCTURES[st.type].infectionSource;
      if (!src) continue;
      const r = (src.radius * (st.type === 'plague_pit' ? pitR : 1)) / inf.cs;
      const cx = Math.floor(st.x / inf.cs), cz = Math.floor(st.z / inf.cs);
      const R = Math.ceil(r);
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          const d2 = dx * dx + dz * dz;
          if (d2 > r * r) continue;
          const x = cx + dx, z = cz + dz;
          if (x < 0 || z < 0 || x >= inf.cols || z >= inf.rows) continue;
          if (!sourceConnected(sim, inf, cx, cz, x, z)) continue;
          add[base + z * inf.cols + x] += Math.max(1, Math.round(src.rate * (1 - Math.sqrt(d2) / (r + 1))));
        }
      }
    }
  }
  // sources: infected corpses rot the ground (their claimant's layer)
  for (const c of state.corpses) {
    if (!c.infected) continue;
    const x = Math.floor(c.x / inf.cs), z = Math.floor(c.z / inf.cs);
    const layer = c.plague ? sideIndex(c.plague) : firstLayer;
    if (layer >= 0 && x >= 0 && z >= 0 && x < inf.cols && z < inf.rows) add[layer * n + z * inf.cols + x] += 4;
  }
  // Plague units fighting on a bridge lightly feed the cell beneath them. Structures remain the
  // main source; this only lets the front crawl behind an advancing army.
  for (const fid of sides) {
    const layer = sideIndex(fid);
    for (const sq of state.squads) {
      if (sq.faction !== fid || !unitDef(sq.type).combatUnit || !sq.members.some((m) => m.state === 'alive')) continue;
      const x = Math.floor(sq.cx / inf.cs), z = Math.floor(sq.cz / inf.cs);
      if (x >= 0 && z >= 0 && x < inf.cols && z < inf.rows && bridgeCell(sim, inf, x, z)) add[layer * n + z * inf.cols + x] += 2;
    }
  }
  // Terrain-aware spread. Ordinary land creep remains slow. A bridge/ford is a narrow connected
  // propagation line: once fed above 70 it advances ~one 8 m cell per 6-10 seconds. Deep water is
  // never a neighbour, so infection cannot teleport across the river.
  for (let z = 0; z < inf.rows; z++) {
    for (let x = 0; x < inf.cols; x++) {
      const i = z * inf.cols + x;
      const v = inf.v[i];
      const hereBridge = bridgeCell(sim, inf, x, z);
      if (v > (hereBridge ? 70 : 170)) {
        const b = (own[i] ? own[i] - 1 : firstLayer) * n;
        const feed = (nx, nz, ni) => {
          if (!infectionPassable(sim, inf, nx, nz)) return;
          const crossing = hereBridge || bridgeCell(sim, inf, nx, nz);
          add[b + ni] += crossing ? 28 : 1;
        };
        if (x > 0) feed(x - 1, z, i - 1);
        if (x < inf.cols - 1) feed(x + 1, z, i + 1);
        if (z > 0) feed(x, z - 1, i - inf.cols);
        if (z < inf.rows - 1) feed(x, z + 1, i + inf.cols);
      }
    }
  }
  const cells = new Array(L).fill(0);
  for (let i = 0; i < n; i++) {
    let a = 0, best = -1, bestA = 0;
    for (let l = 0; l < L; l++) {
      const k = add[l * n + i];
      if (!k) continue;
      a += k;
      if (k > bestA || (k === bestA && own[i] === l + 1)) { bestA = k; best = l; }
    }
    let v = inf.v[i] + a;
    if (a === 0 && v > 0) v -= 1;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    inf.v[i] = v;
    if (best >= 0) own[i] = best + 1;
    if (!v) own[i] = 0;
    if (v >= 120 && own[i]) cells[own[i] - 1]++;
  }
  return cells;
}

function infectionEffects(sim, fid) {
  const { state } = sim;
  const rng = state.rng.main;
  const spread = 0.25 * spreadMult(state, fid);
  const regen = 2 * specValue(state, fid, 'grailRegen', 1);
  const first = plagueFaction(state);
  for (const sq of state.squads) {
    const grail = sq.faction === fid;
    const def = unitDef(sq.type);
    // other plague-immune sides (a mirror twin) neither sicken nor heal on this plague's ground
    if (!grail && plagueImmune(sq.faction)) continue;
    for (const m of sq.members) {
      if (m.state !== 'alive') continue;
      const v = ownInfectionAt(state, fid, m.x, m.z);
      if (grail) {
        if (v >= 60 && m.hp < def.hp) m.hp = Math.min(def.hp, m.hp + regen);
        continue;
      }
      if (v >= 160 && rngFloat(rng) < spread) addInfection(sim, sq, m, 1, fid);
      // the plague's damage belongs to whoever laid the stacks
      if (m.infection > 0 && (m.infBy || first) === fid) {
        // plague damage over time (halved under a medic's care); the killing blow belongs to the
        // Grail (corpse is infected)
        const k = m.slow > state.tick ? 0.5 : 1;
        damageSoldier(sim, sq, m, m.infection * 1.5 * k, fid, PLAGUE, 0, 0);
        if (m.state === 'alive' && infectionAt(state, m.x, m.z) < 60 && rngFloat(rng) < 0.12) m.infection--;
      }
    }
  }
}

/** Grail soldiers finish (and infect) the wounded they stand over. */
function finishWounded(sim, fid) {
  const { state, rt } = sim;
  for (const sq of state.squads) {
    if (sq.faction === fid) continue;
    for (const m of sq.members) {
      if (m.state !== 'wounded') continue;
      let by = null;
      pointGridQuery(rt.soldierGrid, m.x, m.z, 1.9, (g, gsq) => {
        if (!by && gsq.faction === fid && g.state === 'alive' && unitDef(gsq.type).combatUnit) by = g;
      });
      if (!by) continue;
      addInfection(sim, sq, m, 3, fid);
      sim.events.push({ type: EV.MELEE, attacker: by.id, sq: rt.soldierIndex.get(by.id) ? rt.soldierIndex.get(by.id).id : 0, faction: fid, weapon: 'thrall_claws', x: by.x, z: by.z, tx: m.x, tz: m.z, hit: true, target: m.id, tsq: sq.id, impact: 'flesh' });
      killSoldier(sim, sq, m, fid, 'melee', m.x - by.x, m.z - by.z, 0, 0.5, 0);
    }
  }
}

/**
 * Heralds (fly-cloud aura: infection + shaken aim) and the Lord of Tumours (regeneration, horde
 * support, plague pressure). NON-STACKING by aura kind (Phase 4.1): a Grail soldier inside two
 * Lords' courts regenerates once; an enemy inside two Heralds' clouds takes one stack per pulse —
 * several leaders only widen the covered front (union of their areas).
 */
function leaders(sim, fid) {
  const { state } = sim;
  const tick = state.tick;
  const list = sim.rt.auras && sim.rt.auras[fid];
  if (!list || !list.length) return;
  let regen = false;
  const pulses = [];
  for (const a of list) {
    if (a.regen) regen = true;
    if (a.infectEverySec) {
      let p = pulses.find((x) => x.kind === a.kind);
      if (!p) { p = { kind: a.kind, every: Math.max(1, Math.round(a.infectEverySec * TICK_RATE)), areas: [], debuff: 0 }; pulses.push(p); }
      p.areas.push(a);
      if (a.debuff) p.debuff = 1;
    }
  }
  if (regen) {
    for (const o of state.squads) {
      if (o.faction !== fid) continue;
      const r = auraValue(sim, fid, o.cx, o.cz, 'regen');
      if (!r) continue;
      const hp = unitDef(o.type).hp;
      for (const m of o.members) if (m.state === 'alive' && m.hp < hp) m.hp = Math.min(hp, m.hp + r * 0.5);
    }
  }
  for (const p of pulses) {
    if (tick % p.every >= 10) continue; // once per period (leaders() runs every 10 ticks)
    for (const o of state.squads) {
      if (o.faction === fid || !sideDef(o.faction)) continue;
      let near = false;
      for (const a of p.areas) if (dist(o.cx, o.cz, a.x, a.z) <= (a.infectRadius || a.r) + 10) { near = true; break; }
      if (!near) continue;
      let touched = false;
      for (const m of o.members) {
        if (m.state !== 'alive') continue;
        let inside = false;
        for (const a of p.areas) if (dist(m.x, m.z, a.x, a.z) <= (a.infectRadius || a.r)) { inside = true; break; }
        if (!inside) continue;
        addInfection(sim, o, m, 1, fid);
        touched = true;
      }
      if (touched && p.debuff) o.debuffUntil = tick + 30;
    }
  }
}

/**
 * AUTO FORAGE (less hauling micro): a work gang left idle for a few seconds looks around itself
 * for known bodies / visible animals and forages that area on its own (order flagged auto: it goes
 * idle again when the area is empty). Any player / AI order takes over at once.
 */
const AUTO_IDLE = 6 * TICK_RATE;
const AUTO_RETRY = 8 * TICK_RATE;
export const AUTO_FORAGE_R = 28;

/**
 * AUTO SAFE HUNT (Phase 4.1): threat around a point as the faction KNOWS it — a visible enemy
 * squad within r, or a known enemy weapon position (MG post, pillbox, field gun…) covering it.
 * An idle gang with auto hunt on only forages where this is clear, and breaks off (back to a
 * drop-off) when an enemy shows up close; the player's own FORAGE order goes anywhere.
 */
export function threatAt(sim, fid, x, z, r) {
  return huntThreat(sim, fid, x, z, r);
}

const SAFE_R = 40;

function autoForage(sim, fid) {
  const { state } = sim;
  const tick = state.tick;
  const r = AUTO_FORAGE_R * specValue(state, fid, 'forageRadius', 1);
  for (const sq of state.squads) {
    if (sq.faction !== fid || unitDef(sq.type).gathers !== 'corpse') continue;
    const o = sq.order;
    // an automatic hunt breaks off when an enemy appears close (no suicide runs at MG lines)
    if ((o.t === 'gather' || o.t === 'move') && o.auto && o.phase !== 'to_drop' && huntThreat(sim, fid, sq.cx, sq.cz, sq.safeHunt === 0 ? 15 : 40, sq.safeHunt !== 0)) {
      const home = nearestDrop(sim, fid, sq.cx, sq.cz);
      if (home) setOrder(sim, sq, { t: 'gather', mode: 'forage', fx: home.x, fz: home.z, fr: r, phase: 'to_drop', cid: 0, aid: 0, auto: 1 });
      else sq.order = { t: 'idle' };
      sq.autoT = tick + 20 * TICK_RATE;
      sim.events.push({ type: EV.NOTICE, faction: fid, key: 'gang.fled', squadId: sq.id, x: sq.cx, z: sq.cz });
      continue;
    }
    if (o.t !== 'idle' || sq.autoHunt === 0) continue;
    if (sq.autoT === 0) { sq.autoT = tick + AUTO_IDLE; continue; }
    if (tick < sq.autoT) continue;
    sq.autoT = tick + AUTO_RETRY;
    if (!sq.members.some((m) => m.state === 'alive')) continue;
    if (!sq.huntMemo) sq.huntMemo = {};
    const prey = forageSpot(sim, fid, sq), target = prey || habitatSpot(sim, fid, sq, sq.huntMemo);
    if (!target) continue;
    if (!prey) sq.huntMemo[target.id] = tick + 20 * 90;
    setOrder(sim, sq, { t: 'gather', mode: 'forage', fx: target.x, fz: target.z, fr: r,
      phase: dist(sq.cx, sq.cz, target.x, target.z) > r * 0.5 ? 'travel' : 'seek', cid: prey && prey.kind === 'corpse' ? prey.id : 0, aid: 0, auto: 1 });
    sq.autoT = 0;
  }
}

function nearestDrop(sim, fid, x, z) {
  let best = null, bd = Infinity;
  for (const st of sim.state.structures) {
    if (st.faction !== fid || !st.built || !STRUCTURES[st.type].dropOff) continue;
    const d = dist(st.x, st.z, x, z);
    if (d < bd || (d === bd && best && st.id < best.id)) { bd = d; best = st; }
  }
  return best;
}

/**
 * Balance statistics: the first MEANINGFUL THRALL WAVE — at least two full squads' worth of
 * combat Thralls alive at once that were raised / trained during the war (paid by the war economy,
 * not the starting horde) — and the first time the Grail stands at the fortress walls.
 */
const WAVE_THRALLS = 24;
function watchBreach(sim, fid) {
  const { state } = sim;
  const f = state.factions[fid];
  if (f.stats.firstWaveTick < 0 && state.match.phase === 'WAR') {
    let n = 0;
    for (const sq of state.squads) {
      if (sq.faction !== fid || sq.type !== 'grail_thrall' || sq.spawnTick < state.match.prepEndTick) continue;
      for (const m of sq.members) if (m.state === 'alive') n++;
    }
    if (n >= WAVE_THRALLS) f.stats.firstWaveTick = state.tick;
  }
  if (f.stats.breachTick >= 0) return;
  const obj = enemyTarget(sim, fid);
  if (!obj) return;
  for (const sq of state.squads) {
    if (sq.faction !== fid || !unitDef(sq.type).combatUnit) continue;
    if (dist(sq.cx, sq.cz, obj.x, obj.z) < 30 && sq.members.some((m) => m.state === 'alive')) { f.stats.breachTick = state.tick; return; }
  }
}

export const blackGrailLogic = {
  id: 'black_grail',
  tick(sim, fid) {
    const t = sim.state.tick;
    const f = sim.state.factions[fid];
    if (t % 20 === 3) {
      income(sim, fid);
      autoForage(sim, fid);
      updatePestilence(sim, fid, f.econ.infCells || 0);
      watchBreach(sim, fid);
    }
    if (t % 20 === 11) reanimate(sim, fid);
    if (t % 40 === 17) {
      // one ground step per match (the first plague side runs it for all; plain state: identical
      // after a save / load), then each plague side applies its own ground
      if (fid === plagueFaction(sim.state)) {
        const cells = updateInfection(sim);
        for (const s of plagueSides(sim.state)) sim.state.factions[s].econ.infCells = cells[sideIndex(s)] || 0;
      }
      if (sim.state.match.phase === 'WAR') infectionEffects(sim, fid);
    }
    if (sim.state.match.phase === 'WAR' && t % 10 === 7) { finishWounded(sim, fid); leaders(sim, fid); }
  },
};
