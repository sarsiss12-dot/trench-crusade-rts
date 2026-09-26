// Coarse spatial grid of structures (runtime acceleration only; rebuilt from GameState).
import { STRUCTURES } from '../data/structures.js';

export function createStructGrid(width, height, cellSize = 8) {
  const cols = Math.ceil(width / cellSize), rows = Math.ceil(height / cellSize);
  const cells = new Array(cols * rows);
  for (let i = 0; i < cells.length; i++) cells[i] = [];
  return { cs: cellSize, cols, rows, cells };
}

export function structBounds(s, out) {
  const def = STRUCTURES[s.type];
  if (def.kind === 'linear') {
    const hw = (def.width || 1) * 0.5 + 0.5;
    out[0] = Math.min(s.x1, s.x2) - hw; out[1] = Math.min(s.z1, s.z2) - hw;
    out[2] = Math.max(s.x1, s.x2) + hw; out[3] = Math.max(s.z1, s.z2) + hw;
  } else {
    const r = Math.sqrt(def.footprint.w * def.footprint.w + def.footprint.d * def.footprint.d) * 0.5 + 0.5;
    out[0] = s.x - r; out[1] = s.z - r; out[2] = s.x + r; out[3] = s.z + r;
  }
  return out;
}

const B = [0, 0, 0, 0];

export function structGridRebuild(g, structures) {
  for (let i = 0; i < g.cells.length; i++) g.cells[i].length = 0;
  for (const s of structures) structGridInsert(g, s);
}

export function structGridInsert(g, s) {
  structBounds(s, B);
  const x0 = Math.max(0, Math.floor(B[0] / g.cs)), x1 = Math.min(g.cols - 1, Math.floor(B[2] / g.cs));
  const z0 = Math.max(0, Math.floor(B[1] / g.cs)), z1 = Math.min(g.rows - 1, Math.floor(B[3] / g.cs));
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) g.cells[z * g.cols + x].push(s);
}

/** Collect unique structures whose cells intersect the query circle's AABB. */
export function structGridQuery(g, x, z, r, out) {
  const x0 = Math.max(0, Math.floor((x - r) / g.cs)), x1 = Math.min(g.cols - 1, Math.floor((x + r) / g.cs));
  const z0 = Math.max(0, Math.floor((z - r) / g.cs)), z1 = Math.min(g.rows - 1, Math.floor((z + r) / g.cs));
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      const list = g.cells[cz * g.cols + cx];
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (out.indexOf(s) < 0) out.push(s);
      }
    }
  }
  return out;
}
