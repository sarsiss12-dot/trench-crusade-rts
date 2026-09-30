// Iron Sultanate faction logic — compact, secure economy.
// Income is tied to a small number of high-value command/sapper structures: it expands by placing
// deliberate fortified nodes instead of copying New Antioch's settlement/food chain.
import { STRUCTURES } from '../data/structures.js';
import { DT } from '../sim/constants.js';
import { areHostile, sideBit } from '../data/factions.js';
import { dist } from '../core/dmath.js';
import { cleanseInfection } from './pestilence.js';

export const ironSultanateLogic = {
  id: 'iron_sultanate',
  tick(sim, fid) {
    const { state } = sim;
    if (state.tick % 20 !== 5) return;
    const f = state.factions[fid];
    for (const st of state.structures) {
      if (st.faction !== fid || !st.built || st.hp <= 0) continue;
      const d = STRUCTURES[st.type];
      let unsafe = false;
      for (const q of state.squads) if (areHostile(fid, q.faction) && (q.visibleTo & sideBit(fid)) && dist(q.cx, q.cz, st.x, st.z) < 32 && q.members.some((m) => m.state === 'alive')) { unsafe = true; break; }
      if (d.secureIncome && unsafe) continue;
      if (d.materialRate) f.resources.material += d.materialRate * 20 * DT;
      if (d.supplyRate) f.resources.supply += d.supplyRate * 20 * DT;
      if (d.manpowerRate) f.resources.manpower += d.manpowerRate * 20 * DT;
      if (d.cleanseAura) cleanseInfection(sim, st.x, st.z, d.cleanseAura.radius, d.cleanseAura.amount);
      if (d.repairAura && !unsafe) for (const target of state.structures) {
        if (target === st || target.faction !== fid || !target.built || target.hp >= target.maxHp || state.tick - (target.lastDamageTick || 0) < 100) continue;
        if (dist(st.x, st.z, target.x, target.z) > d.repairAura.radius) continue;
        const hp = Math.min(d.repairAura.hp, target.maxHp - target.hp, (f.resources.material || 0) * 20);
        target.hp += hp; f.resources.material -= hp * 0.05;
      }
    }
  },
};
