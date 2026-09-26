// Fog of war grid (low resolution, per faction). Three states per cell:
//   UNEXPLORED (never seen), EXPLORED (seen before), VISIBLE (currently seen).
// Stored in GameState (typed arrays, encoded by the save codec).

export const FOG_CELL = 4;
export const FOG = Object.freeze({ UNEXPLORED: 0, EXPLORED: 1, VISIBLE: 2 });

export function createFogState(width, height, factionCount, cs = FOG_CELL) {
  const cols = Math.ceil(width / cs), rows = Math.ceil(height / cs);
  const vis = [], seen = [];
  for (let i = 0; i < factionCount; i++) {
    vis.push(new Uint8Array(cols * rows));
    seen.push(new Uint8Array(cols * rows));
  }
  return { cs, cols, rows, vis, seen };
}

const circleCache = new Map();

function circleOffsets(radiusCells2) {
  let offs = circleCache.get(radiusCells2);
  if (offs) return offs;
  const r = radiusCells2 / 2;
  const R = Math.ceil(r);
  const list = [];
  for (let dz = -R; dz <= R; dz++) {
    for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dz * dz <= r * r + 0.25) list.push(dx, dz);
    }
  }
  offs = new Int16Array(list);
  circleCache.set(radiusCells2, offs);
  return offs;
}

export function clearVisible(fog) {
  for (let i = 0; i < fog.vis.length; i++) fog.vis[i].fill(0);
}

export function stampVision(fog, fIdx, x, z, radius) {
  const cs = fog.cs;
  const cx = Math.floor(x / cs), cz = Math.floor(z / cs);
  const offs = circleOffsets(Math.round((radius / cs) * 2));
  const vis = fog.vis[fIdx], seen = fog.seen[fIdx];
  const cols = fog.cols, rows = fog.rows;
  for (let k = 0; k < offs.length; k += 2) {
    const nx = cx + offs[k], nz = cz + offs[k + 1];
    if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
    const i = nz * cols + nx;
    vis[i] = 1;
    seen[i] = 1;
  }
}

export function fogIndex(fog, x, z) {
  const cx = Math.floor(x / fog.cs), cz = Math.floor(z / fog.cs);
  if (cx < 0 || cz < 0 || cx >= fog.cols || cz >= fog.rows) return -1;
  return cz * fog.cols + cx;
}

export function isVisibleAt(fog, fIdx, x, z) {
  const i = fogIndex(fog, x, z);
  return i >= 0 && fog.vis[fIdx][i] === 1;
}

export function isExploredAt(fog, fIdx, x, z) {
  const i = fogIndex(fog, x, z);
  return i >= 0 && fog.seen[fIdx][i] === 1;
}

export function fogStateAt(fog, fIdx, x, z) {
  const i = fogIndex(fog, x, z);
  if (i < 0) return FOG.UNEXPLORED;
  if (fog.vis[fIdx][i]) return FOG.VISIBLE;
  return fog.seen[fIdx][i] ? FOG.EXPLORED : FOG.UNEXPLORED;
}
