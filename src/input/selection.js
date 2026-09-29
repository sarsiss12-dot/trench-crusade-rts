// Player selection model (DOM-free). Holds squad ids (own squads; or a single visible enemy squad
// for inspection) and at most one structure. Pruned every frame against the simulation and the
// viewer's perception so a selection can never keep tracking something hidden by the fog.
import { unitDef } from '../data/units.js';
import { isSquadVisibleTo, isStructureKnownTo } from '../sim/perception.js';
import { isSquadAlive } from '../sim/state.js';
import { STRUCTURES } from '../data/structures.js';

export function createSelection() {
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
    for (const id of ids) sel.squads.add(id);
    sel.struct = 0;
    changed();
  };

  sel.add = (ids) => {
    for (const id of ids) sel.squads.add(id);
    sel.struct = 0;
    changed();
  };

  sel.toggle = (id) => {
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
      if (!sq || !isSquadAlive(sq) || !isSquadVisibleTo(sq, viewer)) { sel.squads.delete(id); dirty = true; }
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
      if (sq && sq.faction === viewer) res.push(sq);
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
    if (sq.faction !== viewer || !isSquadAlive(sq)) continue;
    if (unitDef(sq.type).combatUnit !== true) continue;
    ids.push(sq.id);
  }
  return ids.sort((a, b) => a - b);
}

/** Own alive squads having a capability role (e.g. 'builder'). */
export function squadIdsWithRole(sim, viewer, role) {
  const ids = [];
  for (const sq of sim.state.squads) {
    if (sq.faction !== viewer || !isSquadAlive(sq)) continue;
    if (unitDef(sq.type).roles.indexOf(role) < 0) continue;
    ids.push(sq.id);
  }
  return ids.sort((a, b) => a - b);
}


/**
 * Fixed quick-select structures for the local side. New Phase 5A starts persist `quickSlot` on the
 * structure itself (A/B/C for the Black Grail production altars, HQ for New Antioch's starting
 * church-bastion / field HQ). The fallback keeps migrated pre-hotfix saves useful: the first three
 * own train-capable HQ structures become A/B/C; a single one becomes HQ. This returns ids only and
 * never performs camera movement.
 */
export function quickStructureSlots(sim, viewer) {
  const own = sim.state.structures.filter((s) => s.faction === viewer && s.built).sort((a, b) => a.id - b.id);
  const tagged = own.filter((s) => !!s.quickSlot).map((s) => ({ id: s.id, type: s.type, label: s.quickSlot }));
  if (tagged.length) return tagged;
  const hubs = own.filter((s) => {
    const d = STRUCTURES[s.type];
    return !!(d && d.hq && d.trains && d.trains.length);
  });
  if (hubs.length >= 3) return hubs.slice(0, 3).map((s, i) => ({ id: s.id, type: s.type, label: String.fromCharCode(65 + i) }));
  if (hubs.length === 1) return [{ id: hubs[0].id, type: hubs[0].type, label: 'HQ' }];
  return [];
}

/** The MULTI-SELECT quick button's visible state: explicit ON label + class (Phase 4 mobile UX). */
export function multiSelectView(multiOn) {
  return { on: !!multiOn, labelKey: multiOn ? 'hud.multi_on' : 'hud.multi_short', icon: 'multi' };
}

/**
 * MULTI-SELECT is ONE-SHOT (Phase 4.1): one additive tap or one box, then back to normal
 * selection. Returns true when the mode was consumed.
 */
export function consumeMulti(ui) {
  if (!ui || !ui.multi) return false;
  ui.multi = false;
  return true;
}
