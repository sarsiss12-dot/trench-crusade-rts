// Unit (squad) definitions. Gameplay decisions are made at SQUAD level; soldiers are light state.
//
// combatUnit: true  -> selected by "Tümü/All", joins AI assault groups.
// combatUnit: false -> engineers / workers / civilians / medics / carriers (never in "All").
// roles: capability flags (builder, gatherer, repairer...). Logic checks roles, never unit names.
// lore.status: 'canon' (named unit type verified in official sources), 'canon-inspired', 'abstraction'.
// Squad sizes, stats and RTS behaviour are always gameplay abstractions.

export const UNITS = {
  yeoman_rifle: {
    id: 'yeoman_rifle', faction: 'new_antioch', nameKey: 'unit.yeoman_rifle', descKey: 'unit.yeoman_rifle.desc',
    lore: { status: 'canon', ref: 'Yeoman — New Antioch basic infantry with bolt-action rifles (official rules / Trench Companion)' },
    combatUnit: true, roles: ['line'], squadSize: 8,
    hp: 100, armor: 0, speed: 2.9, vision: 46, radius: 0.42,
    weapon: 'bolt_rifle', melee: 'bayonet', ammoPerSoldier: 18,
    formation: 'line', spacing: 1.7, canGarrison: true, heavy: false,
    corpseBiomass: 12,
    model: 'na_yeoman', icon: 'rifle',
    cost: { manpower: 8, supply: 50 }, trainTime: 28,
  },
  combat_engineer: {
    id: 'combat_engineer', faction: 'new_antioch', nameKey: 'unit.combat_engineer', descKey: 'unit.combat_engineer.desc',
    lore: { status: 'canon', ref: 'Combat Engineer — New Antioch specialist who can fortify positions (official rules); the automatic shotgun loadout here is a gameplay choice' },
    combatUnit: false, roles: ['builder', 'gatherer', 'repairer', 'sanitizer'], squadSize: 5,
    hp: 95, armor: 0.05, speed: 2.9, vision: 40, radius: 0.44,
    weapon: 'auto_shotgun', melee: 'entrenching_tool', ammoPerSoldier: 10,
    buildRate: 1.0, gatherRate: 1.6, carryCapacity: 8, gathers: 'salvage',
    formation: 'cluster', spacing: 1.6, canGarrison: true, heavy: false,
    corpseBiomass: 12,
    model: 'na_engineer', icon: 'engineer',
    cost: { manpower: 5, material: 40 }, trainTime: 24,
  },
  mech_heavy: {
    id: 'mech_heavy', faction: 'new_antioch', nameKey: 'unit.mech_heavy', descKey: 'unit.mech_heavy.desc',
    lore: { status: 'canon', ref: 'Mechanised Heavy Infantry — heavily armoured New Antioch troops in machine armour with heavy weapons (official rules); exact loadout is a gameplay choice' },
    combatUnit: true, roles: ['line', 'heavy'], squadSize: 3,
    hp: 340, armor: 0.4, speed: 2.1, vision: 44, radius: 0.62,
    weapon: 'heavy_mg', melee: 'great_hammer', ammoPerSoldier: 60,
    formation: 'line', spacing: 2.4, canGarrison: true, heavy: true,
    corpseBiomass: 18,
    specCostKey: 'heavyCost', specSizeKey: 'heavySize',
    model: 'na_heavy', icon: 'heavy',
    cost: { manpower: 3, supply: 110, material: 90 }, trainTime: 45,
  },
  // ---- Phase 3: New Antioch support / leaders / counter-plague -----------------------------------
  combat_medic: {
    id: 'combat_medic', faction: 'new_antioch', nameKey: 'unit.combat_medic', descKey: 'unit.combat_medic.desc',
    lore: { status: 'canon', ref: 'Combat Medic — New Antioch specialist (official roster); healing / early infection treatment here is a gameplay abstraction' },
    combatUnit: false, roles: ['medic'], squadSize: 2,
    hp: 90, armor: 0.05, speed: 2.9, vision: 40, radius: 0.42,
    weapon: 'service_pistol', melee: 'entrenching_tool', ammoPerSoldier: 8,
    formation: 'cluster', spacing: 1.6, canGarrison: true, heavy: false,
    corpseBiomass: 12,
    specCostKey: 'medicCost',
    model: 'na_medic', icon: 'medic',
    cost: { manpower: 3, supply: 80, material: 20 }, trainTime: 26, maxSquads: 3,
    // no area immunity: heals, revives the wounded, treats EARLY infection, slows late infection
    medic: { radius: 10, hpPerSec: 2, cureEverySec: 3, cureMaxStacks: 3, slowSec: 5, reviveRadius: 16 },
  },
  trench_cleric: {
    id: 'trench_cleric', faction: 'new_antioch', nameKey: 'unit.trench_cleric', descKey: 'unit.trench_cleric.desc',
    lore: { status: 'canon', ref: 'Trench Cleric — New Antioch elite (official roster); the aura is a gameplay abstraction' },
    combatUnit: true, roles: ['leader', 'support'], squadSize: 1,
    hp: 180, armor: 0.12, speed: 2.7, vision: 44, radius: 0.45,
    weapon: 'service_pistol', melee: 'trench_club', ammoPerSoldier: 10,
    formation: 'line', spacing: 1.7, canGarrison: true, heavy: false,
    corpseBiomass: 14,
    model: 'na_cleric', icon: 'cleric',
    cost: { manpower: 2, supply: 110, material: 20 }, trainTime: 30, maxSquads: 1,
    requiresSpec: ['na_faith', 'na_purification'],
    // resistance, not immunity; consecrated ground keeps nearby dead from rising
    aura: { radius: 14, infectResist: 0.5, accBonus: 0.1, fearImmune: 1, consecrate: 16, purifyEverySec: 8, purifyRadius: 10 },
  },
  shock_flamer: {
    id: 'shock_flamer', faction: 'new_antioch', nameKey: 'unit.shock_flamer', descKey: 'unit.shock_flamer.desc',
    lore: { status: 'canon-inspired', ref: 'Shocktroopers can be armed with flamethrowers (official New Antioch armoury); the two-man flamer team is a gameplay abstraction' },
    combatUnit: true, roles: ['line', 'flame'], squadSize: 2,
    hp: 125, armor: 0.2, speed: 2.6, vision: 40, radius: 0.46,
    weapon: 'flamethrower', melee: 'trench_club', ammoPerSoldier: 12,
    formation: 'line', spacing: 2.0, canGarrison: true, heavy: false,
    corpseBiomass: 14,
    specCostKey: 'flamerCost', specCapKey: 'flamerCap',
    model: 'na_flamer', icon: 'flame',
    cost: { manpower: 3, supply: 130, material: 50 }, trainTime: 32, maxSquads: 2, requiresStructure: 'workshop',
  },
  na_lieutenant: {
    id: 'na_lieutenant', faction: 'new_antioch', nameKey: 'unit.na_lieutenant', descKey: 'unit.na_lieutenant.desc',
    lore: { status: 'canon', ref: 'Lieutenant — New Antioch warband leader (official roster); command aura is a gameplay abstraction' },
    combatUnit: true, roles: ['leader', 'line'], squadSize: 1,
    hp: 170, armor: 0.15, speed: 2.9, vision: 52, radius: 0.43,
    weapon: 'smg', melee: 'bayonet', ammoPerSoldier: 24,
    formation: 'line', spacing: 1.7, canGarrison: true, heavy: false,
    corpseBiomass: 14,
    model: 'na_lieutenant', icon: 'officer',
    cost: { manpower: 2, supply: 120 }, trainTime: 30, maxSquads: 1, requiresSpec: ['na_elite'],
    aura: { radius: 16, accBonus: 0.15, suppressResist: 1, fearImmune: 1 },
    // Phase 4: the faction's COMMANDER (one on the field; see sim/commander.js)
    commander: { ability: 'hold_the_line', replaceSec: 150, replaceCostMult: 2, maxReplacements: 1, penalty: { sec: 60, cooldownMult: 1.3, shockR: 35, shockSec: 6 } },
  },
  // Civilians of the principality: autonomous workers of a settlement (never commanded, never in
  // "All"); the settlement's population is aggregate, these crews are its visible workforce
  civilians: {
    id: 'civilians', faction: 'new_antioch', nameKey: 'unit.civilians', descKey: 'unit.civilians.desc',
    lore: { status: 'abstraction', ref: 'New Antioch is a populous fortress-city; civilian workers are a gameplay abstraction' },
    combatUnit: false, autonomous: true, roles: ['civilian'], squadSize: 6,
    hp: 45, armor: 0, speed: 2.5, vision: 16, radius: 0.42,
    weapon: null, melee: null, ammoPerSoldier: 0,
    formation: 'cluster', spacing: 1.7, canGarrison: false, heavy: false,
    corpseBiomass: 8,
    model: 'na_civilian', icon: 'civilian',
    cost: null, trainTime: 0,
  },
  grail_thrall: {
    id: 'grail_thrall', faction: 'black_grail', nameKey: 'unit.grail_thrall', descKey: 'unit.grail_thrall.desc',
    lore: {
      status: 'canon',
      ref: 'Grail Thrall — hollowed husks without equipment that grow stronger in groups (official rules: "Overwhelming Horde"); infected dead "lurch to their feet" (official lore)',
    },
    // Phase 3 swarm identity: cheap, slow, weak alone, many to a squad (performance-bounded)
    combatUnit: true, roles: ['horde'], squadSize: 12,
    hp: 58, armor: 0.15, speed: 2.3, vision: 36, radius: 0.44, // Phase 4: weaker alone (62 -> 58)
    weapon: null, melee: 'thrall_claws', ammoPerSoldier: 0,
    // canon-inspired: "strengthened by proximity to other Thralls" (other Grail squads count half)
    hordeBonus: { radius: 16, perSquad: 0.07, other: 0.5, max: 0.28 },
    fear: { radius: 11, squads: 3, accMult: 0.85 },
    formation: 'horde', spacing: 1.45, canGarrison: false, heavy: false,
    corpseBiomass: 3,
    specCostKey: 'thrallCost', specTrainKey: 'thrallTrain', specSizeKey: 'thrallSize', specDamageKey: 'thrallDamage',
    model: 'bg_thrall', icon: 'thrall',
    // Phase 4 early swarm: cheaper and faster to raise (60 / 14 s -> 50 / 11 s)
    cost: { biomass: 50 }, trainTime: 11, raisedFromCorpses: true,
  },
  // Grail Thralls used as expendable labour: cheap, slow, weak, numerous. They raise the Black
  // Grail's organic structures and haul corpses to altars / mounds. Not a generic worker caste.
  thrall_gang: {
    id: 'thrall_gang', faction: 'black_grail', nameKey: 'unit.thrall_gang', descKey: 'unit.thrall_gang.desc',
    lore: { status: 'canon-inspired', ref: 'Grail Thralls are canon (official rules); using them as labour / corpse-hauling gangs is a gameplay adaptation' },
    combatUnit: false, roles: ['builder', 'gatherer'], squadSize: 6,
    hp: 70, armor: 0.1, speed: 2.05, vision: 30, radius: 0.44,
    weapon: null, melee: 'thrall_claws', ammoPerSoldier: 0,
    buildRate: 0.55, gatherRate: 0.9, carryCapacity: 4, gathers: 'corpse',
    formation: 'horde', spacing: 1.6, canGarrison: false, heavy: false,
    corpseBiomass: 3,
    specCapKey: 'gangCap',
    model: 'bg_thrall', icon: 'gang',
    cost: { biomass: 30 }, trainTime: 12, maxSquads: 4,
  },
  corpse_guard: {
    id: 'corpse_guard', faction: 'black_grail', nameKey: 'unit.corpse_guard', descKey: 'unit.corpse_guard.desc',
    lore: { status: 'canon', ref: 'Corpse Guard — elite bodyguard devotees of the Black Grail (official rules); the infested rifle and backpack parasite are this project\'s interpretation' },
    combatUnit: true, roles: ['line'], squadSize: 4,
    hp: 150, armor: 0.25, speed: 2.7, vision: 44, radius: 0.46,
    weapon: 'infested_rifle', melee: 'plague_blade', ammoPerSoldier: 0,
    formation: 'line', spacing: 1.9, canGarrison: false, heavy: false,
    corpseBiomass: 5,
    model: 'bg_corpse_guard', icon: 'guard',
    cost: { biomass: 80 }, trainTime: 22,
  },
  plague_knight: {
    id: 'plague_knight', faction: 'black_grail', nameKey: 'unit.plague_knight', descKey: 'unit.plague_knight.desc',
    lore: { status: 'canon', ref: 'Plague Knight — armoured warrior of the Black Grail (official rules); heraldic carapace look is this project\'s interpretation' },
    combatUnit: true, roles: ['shock', 'heavy'], squadSize: 3,
    hp: 360, armor: 0.4, speed: 2.55, vision: 40, radius: 0.62,
    weapon: null, melee: 'plague_greatblade', ammoPerSoldier: 0,
    formation: 'wedge', spacing: 2.3, canGarrison: false, heavy: true,
    corpseBiomass: 8,
    model: 'bg_plague_knight', icon: 'knight',
    cost: { biomass: 120 }, trainTime: 30,
  },
  // ---- Phase 3: Black Grail speciality units ------------------------------------------------------
  herald: {
    id: 'herald', faction: 'black_grail', nameKey: 'unit.herald', descKey: 'unit.herald.desc',
    lore: { status: 'canon', ref: 'Herald of Beelzebub — Black Grail elite (official roster); the fly-cloud aura is a gameplay abstraction' },
    combatUnit: true, roles: ['shock', 'support'], squadSize: 1,
    hp: 280, armor: 0.2, speed: 2.8, vision: 46, radius: 0.5,
    weapon: null, melee: 'plague_blade', ammoPerSoldier: 0,
    formation: 'line', spacing: 2, canGarrison: false, heavy: false,
    corpseBiomass: 8,
    model: 'bg_herald', icon: 'herald',
    cost: { biomass: 140 }, trainTime: 26, maxSquads: 2, requiresSpec: ['bg_heralds'],
    aura: { radius: 9, infectEverySec: 3, debuff: 1 },
  },
  amalgam: {
    id: 'amalgam', faction: 'black_grail', nameKey: 'unit.amalgam', descKey: 'unit.amalgam.desc',
    lore: { status: 'canon', ref: 'Amalgam — Black Grail troop (official roster); raised at a corpse mound here (gameplay abstraction)' },
    combatUnit: true, roles: ['shock', 'heavy'], squadSize: 1,
    hp: 1100, armor: 0.3, speed: 1.9, vision: 36, radius: 1.1,
    weapon: null, melee: 'amalgam_maul', ammoPerSoldier: 0,
    formation: 'line', spacing: 3, canGarrison: false, heavy: true,
    corpseBiomass: 20,
    model: 'bg_amalgam', icon: 'amalgam',
    cost: { biomass: 220 }, trainTime: 40, maxSquads: 3, requiresSpec: ['bg_amalgam'],
  },
  lord_of_tumours: {
    id: 'lord_of_tumours', faction: 'black_grail', nameKey: 'unit.lord_of_tumours', descKey: 'unit.lord_of_tumours.desc',
    lore: { status: 'canon', ref: 'Lord of Tumours — Black Grail leader (official roster); aura is a gameplay abstraction' },
    combatUnit: true, roles: ['leader', 'shock', 'heavy'], squadSize: 1,
    hp: 650, armor: 0.35, speed: 2.4, vision: 46, radius: 0.7,
    weapon: null, melee: 'tumour_blade', ammoPerSoldier: 0,
    formation: 'line', spacing: 2.5, canGarrison: false, heavy: true,
    corpseBiomass: 16,
    model: 'bg_lord', icon: 'lord',
    cost: { biomass: 200 }, trainTime: 36, maxSquads: 1, requiresSpec: ['bg_lord'],
    aura: { radius: 14, regen: 2, meleeBonus: 0.15, infectRadius: 6, infectEverySec: 4 },
    commander: { ability: 'plague_blessing', replaceSec: 150, replaceCostMult: 2, maxReplacements: 1, penalty: { sec: 60, cooldownMult: 1.3, shockR: 35, shockSec: 5 } },
  },
};

export function unitDef(id) {
  const d = UNITS[id];
  if (!d) throw new Error('Unknown unit type: ' + id);
  return d;
}

export function hasRole(def, role) {
  return def.roles.indexOf(role) >= 0;
}
