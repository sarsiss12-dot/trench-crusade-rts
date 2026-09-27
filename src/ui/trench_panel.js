// Multi-squad trench panel data, DOM-free (unit-tested). A selected own (or neutral) trench shows
// an occupancy badge ("squads inside"); its panel lists every own squad holding that trench
// network with the card data the HUD draws: icon, name, alive / max, aggregate HP, ammunition,
// infection. On a phone this panel is the main way to pick squads out of a crowded trench line.
// Enemy trenches reveal nothing about who is inside.
import { unitDef } from '../data/units.js';
import { INFECTION_MAX } from '../sim/constants.js';
import { trenchNetwork, networkCapacity, squadsInNetwork } from '../construction/trench.js';
import { iconForUnit } from './icons.js';

export function trenchPanelData(sim, viewer, segId) {
  const seg = sim.rt.structById.get(segId);
  if (!seg || seg.type !== 'trench') return null;
  if (seg.faction !== viewer && seg.faction !== 'neutral') return null;
  const segs = trenchNetwork(sim.state.structures, seg, viewer);
  const cap = networkCapacity(sim.state, segs, viewer, null);
  const squads = squadsInNetwork(sim.state, segs, viewer);
  const cards = squads.map((sq) => {
    const def = unitDef(sq.type);
    let alive = 0, hp = 0, stacks = 0, infected = 0;
    for (const m of sq.members) {
      if (m.state !== 'alive' && m.state !== 'joining') continue;
      alive++;
      hp += Math.max(0, m.hp);
      if (m.infection > 0) { infected++; stacks += m.infection; }
    }
    const max = Math.max(sq.cap || 0, def.squadSize);
    return {
      id: sq.id, type: sq.type, nameKey: def.nameKey, icon: iconForUnit(def),
      alive, max, hp: max ? hp / (def.hp * max) : 0,
      ammo: sq.ammoMax > 0 ? sq.ammo / sq.ammoMax : -1,
      infected, infection: alive ? stacks / (alive * INFECTION_MAX) : 0,
    };
  });
  return { segId, segments: segs.length, total: cap.total, used: cap.used, free: cap.free, count: cards.length, cards };
}
