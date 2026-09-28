// "NEDEN YAPAMIYORUM?" / "WHY CAN'T I?" (Phase 4.1) — one reusable requirement / refusal
// explainer. Every refusal the simulation gives (COMMAND_REJECTED carries its subject: unit, stype,
// ability, sid), a locked card, a silent gun or a waiting reinforcement is turned into
// { reason, fix }: what is wrong and what the player can do about it. DOM-free (unit-tested).
import { t } from './i18n.js';
import { SPECIALITIES } from '../data/specialities.js';
import { UNITS } from '../data/units.js';
import { STRUCTURES } from '../data/structures.js';
import { ABILITIES } from '../data/abilities.js';
import { unitCost } from '../sim/specialities.js';
import { structureCost } from '../construction/construction.js';

const ROMAN = ['I', 'II', 'III', 'IV'];

/** The speciality that unlocks a unit / structure / ability: { fid, tier, id } or null. */
export function specRequirement(kind, id) {
  for (const fid in SPECIALITIES) {
    const tiers = SPECIALITIES[fid];
    for (let tier = 0; tier < tiers.length; tier++) {
      for (const o of tiers[tier]) {
        const u = o.unlocks && o.unlocks[kind];
        if (u && u.indexOf(id) >= 0) return { fid, tier, id: o.id };
      }
    }
  }
  return null;
}

/** "Gerekli: Tier II — Kaynaşma" for a locked unit / structure / ability ('' when not locked by one). */
export function requirementText(kind, id) {
  const r = specRequirement(kind, id);
  return r ? t('req.spec', { tier: ROMAN[r.tier] || r.tier + 1, spec: t('spec.' + r.id) }) : '';
}

/** Missing resources for a cost: "İkmal 40 · Malzeme 15" ('' when affordable). */
export function missingText(resources, cost) {
  const parts = [];
  for (const k in cost || {}) {
    const need = Math.ceil((cost[k] || 0) - (resources[k] || 0));
    if (need > 0) parts.push(t('res.' + k) + ' ' + need);
  }
  return parts.join(' · ');
}

function costOf(sim, viewer, ev) {
  const st = sim.state;
  if (ev.unit && UNITS[ev.unit]) return unitCost(st, viewer, ev.unit);
  if (ev.stype && STRUCTURES[ev.stype]) return structureCost(st, viewer, ev.stype, 8);
  if (ev.ability && ABILITIES[ev.ability]) return ABILITIES[ev.ability].cost;
  return null;
}

function specFix(ev) {
  const kind = ev.unit ? 'units' : ev.stype ? 'structures' : ev.ability ? 'abilities' : '';
  const id = ev.unit || ev.stype || ev.ability;
  const req = kind ? requirementText(kind, id) : '';
  return req || t('why.fix.spec');
}

/** Fix line for a refusal / status reason key ('' when there is nothing useful to say). */
export function fixFor(sim, viewer, ev) {
  const k = ev.reason || ev.key || '';
  switch (k) {
    case 'build.no_resources': case 'train.no_resources': case 'ability.no_resources': {
      const c = costOf(sim, viewer, ev);
      const miss = c ? missingText(sim.state.factions[viewer].resources, c) : '';
      return miss ? t('why.fix.resources', { res: miss }) : '';
    }
    case 'build.spec': case 'train.spec': case 'ability.spec': return specFix(ev);
    case 'build.requires': case 'train.requires': return t('why.fix.structure');
    case 'build.needs_sector_kind': {
      const kinds = ev.stype && STRUCTURES[ev.stype] && STRUCTURES[ev.stype].requiresSectorKind;
      return kinds ? t('why.fix.sector_kind', { kinds: kinds.map((s) => t('sector.' + s)).join(' / ') }) : t('why.fix.sector');
    }
    case 'build.needs_sector': case 'build.sector_taken': return t('why.fix.free_sector');
    case 'build.needs_settlement': case 'build.econ_limit': return t('why.fix.settlement');
    case 'build.out_of_zone': return t('why.fix.zone');
    case 'build.needs_anchor': return t('why.fix.anchor');
    case 'build.overlap': case 'build.blocked': case 'build.bad_terrain': return t('why.fix.place');
    case 'ability.no_vision': return t('why.fix.vision');
    case 'ability.cooldown': return t('why.fix.cooldown');
    case 'ability.out_of_range': return t('why.fix.closer');
    case 'ability.pestilence': return t('why.fix.pestilence');
    case 'train.cap': return t('why.fix.cap');
    case 'train.queue_full': return t('why.fix.queue');
    case 'autoreinf.no_position': return t('why.fix.position');
    case 'reinf.auto_waiting': return ev.res === 'manpower' ? t('why.fix.manpower') : t('why.fix.supply');
    case 'garrison.full': return t('why.fix.other_ruin');
    case 'gun.no_supply': case 'no_supply': return t('why.fix.supply');
    case 'min_range': return t('why.fix.min_range');
    case 'traverse': return t('why.fix.facing');
    case 'crew': return t('why.fix.crew');
    case 'relay': return '';
    default: return '';
  }
}

/** Refusal event -> { reason, fix } texts for the HUD. */
export function explain(sim, viewer, ev) {
  return { reason: t(ev.reason), fix: fixFor(sim, viewer, ev) };
}

/** Why a gun emplacement is silent (st.gs) -> { reason, fix } or null while it can fire. */
export function gunStatus(sim, viewer, st) {
  const gs = st.gs || '';
  if (!gs) return null;
  return { reason: t('gun.gs.' + gs), fix: fixFor(sim, viewer, { reason: gs }) };
}
