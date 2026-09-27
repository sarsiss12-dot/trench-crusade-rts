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
    model: 'na_yeoman', icon: 'rifle',
    cost: { manpower: 8, supply: 50 }, trainTime: 28,
  },
  combat_engineer: {
    id: 'combat_engineer', faction: 'new_antioch', nameKey: 'unit.combat_engineer', descKey: 'unit.combat_engineer.desc',
    lore: { status: 'canon', ref: 'Combat Engineer — New Antioch specialist who can fortify positions (official rules); the automatic shotgun loadout here is a gameplay choice' },
    combatUnit: false, roles: ['builder', 'gatherer', 'repairer'], squadSize: 5,
    hp: 95, armor: 0.05, speed: 2.9, vision: 40, radius: 0.44,
    weapon: 'auto_shotgun', melee: 'entrenching_tool', ammoPerSoldier: 10,
    buildRate: 1.0, gatherRate: 1.6, carryCapacity: 8, gathers: 'salvage',
    formation: 'cluster', spacing: 1.6, canGarrison: true, heavy: false,
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
    model: 'na_heavy', icon: 'heavy',
    cost: { manpower: 3, supply: 110, material: 90 }, trainTime: 45,
  },
  grail_thrall: {
    id: 'grail_thrall', faction: 'black_grail', nameKey: 'unit.grail_thrall', descKey: 'unit.grail_thrall.desc',
    lore: {
      status: 'canon',
      ref: 'Grail Thrall — hollowed husks without equipment that grow stronger in groups (official rules); infected dead "lurch to their feet" (official lore)',
    },
    combatUnit: true, roles: ['horde'], squadSize: 8,
    hp: 80, armor: 0.2, speed: 2.45, vision: 36, radius: 0.44,
    weapon: null, melee: 'thrall_claws', ammoPerSoldier: 0,
    // canon-inspired: "strengthened by proximity to other Thralls"
    hordeBonus: { radius: 16, perSquad: 0.08, max: 0.24 },
    formation: 'horde', spacing: 1.5, canGarrison: false, heavy: false,
    model: 'bg_thrall', icon: 'thrall',
    cost: { biomass: 55 }, trainTime: 16, raisedFromCorpses: true,
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
    model: 'bg_plague_knight', icon: 'knight',
    cost: { biomass: 120 }, trainTime: 30,
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
