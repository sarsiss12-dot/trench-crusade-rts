// Shared sanitation scoring for player-side idle automation and AI commands. Bounded radius,
// staggered searches, no hidden enemy/corpse knowledge, imminent risings before other infection.
import { unitDef, hasRole } from '../data/units.js';
import { STRUCTURES } from '../data/structures.js';
import { WEAPONS } from '../data/weapons.js';
import { sideBit, sideIndex } from '../data/factions.js';
import { dist } from '../core/dmath.js';
import { isVisibleAt } from '../world/fog.js';
import { huntThreat } from './hunt_targets.js';
import { setOrder } from './orders.js';

function protectedValue(sim, fid, x, z) {
  let value = 0;
  for (const st of sim.state.structures) {
    if (st.faction !== fid || !st.built) continue;
    const d = STRUCTURES[st.type];
    if ((d.hq || d.settlement || d.heavyDefense) && dist(x, z, st.x, st.z) < 50) value = Math.max(value, d.hq ? 35 : 25);
  }
  return value;
}
export function sanitationTarget(sim, fid, x, z, radius = 72, ground = true) {
  const state = sim.state, bit = sideBit(fid);
  let best = null, bestScore = -Infinity;
  for (const c of state.corpses) {
    if (!c.infected || !(c.seenBy & bit)) continue;
    const d = dist(x, z, c.x, c.z);
    if (d > radius || huntThreat(sim, fid, c.x, c.z, 32)) continue;
    const imminent = c.riseAt ? 10000 + Math.max(0, 600 - (c.riseAt - state.tick)) : 1000;
    const score = imminent + protectedValue(sim, fid, c.x, c.z) - d;
    if (score > bestScore) { bestScore = score; best = { x: c.x, z: c.z, cid: c.id, score }; }
  }
  if (best || !ground) return best;
  // Only the local neighbourhood, and only visible cells. No world-wide grid scan per engineer.
  const inf = state.infection, r = Math.min(radius, 40), R = Math.ceil(r / inf.cs);
  const cx = Math.floor(x / inf.cs), cz = Math.floor(z / inf.cs);
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const gx = cx + dx, gz = cz + dz;
    if (gx < 0 || gz < 0 || gx >= inf.cols || gz >= inf.rows) continue;
    const v = inf.v[gz * inf.cols + gx], px = (gx + 0.5) * inf.cs, pz = (gz + 0.5) * inf.cs;
    if (v < 80 || dist(x, z, px, pz) > r || !isVisibleAt(state.fog, sideIndex(fid), px, pz)) continue;
    const score = v + protectedValue(sim, fid, px, pz) - dist(x, z, px, pz);
    if (score <= bestScore || huntThreat(sim, fid, px, pz, 32)) continue;
    bestScore = score; best = { x: px, z: pz, cid: 0, score };
  }
  return best;
}
export function updateAutomaticSanitation(sim) {
  const state = sim.state;
  if (state.match.phase !== 'WAR') return;
  for (const sq of state.squads) {
    if ((state.tick + sq.id) % 40 !== 0 || sq.autonomous || !sq.members.some((m) => m.state === 'alive')) continue;
    const d = unitDef(sq.type), flame = WEAPONS[d.weapon] && WEAPONS[d.weapon].kind === 'flame';
    const engineer = hasRole(d, 'sanitizer');
    if (!engineer && !flame) continue;
    const o = sq.order;
    if (o.autoSanitize && (sq.engaged || state.tick - sq.lastHitTick < 100 || huntThreat(sim, sq.faction, sq.cx, sq.cz, 32))) {
      setOrder(sim, sq, { t: 'move', x: o.returnX, z: o.returnZ, am: 0 }); continue;
    }
    if (o.t !== 'idle' && !(o.t === 'move' && o.ret)) continue;
    if (sq.bq && sq.bq.length || sq.engaged || state.tick - sq.lastHitTick < 100 || huntThreat(sim, sq.faction, sq.cx, sq.cz, 30)) continue;
    if (flame && sq.ammo <= 0) continue;
    const target = sanitationTarget(sim, sq.faction, sq.cx, sq.cz, engineer ? 72 : 18, engineer);
    if (!target) continue;
    setOrder(sim, sq, { t: 'sanitize', x: target.x, z: target.z, r: engineer ? 12 : 4,
      phase: 'seek', cid: 0, until: 0, autoSanitize: 1, emergency: flame ? 1 : 0, returnX: sq.cx, returnZ: sq.cz });
  }
}
