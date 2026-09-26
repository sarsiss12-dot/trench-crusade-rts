// Structure definitions (data-driven).
// kind: 'building' (rotated rectangle footprint), 'linear' (segment between two points), 'area' (field).
// work: engineer-seconds to build (linear: per meter). cost: resources (linear: per meter via costPerM).
// blocks: footprint is impassable for pathing. cover: cover type given to soldiers using it.
// moveMult*: movement multiplier for units crossing the footprint (wire / sandbags / trench).
// Faction 'neutral' structures (old trench remnants, old wire) are placed by the map.

export const STRUCTURES = {
  bastion: {
    id: 'bastion', faction: 'new_antioch', kind: 'building', nameKey: 'struct.bastion',
    lore: { status: 'abstraction', ref: 'New Antioch is a walled fortress-city that endured eight great sieges (official lore); this fortified church-bastion is a gameplay objective abstraction' },
    footprint: { w: 26, d: 22 }, hp: 9000, blocks: true, vision: 64, buildable: false,
    dropOff: true, resupplyRadius: 42, reinforceRadius: 46, supplyRate: 0.6, materialRate: 0.25,
    trains: ['yeoman_rifle', 'combat_engineer', 'mech_heavy'], canBeObjective: true,
    model: 'bastion',
  },
  supply_depot: {
    id: 'supply_depot', faction: 'new_antioch', kind: 'building', nameKey: 'struct.supply_depot',
    lore: { status: 'abstraction' },
    footprint: { w: 14, d: 10 }, hp: 2000, blocks: true, vision: 34, buildable: false,
    dropOff: true, resupplyRadius: 34, reinforceRadius: 36, supplyRate: 1.6,
    model: 'depot',
  },
  field: {
    id: 'field', faction: 'new_antioch', kind: 'area', nameKey: 'struct.field',
    lore: { status: 'abstraction' },
    footprint: { w: 40, d: 30 }, hp: 600, blocks: false, vision: 0, buildable: false,
    foodRate: 0.7, model: 'field',
  },
  trench: {
    id: 'trench', faction: 'any', kind: 'linear', nameKey: 'struct.trench',
    lore: { status: 'abstraction', ref: 'Trench warfare is the core of the setting; RTS trench mechanics are abstractions' },
    width: 2.2, depth: 1.55, minLen: 4, maxLen: 16, hp: 2600, buildable: true, builder: 'new_antioch',
    costPerM: { material: 2.2 }, workPerM: 5.0, blocks: false, cover: 'trench', slotSpacing: 1.45,
    moveMultEnemy: 0.55, moveMultFriendly: 0.85, pathCostMult: 1.4,
    model: 'trench',
  },
  sandbags: {
    id: 'sandbags', faction: 'new_antioch', kind: 'linear', nameKey: 'struct.sandbags',
    lore: { status: 'abstraction' },
    width: 1.0, minLen: 2, maxLen: 12, hp: 520, buildable: true, builder: 'new_antioch',
    costPerM: { material: 1.6 }, workPerM: 1.8, blocks: false, cover: 'sandbag', coverRadius: 1.8,
    moveMultEnemy: 0.5, moveMultFriendly: 0.6, pathCostMult: 2.2,
    model: 'sandbags',
  },
  wire: {
    id: 'wire', faction: 'new_antioch', kind: 'linear', nameKey: 'struct.wire',
    lore: { status: 'abstraction' },
    width: 3.4, minLen: 3, maxLen: 16, hp: 170, buildable: true, builder: 'new_antioch',
    costPerM: { material: 1.0 }, workPerM: 1.4, blocks: false, cover: null,
    // Not a wall: slows infantry. Heavy units push through more easily (data-driven).
    moveMultEnemy: 0.24, moveMultFriendly: 0.7, moveMultHeavy: 0.55, pathCostMult: 3.0,
    model: 'wire',
  },
  fire_post: {
    id: 'fire_post', faction: 'new_antioch', kind: 'building', nameKey: 'struct.fire_post',
    lore: { status: 'abstraction', ref: 'Fortified machine-gun position (WWI field fortification abstraction)' },
    footprint: { w: 5.5, d: 4.5 }, hp: 1500, blocks: true, vision: 54, buildable: true, builder: 'new_antioch',
    cost: { material: 90, manpower: 2 }, work: 70,
    weapon: 'fire_post_mg', arc: 150, crew: 2,
    model: 'fire_post',
  },
  observation_post: {
    id: 'observation_post', faction: 'new_antioch', kind: 'building', nameKey: 'struct.observation_post',
    lore: { status: 'abstraction' },
    footprint: { w: 3.5, d: 3.5 }, hp: 520, blocks: true, vision: 96, buildable: true, builder: 'new_antioch',
    cost: { material: 60 }, work: 40,
    model: 'obs_post',
  },
  supply_cache: {
    id: 'supply_cache', faction: 'new_antioch', kind: 'building', nameKey: 'struct.supply_cache',
    lore: { status: 'abstraction' },
    footprint: { w: 3.5, d: 2.5 }, hp: 420, blocks: true, vision: 20, buildable: true, builder: 'new_antioch',
    cost: { material: 50, supply: 40 }, work: 30, resupplyRadius: 24,
    model: 'supply_cache',
  },
  grail_altar: {
    id: 'grail_altar', faction: 'black_grail', kind: 'building', nameKey: 'struct.grail_altar',
    lore: { status: 'canon', ref: '"Altars of Beelzebub... constructed from the remains of their victims shaped into the form of monstrous flies" (official lore)' },
    footprint: { w: 10, d: 10 }, hp: 3600, blocks: true, vision: 46, buildable: false,
    trains: ['grail_thrall', 'corpse_guard', 'plague_knight'], biomassRate: 0.35,
    infectionSource: { radius: 34, rate: 6 },
    model: 'grail_altar',
  },
};

export function structDef(id) {
  const d = STRUCTURES[id];
  if (!d) throw new Error('Unknown structure type: ' + id);
  return d;
}

/** Resource nodes (physical economy). */
export const NODE_TYPES = {
  salvage_rubble: { id: 'salvage_rubble', resource: 'material', nameKey: 'node.salvage', model: 'salvage_rubble' },
  salvage_wreck: { id: 'salvage_wreck', resource: 'material', nameKey: 'node.wreck', model: 'salvage_wreck' },
  salvage_gun: { id: 'salvage_gun', resource: 'material', nameKey: 'node.gun', model: 'salvage_gun' },
};
