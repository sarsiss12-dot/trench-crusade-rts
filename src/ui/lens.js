// RESOURCE LENS (Phase 4.1), DOM-free (unit-tested). Tapping a resource in the top bar shows
// WHERE it comes from on the map — without moving the camera — and a tap again closes it.
// Strictly fog-safe: own structures, own convoys, and only neutral things the viewer KNOWS
// (discovered heaps / sectors, bodies it has seen, animals in sight). Enemy economy never shows.
import { STRUCTURES } from '../data/structures.js';
import { isNodeKnownTo, isSectorKnownTo, isCorpseKnownTo, isAnimalVisibleTo, isConvoyVisibleTo } from '../sim/perception.js';
import { economyViewItems, usesResourceSectors } from '../sim/economy_view.js';

export const LENS_MAX = 80;

function ownStruct(st, viewer) {
  return st.faction === viewer && st.built && st.hp > 0;
}

/** Source kind of an own structure for a resource ('' when it is not a source). */
function sourceKind(d, res) {
  switch (res) {
    case 'material': return d.materialRate || (d.quarry && d.quarry.materialRate) ? (d.quarry ? 'heap' : 'depot') : '';
    case 'supply': return d.supplyRate ? 'depot' : '';
    case 'manpower': case 'population': return d.settlement ? 'settlement' : d.hq ? 'depot' : '';
    case 'food': return d.farm || d.foodRate ? 'field' : d.pen ? 'field' : d.settlement ? 'settlement' : '';
    case 'biomass': return d.biomassRate ? 'altar' : d.harvestRadius ? 'mound' : '';
    case 'corpses': return d.harvestRadius ? 'mound' : '';
    case 'pestilence': return d.infectionSource ? 'altar' : '';
    default: return '';
  }
}

/** Lens items for a resource: [{ x, z, kind, r }] (bounded, own / known only). */
export function lensItems(sim, viewer, res) {
  const { state } = sim;
  const out = [];
  const push = (x, z, kind, r = 0) => { if (out.length < LENS_MAX) out.push({ x, z, kind, r }); };
  for (const st of state.structures) {
    if (!ownStruct(st, viewer)) continue;
    const k = sourceKind(STRUCTURES[st.type], res);
    if (k) push(st.x, st.z, k, STRUCTURES[st.type].harvestRadius || 0);
  }
  if (res === 'material') {
    for (const n of state.nodes) if (n.amount > 0 && isNodeKnownTo(n, viewer)) push(n.x, n.z, 'heap');
    if (usesResourceSectors(viewer)) for (const sec of state.sectors) if ((sec.kind === 'quarry' || sec.kind === 'scrap') && isSectorKnownTo(sec, viewer)) push(sec.x, sec.z, 'sector', sec.r);
  }
  if (res === 'food') {
    for (const sec of state.sectors) if ((sec.kind === 'fertile' || sec.kind === 'pasture') && isSectorKnownTo(sec, viewer)) push(sec.x, sec.z, 'sector', sec.r);
  }
  if (res === 'supply') {
    for (const c of state.convoys || []) if (c.faction === viewer && isConvoyVisibleTo(c, viewer)) push(c.x, c.z, 'depot');
  }
  if (res === 'biomass' || res === 'corpses') {
    if (res === 'biomass') for (const it of economyViewItems(sim, viewer)) if (it.kind === 'habitat' && it.safe) push(it.x, it.z, it.kind, it.r);
    for (const c of state.corpses) {
      if (!isCorpseKnownTo(c, viewer) || c.biomass <= 0) continue;
      if (res === 'biomass' && c.infected) continue; // infected bodies are for rising, not for eating
      push(c.x, c.z, 'corpse');
    }
    if (res === 'biomass') for (const a of state.animals) if (isAnimalVisibleTo(a, viewer)) push(a.x, a.z, 'animal');
  }
  return out;
}

/**
 * Income meter: a moving net rate per minute of a resource from periodic samples (presentation
 * side only — it reads the viewer's own stockpile, nothing hidden). samples: [{ t, v }].
 */
export function netPerMinute(samples, windowSec = 30) {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (const s of samples) if (last.t - s.t <= windowSec) { first = s; break; }
  const dt = last.t - first.t;
  return dt > 1 ? ((last.v - first.v) / dt) * 60 : 0;
}
