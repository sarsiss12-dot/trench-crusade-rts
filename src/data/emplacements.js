// Phase 4 emplacement weapons (data). Gun positions that do not shoot bullets but LOB something
// that lands later (kind 'shell': a scheduled blast) or spew a cloud (kind 'cloud').
// The artillery hierarchy stays distinct:
//   MG / pillbox   — direct fire, suppression, no structure damage
//   mortar ability — short-range area fire, light blasts, no craters to speak of
//   FIELD GUN      — a BUILT position: long range, slow, supply per shot, heavy structure damage,
//                    big suppression, minimum range, slow traverse, weak up close (crew)
//   artillery barrage (off-map ability) — the heaviest, a whole area, long cooldown
// Lore: New Antioch's foundries cast artillery (official lore: "titanic artillery pieces … are
// constructed in the foundries of New Antioch"); this particular emplacement is an abstraction and
// carries no canon name. The Viscera Cannon is an official Black Grail heavy weapon; a Corruption
// Belcher appears in the official battlekit glossary (faction attribution not verified). Both
// ORGANIC NESTS here are gameplay abstractions built around those names.

export const EMPLACEMENT_WEAPONS = {
  field_gun_shell: {
    id: 'field_gun_shell', kind: 'shell',
    lore: { status: 'canon-inspired', ref: 'New Antioch foundries cast artillery (official lore); the field gun emplacement is an abstraction' },
    range: 130, minRange: 28, reload: 9, reloadJitter: 0.1,
    traverse: 0.42, // rad/s — a slow gun: a flank it is not facing takes seconds to answer
    flightBase: 0.9, flightPerM: 0.011, // s
    scatter: 2.0, scatterPerM: 0.03, // m: landing spread around the aim point
    supplyPerShot: 5, // New Antioch supply per round (no supply -> silent gun)
    crewThreatR: 9, // enemies this close keep the crew from serving the gun
    targetStructures: true,
    blast: { blastRadius: 6, damage: 70, structureDamage: 520, size: 'heavy', craters: true, suppress: { seconds: 7 }, gunStat: 1 },
    sound: 'field_gun',
  },
  viscera_shot: {
    id: 'viscera_shot', kind: 'shell',
    lore: { status: 'canon-inspired', ref: 'Viscera Cannon — official Black Grail heavy weapon; the organic gun nest is an abstraction' },
    range: 62, minRange: 6, reload: 5.5, reloadJitter: 0.15,
    traverse: 0.95,
    flightBase: 0.6, flightPerM: 0.012,
    scatter: 1.5, scatterPerM: 0.03,
    supplyPerShot: 0,
    crewThreatR: 0,
    targetStructures: false,
    blast: { blastRadius: 3.8, damage: 20, structureDamage: 45, size: 'light', infect: 1, organic: 1, suppress: { seconds: 5 }, gunStat: 1 },
    sound: 'viscera',
  },
  belcher_gas: {
    id: 'belcher_gas', kind: 'cloud',
    lore: { status: 'canon-inspired', ref: 'Corruption Belcher — named in the official battlekit glossary (faction attribution not verified); the nest is an abstraction' },
    range: 24, minRange: 0, reload: 6.5, reloadJitter: 0.1,
    traverse: 1.4,
    supplyPerShot: 0,
    crewThreatR: 0,
    targetStructures: false,
    cloud: { ability: 'belcher_cloud', radius: 6.5, duration: 7, groundInfect: 20 },
    sound: 'belcher',
  },
};
