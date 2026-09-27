// Gameplay corpse removal (shared by combat, the Black Grail economy and corpse-hauling gangs).
// Kept dependency-free so units/ and combat/ can both use it without an import cycle.
import { EV } from '../core/events.js';

export function removeCorpse(sim, c, reason) {
  const { state, rt } = sim;
  const i = state.corpses.indexOf(c);
  if (i >= 0) state.corpses.splice(i, 1);
  rt.corpseById.delete(c.id);
  sim.events.push({ type: EV.CORPSE_REMOVED, id: c.id, reason, x: c.x, z: c.z });
}
