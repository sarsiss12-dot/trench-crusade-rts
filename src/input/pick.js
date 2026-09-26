// Screen / world picking (DOM-free). All picks go through the viewer's perception filters:
// hidden squads, unseen structures and undiscovered resources can never be hit-tested.
import { projectToScreen } from '../render/camera.js';
import { STRUCTURES } from '../data/structures.js';
import { unitDef } from '../data/units.js';
import { isSquadVisibleTo, isStructureKnownTo, isNodeKnownTo, isSoldierVisibleTo } from '../sim/perception.js';
import { isSquadAlive } from '../sim/state.js';
import { pointSegment } from '../core/dmath.js';

const P = [0, 0, 0, 0];
const SEG = [0, 0];

function memberPresent(m) {
  return m.state === 'alive' || m.state === 'rising' || m.state === 'joining';
}

/**
 * Nearest squad whose soldiers project within radiusPx of (sx, sy).
 * filter(sq) -> bool optional. Returns { sq, d } or null.
 */
export function pickSquad(sim, viewer, camera, groundFn, sx, sy, radiusPx, filter) {
  let best = null, bestD = radiusPx;
  for (const sq of sim.state.squads) {
    if (!isSquadVisibleTo(sq, viewer) || !isSquadAlive(sq)) continue;
    if (filter && !filter(sq)) continue;
    const gy = groundFn(sq.cx, sq.cz);
    projectToScreen(camera, sq.cx, gy + 1, sq.cz, P);
    if (!P[3]) continue;
    // coarse reject: squads span at most ~12 m
    if (Math.hypot(P[0] - sx, P[1] - sy) > radiusPx + 400) continue;
    const tall = unitDef(sq.type).heavy ? 1.3 : 1.05;
    for (const m of sq.members) {
      if (!memberPresent(m) || !isSoldierVisibleTo(sim, sq, m, viewer)) continue;
      const y = groundFn(m.x, m.z);
      for (let k = 0; k < 2; k++) {
        projectToScreen(camera, m.x, y + (k ? tall * 1.4 : tall * 0.55), m.z, P);
        if (!P[3]) continue;
        const d = Math.hypot(P[0] - sx, P[1] - sy);
        if (d < bestD) { bestD = d; best = sq; }
      }
    }
  }
  return best ? { sq: best, d: bestD } : null;
}

/**
 * Structure under a ground point (footprint / linear corridor), as known to the viewer.
 * `list`: the viewer's known structures (fog memory); defaults to state filtered by seenBy.
 */
export function pickStructure(sim, viewer, wx, wz, margin = 0.8, filter, list) {
  let best = null, bestD = Infinity;
  for (const st of list || sim.state.structures) {
    if (!list && st.faction !== viewer && st.faction !== 'neutral' && !isStructureKnownTo(st, viewer)) continue;
    if (filter && !filter(st)) continue;
    const def = STRUCTURES[st.type];
    let d;
    if (def.kind === 'linear') {
      pointSegment(SEG, wx, wz, st.x1, st.z1, st.x2, st.z2);
      if (SEG[0] > def.width * 0.5 + margin) continue;
      d = SEG[0];
    } else {
      const fp = def.footprint;
      const s = Math.sin(st.rot), c = Math.cos(st.rot);
      const dx = wx - st.x, dz = wz - st.z;
      // inverse of the model rotation used by the renderer: local = R(-rot) * d
      const lx = c * dx - s * dz, lz = s * dx + c * dz;
      if (Math.abs(lx) > fp.w * 0.5 + margin || Math.abs(lz) > fp.d * 0.5 + margin) continue;
      d = Math.hypot(lx, lz) * 0.25; // buildings win over linear structures under them
    }
    if (d < bestD) { bestD = d; best = st; }
  }
  return best;
}

/** Known, non-depleted resource node near a ground point. */
export function pickNode(sim, viewer, wx, wz, radius = 4.5) {
  let best = null, bestD = radius;
  for (const n of sim.state.nodes) {
    if (n.amount <= 0 || !isNodeKnownTo(n, viewer)) continue;
    const d = Math.hypot(n.x - wx, n.z - wz);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

/** Own squads with any soldier projecting inside the screen rectangle. */
export function boxSelect(sim, viewer, camera, groundFn, x0, y0, x1, y1) {
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1), minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
  const ids = [];
  for (const sq of sim.state.squads) {
    if (sq.faction !== viewer || !isSquadAlive(sq)) continue;
    let hit = false;
    for (const m of sq.members) {
      if (!memberPresent(m)) continue;
      projectToScreen(camera, m.x, groundFn(m.x, m.z) + 1, m.z, P);
      if (P[3] && P[0] >= minX && P[0] <= maxX && P[1] >= minY && P[1] <= maxY) { hit = true; break; }
    }
    if (hit) ids.push(sq.id);
  }
  return ids.sort((a, b) => a - b);
}

/** Own squads of a unit type whose centroid is on screen (double-tap "select all of type"). */
export function squadsOfTypeOnScreen(sim, viewer, camera, groundFn, type) {
  const ids = [];
  for (const sq of sim.state.squads) {
    if (sq.faction !== viewer || sq.type !== type || !isSquadAlive(sq)) continue;
    projectToScreen(camera, sq.cx, groundFn(sq.cx, sq.cz) + 1, sq.cz, P);
    if (P[3] && P[0] >= 0 && P[0] <= camera.width && P[1] >= 0 && P[1] <= camera.height) ids.push(sq.id);
  }
  return ids.sort((a, b) => a - b);
}
