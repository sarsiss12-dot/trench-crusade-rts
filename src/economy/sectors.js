// Resource SECTORS (Phase 3): natural economic zones from the map data (fertile land, pasture,
// quarry, scrap yard, abandoned depot, ruined hamlet). Their kind is fixed by the map; their
// richness is rolled per match from the match seed, so the best expansion order changes from
// match to match. Plain data in state.sectors; `sid` = the settlement built on it (0 = free).
// Knowledge: a faction knows the sectors inside its own deployment zone (its home country); the
// rest are learned by sight (seenBy bits, perception.js).
import { SECTOR_KINDS, RICHNESS } from '../data/economy.js';
import { FACTIONS, FACTION_ORDER } from '../data/factions.js';
import { rngFloat } from '../core/rng.js';
import { dist } from '../core/dmath.js';
import { inZone } from '../world/mapgen.js';

export function setupSectors(state, world) {
  state.sectors = [];
  const rng = state.rng.eco;
  for (const s of world.sectors || []) {
    const roll = rngFloat(rng);
    const rich = roll < 0.3 ? 0 : roll < 0.72 ? 1 : 2;
    let seenBy = 0;
    for (const fid of FACTION_ORDER) {
      const zone = world.zones[fid];
      if (zone && inZone(zone, s.x, s.z)) seenBy |= 1 << FACTIONS[fid].index;
    }
    state.sectors.push({ id: s.id, kind: s.kind, x: s.x, z: s.z, r: s.r, rich, sid: 0, seenBy });
  }
}

export function sectorRichness(sec) {
  return RICHNESS[sec.rich] !== undefined ? RICHNESS[sec.rich] : 1;
}

export function sectorKind(sec) {
  return SECTOR_KINDS[sec.kind];
}

/** Sector whose area contains (x, z) (nearest centre wins), else null. */
export function sectorAt(state, x, z) {
  let best = null, bd = Infinity;
  for (const s of state.sectors || []) {
    const d = dist(s.x, s.z, x, z);
    if (d <= s.r && d < bd) { bd = d; best = s; }
  }
  return best;
}

export function sectorById(state, id) {
  for (const s of state.sectors || []) if (s.id === id) return s;
  return null;
}

/** Sector a settlement was founded on (by settlement id). */
export function sectorOfSettlement(state, sid) {
  for (const s of state.sectors || []) if (s.sid === sid) return s;
  return null;
}
