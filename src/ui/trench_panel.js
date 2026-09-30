// Multi-squad trench panel data, DOM-free (unit-tested). A selected own (or neutral) trench shows
// an occupancy badge ("squads inside"); its panel lists every own squad holding that trench
// network with the card data the HUD draws: icon, name, alive / max, aggregate HP, ammunition,
// infection. On a phone this panel is the main way to pick squads out of a crowded trench line.
// Enemy trenches reveal nothing about who is inside.
import { unitDef, commandable } from '../data/units.js';
import { INFECTION_MAX } from '../sim/constants.js';
import { trenchNetwork, networkCapacity, squadsInNetwork } from '../construction/trench.js';
import { iconForUnit } from './icons.js';
import { isGarrison, garrisonGeom, visibleOccupant } from '../units/garrison.js';

function cardOf(sq) {
  const def = unitDef(sq.type);
  let alive = 0, hp = 0, stacks = 0, infected = 0, enRoute = 0;
  for (const m of sq.members) {
    if (m.state === 'joining') { enRoute++; continue; }
    if (m.state !== 'alive') continue;
    alive++;
    hp += Math.max(0, m.hp);
    if (m.infection > 0) { infected++; stacks += m.infection; }
  }
  const max = Math.max(sq.cap || 0, def.squadSize);
  return {
    id: sq.id, type: sq.type, nameKey: def.nameKey, icon: iconForUnit(def),
    alive, max, enRoute, hp: max ? hp / (def.hp * max) : 0,
    ammo: sq.ammoMax > 0 ? sq.ammo / sq.ammoMax : -1,
    infected, infection: alive ? stacks / (alive * INFECTION_MAX) : 0,
  };
}

/**
 * Ruin garrison panel (Phase 4, same cards as a trench). Own garrison: the squads inside and the
 * squad capacity. Not ours (empty OR enemy-held — indistinguishable): capacity only, plus whether an
 * enemy occupant is SEEN right now (used = -1).
 */
export function garrisonPanelData(sim, viewer, st) {
  const g = garrisonGeom(sim, st);
  if (!g) return null;
  const base = { segId: st.id, kind: 'garrison', titleKey: 'hud.garrison_squads', segments: 1, total: g.cap, collapsed: st.collapsed ? 1 : 0, hp: st.maxHp ? Math.max(0, st.hp) / st.maxHp : 0 };
  if (st.contested && (st.holder === viewer || visibleOccupant(sim, st, viewer))) base.titleKey = 'garrison.contested';
  if (st.holder !== viewer) {
    // empty and enemy-held look the same unless an occupant is SEEN right now (fog)
    return { ...base, used: -1, free: -1, count: 0, cards: [], enemySeen: st.holder && visibleOccupant(sim, st, viewer) ? 1 : 0 };
  }
  const cards = [];
  for (const id of st.occ) { const sq = sim.rt.squadById.get(id); if (commandable(sq) && sq.faction === viewer) cards.push(cardOf(sq)); }
  // own squads on their way in
  let coming = 0;
  for (const sq of sim.state.squads) if (sq.faction === viewer && sq.order.t === 'garrison' && sq.order.sid === st.id && sq.order.phase === 'to_door') coming++;
  return { ...base, used: cards.length, free: Math.max(0, g.cap - cards.length - coming), coming, count: cards.length, cards, enemySeen: 0 };
}

export function trenchPanelData(sim, viewer, segId) {
  const seg = sim.rt.structById.get(segId);
  if (seg && isGarrison(seg)) return garrisonPanelData(sim, viewer, seg);
  if (!seg || seg.type !== 'trench') return null;
  if (seg.faction !== viewer && seg.faction !== 'neutral') return null;
  const segs = trenchNetwork(sim.state.structures, seg, viewer);
  const cap = networkCapacity(sim.state, segs, viewer, null);
  const squads = squadsInNetwork(sim.state, segs, viewer);
  const cards = squads.map(cardOf);
  return { segId, kind: 'trench', titleKey: 'hud.trench_squads', segments: segs.length, total: cap.total, used: cap.used, free: cap.free, count: cards.length, cards };
}
