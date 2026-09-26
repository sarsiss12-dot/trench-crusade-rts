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
    effect: 'swarm',
  },
  artillery_barrage: {
    id: 'artillery_barrage', faction: 'new_antioch', nameKey: 'ability.artillery_barrage', descKey: 'ability.artillery_barrage.desc',
    lore: {
      status: 'abstraction',
      ref: '"Artillery battalions, the pride and joy of New Antioch" (official lore); the call-in barrage ability is a gameplay abstraction',
    },
    cost: { supply: 90 }, cooldown: 75, requiresVision: true,
    radius: 13, shells: 7, delay: 3.0, interval: 0.55, damage: 110, blastRadius: 5.5, structureDamage: 240,
    effect: 'barrage',
  },
};

export function abilityDef(id) {
  const d = ABILITIES[id];
  if (!d) throw new Error('Unknown ability: ' + id);
  return d;
}
