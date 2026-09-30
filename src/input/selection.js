// Player selection model (DOM-free). Holds squad ids (own squads; or a single visible enemy squad
// for inspection) and at most one structure. Pruned every frame against the simulation and the
// viewer's perception so a selection can never keep tracking something hidden by the fog.
import { unitDef, commandable } from '../data/units.js';
import { isSquadVisibleTo, isStructureKnownTo } from '../sim/perception.js';
import { isSquadAlive } from '../sim/state.js';

export function createSelection(boundSim) {
  const allowed = (id) => !boundSim || commandable(boundSim.rt.squadById.get(id));
  const sel = {
    squads: new Set(),
    struct: 0,
    version: 0, // bumps on every change (HUD refresh)
  };

  function changed() {
    sel.version++;
  }

  sel.clear = () => {
    if (!sel.squads.size && !sel.struct) return;
    sel.squads.clear();
    sel.struct = 0;
    changed();
  };

  sel.set = (ids) => {
    sel.squads.clear();
    for (const id of ids) if (allowed(id)) sel.squads.add(id);
    sel.struct = 0;
    changed();
  };

  sel.add = (ids) => {
    for (const id of ids) if (allowed(id)) sel.squads.add(id);
    sel.struct = 0;
    changed();
  };

  sel.toggle = (id) => {
    if (!allowed(id)) return;
    if (sel.squads.has(id)) sel.squads.delete(id);
    else sel.squads.add(id);
    sel.struct = 0;
    changed();
  };

  /** Tap on an own squad: additive (Shift / Ctrl / MULTI-SELECT mode) toggles it, else replaces. */
  sel.tapOwn = (id, additive) => {
    if (additive) sel.toggle(id);
    else sel.set([id]);
  };

  /** Box drag result: additive adds; an empty box clears only outside multi-select mode. */
  sel.applyBox = (ids, additive, multi) => {
    if (ids.length) { if (additive) sel.add(ids); else sel.set(ids); }
    else if (!multi) sel.clear();
  };

  sel.setStruct = (id) => {
    sel.squads.clear();
    sel.struct = id;
    changed();
  };

  sel.has = (id) => sel.squads.has(id);

  /**
   * Drop dead / removed / no-longer-visible entries. knownStructure(id) (optional): the structure as
   * the viewer knows it (fog memory) — a remembered enemy structure stays selected even if it was
   * destroyed out of sight, so the selection cannot be used to probe the fog.
   */
  sel.prune = (sim, viewer, knownStructure) => {
    const { rt } = sim;
    let dirty = false;
    for (const id of sel.squads) {
      const sq = rt.squadById.get(id);
      if (!commandable(sq) || !isSquadAlive(sq) || !isSquadVisibleTo(sq, viewer)) { sel.squads.delete(id); dirty = true; }
    }
    // an enemy squad may only be inspected alone
    if (sel.squads.size > 1) {
      for (const id of sel.squads) {
        const sq = rt.squadById.get(id);
        if (sq && sq.faction !== viewer) { sel.squads.delete(id); dirty = true; }
      }
    }
    if (sel.struct) {
      const st = knownStructure ? knownStructure(sel.struct) : rt.structById.get(sel.struct);
      if (!st || !(st.faction === viewer || st.faction === 'neutral' || st.memory || isStructureKnownTo(st, viewer))) { sel.struct = 0; dirty = true; }
    }
    if (dirty) changed();
  };

  /** Own selected squads (sorted ids -> deterministic command payloads). */
  sel.ownSquads = (sim, viewer) => {
    const res = [];
    for (const id of sel.squads) {
      const sq = sim.rt.squadById.get(id);
      if (commandable(sq) && sq.faction === viewer) res.push(sq);
    }
    res.sort((a, b) => a.id - b.id);
    return res;
  };

  sel.ownIds = (sim, viewer) => sel.ownSquads(sim, viewer).map((s) => s.id);

  return sel;
}

/** "Tümü / All": alive + player-owned + combatUnit === true (data-driven, never by unit name). */
export function allCombatSquadIds(sim, viewer) {
  const ids = [];
  for (const sq of sim.state.squads) {
    if (sq.faction !== viewer || !isSquadAlive(sq) || !commandable(sq)) continue;
    if (unitDef(sq.type).combatUnit !== true) continue;
    ids.push(sq.id);
  }
  return ids.sort((a, b) => a - b);
}

/** Own alive squads having a capability role (e.g. 'builder'). */
export function squadIdsWithRole(sim, viewer, role) {
  const ids = [];
  for (const sq of sim.state.squads) {
    if (sq.faction !== viewer || !isSquadAlive(sq) || !commandable(sq)) continue;
    if (unitDef(sq.type).roles.indexOf(role) < 0) continue;
    ids.push(sq.id);
  }
  return ids.sort((a, b) => a - b);
}

/** The sticky tap-by-tap MULTI SELECT button's visible state. */
export function multiSelectView(multiOn) {
  return { on: !!multiOn, labelKey: multiOn ? 'hud.multi_on' : 'hud.multi_short', icon: 'multi' };
}

/** Button transitions are explicit so AREA and sticky MULTI can never consume one another. */
export function toggleAreaSelect(ui) {
  ui.areaSelect = !ui.areaSelect;
  return ui.areaSelect;
}

export function toggleMultiSelect(ui) {
  ui.multiSelect = !ui.multiSelect;
  return ui.multiSelect;
}

/** Area Select is the one-shot mode; completion consumes only that state. */
export function completeAreaSelect(ui) {
  if (!ui || !ui.areaSelect) return false;
  ui.areaSelect = false;
  return true;
}
