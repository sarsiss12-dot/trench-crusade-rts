// Structure definitions (data-driven).
// kind: 'building' (rotated rectangle footprint), 'linear' (segment between two points), 'area' (field).
// work: engineer-seconds to build (linear: per meter). cost: resources (linear: per meter via costPerM).
// blocks: footprint is impassable for pathing. cover: cover type given to soldiers using it.
// moveMult*: movement multiplier for units crossing the footprint (wire / sandbags / trench).
// Faction 'neutral' structures (old trench remnants, old wire) are placed by the map.

// Phase 3 keys: cat (build-menu tab: defense / economy / support), hub (engineers / gangs return
// here when idle), fortAnchor (heavy defenses may be built within anchorRadius), heavyDefense
// (needs an anchor — or a settlement with the Fortified Settlements speciality), requiresSpec
// (speciality ids, any of them), requiresSector / requiresSettlement / requiresSectorKind
// (expansion economy placement rules, construction/construction.js).
export const STRUCTURES = {
  bastion: {
    id: 'bastion', faction: 'new_antioch', kind: 'building', nameKey: 'struct.bastion',
    lore: { status: 'abstraction', ref: 'New Antioch is a walled fortress-city that endured eight great sieges (official lore); this fortified church-bastion is a gameplay objective abstraction' },
    footprint: { w: 26, d: 22 }, hp: 9000, blocks: true, vision: 64, buildable: false,
    dropOff: true, resupplyRadius: 42, reinforceRadius: 46, supplyRate: 0.6, materialRate: 0.25,
    trains: ['yeoman_rifle', 'combat_engineer', 'mech_heavy', 'combat_medic', 'shock_flamer', 'trench_cleric', 'na_lieutenant', 'sniper_priest'], canBeObjective: true,
    hq: true, reinforceSource: true, hub: true, fortAnchor: true, anchorRadius: 90, homeEcon: 70, shelter: true,
    model: 'bastion',
  },
  // Phase 5A: a New Antioch side that STARTS as the attacker has no fortress-city behind it; its
  // HQ is a forward field headquarters (same HQ capability as the bastion: trains, reinforcement
  // source, resupply, drop-off; lighter economy). Gameplay abstraction, no canon name.
  field_hq: {
    id: 'field_hq', faction: 'new_antioch', kind: 'building', nameKey: 'struct.field_hq',
    lore: { status: 'abstraction', ref: 'Forward command posts of trench warfare (WWI); New Antioch campaigns far from its walls (official lore) — the structure itself is a gameplay abstraction' },
    footprint: { w: 14, d: 10 }, hp: 5200, blocks: true, vision: 52, buildable: false,
    dropOff: true, resupplyRadius: 38, reinforceRadius: 40, supplyRate: 0.55, materialRate: 0.2,
    trains: ['yeoman_rifle', 'combat_engineer', 'mech_heavy', 'combat_medic', 'shock_flamer', 'trench_cleric', 'na_lieutenant', 'sniper_priest'], canBeObjective: true,
    hq: true, reinforceSource: true, hub: true, fortAnchor: true, anchorRadius: 80, homeEcon: 60, shelter: true,
    model: 'depot',
  },
  supply_depot: {
    id: 'supply_depot', faction: 'new_antioch', kind: 'building', nameKey: 'struct.supply_depot',
    lore: { status: 'abstraction' },
    footprint: { w: 14, d: 10 }, hp: 2000, blocks: true, vision: 34, buildable: true, builder: 'new_antioch',
    cost: { material: 160, supply: 40 }, work: 110, requiresSpec: ['na_adv_logistics'], cat: 'economy',
    dropOff: true, resupplyRadius: 34, reinforceRadius: 36, supplyRate: 1.6, reinforceSource: true,
    hub: true, fortAnchor: true, anchorRadius: 80, homeEcon: 50,
    model: 'depot',
  },
  field: {
    id: 'field', faction: 'new_antioch', kind: 'area', nameKey: 'struct.field',
    lore: { status: 'abstraction' },
    footprint: { w: 40, d: 30 }, hp: 600, blocks: false, vision: 0, buildable: false,
    foodRate: 0.45, model: 'field',
  },
  // ---- Phase 3: expansion economy ---------------------------------------------------------------
  settlement: {
    id: 'settlement', faction: 'new_antioch', kind: 'building', nameKey: 'struct.settlement',
    lore: { status: 'abstraction', ref: 'Small civilian outpost of the principality (gameplay abstraction)' },
    footprint: { w: 12, d: 10 }, hp: 1800, blocks: true, vision: 34, buildable: true, builder: 'new_antioch',
    cost: { material: 60, supply: 40 }, work: 60, cat: 'economy', requiresSector: true,
    settlement: { econRadius: 42, popCap: 20 }, dropOff: true, hub: true, shelter: true,
    specWeapon: { spec: 'na_fortified_settlements', weapon: 'settlement_mg', arc: 360 },
    model: 'settlement',
  },
  farm: {
    id: 'farm', faction: 'new_antioch', kind: 'area', nameKey: 'struct.farm',
    lore: { status: 'abstraction' },
    footprint: { w: 22, d: 16 }, hp: 420, blocks: false, vision: 0, buildable: true, builder: 'new_antioch',
    cost: { material: 25 }, work: 25, cat: 'economy', requiresSettlement: true,
    farm: { foodRate: 0.32 },
    model: 'farm',
  },
  livestock_pen: {
    id: 'livestock_pen', faction: 'new_antioch', kind: 'building', nameKey: 'struct.livestock_pen',
    lore: { status: 'abstraction' },
    footprint: { w: 12, d: 10 }, hp: 520, blocks: false, vision: 22, buildable: true, builder: 'new_antioch',
    cost: { material: 40 }, work: 30, cat: 'economy', requiresSettlement: true,
    pen: { capacity: 8, herdRadius: 70 },
    model: 'livestock_pen',
  },
  quarry: {
    id: 'quarry', faction: 'new_antioch', kind: 'building', nameKey: 'struct.quarry',
    lore: { status: 'abstraction' },
    footprint: { w: 10, d: 9 }, hp: 900, blocks: true, vision: 24, buildable: true, builder: 'new_antioch',
    cost: { material: 50 }, work: 40, cat: 'economy', requiresSettlement: true, requiresSectorKind: ['quarry', 'scrap'],
    quarry: { materialRate: 0.32 },
    model: 'quarry',
  },
  pillbox: {
    id: 'pillbox', faction: 'new_antioch', kind: 'building', nameKey: 'struct.pillbox',
    lore: { status: 'abstraction', ref: 'Concrete machine-gun bunker (WWI field fortification abstraction)' },
    footprint: { w: 5, d: 5 }, hp: 3200, blocks: true, vision: 56, buildable: true, builder: 'new_antioch',
    cost: { material: 140, supply: 20 }, work: 90, cat: 'defense', requiresSpec: ['na_fortification'], heavyDefense: true,
    weapon: 'pillbox_mg', arc: 150, crew: 2, blastResist: 0.5,
    model: 'pillbox',
  },
  trench: {
    id: 'trench', faction: 'any', kind: 'linear', nameKey: 'struct.trench',
    lore: { status: 'abstraction', ref: 'Trench warfare is the core of the setting; RTS trench mechanics are abstractions' },
    width: 2.2, depth: 1.55, minLen: 4, maxLen: 16, hp: 2600, buildable: true, builder: 'new_antioch',
    costPerM: { material: 2.2 }, workPerM: 5.0, blocks: false, cover: 'trench', slotSpacing: 1.45,
    moveMultEnemy: 0.55, moveMultFriendly: 0.85, pathCostMult: 1.4,
    cat: 'defense',
    model: 'trench',
  },
  sandbags: {
    id: 'sandbags', faction: 'new_antioch', kind: 'linear', nameKey: 'struct.sandbags',
    lore: { status: 'abstraction' },
    width: 1.0, minLen: 2, maxLen: 12, hp: 520, buildable: true, builder: 'new_antioch',
    costPerM: { material: 1.6 }, workPerM: 1.8, blocks: false, cover: 'sandbag', coverRadius: 1.8,
    moveMultEnemy: 0.5, moveMultFriendly: 0.6, pathCostMult: 2.2,
    cat: 'defense',
    model: 'sandbags',
  },
  wire: {
    id: 'wire', faction: 'new_antioch', kind: 'linear', nameKey: 'struct.wire',
    lore: { status: 'abstraction' },
    width: 3.4, minLen: 3, maxLen: 16, hp: 170, buildable: true, builder: 'new_antioch',
    costPerM: { material: 1.0 }, workPerM: 1.4, blocks: false, cover: null,
    // Not a wall: slows infantry. Heavy units push through more easily (data-driven).
    moveMultEnemy: 0.24, moveMultFriendly: 0.7, moveMultHeavy: 0.55, pathCostMult: 3.0,
    cat: 'defense',
    model: 'wire',
  },
  fire_post: {
    id: 'fire_post', faction: 'new_antioch', kind: 'building', nameKey: 'struct.fire_post',
    lore: { status: 'abstraction', ref: 'Fortified machine-gun position (WWI field fortification abstraction)' },
    footprint: { w: 5.5, d: 4.5 }, hp: 1500, blocks: true, vision: 54, buildable: true, builder: 'new_antioch',
    cost: { material: 90, manpower: 2 }, work: 70,
    weapon: 'fire_post_mg', arc: 150, crew: 2,
    cat: 'defense', heavyDefense: true,
    model: 'fire_post',
  },
  observation_post: {
    id: 'observation_post', faction: 'new_antioch', kind: 'building', nameKey: 'struct.observation_post',
    lore: { status: 'abstraction' },
    footprint: { w: 3.5, d: 3.5 }, hp: 520, blocks: true, vision: 96, buildable: true, builder: 'new_antioch',
    cost: { material: 60 }, work: 40,
    cat: 'support',
    flammable: true,
    model: 'obs_post',
  },
  supply_cache: {
    id: 'supply_cache', faction: 'new_antioch', kind: 'building', nameKey: 'struct.supply_cache',
    lore: { status: 'abstraction' },
    footprint: { w: 3.5, d: 2.5 }, hp: 420, blocks: true, vision: 20, buildable: true, builder: 'new_antioch',
    cost: { material: 50, supply: 40 }, work: 30, resupplyRadius: 24,
    cat: 'support',
    model: 'supply_cache',
  },
  // ---- Phase 2: New Antioch logistics / support buildings -------------------------------------
  aid_station: {
    id: 'aid_station', faction: 'new_antioch', kind: 'building', nameKey: 'struct.aid_station',
    lore: { status: 'abstraction', ref: 'New Antioch fields Combat Medics (official roster); the field dressing station building is a gameplay abstraction' },
    footprint: { w: 6, d: 5 }, hp: 700, blocks: true, vision: 26, buildable: true, builder: 'new_antioch',
    cost: { material: 70, supply: 30 }, work: 45,
    heal: { radius: 16, hpPerSec: 1.5, cureEveryTicks: 80 },
    cat: 'support',
    model: 'aid_station',
  },
  workshop: {
    id: 'workshop', faction: 'new_antioch', kind: 'building', nameKey: 'struct.workshop',
    lore: { status: 'canon-inspired', ref: 'New Antioch is described as an industrial fortress-city with workshops and foundries; this field workshop is a gameplay abstraction' },
    footprint: { w: 9, d: 7 }, hp: 1400, blocks: true, vision: 28, buildable: true, builder: 'new_antioch',
    cost: { material: 120, manpower: 2 }, work: 90, materialRate: 0.35,
    repairAura: { radius: 26, hpPerSec: 4 }, unlocks: ['fortified_wall'],
    cat: 'support', hub: true, fortAnchor: true, anchorRadius: 70,
    model: 'workshop',
  },
  ammo_dump: {
    id: 'ammo_dump', faction: 'new_antioch', kind: 'building', nameKey: 'struct.ammo_dump',
    lore: { status: 'abstraction', ref: 'Forward ammunition dump (WWI logistics abstraction)' },
    footprint: { w: 6, d: 4 }, hp: 600, blocks: true, vision: 22, buildable: true, builder: 'new_antioch',
    cost: { material: 80, supply: 60 }, work: 50, resupplyRadius: 38,
    explodes: { radius: 12, damage: 140, structureDamage: 300 },
    cat: 'support',
    model: 'ammo_dump',
  },
  signal_post: {
    id: 'signal_post', faction: 'new_antioch', kind: 'building', nameKey: 'struct.signal_post',
    lore: { status: 'abstraction', ref: 'New Antioch fields Observers (official roster) and artillery battalions (official lore); the signal post building is an abstraction' },
    footprint: { w: 3, d: 3 }, hp: 450, blocks: true, vision: 70, buildable: true, builder: 'new_antioch',
    cost: { material: 70, supply: 20 }, work: 40,
    support: { artillerySupport: 0.8 },
    cat: 'support',
    flammable: true,
    model: 'signal_post',
  },
  muster_point: {
    id: 'muster_point', faction: 'new_antioch', kind: 'building', nameKey: 'struct.muster_point',
    lore: { status: 'abstraction', ref: 'Forward barracks / muster point where replacements assemble (abstraction)' },
    footprint: { w: 8, d: 6 }, hp: 1000, blocks: true, vision: 30, buildable: true, builder: 'new_antioch',
    cost: { material: 100, supply: 40 }, work: 70,
    reinforceSource: true, reinforceRadius: 30, levy: { supply: 8, everyTicks: 300 },
    cat: 'support', fortAnchor: true, anchorRadius: 70, trainsSpec: { mech_heavy: 'na_mechanised' }, trains: ['mech_heavy'],
    model: 'muster_point',
  },
  // ---- Phase 2: New Antioch wall family (linear; segments leave room for a later gate system) ---
  low_sandbags: {
    id: 'low_sandbags', faction: 'new_antioch', kind: 'linear', nameKey: 'struct.low_sandbags',
    lore: { status: 'abstraction' },
    width: 0.8, minLen: 2, maxLen: 14, hp: 260, buildable: true, builder: 'new_antioch',
    costPerM: { material: 0.7 }, workPerM: 0.7, blocks: false, cover: 'low_wall', coverRadius: 1.6,
    moveMultEnemy: 0.75, moveMultFriendly: 0.85, pathCostMult: 1.3,
    cat: 'defense',
    model: 'low_sandbags',
  },
  breastwork: {
    id: 'breastwork', faction: 'new_antioch', kind: 'linear', nameKey: 'struct.breastwork',
    lore: { status: 'abstraction', ref: 'Timber-and-earth breastwork (field fortification abstraction)' },
    width: 1.8, minLen: 3, maxLen: 14, hp: 1400, buildable: true, builder: 'new_antioch',
    costPerM: { material: 0.6 }, workPerM: 3.2, blocks: false, cover: 'breastwork', coverRadius: 2.0,
    moveMultEnemy: 0.45, moveMultFriendly: 0.6, pathCostMult: 2.4, blastResist: 0.5,
    cat: 'defense', heavyDefense: true,
    flammable: true,
    model: 'breastwork',
  },
  timber_wall: {
    id: 'timber_wall', faction: 'new_antioch', kind: 'linear', nameKey: 'struct.timber_wall',
    lore: { status: 'abstraction', ref: 'Reinforced sandbag and timber revetment (abstraction)' },
    width: 1.2, minLen: 2, maxLen: 10, hp: 1100, buildable: true, builder: 'new_antioch',
    costPerM: { material: 3 }, workPerM: 2.4, blocks: false, cover: 'timber', coverRadius: 1.8,
    moveMultEnemy: 0.3, moveMultFriendly: 0.45, pathCostMult: 4,
    cat: 'defense', heavyDefense: true,
    flammable: true,
    model: 'timber_wall',
  },
  fortified_wall: {
    id: 'fortified_wall', faction: 'new_antioch', kind: 'linear', nameKey: 'struct.fortified_wall',
    lore: { status: 'abstraction', ref: 'Fortified wall section in the spirit of New Antioch\'s city walls (official lore: walled city); field version is an abstraction' },
    width: 1.6, minLen: 3, maxLen: 10, hp: 3600, buildable: true, builder: 'new_antioch',
    costPerM: { material: 6, supply: 1 }, workPerM: 6, blocks: true, cover: 'fortified', coverRadius: 2.0,
    requires: 'workshop', blastResist: 0.35,
    cat: 'defense', heavyDefense: true,
    model: 'fortified_wall',
  },
  // ---- Black Grail ------------------------------------------------------------------------------
  grail_altar: {
    id: 'grail_altar', faction: 'black_grail', kind: 'building', nameKey: 'struct.grail_altar',
    lore: { status: 'canon', ref: '"Altars of Beelzebub... constructed from the remains of their victims shaped into the form of monstrous flies" (official lore)' },
    footprint: { w: 10, d: 10 }, hp: 3600, blocks: true, vision: 46, buildable: true, builder: 'black_grail',
    cost: { biomass: 220 }, work: 110,
    trains: ['grail_thrall', 'corpse_guard', 'plague_knight', 'thrall_gang', 'herald', 'lord_of_tumours'], biomassRate: 0.14,
    infectionSource: { radius: 34, rate: 6 }, dropOff: true, hq: true,
    hub: true,
    model: 'grail_altar',
  },
  corpse_mound: {
    id: 'corpse_mound', faction: 'black_grail', kind: 'building', nameKey: 'struct.corpse_mound',
    lore: { status: 'abstraction', ref: 'Heaped dead gathered for the Grail\'s use; the Black Grail\'s use of corpses is canon, this structure is a gameplay abstraction' },
    footprint: { w: 7, d: 7 }, hp: 900, blocks: true, vision: 24, buildable: true, builder: 'black_grail',
    cost: { biomass: 60 }, work: 40, dropOff: true, harvestRadius: 22, harvestRate: 0.3,
    hub: true, trains: ['amalgam'],
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
  // ---- Phase 4: emplacements (data/emplacements.js) --------------------------------------------
  field_gun: {
    id: 'field_gun', faction: 'new_antioch', kind: 'building', nameKey: 'struct.field_gun',
    lore: { status: 'canon-inspired', ref: 'New Antioch foundries cast artillery (official lore); this field gun emplacement is a gameplay abstraction with no canon name' },
    footprint: { w: 6, d: 6 }, hp: 1500, blocks: true, vision: 44, buildable: true, builder: 'new_antioch',
    cost: { material: 110, supply: 90 }, work: 90, cat: 'defense', heavyDefense: true,
    // Phase 4.1: a narrower laid sector makes the placement direction matter; re-laying the gun
    // (REORIENT) costs material and takes it out of action for a while
    emplacement: 'field_gun_shell', arc: 120, crew: 3, blastResist: 0.25, relay: { material: 20, sec: 18 },
    model: 'field_gun',
  },
  viscera_nest: {
    id: 'viscera_nest', faction: 'black_grail', kind: 'building', nameKey: 'struct.viscera_nest',
    lore: { status: 'canon-inspired', ref: 'Built around the Viscera Cannon (official Black Grail heavy weapon); the organic gun nest is a gameplay abstraction' },
    footprint: { w: 5, d: 5 }, hp: 1100, blocks: true, vision: 40, buildable: true, builder: 'black_grail',
    cost: { biomass: 110 }, work: 70, cat: 'defense',
    emplacement: 'viscera_shot', arc: 360,
    organic: true, model: 'viscera_nest',
  },
  belcher_nest: {
    id: 'belcher_nest', faction: 'black_grail', kind: 'building', nameKey: 'struct.belcher_nest',
    lore: { status: 'canon-inspired', ref: 'Built around the Corruption Belcher (official battlekit glossary; faction attribution not verified); the organic nest is a gameplay abstraction' },
    footprint: { w: 4, d: 4 }, hp: 800, blocks: true, vision: 28, buildable: true, builder: 'black_grail',
    cost: { biomass: 70 }, work: 45, cat: 'defense',
    emplacement: 'belcher_gas', arc: 360,
    organic: true, model: 'belcher_nest',
  },
  // ---- Phase 05B: Iron Sultanate ---------------------------------------------------------------
  sultanate_citadel: {
    id: 'sultanate_citadel', faction: 'iron_sultanate', kind: 'building', nameKey: 'struct.sultanate_citadel',
    lore: { status: 'canon-inspired', ref: 'Compact Sultanate fortified command post; faction and fortress doctrine are canon, this RTS structure is an abstraction' },
    footprint: { w: 20, d: 16 }, hp: 7600, blocks: true, vision: 60, buildable: false,
    dropOff: true, resupplyRadius: 40, reinforceRadius: 42, reinforceSource: true,
    supplyRate: 0.5, materialRate: 0.22, manpowerRate: 0.025,
    trains: ['azeb', 'janissary', 'sultanate_sapper', 'jabirean_alchemist'], canBeObjective: true,
    hq: true, hub: true, fortAnchor: true, anchorRadius: 76, model: 'bastion',
  },
  sultanate_field_hq: {
    id: 'sultanate_field_hq', faction: 'iron_sultanate', kind: 'building', nameKey: 'struct.sultanate_field_hq',
    lore: { status: 'abstraction', ref: 'Mobile expeditionary command post for an attacking Sultanate force — gameplay abstraction' },
    footprint: { w: 14, d: 10 }, hp: 4800, blocks: true, vision: 52, buildable: false,
    dropOff: true, resupplyRadius: 36, reinforceRadius: 38, reinforceSource: true,
    supplyRate: 0.46, materialRate: 0.18, manpowerRate: 0.02,
    trains: ['azeb', 'janissary', 'sultanate_sapper', 'jabirean_alchemist'], canBeObjective: true,
    hq: true, hub: true, fortAnchor: true, anchorRadius: 68, model: 'depot',
  },
  sapper_post: {
    id: 'sapper_post', faction: 'iron_sultanate', kind: 'building', nameKey: 'struct.sapper_post',
    lore: { status: 'abstraction', ref: 'Forward sapper workshop and stores — gameplay abstraction using the canon Sultanate Sapper role' },
    footprint: { w: 9, d: 7 }, hp: 1500, blocks: true, vision: 30, buildable: true, builder: 'iron_sultanate',
    cost: { material: 110, supply: 30 }, work: 75, cat: 'support',
    materialRate: 0.18, supplyRate: 0.2, trains: ['sultanate_sapper'],
    hub: true, fortAnchor: true, anchorRadius: 58, model: 'workshop',
  },
  sultanate_redoubt: {
    id: 'sultanate_redoubt', faction: 'iron_sultanate', kind: 'building', nameKey: 'struct.sultanate_redoubt',
    lore: { status: 'abstraction', ref: 'Compact prepared strongpoint expressing Sultanate area-control doctrine — gameplay abstraction' },
    footprint: { w: 6, d: 6 }, hp: 2700, blocks: true, vision: 58, buildable: true, builder: 'iron_sultanate',
    cost: { material: 135, supply: 35 }, work: 90, cat: 'defense', heavyDefense: true,
    weapon: 'pillbox_mg', arc: 220, crew: 2, blastResist: 0.45, model: 'pillbox',
  },
  sultanate_bulwark: {
    id: 'sultanate_bulwark', faction: 'iron_sultanate', kind: 'linear', nameKey: 'struct.sultanate_bulwark',
    lore: { status: 'abstraction', ref: 'Field-sized modular fortification; not the Great Iron Wall itself' },
    width: 1.5, minLen: 3, maxLen: 12, hp: 2300, buildable: true, builder: 'iron_sultanate',
    costPerM: { material: 4.2, supply: 0.5 }, workPerM: 4.7, blocks: false,
    cover: 'fortified', coverRadius: 2, moveMultEnemy: 0.35, moveMultFriendly: 0.55, pathCostMult: 3.5,
    cat: 'defense', heavyDefense: true, blastResist: 0.4, model: 'fortified_wall',
  },
  iron_wall_section: {
    id: 'iron_wall_section', faction: 'scenario', kind: 'linear', nameKey: 'struct.iron_wall_section',
    lore: { status: 'canon-inspired', ref: 'A local battlefield sector inspired by the canon Great Iron Wall; scale and segment behaviour are RTS abstractions' },
    width: 2.4, minLen: 4, maxLen: 40, hp: 6200, buildable: false, workPerM: 0,
    blocks: true, cover: 'fortified', coverRadius: 2.6, blastResist: 0.3,
    scenarioFeature: { family: 'iron_wall', segment: true, gateReady: true, destructible: true },
    model: 'fortified_wall',
  },
  // ---- Phase 4: ruin garrisons (neutral map features, occupied by whoever holds them) -----------
  // The walls are the unique world mesh (render/models/structures.js buildRuin); these records carry
  // hit points, occupancy and the garrison rules. Geometry: world/ruin_geometry.js.
  ruin_house: {
    id: 'ruin_house', faction: 'neutral', kind: 'building', nameKey: 'struct.ruin_house',
    lore: { status: 'abstraction', ref: 'Shell-shattered houses of the war-torn front (setting flavour); garrison rules are a gameplay abstraction' },
    footprint: { w: 10, d: 8.5 }, hp: 900, blocks: false, vision: 30, buildable: false,
    garrison: { cover: 'garrison', blastTaken: 0.9, flameTaken: 1.3, heavyCoverMult: 0.5, collapseKill: 0.35, suppressSec: 8 },
    repairable: true, model: null,
  },
  ruin_chapel: {
    id: 'ruin_chapel', faction: 'neutral', kind: 'building', nameKey: 'struct.ruin_chapel',
    lore: { status: 'abstraction', ref: 'Ruined chapel in no man\'s land (setting flavour); garrison rules are a gameplay abstraction' },
    footprint: { w: 14, d: 9 }, hp: 1400, blocks: false, vision: 34, buildable: false,
    garrison: { cover: 'garrison', blastTaken: 0.85, flameTaken: 1.3, heavyCoverMult: 0.5, collapseKill: 0.35, suppressSec: 8 },
    repairable: true, model: null,
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
