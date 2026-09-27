// Ordinary animals of the war-torn countryside (Phase 3 wildlife + livestock). No fantastical
// creatures: sheep, goats, pigs, cattle, mules and stray dogs. Behaviour is a cheap RTS abstraction
// (herd wandering, fleeing, slow habitat respawn with a population cap), NOT a breeding simulator.
// biomass: what a carcass yields the Black Grail (low: animals are the least valuable bodies).
// food: New Antioch emergency slaughter yield; foodRate: sustained yield per penned animal / s.

export const SPECIES = {
  sheep: {
    id: 'sheep', nameKey: 'animal.sheep', lore: { status: 'abstraction' },
    hp: 40, speed: 1.2, flee: 4.4, radius: 0.5, biomass: 5, food: 22, foodRate: 0.011, livestock: true, herd: true, model: 'an_sheep',
  },
  goat: {
    id: 'goat', nameKey: 'animal.goat', lore: { status: 'abstraction' },
    hp: 35, speed: 1.3, flee: 5.0, radius: 0.45, biomass: 5, food: 18, foodRate: 0.009, livestock: true, herd: true, model: 'an_goat',
  },
  pig: {
    id: 'pig', nameKey: 'animal.pig', lore: { status: 'abstraction' },
    hp: 60, speed: 1.1, flee: 4.0, radius: 0.55, biomass: 8, food: 32, foodRate: 0.014, livestock: true, herd: false, model: 'an_pig',
  },
  cattle: {
    id: 'cattle', nameKey: 'animal.cattle', lore: { status: 'abstraction' },
    hp: 120, speed: 1.0, flee: 3.8, radius: 0.85, biomass: 11, food: 60, foodRate: 0.024, livestock: true, herd: true, model: 'an_cattle',
  },
  mule: {
    id: 'mule', nameKey: 'animal.mule', lore: { status: 'abstraction', ref: 'Draught animals of WWI-era logistics' },
    hp: 90, speed: 1.2, flee: 4.6, radius: 0.75, biomass: 9, food: 30, foodRate: 0.006, livestock: true, herd: false, model: 'an_mule',
  },
  dog: {
    id: 'dog', nameKey: 'animal.dog', lore: { status: 'canon-inspired', ref: 'Dogs appear in the setting (e.g. trench dogs); strays are an abstraction' },
    hp: 30, speed: 1.6, flee: 5.8, radius: 0.4, biomass: 4, food: 0, foodRate: 0, livestock: false, herd: false, model: 'an_dog',
  },
};

export const SPECIES_ORDER = ['sheep', 'goat', 'pig', 'cattle', 'mule', 'dog'];

export const WILDLIFE = {
  maxTotal: 64, // hard bound on living animals (all habitats + pens)
  updateEvery: 2, // ticks between steering steps
  respawnSec: [75, 120], // a habitat below its cap gets one stray back after this long
  respawnAfterDeathSec: 60, // never an instant replacement
  wanderSec: [3, 9],
  panicSec: 6,
  blastPanicR: 55,
  crowdR: 6, // soldiers this close make animals shy away
  grailR: 20, // the plague's hosts are smelled from further away
  grailMaulDps: 25, // a Grail soldier touching a panicked animal mauls it
  penCapacity: 8,
  herdCatchR: 3.5,
};
