// Faction definitions. Factions are generic in architecture; asymmetry lives in the data +
// the faction logic module (economy / production / abilities) + the faction AI module.
//
// Phase 5A — FACTION vs SIDE vs ROLE (see docs/ARCHITECTURE.md):
//  - FACTION (this file): WHO you are — units, structures, resources, economy, elites,
//    specialities, visuals, audio, AI doctrine. Never a battle role.
//  - SIDE: WHICH match participant you are. Everything that is OWNED (squads, structures,
//    resources, fog, pestilence meter, AI memory) is keyed by the side id. A side id is the
//    faction id for the first side of that faction and "<faction>~2" for a mirror-match twin, so
//    the content faction of any owner is a pure function of its id (baseFaction) and hostility
//    (areHostile) is simply "different side".
//  - ROLE (attacker / defender): only the starting strategic position (scenario data).

export const FACTION_ORDER = ['new_antioch', 'black_grail', 'iron_sultanate'];

export const FACTIONS = {
  new_antioch: {
    id: 'new_antioch', index: 0, nameKey: 'faction.new_antioch',
    lore: { status: 'canon', ref: 'The Principality of New Antioch — fortress-city, "the Sword and the Shield of Europa and Africa"' },
    // Muted accent colors for UI / banners / rings (never full-body team paint).
    accent: [0.79, 0.7, 0.5], uiColor: '#c8b07a',
    economy: 'logistics', logic: 'new_antioch', ai: 'new_antioch',
    resources: ['material', 'supply', 'manpower', 'food'],
    buildList: [
      'trench', 'low_sandbags', 'sandbags', 'breastwork', 'timber_wall', 'fortified_wall', 'wire', 'fire_post', 'pillbox', 'field_gun',
      'settlement', 'farm', 'livestock_pen', 'quarry', 'supply_depot',
      'observation_post', 'signal_post', 'supply_cache', 'ammo_dump', 'aid_station', 'workshop', 'muster_point',
    ],
    buildTabs: ['defense', 'economy', 'support'],
    abilities: ['artillery_barrage', 'mortar_barrage', 'purge'],
    // Phase 3: expansion economy (population / manpower / settlements / convoys: economy/settlements.js)
    population: true,
    usesAmmo: true,
    // replacements walk from a reinforcement source to the depleted squad (see factions/new_antioch.js)
    // autoReserve (Phase 4.1): positional AUTO reinforcement never spends the last supply —
    // ammunition and fire support come first (manual REINFORCE may dig into it)
    reinforcements: { manpower: 1, supply: 6, intervalTicks: 30, autoReserve: { supply: 45 } },
    // HOME: the living HQ (then the anchor), z offset toward the front so the view shows the line
    // HOME / HQ capability: the structure types that are this faction's headquarters (victory and
    // HOME focus go through STRUCTURES[type].hq, never through names)
    home: { hq: ['bastion', 'field_hq'], front: -38 },
    terrainSpeed: {},
    // Phase 5A match setup card (gameplay description, not a lore claim)
    card: { icon: 'cross', identityKey: 'setup.na.identity', economyKey: 'setup.na.economy', styleKey: 'setup.na.style' },
    visual: { organic: false }, // presentation: human blood / impacts
    // development stress benchmark composition (sim/scenario.js buildStressForces): fixed squads
    // per N soldiers, then the fill unit
    stress: { fixed: [{ unit: 'mech_heavy', per: 80 }], fill: 'yeoman_rifle' },
  },
  black_grail: {
    id: 'black_grail', index: 1, nameKey: 'faction.black_grail',
    lore: { status: 'canon', ref: 'Cult of the Black Grail — Beelzebub, plague, flies, reanimated infected dead' },
    accent: [0.6, 0.63, 0.35], uiColor: '#9aa15c',
    economy: 'plague', logic: 'black_grail', ai: 'black_grail',
    resources: ['biomass'],
    // organic growth raised by Thrall work-gangs (never a human building chain)
    buildList: ['corpse_mound', 'plague_pit', 'fly_nest', 'bone_barricade', 'viscera_nest', 'belcher_nest', 'grail_altar'],
    abilities: ['fly_swarm', 'great_pestilence', 'black_tide'],
    // Phase 3: faction-wide plague momentum meter (factions/pestilence.js), separate from biomass
    pestilence: true,
    usesAmmo: false,
    reinforcements: null,
    home: { hq: ['grail_altar'], front: 32 },
    // Black Grail may also raise structures on ground its plague already holds (infection >= value)
    buildOnInfection: 100,
    terrainSpeed: { infected: 1.15 },
    // canon: infected corpses "lurch to their feet"; numbers are gameplay tuning
    reanimation: { searchRadius: 26, clusterRadius: 16, minBodies: 4, maxBodies: 8, delaySeconds: 7, loneRiseTicks: 800, chance: 0.6, unit: 'grail_thrall', blessSec: 6 },
    harvest: { radius: 5.5, ratePerSecond: 1.2, perCorpse: 6 },
    // the faction's own soldiers cannot be infected / wounded (hollowed husks, plague-bearers);
    // production EMERGES from the ground; organic impacts / bio visuals
    plagueImmune: true, noWounded: true, emergingProduction: true,
    card: { icon: 'grail', identityKey: 'setup.bg.identity', economyKey: 'setup.bg.economy', styleKey: 'setup.bg.style' },
    visual: { organic: true },
    hudResources: ['biomass', 'corpses'], prepHintKey: 'hud.prep_hint_bg', // HUD presentation
    stress: { fixed: [{ unit: 'plague_knight', per: 60 }, { unit: 'corpse_guard', per: 45 }], fill: 'grail_thrall', tail: 'corpse_guard' },
  },
  iron_sultanate: {
    id: 'iron_sultanate', index: 2, nameKey: 'faction.iron_sultanate',
    lore: { status: 'canon', ref: 'The Iron Sultanate — an independent power protected by the Great Iron Wall; Azebs, Janissaries, Sappers and Jabirean Alchemists are official roster names' },
    accent: [0.66, 0.38, 0.2], uiColor: '#a86134',
    economy: 'compact_fortress', logic: 'iron_sultanate', ai: 'iron_sultanate',
    resources: ['material', 'supply', 'manpower'],
    buildList: ['sultanate_bulwark', 'sultanate_redoubt', 'sapper_post'],
    buildTabs: ['defense', 'support'],
    abilities: [],
    usesAmmo: true,
    reinforcements: { manpower: 1, supply: 5, intervalTicks: 34, autoReserve: { supply: 40 } },
    home: { hq: ['sultanate_citadel', 'sultanate_field_hq'], front: -28 },
    terrainSpeed: {},
    card: { icon: 'sultanate', identityKey: 'setup.is.identity', economyKey: 'setup.is.economy', styleKey: 'setup.is.style' },
    visual: { organic: false },
    prepHintKey: 'hud.prep_hint_is',
    stress: { fixed: [{ unit: 'janissary', per: 55 }, { unit: 'jabirean_alchemist', per: 90 }], fill: 'azeb' },
  },
};

// Factions that are PLANNED but not implemented: shown locked ("coming soon") in Match Setup.
// No data, no fake implementation — adding one means adding its full FACTIONS entry + content.
export const PLANNED_FACTIONS = [
  { id: 'heretic_legion', nameKey: 'faction.heretic_legion', icon: 'lock', phase: '05C' },
];

// ------------------------------------------------------------------ side helpers (pure)

export const SIDE_SEP = '~';
// fog / visibility layers: one per faction index slot (a mirror twin takes the other free slot)
export const FOG_LAYERS = FACTION_ORDER.length;
const BASE = new Map();
const INDEX = new Map();

/** Content faction of an owner id ('new_antioch~2' -> 'new_antioch'); 'neutral' stays itself. */
export function baseFaction(side) {
  let b = BASE.get(side);
  if (b === undefined) {
    const i = typeof side === 'string' ? side.indexOf(SIDE_SEP) : -1;
    b = i < 0 ? side : side.slice(0, i);
    BASE.set(side, b);
  }
  return b;
}

/** The faction definition of an owner (null for neutral / unknown). */
export function sideDef(side) {
  return FACTIONS[baseFaction(side)] || null;
}

/** Is this owner of the given content faction? */
export function isKind(side, fid) {
  return baseFaction(side) === fid;
}

/** Mirror twin id: the n-th side (n >= 2) of the same faction in one match. */
export function mirrorSideId(fid, n) {
  return n <= 1 ? fid : fid + SIDE_SEP + n;
}

/**
 * Fog / visibility layer of an owner: the faction's index for its first side; a mirror twin
 * takes the lowest index its base faction does not use. -1 for neutral / unknown. Pure.
 */
export function sideIndex(side) {
  let j = INDEX.get(side);
  if (j === undefined) {
    const d = sideDef(side);
    if (!d) j = -1;
    else if (baseFaction(side) === side) j = d.index;
    else { j = 0; while (j === d.index) j++; }
    INDEX.set(side, j);
  }
  return j;
}

/** Visibility bit of an owner (0 for neutral / unknown). */
export function sideBit(side) {
  const j = sideIndex(side);
  return j < 0 ? 0 : 1 << j;
}

/** Terrain / content index (per FACTION, e.g. nav terrain speed tables). */
export function contentIndex(side) {
  const d = sideDef(side);
  return d ? d.index : 0;
}

export function factionDef(id) {
  const d = FACTIONS[id];
  if (!d) throw new Error('Unknown faction: ' + id);
  return d;
}

/** Presentation: organic (Grail-like) visuals / impacts / sound for this owner. */
export function isOrganic(side) {
  const d = sideDef(side);
  return !!(d && d.visual && d.visual.organic);
}

/** Soldiers of this owner never carry infection stacks (faction data). */
export function isPlagueImmune(side) {
  const d = sideDef(side);
  return !!(d && d.plagueImmune);
}

/** Mirror twin ("<faction>~2")? */
export function isTwin(side) {
  return typeof side === 'string' && side.indexOf(SIDE_SEP) >= 0;
}

/** Hostility is between SIDES (a mirror twin is an enemy); neutral is nobody's enemy. */
export function areHostile(a, b) {
  return a !== b && a !== 'neutral' && b !== 'neutral';
}
