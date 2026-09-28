// Simulation -> presentation event types.
// Events are plain objects emitted by the simulation each tick and consumed by
// render / UI / audio (after fog-of-war filtering). They never feed back into the sim.

export const EV = Object.freeze({
  PHASE_CHANGED: 'PHASE_CHANGED',
  MATCH_ENDED: 'MATCH_ENDED',
  COMMAND_REJECTED: 'COMMAND_REJECTED',
  ORDER_ACK: 'ORDER_ACK',

  FIRE: 'FIRE', // ranged shot (hit or miss)
  MELEE: 'MELEE', // melee strike
  HIT: 'HIT', // non-lethal damage on soldier
  DEATH: 'DEATH', // soldier killed (starts dying animation)
  CORPSE_CREATED: 'CORPSE_CREATED',
  CORPSE_REMOVED: 'CORPSE_REMOVED', // decayed / consumed / raised
  CORPSE_PURIFIED: 'CORPSE_PURIFIED', // Phase 4.1: consecrated long enough — never rises
  SOLDIER_RISING: 'SOLDIER_RISING', // corpse reanimated (Black Grail)
  SQUAD_SPAWNED: 'SQUAD_SPAWNED',
  SQUAD_DESTROYED: 'SQUAD_DESTROYED',

  EXPLOSION: 'EXPLOSION',
  ABILITY_CAST: 'ABILITY_CAST',

  STRUCTURE_PLACED: 'STRUCTURE_PLACED',
  STRUCTURE_PROGRESS: 'STRUCTURE_PROGRESS',
  STRUCTURE_COMPLETED: 'STRUCTURE_COMPLETED',
  STRUCTURE_DAMAGED: 'STRUCTURE_DAMAGED',
  STRUCTURE_DESTROYED: 'STRUCTURE_DESTROYED',
  STRUCTURE_FIRE: 'STRUCTURE_FIRE', // fortified position firing
  TRAIN_QUEUED: 'TRAIN_QUEUED',
  TRAIN_COMPLETED: 'TRAIN_COMPLETED',

  RESOURCE_GATHERED: 'RESOURCE_GATHERED',
  RESOURCE_DELIVERED: 'RESOURCE_DELIVERED',
  NOTICE: 'NOTICE', // generic UI notice for a faction (key + params)

  // Phase 3
  SPEC_CHOSEN: 'SPEC_CHOSEN',
  ENGINEER_ASSIGNED: 'ENGINEER_ASSIGNED', // auto-dispatched builder (highlight in HUD + world)
  CONVOY_DISPATCHED: 'CONVOY_DISPATCHED',
  CONVOY_ARRIVED: 'CONVOY_ARRIVED',
  CONVOY_LOST: 'CONVOY_LOST',
  ANIMAL_KILLED: 'ANIMAL_KILLED',
  WOUNDED: 'WOUNDED', // soldier incapacitated (not dead)
  REVIVED: 'REVIVED', // wounded soldier back on his feet (medic)
  PESTILENCE_TIER: 'PESTILENCE_TIER',
  EVACUATION: 'EVACUATION',
  // Phase 4
  REINFORCEMENT_JOINED: 'REINFORCEMENT_JOINED', // a walking replacement reached its squad (now counted)
  PHASE_WARNING: 'PHASE_WARNING', // the front is going quiet / stirring again (operational lull)
  CIVILIAN_ALARM: 'CIVILIAN_ALARM', // own civilians run for shelter / flee (own side only)
  GARRISON_ENTERED: 'GARRISON_ENTERED', // a squad took its slots in a ruin (own side only)
  RUIN_COLLAPSED: 'RUIN_COLLAPSED', // a garrisoned ruin came down (seen where visible)
});

/** Impact surface classes used by FIRE/MELEE events for VFX selection. */
export const IMPACT = Object.freeze({
  GROUND: 'ground',
  FLESH: 'flesh',
  ORGANIC: 'organic',
  METAL: 'metal',
  WALL: 'wall',
  WATER: 'water',
  FIRE: 'fire',
});
