// Screen / world picking (DOM-free). All picks go through the viewer's perception filters:
// hidden squads, unseen structures and undiscovered resources can never be hit-tested.
import { projectToScreen } from '../render/camera.js';
import { STRUCTURES } from '../data/structures.js';
import { unitDef, commandable } from '../data/units.js';
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
    if (sq.autonomous) continue; // do not occlude player units beneath an autonomous horde
    if (sq.civ && sq.faction === viewer) continue; // own civilians are autonomous (never commanded)
    if (filter && !filter(sq)) continue;
    const gy = groundFn(sq.cx, sq.cz);
    projectToScreen(camera, sq.cx, gy + 1, sq.cz, P);
    if (!P[3]) continue;
    // coarse reject: squads span at most ~12 m
    if (Math.hypot(P[0] - sx, P[1] - sy) > radiusPx + 400) continue;
    const tall = unitDef(sq.type).heavy ? 1.3 : 1.05;
    // Phase 4.1: small squads (work gangs, a lone sniper) are hard to hit with a finger — wider pick
    const k0 = unitDef(sq.type).squadSize <= 4 || unitDef(sq.type).gathers === 'corpse' ? 1 / 1.35 : 1;
    for (const m of sq.members) {
      if (!memberPresent(m) || !isSoldierVisibleTo(sim, sq, m, viewer)) continue;
      const y = groundFn(m.x, m.z);
      for (let k = 0; k < 2; k++) {
        projectToScreen(camera, m.x, y + (k ? tall * 1.4 : tall * 0.55), m.z, P);
        if (!P[3]) continue;
        const d = Math.hypot(P[0] - sx, P[1] - sy) * k0;
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
      // buildings win over linear structures under them — except a ruin garrison, a large walled
      // area whose trenches / wire / posts inside stay pickable
      d = def.garrison ? Math.hypot(lx, lz) + 2.5 : Math.hypot(lx, lz) * 0.25;
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

/** Resource-node pick tolerances (Phase 4): fingers need a much larger target than a mouse. */
export const NODE_PICK = { mouseM: 4.5, touchM: 8, mousePx: 24, touchPx: 52, assist: 1.3 };

/**
 * Resource node for a tap: world distance around the ground point OR the heap's projected screen
 * position (a heap seen at a low angle covers little ground but a lot of screen). touch: finger
 * input; pxScale: canvas px per CSS px. Returns the node or null.
 */
export function pickNodeAt(sim, viewer, camera, groundFn, sx, sy, wx, wz, touch, pxScale = 1, assist = false) {
  const k = assist ? NODE_PICK.assist : 1;
  const worldR = (touch ? NODE_PICK.touchM : NODE_PICK.mouseM) * k;
  const near = wx === undefined ? null : pickNode(sim, viewer, wx, wz, worldR);
  if (near) return near;
  let best = null, bestD = (touch ? NODE_PICK.touchPx : NODE_PICK.mousePx) * k * pxScale;
  for (const n of sim.state.nodes) {
    if (n.amount <= 0 || !isNodeKnownTo(n, viewer)) continue;
    projectToScreen(camera, n.x, groundFn(n.x, n.z) + 0.8, n.z, P);
    if (!P[3]) continue;
    const d = Math.hypot(P[0] - sx, P[1] - sy);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

/** Own squads with any soldier projecting inside the screen rectangle. */
export function boxSelect(sim, viewer, camera, groundFn, x0, y0, x1, y1) {
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1), minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
  const ids = [];
  for (const sq of sim.state.squads) {
    if (sq.faction !== viewer || !isSquadAlive(sq) || !commandable(sq)) continue;
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
    if (sq.faction !== viewer || sq.type !== type || !isSquadAlive(sq) || !commandable(sq)) continue;
    projectToScreen(camera, sq.cx, groundFn(sq.cx, sq.cz) + 1, sq.cz, P);
    if (P[3] && P[0] >= 0 && P[0] <= camera.width && P[1] >= 0 && P[1] <= camera.height) ids.push(sq.id);
  }
  return ids.sort((a, b) => a - b);
}
