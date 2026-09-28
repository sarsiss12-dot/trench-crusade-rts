// Area-effect faction abilities (data-driven). Architecture supports any faction owning any
// number of abilities; effects are resolved by the simulation (sim/abilities.js).

export const ABILITIES = {
  fly_swarm: {
    id: 'fly_swarm', faction: 'black_grail', nameKey: 'ability.fly_swarm', descKey: 'ability.fly_swarm.desc',
    lore: {
      status: 'abstraction',
      ref: 'Canon-inspired: Black Grail spreads via swarms of hell-flies; a castable swarm is a gameplay abstraction',
    },
    cost: { biomass: 45 }, cooldown: 40, castRange: 75,
    radius: 11, duration: 9, dps: 4.5, infectInterval: 2.5, accuracyDebuff: 0.35, ignoresCover: true,
    effect: 'swarm', supportKey: 'swarmSupport', // a standing Fly Nest shortens the cooldown
  },
  artillery_barrage: {
    id: 'artillery_barrage', faction: 'new_antioch', nameKey: 'ability.artillery_barrage', descKey: 'ability.artillery_barrage.desc',
    lore: {
      status: 'abstraction',
      ref: '"Artillery battalions, the pride and joy of New Antioch" (official lore); the call-in barrage ability is a gameplay abstraction',
    },
    cost: { supply: 90 }, cooldown: 75, requiresVision: true,
    radius: 13, shells: 7, delay: 3.0, interval: 0.55, damage: 110, blastRadius: 5.5, structureDamage: 240,
    effect: 'barrage', size: 'heavy', craters: true, supportKey: 'artillerySupport',
  },
  // Lighter support fire with a different job: many small rounds, short cooldown, suppression /
  // area denial (accuracy and movement drop in the zone) instead of raw destruction.
  mortar_barrage: {
    id: 'mortar_barrage', faction: 'new_antioch', nameKey: 'ability.mortar_barrage', descKey: 'ability.mortar_barrage.desc',
    lore: {
      status: 'abstraction',
      ref: 'Trench mortars are a generic WWI-era weapon; the official New Antioch roster (checked: no mortar or artillery crew model) has none — gameplay abstraction',
    },
    cost: { supply: 45 }, cooldown: 35, requiresVision: true,
    radius: 8, shells: 9, delay: 1.6, interval: 0.3, damage: 48, blastRadius: 3.2, structureDamage: 50,
    effect: 'barrage', size: 'light', craters: false, supportKey: 'artillerySupport',
    suppress: { seconds: 6, accMult: 0.6, speedMult: 0.6 },
  },
  // ---- Phase 3 ----------------------------------------------------------------------------------
  // Pestilence 100: the plague's crest. Spends most of the meter (no permanent snowball).
  great_pestilence: {
    id: 'great_pestilence', faction: 'black_grail', nameKey: 'ability.great_pestilence', descKey: 'ability.great_pestilence.desc',
    lore: { status: 'abstraction', ref: 'Plague and pestilence are core Black Grail themes; the castable Great Pestilence is a gameplay abstraction' },
    cost: { biomass: 60 }, cooldown: 60, castRange: 90, requiresPestilence: 100, pestilenceCost: 60,
    radius: 20, duration: 14, dps: 2.5, infectInterval: 2.5, maxStacks: 3, groundInfect: 100,
    effect: 'plague_cloud', supportKey: '',
  },
  // Phase 4: the Corruption Belcher nest's gas (not castable: no faction lists it; the nest spawns it)
  belcher_cloud: {
    id: 'belcher_cloud', faction: 'black_grail', nameKey: 'ability.belcher_cloud', descKey: 'ability.belcher_cloud.desc',
    lore: { status: 'canon-inspired', ref: 'Corruption belchers "spew forth noxious gas and corrosive fumes" (official battlekit glossary); the cloud is an abstraction' },
    cost: {}, cooldown: 0, radius: 6.5, duration: 7, dps: 3, infectInterval: 3, maxStacks: 2, groundInfect: 20,
    effect: 'plague_cloud', supportKey: '', emplacementOnly: true,
  },
  // Purification speciality: incense, fire and prayer over a patch of ground.
  purge: {
    id: 'purge', faction: 'new_antioch', nameKey: 'ability.purge', descKey: 'ability.purge.desc',
    lore: { status: 'abstraction', ref: 'Purification by fire (New Antioch armoury has flamethrowers — official rules); the rite ability is an abstraction' },
    cost: { supply: 70 }, cooldown: 55, requiresVision: true, requiresSpec: ['na_purification'],
    radius: 14, duration: 4, pestilenceDrain: 10, cleanse: 200,
    effect: 'purge', supportKey: '',
  },
  // Black Tide speciality: the horde surges forward.
  black_tide: {
    id: 'black_tide', faction: 'black_grail', nameKey: 'ability.black_tide', descKey: 'ability.black_tide.desc',
    lore: { status: 'abstraction' },
    cost: { biomass: 50 }, cooldown: 70, castRange: 60, requiresSpec: ['bg_black_tide'],
    radius: 40, duration: 15, speedMult: 1.3, meleeMult: 1.3,
    effect: 'tide', supportKey: '',
  },
};

export function abilityDef(id) {
  const d = ABILITIES[id];
  if (!d) throw new Error('Unknown ability: ' + id);
  return d;
}
