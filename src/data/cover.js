// Cover types (data-driven). Used by combat (damage/accuracy) and HUD (active cover display).
// suppression is reserved for a later suppression system (kept here so data stays stable).
// directional: cover only applies when the attacker is on the protected side of the object.

export const COVER_TYPES = Object.freeze({
  none: { id: 'none', key: 'cover.none', level: 0, dmgReduction: 0, accPenalty: 0, suppression: 0 },
  forest: { id: 'forest', key: 'cover.forest', level: 1, dmgReduction: 0.15, accPenalty: 0.2, suppression: 0.1 },
  crater: { id: 'crater', key: 'cover.crater', level: 1, dmgReduction: 0.25, accPenalty: 0.2, suppression: 0.15 },
  ruins: { id: 'ruins', key: 'cover.ruins', level: 2, dmgReduction: 0.3, accPenalty: 0.25, suppression: 0.2 },
  sandbag: { id: 'sandbag', key: 'cover.sandbag', level: 2, dmgReduction: 0.4, accPenalty: 0.3, suppression: 0.25, directional: true },
  trench: { id: 'trench', key: 'cover.trench', level: 3, dmgReduction: 0.55, accPenalty: 0.45, suppression: 0.4 },
  fortified: { id: 'fortified', key: 'cover.fortified', level: 3, dmgReduction: 0.65, accPenalty: 0.5, suppression: 0.5 },
});

// Stable numeric ids (stored per soldier for HUD / serialization).
export const COVER_IDS = ['none', 'forest', 'crater', 'ruins', 'sandbag', 'trench', 'fortified'];
export const COVER_INDEX = Object.freeze(Object.fromEntries(COVER_IDS.map((id, i) => [id, i])));
