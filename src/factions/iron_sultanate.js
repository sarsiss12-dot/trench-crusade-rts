// Iron Sultanate faction logic — compact, secure economy.
// Income is tied to a small number of high-value command/sapper structures: it expands by placing
// deliberate fortified nodes instead of copying New Antioch's settlement/food chain.
import { STRUCTURES } from '../data/structures.js';
import { DT } from '../sim/constants.js';

export const ironSultanateLogic = {
  id: 'iron_sultanate',
  tick(sim, fid) {
    const { state } = sim;
    if (state.tick % 20 !== 5) return;
    const f = state.factions[fid];
    for (const st of state.structures) {
      if (st.faction !== fid || !st.built || st.hp <= 0) continue;
      const d = STRUCTURES[st.type];
      if (d.materialRate) f.resources.material += d.materialRate * 20 * DT;
      if (d.supplyRate) f.resources.supply += d.supplyRate * 20 * DT;
      if (d.manpowerRate) f.resources.manpower += d.manpowerRate * 20 * DT;
    }
  },
};
