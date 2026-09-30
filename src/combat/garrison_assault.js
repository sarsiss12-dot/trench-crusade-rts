// Interior close combat. Geometry/state belongs to units/garrison; this layer alone deals damage.
import { garrisonGeom } from '../units/garrison.js';
import { insideRuin } from '../world/ruin_geometry.js';
import { unitDef } from '../data/units.js';
import { WEAPONS } from '../data/weapons.js';
import { areHostile } from '../data/factions.js';
import { damageSoldier } from './combat.js';
import { dist } from '../core/dmath.js';
import { EV, IMPACT } from '../core/events.js';

function strike(sim, a, m, b, victim) {
  const w = WEAPONS[unitDef(a.type).melee];
  if (!w) return;
  damageSoldier(sim, b, victim, w.damage * 0.7, a.faction, w, 0, 0, a.id);
  sim.events.push({ type: EV.MELEE, attacker: m.id, sq: a.id, faction: a.faction, weapon: w.id,
    x: m.x, z: m.z, tx: victim.x, tz: victim.z, target: victim.id, tsq: b.id, hit: true, impact: IMPACT.FLESH });
}
export function updateGarrisonAssaults(sim) {
  if (sim.state.match.phase !== 'WAR') return;
  for (const sq of sim.state.squads) {
    const o = sq.order;
    if (o.t !== 'storm' || o.phase !== 'inside' || (sim.state.tick + sq.id) % 20 !== 0) continue;
    const st = sim.rt.structById.get(o.sid), g = st && garrisonGeom(sim, st);
    if (!g || st.collapsed) continue;
    let attacks = 0;
    for (const m of sq.members) {
      if (m.state !== 'alive' || !insideRuin(g.r, m.x, m.z, 0.15)) continue;
      let target = null, owner = null, best = 4;
      for (const id of st.occ) {
        const q = sim.rt.squadById.get(id);
        if (!q || !areHostile(sq.faction, q.faction)) continue;
        for (const v of q.members) if (v.state === 'alive') {
          const d = dist(m.x, m.z, v.x, v.z);
          if (d < best) { best = d; target = v; owner = q; }
        }
      }
      if (!target) continue;
      strike(sim, sq, m, owner, target);
      if (target.state === 'alive') strike(sim, owner, target, sq, m);
      if (++attacks >= 4) break; // doorway throughput / bounded combat work
    }
  }
}
