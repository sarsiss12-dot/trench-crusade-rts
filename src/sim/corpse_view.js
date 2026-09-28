// Corpse state view (Phase 4.1): what a VIEWER may know about a body — read-only, used by the
// world-space corpse icons (render/range_viz.js), the corpse tap tooltip (HUD) and tests.
// It mirrors the real reanimation rules (factions/black_grail.js reanimate):
//  - an infected body rises when scheduled (riseAt): a TURNING body (≥ PESTILENCE.turnStacks at
//    death) on its own timer, others when a Grail fighter is near or the ground festers
//  - due bodies rise in clusters (a due body can wait for company: 'gathering')
//  - consecrated ground stops the countdown; after blessSec seconds the body is PURIFIED for good
// Black Grail viewer: every body it has seen — precise countdown and state.
// Other viewers: only bodies in sight right now, and only coarse information: "infected — risk of
// reanimation" and "reanimation imminent" in the last seconds (no timer, no turn flag).
import { TICK_RATE } from './constants.js';
import { isCorpseKnownTo, isPointVisibleTo } from './perception.js';

const GRAIL = 'black_grail';
export const IMMINENT_SEC = 5;
export const TWITCH_SEC = 3;

/**
 * { st, secs, p } or null (nothing to show).
 * st: 'infected' | 'scheduled' | 'gathering' | 'turn' | 'purified' | 'risk' | 'imminent'
 * secs: seconds left (Grail only, scheduled / turn), p: countdown progress 0..1.
 */
export function corpseView(sim, viewer, c) {
  const tick = sim.state.tick;
  if (viewer === GRAIL) {
    if (!isCorpseKnownTo(c, viewer)) return null;
    if (c.blessed) return { st: 'purified', secs: 0, p: 0 };
    if (!c.infected) return null;
    if (c.riseAt > 0) {
      const left = c.riseAt - tick;
      if (left <= 0) return { st: 'gathering', secs: 0, p: 1 };
      const total = Math.max(1, c.riseAt - (c.sched || c.tick));
      return { st: c.turn ? 'turn' : 'scheduled', secs: Math.ceil(left / TICK_RATE), p: Math.min(1, Math.max(0, 1 - left / total)) };
    }
    return { st: c.turn ? 'turn' : 'infected', secs: 0, p: 0 };
  }
  if (!isPointVisibleTo(sim, viewer, c.x, c.z)) return null;
  if (c.blessed) return { st: 'purified', secs: 0, p: 0 };
  if (!c.infected) return null;
  if (c.riseAt > 0 && c.riseAt - tick <= IMMINENT_SEC * TICK_RATE) return { st: 'imminent', secs: 0, p: 1 };
  return { st: 'risk', secs: 0, p: 0 };
}

/** The body is about to rise (presentation twitch; only for bodies the viewer can see). */
export function corpseTwitching(sim, viewer, c) {
  if (!c.infected || !(c.riseAt > 0)) return false;
  const left = c.riseAt - sim.state.tick;
  if (left > TWITCH_SEC * TICK_RATE) return false;
  return viewer === GRAIL ? isCorpseKnownTo(c, viewer) : isPointVisibleTo(sim, viewer, c.x, c.z);
}

/** Bodies a Grail work gang / corpse mound can use (seen, not infected — infected bodies rise). */
export function usableCorpse(c, viewer) {
  return !c.infected && c.biomass > 0 && isCorpseKnownTo(c, viewer);
}

/**
 * Corpse mound placement preview / selected mound: bodies inside its processing radius.
 * Returns { r, usable, infected, list: [{ c, ok }] } (list bounded by `cap`, nearest first).
 */
export function moundPreview(sim, viewer, x, z, radius, cap = 60) {
  const r2 = radius * radius;
  const found = [];
  let usable = 0, infected = 0;
  for (const c of sim.state.corpses) {
    if (!isCorpseKnownTo(c, viewer) || c.biomass <= 0) continue;
    const dx = c.x - x, dz = c.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    const ok = !c.infected;
    if (ok) usable++; else infected++;
    found.push({ c, ok, d2 });
  }
  found.sort((a, b) => a.d2 - b.d2 || a.c.id - b.c.id);
  if (found.length > cap) found.length = cap;
  return { r: radius, usable, infected, list: found };
}
