// Gameplay corpse bookkeeping shared by combat, the Black Grail economy, corpse-hauling gangs,
// wildlife (carcasses), sanitation and fire (cremation). Kept free of combat / orders imports so
// units/, combat/ and sim/ modules can all use it without an import cycle.
import { EV } from '../core/events.js';
import { PESTILENCE } from '../data/specialities.js';
import { pestLoss } from '../factions/pestilence.js';

export function removeCorpse(sim, c, reason) {
  const { state, rt } = sim;
  const i = state.corpses.indexOf(c);
  if (i >= 0) state.corpses.splice(i, 1);
  rt.corpseById.delete(c.id);
  sim.events.push({ type: EV.CORPSE_REMOVED, id: c.id, reason, x: c.x, z: c.z, sp: c.sp || '' });
}

/**
 * Burn a body (flamethrower, sanitation, purge, cleric rite): it is gone for good — it can neither
 * rise nor feed the Grail. Infected bodies cost the plague more momentum. byFaction gets the stat.
 */
export function cremateCorpse(sim, c, byFaction) {
  pestLoss(sim, c.infected ? PESTILENCE.loss.burnInfected : PESTILENCE.loss.burnCorpse, 'burned');
  const f = byFaction && sim.state.factions[byFaction];
  if (f) f.stats.burned++;
  removeCorpse(sim, c, 'burned');
}

/** Animal carcass (never infected, never rises; biomass only). */
export function addCarcass(sim, x, z, rot, sp, biomass, seenBy = 0) {
  const { state, rt } = sim;
  const c = {
    id: state.nextId++, x, z, rot, faction: 'animal', unit: '', sp,
    pose: 0, tick: state.tick, infected: false, biomass, seenBy, riseAt: 0, soldierId: 0,
  };
  state.corpses.push(c);
  rt.corpseById.set(c.id, c);
  sim.events.push({ type: EV.CORPSE_CREATED, id: c.id, soldierId: 0, x, z, faction: 'animal', unit: '', sp, infected: false });
  return c;
}

/** Remains of older battles placed by the scenario (no decay, never infected, low biomass). */
export function addOldCorpse(state, rt, x, z, rot) {
  const c = {
    id: state.nextId++, x, z, rot, faction: 'neutral', unit: 'yeoman_rifle', old: 1,
    pose: (x * 13 + z * 7) & 1023, tick: 0, infected: false, biomass: 5, seenBy: 0, riseAt: 0, soldierId: 0,
  };
  state.corpses.push(c);
  if (rt) rt.corpseById.set(c.id, c);
  return c;
}
