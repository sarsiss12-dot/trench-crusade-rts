// Auto-dispatch feedback, DOM-free (unit-tested). An ENGINEER_ASSIGNED event of the viewer's own
// faction becomes a short highlight { squadId, sid, x, z, queued, t0 }: the HUD strip makes the
// engineer's chip glow, the world overlay pulses a ring on the engineer and draws a beam to the
// site. Everything fades after ENGINEERING.highlightSec. Presentation only.
import { ENGINEERING } from '../data/economy.js';
import { EV } from '../core/events.js';

export function createEngineerHighlights(duration = ENGINEERING.highlightSec) {
  const list = [];

  function prune(now) {
    for (let i = list.length - 1; i >= 0; i--) if (now - list[i].t0 >= duration) list.splice(i, 1);
  }

  return {
    duration,
    /** Feed a (fog-filtered) event; only the viewer's own assignments are highlighted. */
    onEvent(ev, viewer, now) {
      if (ev.type !== EV.ENGINEER_ASSIGNED || ev.faction !== viewer) return false;
      for (let i = list.length - 1; i >= 0; i--) if (list[i].squadId === ev.squadId) list.splice(i, 1);
      list.push({ squadId: ev.squadId, sid: ev.sid || 0, x: ev.x, z: ev.z, queued: !!ev.queued, t0: now });
      while (list.length > 8) list.shift();
      return true;
    },
    /** Live highlights with their strength k (1 -> 0 as they fade). */
    active(now) {
      prune(now);
      return list.map((h) => ({ ...h, k: Math.max(0, 1 - (now - h.t0) / duration) }));
    },
    isHighlighted(squadId, now) {
      prune(now);
      return list.some((h) => h.squadId === squadId);
    },
    clear() { list.length = 0; },
  };
}
