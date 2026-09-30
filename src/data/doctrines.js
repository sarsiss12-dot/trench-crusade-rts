// ROLE supplies strategic obligations; this independently seeded personality supplies preferences.
// Every profile and speciality name here is a GAMEPLAY ABSTRACTION.
export const DOCTRINES = {
  new_antioch: [
    { id: 'fortress', mods: { defense: 1.5, reserve: 1.5, expansion: 0.7, wave: 0.8, cadence: 1.25 },
      weights: { na_fortification: 2, na_fortified_settlements: 2 } },
    { id: 'logistics', mods: { expansion: 1.5, engineers: 1.3, reserve: 1.1, cadence: 0.85 },
      weights: { na_logistics: 2, na_adv_logistics: 2 } },
    { id: 'firepower', mods: { artillery: 1.6, support: 1.4, elite: 1.2, cadence: 0.9 },
      weights: { na_artillery: 2, na_mechanised: 1.5 } },
  ],
  iron_sultanate: [
    { id: 'engineers', mods: { defense: 1.4, engineers: 1.4, expansion: 0.85 },
      weights: { is_engineering: 2, is_layered_defense: 2, is_preservation: 2 } },
    { id: 'counterguard', mods: { elite: 1.5, reserve: 1.4, wave: 1.2 },
      weights: { is_discipline: 2, is_counterguard: 2, is_measured_advance: 2 } },
    { id: 'alchemists', mods: { support: 1.7, sanitation: 1.6, artillery: 1.2 },
      weights: { is_alchemy: 2, is_fire_cordon: 2, is_purifying_fire: 2 } },
  ],
  black_grail: [
    { id: 'horde', mods: { wave: 0.9, cadence: 0.85 }, weights: { bg_horde: 2, bg_black_tide: 1.5 } },
    { id: 'pestilence', mods: { plague: 1.5, expansion: 1.2 }, weights: { bg_touch: 2, bg_dominion: 2, bg_great_pestilence: 2 } },
    { id: 'devourers', mods: { breach: 1.5, engineers: 1.25 }, weights: { bg_hunger: 2, bg_amalgam: 2, bg_lord: 1.5 } },
  ],
};
export const POLICY_DEFAULTS = {
  defense: 1, reserve: 1, wave: 1, cadence: 1, engineers: 1, elite: 1,
  support: 1, expansion: 1, sanitation: 1, artillery: 1, sally: 1, plague: 1, breach: 1,
};
