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
import { FACTIONS } from '../data/factions.js';
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
} from './pestilence.js';

let scratch = null;
const PLAGUE = { kind: 'plague', infect: 0 };
const GRAIL = 'black_grail';

// Fighting Grail soldiers feed on the dead around them; work gangs (combatUnit false) do not —
// they haul bodies to an altar / corpse mound instead (units/orders.js corpse gathering).
function anyGrailSoldierNear(sim, x, z, r) {
  let found = false;
  pointGridQuery(sim.rt.soldierGrid, x, z, r, (m, sq) => {
    if (!found && sq.faction === GRAIL && m.state === 'alive' && unitDef(sq.type).combatUnit) found = true;
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

/** Consecrated ground (Trench Cleric aura / aid station with Faith & Medicine): no body rises there. */
export function consecrated(sim, x, z) {
  for (const fid in sim.rt.auras || {}) {
    if (fid === GRAIL) continue;
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
  const H = FACTIONS[fid].harvest;
  for (const st of state.structures) {
    if (st.faction !== fid || !st.built) continue;
    const d = STRUCTURES[st.type];
    if (d.biomassRate) gain(f, 'passive', d.biomassRate, state.tick);
  }
  const rot = pestTier(state) >= 3 ? PESTILENCE.tide.corpseRot : 1;
  // harvest corpses (uninfected ones; infected corpses are reserved for reanimation)
  for (let i = state.corpses.length - 1; i >= 0; i--) {
    const c = state.corpses[i];
    if (c.riseAt) continue;
    let rate = 0, viaMound = false;
    if (!c.infected && anyGrailSoldierNear(sim, c.x, c.z, H.radius)) rate = H.ratePerSecond;
    else {
      const mound = c.infected ? null : moundNear(sim, fid, c.x, c.z);
      if (mound) { rate = mound.harvestRate * specValue(state, fid, 'moundHarvest', 1); viaMound = true; } // bodies near a corpse mound render down
      else if (!c.infected && infectionAt(state, c.x, c.z) > 110) rate = 0.12 * rot; // rot seeps into infected ground
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
  const R = FACTIONS[fid].reanimation;
  const delay = Math.round(R.delaySeconds * TICK_RATE * reanimDelayMult(state));
  const turnDelay = turnDelayTicks(state);
  // schedule: turning bodies rise where they lie; other infected bodies need Grail presence or
  // festering ground. A body on consecrated ground cannot rise while it lies there (a scheduled
  // one is stopped); after R.blessSec seconds (cumulative) of consecration it is PURIFIED for good
  // (Phase 4.1: before, a body left consecrated ground and could still rise — the old comment
  // "consecrated bodies never rise" only held inside the area). A purified body is no longer
  // infected (the Grail can still strip it for biomass).
  for (const c of state.corpses) {
    if (!c.infected) continue;
    if (consecrated(sim, c.x, c.z)) {
      c.riseAt = 0; c.sched = 0;
      c.cons = (c.cons || 0) + 1;
      if (c.cons >= R.blessSec) {
        c.infected = false; c.turn = 0; c.blessed = 1;
        sim.events.push({ type: EV.CORPSE_PURIFIED, id: c.id, x: c.x, z: c.z, faction: c.faction });
      }
      continue;
    }
    if (c.riseAt) continue;
    if (c.turn) c.riseAt = Math.max(state.tick + 20, c.tick + turnDelay);
    else if (anyGrailSoldierNear(sim, c.x, c.z, R.searchRadius) || infectionAt(state, c.x, c.z) > 150) c.riseAt = state.tick + delay;
    if (c.riseAt) c.sched = state.tick; // countdown start (world-space corpse UI)
  }
  // rise in clusters (turning bodies may rise alone: the plague does not wait for company)
  const ready = [];
  for (const c of state.corpses) if (c.riseAt && state.tick >= c.riseAt) ready.push(c);
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
    // face toward the nearest enemy objective direction (south for the attacker)
    const obj = state.structures.find((s) => s.objective);
    const rot = obj ? datan2(obj.x - cx, obj.z - cz) : 0;
    const sq = createSquad(state, fid, R.unit, cx, cz, rot, { size: cluster.length, positions, soldierState: 'rising' });
    for (let k = 0; k < cluster.length; k++) sq.members[k].rot = cluster[k].rot;
    state.squads.push(sq);
    rt.squadById.set(sq.id, sq);
    for (const m of sq.members) rt.soldierIndex.set(m.id, sq);
    state.factions[fid].stats.raised += cluster.length;
    pestGain(sim, PESTILENCE.gain.rise * cluster.length, 'risen');
    for (let k = 0; k < cluster.length; k++) {
      const c = cluster[k];
      sim.events.push({ type: EV.SOLDIER_RISING, id: sq.members[k].id, sq: sq.id, corpseId: c.id, faction: fid, x: c.x, z: c.z, fromFaction: c.faction, fromUnit: c.unit, turned: c.turn ? 1 : 0 });
      removeCorpse(sim, c, 'raised');
    }
    sim.events.push({ type: EV.SQUAD_SPAWNED, id: sq.id, faction: fid, unit: R.unit, x: cx, z: cz, risen: true });
  }
}

function updateInfection(sim, fid) {
  const { state } = sim;
  const inf = state.infection;
  const n = inf.cols * inf.rows;
  if (!scratch || scratch.length !== n) scratch = new Int16Array(n);
  const add = scratch;
  add.fill(0);
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
        add[z * inf.cols + x] += Math.max(1, Math.round(src.rate * (1 - Math.sqrt(d2) / (r + 1))));
      }
    }
  }
  // sources: infected corpses rot the ground
  for (const c of state.corpses) {
    if (!c.infected) continue;
    const x = Math.floor(c.x / inf.cs), z = Math.floor(c.z / inf.cs);
    if (x >= 0 && z >= 0 && x < inf.cols && z < inf.rows) add[z * inf.cols + x] += 4;
  }
  // spread from dense cells + decay where nothing feeds it
  for (let z = 0; z < inf.rows; z++) {
    for (let x = 0; x < inf.cols; x++) {
      const i = z * inf.cols + x;
      const v = inf.v[i];
      if (v > 170) {
        if (x > 0) add[i - 1] += 1;
        if (x < inf.cols - 1) add[i + 1] += 1;
        if (z > 0) add[i - inf.cols] += 1;
        if (z < inf.rows - 1) add[i + inf.cols] += 1;
      }
    }
  }
  let cells = 0;
  for (let i = 0; i < n; i++) {
    let v = inf.v[i] + add[i];
    if (add[i] === 0 && v > 0) v -= 1;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    inf.v[i] = v;
    if (v >= 120) cells++;
  }
  return cells;
}

function infectionEffects(sim, fid) {
  const { state } = sim;
  const rng = state.rng.main;
  const spread = 0.25 * spreadMult(state);
  const regen = 2 * specValue(state, fid, 'grailRegen', 1);
  for (const sq of state.squads) {
    const grail = sq.faction === fid;
    const def = unitDef(sq.type);
    for (const m of sq.members) {
      if (m.state !== 'alive') continue;
      const v = infectionAt(state, m.x, m.z);
      if (grail) {
        if (v >= 60 && m.hp < def.hp) m.hp = Math.min(def.hp, m.hp + regen);
        continue;
      }
      if (v >= 160 && rngFloat(rng) < spread) addInfection(sim, sq, m, 1);
      if (m.infection > 0) {
        // plague damage over time (halved under a medic's care); the killing blow belongs to the
        // Grail (corpse is infected)
        const k = m.slow > state.tick ? 0.5 : 1;
        damageSoldier(sim, sq, m, m.infection * 1.5 * k, fid, PLAGUE, 0, 0);
        if (m.state === 'alive' && v < 60 && rngFloat(rng) < 0.12) m.infection--;
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
      addInfection(sim, sq, m, 3);
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
      if (o.faction === fid || !FACTIONS[o.faction]) continue;
      let near = false;
      for (const a of p.areas) if (dist(o.cx, o.cz, a.x, a.z) <= (a.infectRadius || a.r) + 10) { near = true; break; }
      if (!near) continue;
      let touched = false;
      for (const m of o.members) {
        if (m.state !== 'alive') continue;
        let inside = false;
        for (const a of p.areas) if (dist(m.x, m.z, a.x, a.z) <= (a.infectRadius || a.r)) { inside = true; break; }
        if (!inside) continue;
        addInfection(sim, o, m, 1);
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
  const bit = 1 << FACTIONS[fid].index;
  for (const e of sim.state.squads) {
    if (e.faction === fid || !FACTIONS[e.faction] || !(e.visibleTo & bit) || !unitDef(e.type).combatUnit) continue;
    if (dist(e.cx, e.cz, x, z) <= r) return true;
  }
  for (const st of sim.state.structures) {
    if (st.faction === fid || st.faction === 'neutral' || !((st.visibleTo | st.seenBy) & bit)) continue;
    const d = STRUCTURES[st.type];
    const w = d.weapon ? 55 : d.emplacement ? 70 : 0;
    if (w && dist(st.x, st.z, x, z) <= w + 5) return true;
  }
  return false;
}

const SAFE_R = 40;

function safeForage(sim, sq, r) {
  const fid = sq.faction;
  if (threatAt(sim, fid, sq.cx, sq.cz, SAFE_R)) return false;
  const bit = 1 << FACTIONS[fid].index;
  for (const c of sim.state.corpses) {
    if (c.infected || c.riseAt || c.biomass <= 0.01 || !(c.seenBy & bit)) continue;
    if (dist(c.x, c.z, sq.cx, sq.cz) <= r && !threatAt(sim, fid, c.x, c.z, SAFE_R)) return true;
  }
  const a = forageAnimal(sim, fid, sq.cx, sq.cz, r);
  return !!a && !threatAt(sim, fid, a.x, a.z, SAFE_R);
}

function autoForage(sim, fid) {
  const { state } = sim;
  const tick = state.tick;
  const r = AUTO_FORAGE_R * specValue(state, fid, 'forageRadius', 1);
  for (const sq of state.squads) {
    if (sq.faction !== fid || unitDef(sq.type).gathers !== 'corpse') continue;
    const o = sq.order;
    // an automatic hunt breaks off when an enemy appears close (no suicide runs at MG lines)
    if (o.t === 'gather' && o.auto && (tick + sq.id) % 20 === 0 && threatAt(sim, fid, sq.cx, sq.cz, 30)) {
      const home = nearestDrop(sim, fid, sq.cx, sq.cz);
      if (home) setOrder(sim, sq, { t: 'move', x: home.x, z: home.z + 10, am: 0, trench: 0 });
      else sq.order = { t: 'idle' };
      sq.autoT = tick + 20 * TICK_RATE;
      sim.events.push({ type: EV.NOTICE, faction: fid, key: 'gang.fled', squadId: sq.id, x: sq.cx, z: sq.cz });
      continue;
    }
    if (o.t !== 'idle' || sq.autoHunt === 0) { if (o.t !== 'idle') sq.autoT = 0; continue; }
    if (sq.autoT === 0) { sq.autoT = tick + AUTO_IDLE; continue; }
    if (tick < sq.autoT) continue;
    sq.autoT = tick + AUTO_RETRY;
    if (!sq.members.some((m) => m.state === 'alive') || !safeForage(sim, sq, r)) continue;
    setOrder(sim, sq, { t: 'gather', mode: 'forage', fx: sq.cx, fz: sq.cz, fr: r, phase: 'seek', cid: 0, aid: 0, auto: 1 });
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
  const obj = state.structures.find((s) => s.objective);
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
      f.econ.infCells = updateInfection(sim, fid); // plain state: identical after a save / load
      if (sim.state.match.phase === 'WAR') infectionEffects(sim, fid);
    }
    if (sim.state.match.phase === 'WAR' && t % 10 === 7) { finishWounded(sim, fid); leaders(sim, fid); }
  },
};
