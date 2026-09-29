// Side-aware "home" focus point (HOME button, initial camera). Pure function of state + world:
// 1) the side's living, built HQ-capable structure (STRUCTURES[type].hq — data, never names);
//    several candidates (e.g. multiple Grail Altars) resolve deterministically to the one nearest
//    the side's region home anchor;
// 2) otherwise the region's home anchor (Phase 5A: region data, not a faction anchor);
// 3) otherwise any own living structure, then the side's start region.
// The camera offset toward the front (faction data home.front, a distance) points toward the enemy
// from the side's region — the same faction looks forward whichever role it starts in.
import { sideDef } from '../data/factions.js';
import { STRUCTURES } from '../data/structures.js';
import { dcos } from '../core/dmath.js';
import { sideAnchors, sideFacing } from './sides.js';

export function factionHome(sim, fid) {
  const { state, world } = sim;
  const fdef = sideDef(fid) || {};
  const h = fdef.home || {};
  const homes = sideAnchors(sim, fid).home;
  const anchor = homes && homes[0];
  // toward the enemy: facing PI looks to -z (north), facing 0 to +z (south)
  const facing = sideFacing(sim, fid);
  const front = Math.abs(h.front || 0) * (dcos(facing) < 0 ? -1 : 1);
  let best = null, bestD = Infinity;
  const refX = anchor ? anchor[0] : world.width / 2, refZ = anchor ? anchor[1] : world.height / 2;
  for (const s of state.structures) {
    if (s.faction !== fid || s.hp <= 0 || !s.built || !STRUCTURES[s.type].hq) continue;
    const dx = s.x - refX, dz = s.z - refZ;
    const d = dx * dx + dz * dz;
    if (d < bestD || (d === bestD && best && s.id < best.id)) { best = s; bestD = d; }
  }
  if (best) return { x: best.x, z: best.z + front, source: 'hq', sid: best.id };
  if (anchor) return { x: anchor[0], z: anchor[1], source: 'anchor', sid: 0 };
  for (const s of state.structures) {
    if (s.faction === fid && s.hp > 0) return { x: s.x, z: s.z, source: 'structure', sid: s.id };
  }
  const region = state.factions[fid] && state.factions[fid].region;
  return { x: world.width / 2, z: region === 'south' ? world.height - 90 : 90, source: 'side', sid: 0 };
}
