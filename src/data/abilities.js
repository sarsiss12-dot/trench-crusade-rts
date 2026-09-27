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
};

export function abilityDef(id) {
  const d = ABILITIES[id];
  if (!d) throw new Error('Unknown ability: ' + id);
  return d;
}
