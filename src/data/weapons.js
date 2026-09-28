// Weapon definitions. Times are in seconds, distances in meters.
// kind: rifle | shotgun | mg | melee
// accNear/accFar: hit chance at close range / max range (before cover & modifiers).
// structureMult: damage multiplier vs structures. infect: Black Grail infection stacks per hit.
// muzzle/tracer/sound/impact: presentation hints consumed by render/audio (no gameplay effect).

export const WEAPONS = {
  // Phase 4.1: Sniper Priest — very long range, heavy single shots, slow to reload
  sniper_rifle: {
    id: 'sniper_rifle', kind: 'rifle', range: 72, damage: 95, reload: 6.5, reloadJitter: 0.1,
    accNear: 0.9, accFar: 0.72, fireWhileMoving: false, structureMult: 0.05, ammoPerShot: 1,
    muzzle: 'rifle', tracer: 'rifle', sound: 'rifle', impact: 'bullet',
    lore: { status: 'canon-inspired', note: 'Sniper Priest rifle (official elite); numbers are abstractions' },
  },
  bolt_rifle: {
    id: 'bolt_rifle', kind: 'rifle', range: 50, damage: 40, reload: 2.6, reloadJitter: 0.35,
    accNear: 0.72, accFar: 0.28, fireWhileMoving: false, structureMult: 0.08, ammoPerShot: 1,
    muzzle: 'rifle', tracer: 'rifle', sound: 'rifle', impact: 'bullet',
    lore: { status: 'canon', note: 'Yeoman (Rifle): bolt-action rifle + bayonet' },
  },
  auto_shotgun: {
    id: 'auto_shotgun', kind: 'shotgun', range: 24, damage: 30, reload: 1.3, reloadJitter: 0.3,
    burst: 2, burstInterval: 0.28, accNear: 0.78, accFar: 0.34, fireWhileMoving: true, structureMult: 0.05,
    ammoPerShot: 1, muzzle: 'shotgun', tracer: 'pellet', sound: 'shotgun', impact: 'pellet',
    lore: { status: 'canon', note: 'Combat Engineer: automatic shotgun' },
  },
  heavy_mg: {
    id: 'heavy_mg', kind: 'mg', range: 58, damage: 18, reload: 2.2, reloadJitter: 0.25,
    burst: 7, burstInterval: 0.09, accNear: 0.55, accFar: 0.2, fireWhileMoving: false, structureMult: 0.12, antiGarrison: 1,
    ammoPerShot: 1, muzzle: 'mg', tracer: 'mg', sound: 'mg', impact: 'bullet',
    lore: { status: 'canon', note: 'Mechanised Heavy Infantry: machine gun' },
  },
  fire_post_mg: {
    id: 'fire_post_mg', kind: 'mg', range: 72, damage: 20, reload: 2.0, reloadJitter: 0.2,
    burst: 9, burstInterval: 0.085, accNear: 0.6, accFar: 0.22, fireWhileMoving: false, structureMult: 0.1,
    ammoPerShot: 1, muzzle: 'mg', tracer: 'mg', sound: 'mg_heavy', impact: 'bullet',
    lore: { status: 'abstraction', note: 'Fortified fire position weapon (gameplay abstraction)' },
  },
  infested_rifle: {
    id: 'infested_rifle', kind: 'rifle', range: 44, damage: 34, reload: 3.0, reloadJitter: 0.4,
    accNear: 0.62, accFar: 0.24, fireWhileMoving: false, structureMult: 0.08, ammoPerShot: 0, infect: 1,
    muzzle: 'rifle_bio', tracer: 'bio', sound: 'rifle_bio', impact: 'bullet',
    lore: { status: 'canon', note: 'Infested Rifle — Black Grail armoury' },
  },
  thrall_claws: {
    id: 'thrall_claws', kind: 'melee', range: 1.7, damage: 20, reload: 1.25, reloadJitter: 0.3,
    acc: 0.72, infect: 1, structureMult: 0.55, sound: 'claw', impact: 'claw',
    lore: { status: 'canon', note: 'Grail Thralls make melee attacks without weapons' },
  },
  plague_blade: {
    id: 'plague_blade', kind: 'melee', range: 1.9, damage: 38, reload: 1.4, reloadJitter: 0.25,
    acc: 0.75, infect: 1, structureMult: 0.8, sound: 'blade', impact: 'blade',
    lore: { status: 'canon', note: 'Plague Blade — Black Grail armoury' },
  },
  plague_greatblade: {
    id: 'plague_greatblade', kind: 'melee', range: 2.3, damage: 72, reload: 1.9, reloadJitter: 0.2,
    acc: 0.78, infect: 2, structureMult: 2.2, cleave: 2, sound: 'heavy_blade', impact: 'blade',
    lore: { status: 'canon-inspired', note: 'Two-handed plague blade for Plague Knights (loadout abstraction)' },
  },
  bayonet: {
    id: 'bayonet', kind: 'melee', range: 1.9, damage: 32, reload: 1.5, reloadJitter: 0.3,
    acc: 0.68, structureMult: 0.2, sound: 'bayonet', impact: 'blade',
    lore: { status: 'canon', note: 'Yeoman bayonet' },
  },
  entrenching_tool: {
    id: 'entrenching_tool', kind: 'melee', range: 1.7, damage: 26, reload: 1.4, reloadJitter: 0.3,
    acc: 0.65, structureMult: 0.3, sound: 'blunt', impact: 'blunt',
    lore: { status: 'abstraction', note: 'Engineer shovel used in melee' },
  },
  great_hammer: {
    id: 'great_hammer', kind: 'melee', range: 2.2, damage: 80, reload: 2.1, reloadJitter: 0.2,
    acc: 0.75, structureMult: 1.6, cleave: 2, sound: 'hammer', impact: 'blunt',
    lore: { status: 'canon', note: 'Mechanised Heavy Infantry: great hammer' },
  },
  // ---- Phase 3 --------------------------------------------------------------------------------
  service_pistol: {
    id: 'service_pistol', kind: 'rifle', range: 26, damage: 22, reload: 1.6, reloadJitter: 0.3,
    accNear: 0.62, accFar: 0.25, fireWhileMoving: true, structureMult: 0.04, ammoPerShot: 1,
    muzzle: 'rifle', tracer: 'rifle', sound: 'pistol', impact: 'bullet',
    lore: { status: 'abstraction', note: 'Sidearm for medics / clerics (loadout abstraction)' },
  },
  smg: {
    id: 'smg', kind: 'rifle', range: 32, damage: 15, reload: 1.4, reloadJitter: 0.25,
    burst: 4, burstInterval: 0.09, accNear: 0.6, accFar: 0.2, fireWhileMoving: true, structureMult: 0.05, ammoPerShot: 1,
    muzzle: 'rifle', tracer: 'mg', sound: 'smg', impact: 'bullet',
    lore: { status: 'canon', note: 'Submachine gun — New Antioch armoury' },
  },
  // Flamethrower: short range, fuel-hungry, every gout burns everything around the aim point —
  // soldiers (burning), corpses (cremated: they will not rise), infected ground (scoured) and
  // organic / timber structures. The counter to Thrall swarms and the plague, not a cheap spam.
  flamethrower: {
    id: 'flamethrower', kind: 'flame', range: 13, damage: 30, reload: 1.15, reloadJitter: 0.15,
    accNear: 1, accFar: 1, fireWhileMoving: false, structureMult: 0.6, ammoPerShot: 1, fuel: 3,
    splash: 2.6, burnSec: 3, burnDps: 7, corpseBurnR: 2.8, cleanse: 70,
    organicMult: 3, timberMult: 2,
    muzzle: 'flame', tracer: 'flame', sound: 'flame', impact: 'fire',
    lore: { status: 'canon', note: 'Flamethrower — New Antioch armoury (official rules)' },
  },
  trench_club: {
    id: 'trench_club', kind: 'melee', range: 1.8, damage: 34, reload: 1.5, reloadJitter: 0.3,
    acc: 0.7, structureMult: 0.3, sound: 'blunt', impact: 'blunt',
    lore: { status: 'canon', note: 'Trench club — New Antioch armoury' },
  },
  amalgam_maul: {
    id: 'amalgam_maul', kind: 'melee', range: 2.8, damage: 95, reload: 2.4, reloadJitter: 0.2,
    acc: 0.8, infect: 1, structureMult: 3, cleave: 3, sound: 'hammer', impact: 'blunt',
    lore: { status: 'abstraction', note: 'Fused limbs of an Amalgam (abstraction)' },
  },
  tumour_blade: {
    id: 'tumour_blade', kind: 'melee', range: 2.4, damage: 70, reload: 1.7, reloadJitter: 0.2,
    acc: 0.8, infect: 2, structureMult: 1.6, cleave: 2, sound: 'heavy_blade', impact: 'blade',
    lore: { status: 'abstraction', note: 'Lord of Tumours blade (loadout abstraction)' },
  },
  pillbox_mg: {
    id: 'pillbox_mg', kind: 'mg', range: 76, damage: 22, reload: 2.0, reloadJitter: 0.2,
    burst: 10, burstInterval: 0.08, accNear: 0.62, accFar: 0.22, fireWhileMoving: false, structureMult: 0.1,
    ammoPerShot: 1, muzzle: 'mg', tracer: 'mg', sound: 'mg_heavy', impact: 'bullet',
    lore: { status: 'abstraction', note: 'Concrete machine-gun bunker (WWI fortification abstraction)' },
  },
  settlement_mg: {
    id: 'settlement_mg', kind: 'mg', range: 52, damage: 17, reload: 2.4, reloadJitter: 0.25,
    burst: 6, burstInterval: 0.1, accNear: 0.52, accFar: 0.2, fireWhileMoving: false, structureMult: 0.1,
    ammoPerShot: 1, muzzle: 'mg', tracer: 'mg', sound: 'mg', impact: 'bullet',
    lore: { status: 'abstraction', note: 'Settlement militia machine gun (Fortified Settlements speciality)' },
  },
};
