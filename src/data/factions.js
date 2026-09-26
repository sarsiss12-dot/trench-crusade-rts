// Faction definitions. Factions are generic in architecture; asymmetry lives in the data +
// the faction logic module (economy / production / abilities) + the faction AI module.

export const FACTION_ORDER = ['new_antioch', 'black_grail'];

export const FACTIONS = {
  new_antioch: {
    id: 'new_antioch', index: 0, nameKey: 'faction.new_antioch',
    lore: { status: 'canon', ref: 'The Principality of New Antioch — fortress-city, "the Sword and the Shield of Europa and Africa"' },
    // Muted accent colors for UI / banners / rings (never full-body team paint).
    accent: [0.79, 0.7, 0.5], uiColor: '#c8b07a',
    economy: 'logistics', logic: 'new_antioch', ai: 'new_antioch',
    resources: ['material', 'supply', 'manpower', 'food'],
    buildList: ['trench', 'sandbags', 'wire', 'fire_post', 'observation_post', 'supply_cache'],
    abilities: ['artillery_barrage'],
    usesAmmo: true,
    terrainSpeed: {},
  },
  black_grail: {
    id: 'black_grail', index: 1, nameKey: 'faction.black_grail',
    lore: { status: 'canon', ref: 'Cult of the Black Grail — Beelzebub, plague, flies, reanimated infected dead' },
    accent: [0.6, 0.63, 0.35], uiColor: '#9aa15c',
    economy: 'plague', logic: 'black_grail', ai: 'black_grail',
    resources: ['biomass'],
    buildList: [],
    abilities: ['fly_swarm'],
    usesAmmo: false,
    terrainSpeed: { infected: 1.15 },
    // canon: infected corpses "lurch to their feet"; numbers are gameplay tuning
    reanimation: { searchRadius: 26, clusterRadius: 16, minBodies: 4, maxBodies: 8, delaySeconds: 7, loneRiseTicks: 800, chance: 0.6, unit: 'grail_thrall' },
    harvest: { radius: 5.5, ratePerSecond: 1.2, perCorpse: 6 },
  },
};

export function factionDef(id) {
  const d = FACTIONS[id];
  if (!d) throw new Error('Unknown faction: ' + id);
  return d;
}

export function areHostile(a, b) {
  return a !== b && a !== 'neutral' && b !== 'neutral';
}
