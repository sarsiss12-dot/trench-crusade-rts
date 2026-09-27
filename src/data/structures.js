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
    hq: true, reinforceSource: true,
    model: 'bastion',
  },
  supply_depot: {
    id: 'supply_depot', faction: 'new_antioch', kind: 'building', nameKey: 'struct.supply_depot',
    lore: { status: 'abstraction' },
    footprint: { w: 14, d: 10 }, hp: 2000, blocks: true, vision: 34, buildable: false,
    dropOff: true, resupplyRadius: 34, reinforceRadius: 36, supplyRate: 1.6, reinforceSource: true,
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
  // ---- Phase 2: New Antioch logistics / support buildings -------------------------------------
  aid_station: {
    id: 'aid_station', faction: 'new_antioch', kind: 'building', nameKey: 'struct.aid_station',
    lore: { status: 'abstraction', ref: 'New Antioch fields Combat Medics (official roster); the field dressing station building is a gameplay abstraction' },
    footprint: { w: 6, d: 5 }, hp: 700, blocks: true, vision: 26, buildable: true, builder: 'new_antioch',
    cost: { material: 70, supply: 30 }, work: 45,
    heal: { radius: 16, hpPerSec: 1.5, cureEveryTicks: 80 },
    model: 'aid_station',
  },
  workshop: {
    id: 'workshop', faction: 'new_antioch', kind: 'building', nameKey: 'struct.workshop',
    lore: { status: 'canon-inspired', ref: 'New Antioch is described as an industrial fortress-city with workshops and foundries; this field workshop is a gameplay abstraction' },
    footprint: { w: 9, d: 7 }, hp: 1400, blocks: true, vision: 28, buildable: true, builder: 'new_antioch',
    cost: { material: 120, manpower: 2 }, work: 90, materialRate: 0.35,
    repairAura: { radius: 26, hpPerSec: 4 }, unlocks: ['fortified_wall'],
    model: 'workshop',
  },
  ammo_dump: {
    id: 'ammo_dump', faction: 'new_antioch', kind: 'building', nameKey: 'struct.ammo_dump',
    lore: { status: 'abstraction', ref: 'Forward ammunition dump (WWI logistics abstraction)' },
    footprint: { w: 6, d: 4 }, hp: 600, blocks: true, vision: 22, buildable: true, builder: 'new_antioch',
    cost: { material: 80, supply: 60 }, work: 50, resupplyRadius: 38,
    explodes: { radius: 12, damage: 140, structureDamage: 300 },
    model: 'ammo_dump',
  },
  signal_post: {
    id: 'signal_post', faction: 'new_antioch', kind: 'building', nameKey: 'struct.signal_post',
    lore: { status: 'abstraction', ref: 'New Antioch fields Observers (official roster) and artillery battalions (official lore); the signal post building is an abstraction' },
    footprint: { w: 3, d: 3 }, hp: 450, blocks: true, vision: 70, buildable: true, builder: 'new_antioch',
    cost: { material: 70, supply: 20 }, work: 40,
    support: { artillerySupport: 0.8 },
    model: 'signal_post',
  },
  muster_point: {
    id: 'muster_point', faction: 'new_antioch', kind: 'building', nameKey: 'struct.muster_point',
    lore: { status: 'abstraction', ref: 'Forward barracks / muster point where replacements assemble (abstraction)' },
    footprint: { w: 8, d: 6 }, hp: 1000, blocks: true, vision: 30, buildable: true, builder: 'new_antioch',
    cost: { material: 100, supply: 40 }, work: 70,
    reinforceSource: true, reinforceRadius: 30, levy: { supply: 8, everyTicks: 300 },
    model: 'muster_point',
  },
  // ---- Phase 2: New Antioch wall family (linear; segments leave room for a later gate system) ---
  low_sandbags: {
    id: 'low_sandbags', faction: 'new_antioch', kind: 'linear', nameKey: 'struct.low_sandbags',
    lore: { status: 'abstraction' },
    width: 0.8, minLen: 2, maxLen: 14, hp: 260, buildable: true, builder: 'new_antioch',
    costPerM: { material: 0.7 }, workPerM: 0.7, blocks: false, cover: 'low_wall', coverRadius: 1.6,
    moveMultEnemy: 0.75, moveMultFriendly: 0.85, pathCostMult: 1.3,
    model: 'low_sandbags',
  },
  breastwork: {
    id: 'breastwork', faction: 'new_antioch', kind: 'linear', nameKey: 'struct.breastwork',
    lore: { status: 'abstraction', ref: 'Timber-and-earth breastwork (field fortification abstraction)' },
    width: 1.8, minLen: 3, maxLen: 14, hp: 1400, buildable: true, builder: 'new_antioch',
    costPerM: { material: 0.6 }, workPerM: 3.2, blocks: false, cover: 'breastwork', coverRadius: 2.0,
    moveMultEnemy: 0.45, moveMultFriendly: 0.6, pathCostMult: 2.4, blastResist: 0.5,
    model: 'breastwork',
  },
  timber_wall: {
    id: 'timber_wall', faction: 'new_antioch', kind: 'linear', nameKey: 'struct.timber_wall',
    lore: { status: 'abstraction', ref: 'Reinforced sandbag and timber revetment (abstraction)' },
    width: 1.2, minLen: 2, maxLen: 10, hp: 1100, buildable: true, builder: 'new_antioch',
    costPerM: { material: 3 }, workPerM: 2.4, blocks: false, cover: 'timber', coverRadius: 1.8,
    moveMultEnemy: 0.3, moveMultFriendly: 0.45, pathCostMult: 4,
    model: 'timber_wall',
  },
  fortified_wall: {
    id: 'fortified_wall', faction: 'new_antioch', kind: 'linear', nameKey: 'struct.fortified_wall',
    lore: { status: 'abstraction', ref: 'Fortified wall section in the spirit of New Antioch\'s city walls (official lore: walled city); field version is an abstraction' },
    width: 1.6, minLen: 3, maxLen: 10, hp: 3600, buildable: true, builder: 'new_antioch',
    costPerM: { material: 6, supply: 1 }, workPerM: 6, blocks: true, cover: 'fortified', coverRadius: 2.0,
    requires: 'workshop', blastResist: 0.35,
    model: 'fortified_wall',
  },
  // ---- Black Grail ------------------------------------------------------------------------------
  grail_altar: {
    id: 'grail_altar', faction: 'black_grail', kind: 'building', nameKey: 'struct.grail_altar',
    lore: { status: 'canon', ref: '"Altars of Beelzebub... constructed from the remains of their victims shaped into the form of monstrous flies" (official lore)' },
    footprint: { w: 10, d: 10 }, hp: 3600, blocks: true, vision: 46, buildable: true, builder: 'black_grail',
    cost: { biomass: 220 }, work: 110,
    trains: ['grail_thrall', 'corpse_guard', 'plague_knight', 'thrall_gang'], biomassRate: 0.35,
    infectionSource: { radius: 34, rate: 6 }, dropOff: true, hq: true,
    model: 'grail_altar',
  },
  corpse_mound: {
    id: 'corpse_mound', faction: 'black_grail', kind: 'building', nameKey: 'struct.corpse_mound',
    lore: { status: 'abstraction', ref: 'Heaped dead gathered for the Grail\'s use; the Black Grail\'s use of corpses is canon, this structure is a gameplay abstraction' },
    footprint: { w: 7, d: 7 }, hp: 900, blocks: true, vision: 24, buildable: true, builder: 'black_grail',
    cost: { biomass: 60 }, work: 40, dropOff: true, harvestRadius: 22, harvestRate: 0.3,
    organic: true, model: 'corpse_mound',
  },
  plague_pit: {
    id: 'plague_pit', faction: 'black_grail', kind: 'building', nameKey: 'struct.plague_pit',
    lore: { status: 'abstraction', ref: 'Infestation node spreading the Grail\'s corruption; plague and corruption themes are canon, the structure is an abstraction' },
    footprint: { w: 6, d: 6 }, hp: 800, blocks: true, vision: 24, buildable: true, builder: 'black_grail',
    cost: { biomass: 70 }, work: 50, infectionSource: { radius: 26, rate: 4 },
    organic: true, model: 'plague_pit',
  },
  fly_nest: {
    id: 'fly_nest', faction: 'black_grail', kind: 'building', nameKey: 'struct.fly_nest',
    lore: { status: 'canon-inspired', ref: 'Hell-flies and Beelzebub, Lord of the Flies, are core Black Grail lore (Heralds of Beelzebub, Fly Thralls); the nest structure is an abstraction' },
    footprint: { w: 5, d: 5 }, hp: 600, blocks: true, vision: 64, buildable: true, builder: 'black_grail',
    cost: { biomass: 60 }, work: 45, support: { swarmSupport: 0.75 },
    organic: true, model: 'fly_nest',
  },
  bone_barricade: {
    id: 'bone_barricade', faction: 'black_grail', kind: 'linear', nameKey: 'struct.bone_barricade',
    lore: { status: 'abstraction', ref: 'Defensive rampart of bone and fused flesh (abstraction)' },
    width: 1.4, minLen: 2, maxLen: 10, hp: 700, buildable: true, builder: 'black_grail',
    costPerM: { biomass: 2.0 }, workPerM: 2.0, blocks: false, cover: 'bone', coverRadius: 1.8,
    moveMultEnemy: 0.55, moveMultFriendly: 0.8, pathCostMult: 2.2,
    organic: true, model: 'bone_barricade',
  },
};

/** Linear structure types that give directional wall cover (sandbag family, walls, bone lines). */
export const WALL_TYPES = Object.keys(STRUCTURES).filter((k) => {
  const d = STRUCTURES[k];
  return d.kind === 'linear' && d.cover && d.cover !== 'trench';
});

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
