// Ground height query shared by simulation and renderer:
// base heightfield + bridge decks + trench floors (from trench segment data = single source).
import { baseHeightAt } from './terrain.js';
import { bridgeDeckHeight } from './mapgen.js';
import { structGridQuery } from './structgrid.js';
import { trenchFloorAt } from '../construction/trench.js';

const found = [];

export function groundHeightAt(world, structGrid, x, z) {
  const b = bridgeAt(world, x, z);
  if (b) return bridgeDeckHeight(b, z);
  let h = baseHeightAt(world.terrain, x, z);
  if (structGrid) {
    found.length = 0;
    structGridQuery(structGrid, x, z, 1.5, found);
    for (let i = 0; i < found.length; i++) {
      const s = found[i];
      if (s.type !== 'trench') continue;
      const f = trenchFloorAt(s, x, z, world.terrain);
      if (f === f && f < h) h = f; // f === f -> not NaN
    }
  }
  return h;
}

export function bridgeAt(world, x, z) {
  for (let i = 0; i < world.bridges.length; i++) {
    const b = world.bridges[i];
    if (Math.abs(x - b.x) < b.width * 0.5 && z > b.z0 && z < b.z1) return b;
  }
  return null;
}
