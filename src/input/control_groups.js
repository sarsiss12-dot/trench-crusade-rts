// Control groups (Phase 4), DOM-free and unit-tested. Mobile: three HUD slots — LONG PRESS saves
// the current own selection, TAP selects the group, DOUBLE TAP selects and centres the camera on it.
// Desktop: Ctrl+1..9 save, 1..9 select, the same number twice quickly = focus. Groups hold plain
// squad ids (serializable: saved with the match in the save meta); dead / lost squads drop out on
// every read and an emptied slot is cleared.

import { commandable } from '../data/units.js';

export const GROUP_SLOTS_UI = 3;
export const GROUP_COUNT = 9;
export const DOUBLE_TAP_MS = 350;
export const LONG_PRESS_MS = 450;

function usable(sim, viewer, id) {
  const sq = sim.rt.squadById.get(id);
  if (!commandable(sq) || sq.faction !== viewer) return false;
  for (const m of sq.members) if (m.state === 'alive' || m.state === 'rising' || m.state === 'joining') return true;
  return false;
}

export function createControlGroups(count = GROUP_COUNT) {
  const slots = [];
  for (let i = 0; i < count; i++) slots.push([]);
  const lastTap = new Array(count).fill(-1e9);

  const api = {
    count,
    /** Save own squads into slot i (sorted, unique). Returns how many were stored. */
    save(i, ids, sim, viewer) {
      if (i < 0 || i >= count) return 0;
      const set = new Set();
      for (const id of ids) if (!sim || usable(sim, viewer, id)) set.add(id);
      slots[i] = [...set].sort((a, b) => a - b);
      return slots[i].length;
    },
    /** Remove dead / lost squads from every slot (an emptied slot is simply empty). */
    prune(sim, viewer) {
      let changed = false;
      for (let i = 0; i < count; i++) {
        const keep = slots[i].filter((id) => usable(sim, viewer, id));
        if (keep.length !== slots[i].length) { slots[i] = keep; changed = true; }
      }
      return changed;
    },
    ids(i, sim, viewer) {
      if (i < 0 || i >= count) return [];
      if (sim) slots[i] = slots[i].filter((id) => usable(sim, viewer, id));
      return slots[i].slice();
    },
    size(i) { return i >= 0 && i < count ? slots[i].length : 0; },
    /**
     * A tap / key press on slot i at time now (ms). Returns 'empty' | 'select' | 'focus' (the second
     * tap within DOUBLE_TAP_MS).
     */
    tap(i, now) {
      if (i < 0 || i >= count || !slots[i].length) { lastTap[i] = -1e9; return 'empty'; }
      const dbl = now - lastTap[i] <= DOUBLE_TAP_MS;
      lastTap[i] = dbl ? -1e9 : now;
      return dbl ? 'focus' : 'select';
    },
    /** Centre of the group's living squads (camera focus), or null. */
    center(i, sim, viewer) {
      let x = 0, z = 0, n = 0;
      for (const id of api.ids(i, sim, viewer)) { const sq = sim.rt.squadById.get(id); x += sq.cx; z += sq.cz; n++; }
      return n ? [x / n, z / n] : null;
    },
    /** Short summary for the HUD slot: squad count + the most common unit types. */
    summary(i, sim, viewer) {
      const ids = api.ids(i, sim, viewer);
      const types = new Map();
      for (const id of ids) { const t = sim.rt.squadById.get(id).type; types.set(t, (types.get(t) || 0) + 1); }
      return { count: ids.length, types: [...types.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 2).map((e) => e[0]) };
    },
    export() { return slots.map((s) => s.slice()); },
    restore(arr) {
      if (!Array.isArray(arr)) return;
      for (let i = 0; i < count; i++) slots[i] = Array.isArray(arr[i]) ? arr[i].filter((v) => Number.isInteger(v)) : [];
    },
  };
  return api;
}
