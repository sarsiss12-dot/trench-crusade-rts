// Black Grail faction logic: DEATH / DISEASE / INFECTION / ORGANIC WARFARE.
// No mines, no barracks chain. The economy is fed by battlefield death:
//  - corpses near Black Grail soldiers are consumed into BIOMASS
//  - INFECTED corpses (killed by / carrying the plague) reanimate where they fell as Grail
//    Thralls (canon: infected corpses "lurch to their feet, driven by a demonic will")
//  - Altars of Beelzebub (canon structures) spread infected ground and raise hordes from biomass
//  - infected ground heals the Grail and seeds infection into New Antioch soldiers
//  - Phase 2: Grail Thrall work gangs (cheap, slow, capped) haul bodies to altars / corpse mounds
//    and raise organic structures (corpse mound, plague pit, fly nest, bone barricade) on the
//    Grail's own ground or on heavily infected ground
import { STRUCTURES } from '../data/structures.js';
import { FACTIONS } from '../data/factions.js';
import { unitDef } from '../data/units.js';
import { EV } from '../core/events.js';
import { dist, datan2 } from '../core/dmath.js';
import { rngFloat } from '../core/rng.js';
import { INFECTION_MAX, TICK_RATE } from '../sim/constants.js';
import { createSquad } from '../sim/state.js';
import { pointGridQuery } from '../sim/runtime.js';
import { removeCorpse, damageSoldier } from '../combat/combat.js';

let scratch = null;
const PLAGUE = { kind: 'plague', infect: 0 };

// Fighting Grail soldiers feed on the dead around them; work gangs (combatUnit false) do not —
// they haul bodies to an altar / corpse mound instead (units/orders.js corpse gathering).
function anyGrailSoldierNear(sim, x, z, r) {
  let found = false;
  pointGridQuery(sim.rt.soldierGrid, x, z, r, (m, sq) => {
    if (!found && sq.faction === 'black_grail' && m.state === 'alive' && unitDef(sq.type).combatUnit) found = true;
  });
  return found;
}

/** Built own structure with harvestRadius (corpse mound) whose radius holds (x,z), else null. */
function moundNear(sim, fid, x, z) {
  for (const st of sim.state.structures) {
    if (st.faction !== fid || !st.built) continue;
    const d = STRUCTURES[st.type];
    if (d.harvestRadius && dist(x, z, st.x, st.z) <= d.harvestRadius) return d;
  }
  return null;
}

export function infectionAt(state, x, z) {
  const inf = state.infection;
  const cx = Math.floor(x / inf.cs), cz = Math.floor(z / inf.cs);
  if (cx < 0 || cz < 0 || cx >= inf.cols || cz >= inf.rows) return 0;
  return inf.v[cz * inf.cols + cx];
}

function income(sim, fid) {
  const { state } = sim;
  const f = state.factions[fid];
  const H = FACTIONS[fid].harvest;
  for (const st of state.structures) {
    if (st.faction !== fid || !st.built) continue;
    const d = STRUCTURES[st.type];
    if (d.biomassRate) f.resources.biomass += d.biomassRate;
  }
  // harvest corpses (uninfected ones; infected corpses are reserved for reanimation)
  for (let i = state.corpses.length - 1; i >= 0; i--) {
    const c = state.corpses[i];
    if (c.riseAt) continue;
    let rate = 0;
    if (!c.infected && anyGrailSoldierNear(sim, c.x, c.z, H.radius)) rate = H.ratePerSecond;
    else {
      const mound = c.infected ? null : moundNear(sim, fid, c.x, c.z);
      if (mound) rate = mound.harvestRate; // bodies near a corpse mound slowly render down
      else if (infectionAt(state, c.x, c.z) > 110) rate = 0.12; // rot seeps into infected ground
    }
    if (rate <= 0) continue;
    const take = Math.min(c.biomass, rate);
    c.biomass -= take;
    f.resources.biomass += take;
    if (c.biomass <= 0.0001) {
      f.stats.corpsesHarvested++;
      removeCorpse(sim, c, 'consumed');
    }
  }
}

function reanimate(sim, fid) {
  const { state, rt } = sim;
  const R = FACTIONS[fid].reanimation;
  const delay = R.delaySeconds * TICK_RATE;
  // schedule infected corpses that have Grail presence nearby
  for (const c of state.corpses) {
    if (!c.infected || c.riseAt) continue;
    if (anyGrailSoldierNear(sim, c.x, c.z, R.searchRadius) || infectionAt(state, c.x, c.z) > 150) c.riseAt = state.tick + delay;
  }
  // rise in clusters
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
    // bodies rise in hordes; stragglers still rise after a while (never left flagged forever)
    if (cluster.length < R.minBodies && !(cluster.length >= 2 && waited > 400) && waited <= R.loneRiseTicks) continue;
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
    for (let k = 0; k < cluster.length; k++) {
      const c = cluster[k];
      sim.events.push({ type: EV.SOLDIER_RISING, id: sq.members[k].id, sq: sq.id, corpseId: c.id, faction: fid, x: c.x, z: c.z, fromFaction: c.faction, fromUnit: c.unit });
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
  // sources: altars
  for (const st of state.structures) {
    if (st.faction !== fid || !st.built) continue;
    const src = STRUCTURES[st.type].infectionSource;
    if (!src) continue;
    const r = src.radius / inf.cs;
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
  for (let i = 0; i < n; i++) {
    let v = inf.v[i] + add[i];
    if (add[i] === 0 && v > 0) v -= 1;
    inf.v[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
}

function infectionEffects(sim, fid) {
  const { state } = sim;
  const rng = state.rng.main;
  for (const sq of state.squads) {
    const grail = sq.faction === fid;
    const def = unitDef(sq.type);
    for (const m of sq.members) {
      if (m.state !== 'alive') continue;
      const v = infectionAt(state, m.x, m.z);
      if (grail) {
        if (v >= 60 && m.hp < def.hp) m.hp = Math.min(def.hp, m.hp + 2);
        continue;
      }
      if (v >= 160 && rngFloat(rng) < 0.25) m.infection = Math.min(INFECTION_MAX, m.infection + 1);
      if (m.infection > 0) {
        // plague damage over time; the killing blow belongs to the Grail (corpse is infected)
        damageSoldier(sim, sq, m, m.infection * 1.5, fid, PLAGUE, 0, 0);
        if (m.state === 'alive' && v < 60 && rngFloat(rng) < 0.12) m.infection--;
      }
    }
  }
}

export const blackGrailLogic = {
  id: 'black_grail',
  tick(sim, fid) {
    const t = sim.state.tick;
    if (t % 20 === 3) income(sim, fid);
    if (t % 20 === 11) reanimate(sim, fid);
    if (t % 40 === 17) {
      updateInfection(sim, fid);
      if (sim.state.match.phase === 'WAR') infectionEffects(sim, fid);
    }
  },
};

