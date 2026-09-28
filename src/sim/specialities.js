// Faction speciality progression (data: data/specialities.js). Choices live in plain state
// (faction.spec = [tierI|null, tierII|null, tierIII|null]) and are made ONLY through the
// CHOOSE_SPECIALITY command (plain serializable data -> lockstep / replay friendly).
// Everything else reads the choices through the pure helpers below.
import { SPECIALITIES, SPEC_BY_ID, SPEC_TIERS, SPEC_ADDITIVE, SPEC_MIN } from '../data/specialities.js';
import { UNITS } from '../data/units.js';
import { STRUCTURES } from '../data/structures.js';
import { EV } from '../core/events.js';
import { clamp } from '../core/dmath.js';

const EMPTY = [];

export function specList(state, fid) {
  const f = state.factions[fid];
  return (f && f.spec) || EMPTY;
}

export function specHas(state, fid, id) {
  return specList(state, fid).indexOf(id) >= 0;
}

/** Any of the listed speciality ids chosen (data `requiresSpec` arrays). */
export function specAny(state, fid, ids) {
  if (!ids || !ids.length) return true;
  const list = specList(state, fid);
  for (const id of ids) if (list.indexOf(id) >= 0) return true;
  return false;
}

export function specRule(state, fid, rule) {
  for (const id of specList(state, fid)) {
    const o = id && SPEC_BY_ID[id];
    if (o && o.rules && o.rules[rule]) return true;
  }
  return false;
}

/** Combined modifier: multiplicative by default, additive / minimum for the listed keys. */
export function specValue(state, fid, key, dflt) {
  let v = dflt;
  const add = SPEC_ADDITIVE.indexOf(key) >= 0, min = SPEC_MIN.indexOf(key) >= 0;
  for (const id of specList(state, fid)) {
    const o = id && SPEC_BY_ID[id];
    if (!o || !o.mods || o.mods[key] === undefined) continue;
    const m = o.mods[key];
    if (add) v += m;
    else if (min) v = Math.min(v, m);
    else v *= m;
  }
  return v;
}

/** Share of the war timer elapsed (0 during preparation). */
export function matchProgress(state) {
  const m = state.match;
  // the war clock never stops (reorganisation windows are no ceasefire); an endless war is paced
  // over its nominal length (state.match.warMinutes)
  const war = Math.max(1, (m.warMinutes || state.settings.warMinutes || 15) * 60 * 20);
  const t = m.phase === 'ENDED' ? m.endTick : state.tick;
  if (t <= m.prepEndTick) return 0;
  return clamp((t - m.prepEndTick) / war, 0, 1);
}

export function tierUnlocked(state, tier) {
  const def = SPEC_TIERS[tier];
  return !!def && (def.at <= 0 || matchProgress(state) >= def.at - 1e-9);
}

/** Next tier this faction may choose now (unlocked and not chosen, previous chosen), else -1. */
export function availableTier(state, fid) {
  const list = specList(state, fid);
  for (let t = 0; t < SPEC_TIERS.length; t++) {
    if (list[t]) continue;
    return tierUnlocked(state, t) ? t : -1;
  }
  return -1;
}

export function validateSpec(state, fid, tier, id) {
  const tiers = SPECIALITIES[fid];
  if (!tiers || !Number.isInteger(tier) || tier < 0 || tier >= tiers.length) return 'spec.invalid';
  if (!tiers[tier].some((o) => o.id === id)) return 'spec.invalid';
  const list = specList(state, fid);
  if (list[tier]) return 'spec.taken';
  for (let t = 0; t < tier; t++) if (!list[t]) return 'spec.order';
  if (!tierUnlocked(state, tier)) return 'spec.locked';
  if (state.match.phase === 'ENDED') return 'spec.invalid';
  return null;
}

export function chooseSpec(sim, fid, tier, id) {
  const f = sim.state.factions[fid];
  if (!f.spec) f.spec = [null, null, null];
  f.spec[tier] = id;
  // immediate effects on what already stands (e.g. Fortified Settlements: existing settlements
  // are reinforced too, keeping their damage proportion)
  const mods = SPEC_BY_ID[id] && SPEC_BY_ID[id].mods;
  if (mods && mods.settlementHp) {
    for (const st of sim.state.structures) {
      if (st.faction !== fid || !STRUCTURES[st.type] || !STRUCTURES[st.type].settlement) continue;
      const frac = st.maxHp > 0 ? st.hp / st.maxHp : 1;
      st.maxHp = Math.round(STRUCTURES[st.type].hp * specValue(sim.state, fid, 'settlementHp', 1));
      st.hp = Math.max(1, Math.round(st.maxHp * frac));
    }
  }
  sim.events.push({ type: EV.SPEC_CHOSEN, faction: fid, tier, id });
}

/** Unlock gate for data entries carrying requiresSpec (units, structures, abilities). */
export function unlockedBySpec(state, fid, def) {
  return !def || !def.requiresSpec || specAny(state, fid, def.requiresSpec);
}

/** Unit cost after speciality modifiers (rounded up; plain object). */
export function unitCost(state, fid, type) {
  const u = UNITS[type];
  if (!u || !u.cost) return null;
  const k = (u.specCostKey ? specValue(state, fid, u.specCostKey, 1) : 1);
  if (k === 1) return u.cost;
  const c = {};
  for (const r in u.cost) c[r] = Math.ceil(u.cost[r] * k);
  return c;
}

export function unitTrainTime(state, fid, type) {
  const u = UNITS[type];
  return u.trainTime * (u.specTrainKey ? specValue(state, fid, u.specTrainKey, 1) : 1);
}

export function unitSquadSize(state, fid, type) {
  const u = UNITS[type];
  return u.squadSize + (u.specSizeKey ? Math.round(specValue(state, fid, u.specSizeKey, 0)) : 0);
}

export function unitMaxSquads(state, fid, type) {
  const u = UNITS[type];
  if (!u.maxSquads) return 0;
  return u.maxSquads + (u.specCapKey ? Math.round(specValue(state, fid, u.specCapKey, 0)) : 0);
}
