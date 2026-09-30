// Lightweight packs, not player squads. Stable iteration and one decision per pack per second.
import { areHostile, sideBit } from '../data/factions.js';
import { unitDef } from '../data/units.js';
import { dist } from '../core/dmath.js';
import { enemyHomeAnchor } from '../sim/sides.js';
import { setOrder } from './orders.js';
import { hostileGarrison, startStorm } from './garrison.js';

export function updateAutonomousRisen(sim) {
  const state = sim.state;
  if (state.match.phase !== 'WAR') return;
  for (const sq of state.squads) {
    if (sq.autonomous !== 'risen' || state.tick < (sq.risenNext || 0)) continue;
    sq.risenNext = state.tick + 20;
    if (!sq.members.some((m) => m.state === 'alive')) {
      sq.risenState = sq.members.some((m) => m.state === 'rising') ? 'RISE' : 'DIE'; continue;
    }
    if (sq.order.t === 'storm') { sq.risenState = 'ATTACK'; continue; }
    const bit = sideBit(sq.faction);
    let target = null, score = Infinity;
    for (const q of state.squads) {
      if (!areHostile(sq.faction, q.faction) || !(q.visibleTo & bit) || !q.members.some((m) => m.state === 'alive')) continue;
      const d = dist(sq.cx, sq.cz, q.cx, q.cz);
      if (d > 85) continue;
      const rank = q.garrison ? 200 : unitDef(q.type).combatUnit ? 0 : 100;
      if (rank + d < score) { score = rank + d; target = q; }
    }
    if (target) {
      if (target.garrison) startStorm(sim, sq, sim.rt.structById.get(target.garrison));
      else if (sq.order.t !== 'attack' || sq.order.tid !== target.id) setOrder(sim, sq, { t: 'attack', tk: 'squad', tid: target.id, lx: target.cx, lz: target.cz });
      sq.risenState = sq.engaged ? 'ATTACK' : 'SWARM'; continue;
    }
    let stTarget = null, best = 100;
    for (const st of state.structures) {
      if (!(st.visibleTo & bit) || st.hp <= 0) continue;
      const hostile = hostileGarrison(sim, sq.faction, st);
      if (!hostile && !areHostile(sq.faction, st.faction)) continue;
      const d = dist(sq.cx, sq.cz, st.x, st.z) - (hostile ? 20 : 0);
      if (d < best) { best = d; stTarget = st; }
    }
    if (stTarget) {
      if (hostileGarrison(sim, sq.faction, stTarget)) startStorm(sim, sq, stTarget);
      else if (sq.order.t !== 'attack' || sq.order.tid !== stTarget.id) setOrder(sim, sq, { t: 'attack', tk: 'struct', tid: stTarget.id, lx: stTarget.x, lz: stTarget.z });
      sq.risenState = 'SWARM';
    } else {
      sq.risenState = 'SEEK';
      if (sq.order.t === 'idle' || sq.pathState === 'failed') {
        const p = enemyHomeAnchor(sim, sq.faction);
        setOrder(sim, sq, { t: 'move', x: p[0], z: p[1], am: 1 });
      }
    }
  }
}
