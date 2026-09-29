// Black Grail AI — feeding the horde (Phase 3). Pure choices from what the faction perceives
// (VISIBLE animals / convoys / enemies, corpses and structures it has SEEN); black_grail_ai.js
// turns them into ordinary commands (FORAGE / ATTACK / MOVE / USE_ABILITY).
//  - forage: visible animals first (cheap early biomass, safe in the Grail's own half), then known
//    uninfected bodies with an own assault squad close by (gangs are labour, not scouts); with
//    nothing in sight, a sweep of a known pasture / wood (explored map ground, like a player
//    pointing FORAGE at the woods) — never at animals it cannot see
//  - raids: known farms / pens / quarries / isolated settlements — weakly guarded, not too far
//  - Great Pestilence / Black Tide / Fly Swarm targeting helpers
import { STRUCTURES } from '../data/structures.js';
import { unitDef } from '../data/units.js';
import { SPECIES } from '../data/animals.js';
import { areHostile, sideBit, sideIndex } from '../data/factions.js';
import { dist } from '../core/dmath.js';
import { isExploredAt } from '../world/fog.js';

export const FORAGE_RANGE = 240; // how far a gang goes for animals (it still has to haul back)
export const HAUL_RANGE = 380;

function bit(fid) {
  return sideBit(fid);
}

function aliveIn(sq) {
  let n = 0;
  for (const m of sq.members) if (m.state === 'alive') n++;
  return n;
}

export function visibleHostiles(sim, fid, x, z, r) {
  const b = bit(fid);
  let n = 0;
  for (const sq of sim.state.squads) {
    if (!areHostile(fid, sq.faction) || !(sq.visibleTo & b)) continue;
    if (dist(sq.cx, sq.cz, x, z) <= r) n += aliveIn(sq);
  }
  return n;
}

/** Where a work gang should forage now: { x, z, kind } or null. */
export function forageSpot(sim, fid, gang) {
  const { state } = sim;
  const b = bit(fid);
  let best = null, bs = Infinity;
  for (const a of state.animals) {
    if (!(a.visibleTo & b)) continue;
    const d = dist(gang.cx, gang.cz, a.x, a.z);
    if (d > FORAGE_RANGE) continue;
    const s = d - SPECIES[a.sp].biomass * 6;
    if (s >= bs || visibleHostiles(sim, fid, a.x, a.z, 40) > 0) continue;
    bs = s; best = { x: a.x, z: a.z, kind: 'animal' };
  }
  let own = null;
  for (const c of state.corpses) {
    if (c.infected || c.riseAt || c.biomass <= 0.5 || !(c.seenBy & b)) continue;
    const d = dist(gang.cx, gang.cz, c.x, c.z);
    if (d > HAUL_RANGE) continue;
    const s = d - c.biomass * 2;
    if (s >= bs) continue;
    if (!own) own = state.squads.filter((q) => q.faction === fid && unitDef(q.type).combatUnit);
    let covered = !!c.old || !!c.sp; // old battlefield dead / carcasses lie in open country
    if (!covered) for (const q of own) if (dist(q.cx, q.cz, c.x, c.z) < 45) { covered = true; break; }
    if (!covered || visibleHostiles(sim, fid, c.x, c.z, 45) > 0) continue;
    bs = s; best = { x: c.x, z: c.z, kind: 'corpse' };
  }
  return best;
}

/**
 * No prey in sight: the nearest EXPLORED habitat (pasture / wood — static map ground the faction has
 * seen) within reach and without visible enemies, each tried again only after a pause (memo:
 * habitat id -> tick). The FORAGE order then hunts whatever the gang itself finds there.
 */
export function habitatSpot(sim, fid, gang, memo) {
  const { state, world } = sim;
  const fIdx = sideIndex(fid);
  let best = null, bd = Infinity;
  for (const h of world.habitats || []) {
    if ((memo[h.id] || 0) > state.tick) continue;
    if (!isExploredAt(state.fog, fIdx, h.x, h.z)) continue;
    const d = dist(gang.cx, gang.cz, h.x, h.z);
    if (d > FORAGE_RANGE) continue;
    if (visibleHostiles(sim, fid, h.x, h.z, 50) > 0) continue;
    if (d < bd || (d === bd && best && h.id < best.id)) { bd = d; best = h; }
  }
  return best;
}

const RAID_VALUE = { settlement: 70, livestock_pen: 45, farm: 35, quarry: 30, supply_depot: 55 };

/** Best known economic target for a raid from (x, z): weakly guarded, valuable, reachable. */
export function raidTarget(sim, fid, x, z, maxD, homeX, homeZ) {
  const { state } = sim;
  const b = bit(fid);
  let best = null, bs = Infinity;
  for (const st of state.structures) {
    if (!areHostile(fid, st.faction) || st.hp <= 0 || !((st.visibleTo | st.seenBy) & b)) continue;
    const v = RAID_VALUE[st.type];
    if (!v) continue;
    const d = dist(x, z, st.x, st.z);
    if (d > maxD) continue;
    // isolation: far from the enemy's fortress (what the raiders know of it: its position)
    const iso = homeX !== undefined ? Math.min(160, dist(st.x, st.z, homeX, homeZ)) : 0;
    const guard = visibleHostiles(sim, fid, st.x, st.z, 50);
    const s = d * 0.6 + guard * 14 - v - iso * 0.5 + (STRUCTURES[st.type].kind === 'area' ? 10 : 0);
    if (s < bs || (s === bs && best && st.id < best.id)) { bs = s; best = st; }
  }
  return best;
}

/** A visible enemy convoy near (x, z) (raiders intercept it), else null. */
export function convoyNear(sim, fid, x, z, r) {
  const b = bit(fid);
  let best = null, bd = r;
  for (const c of sim.state.convoys) {
    if (!areHostile(fid, c.faction) || !(c.visibleTo & b)) continue;
    const d = dist(c.x, c.z, x, z);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

/**
 * Cluster target for an area ability: the visible enemy squad whose neighbourhood (radius) holds
 * the most soldiers (entrenched ones count extra), within castRange of an own squad. minScore
 * filters small fry. Returns the squad or null.
 */
export function clusterTarget(sim, fid, radius, castRange, minScore) {
  const { state } = sim;
  const b = bit(fid);
  const own = state.squads.filter((s) => s.faction === fid);
  let best = null, bestScore = minScore;
  for (const e of state.squads) {
    if (!areHostile(fid, e.faction) || !(e.visibleTo & b)) continue;
    let inRange = false;
    for (const s of own) if (dist(s.cx, s.cz, e.cx, e.cz) <= castRange) { inRange = true; break; }
    if (!inRange) continue;
    let score = 0;
    for (const o of state.squads) {
      if (o.faction !== e.faction || !(o.visibleTo & b) || dist(o.cx, o.cz, e.cx, e.cz) > radius) continue;
      for (const m of o.members) {
        if (m.state !== 'alive') continue;
        score += m.postId || m.cover >= 4 ? 2.5 : 1;
      }
    }
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return best;
}
