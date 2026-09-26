// Terrain type definitions (data-driven). Index in TERRAIN_TYPES == value stored in terrain grid.
// speed: movement multiplier (0 = impassable). cover: cover type id (see cover.js).
// conceal: 0..1 reduces enemy detection range for units standing here.
// color: base albedo used by renderer + minimap. wet: 0..1 wetness (mud sheen) for rendering.

export const TERRAIN = Object.freeze({
  EARTH: 0,
  MUD: 1,
  GRASS: 2,
  FOREST: 3,
  SHALLOW: 4,
  DEEP: 5,
  ROCK: 6,
  ROAD: 7,
  RUBBLE: 8,
  INFECTED: 9,
  FIELD: 10,
  BRIDGE: 11,
});

export const TERRAIN_TYPES = [
  { id: 'earth', key: 'terrain.earth', speed: 1.0, cover: null, conceal: 0, color: [0.35, 0.3, 0.235], wet: 0.12 },
  { id: 'mud', key: 'terrain.mud', speed: 0.6, cover: null, conceal: 0, color: [0.235, 0.19, 0.135], wet: 0.9 },
  { id: 'grass', key: 'terrain.grass', speed: 1.0, cover: null, conceal: 0, color: [0.36, 0.345, 0.235], wet: 0.08 },
  { id: 'forest', key: 'terrain.forest', speed: 0.8, cover: 'forest', conceal: 0.5, color: [0.235, 0.2, 0.15], wet: 0.3 },
  { id: 'shallow', key: 'terrain.shallow', speed: 0.45, cover: null, conceal: 0, color: [0.23, 0.215, 0.17], wet: 1.0, water: true },
  { id: 'deep', key: 'terrain.deep', speed: 0, cover: null, conceal: 0, color: [0.13, 0.125, 0.11], wet: 1.0, water: true },
  { id: 'rock', key: 'terrain.rock', speed: 0, cover: null, conceal: 0, color: [0.36, 0.345, 0.32], wet: 0.05 },
  { id: 'road', key: 'terrain.road', speed: 1.1, cover: null, conceal: 0, color: [0.37, 0.335, 0.285], wet: 0.35 },
  { id: 'rubble', key: 'terrain.rubble', speed: 0.75, cover: 'ruins', conceal: 0.2, color: [0.34, 0.31, 0.275], wet: 0.1 },
  { id: 'infected', key: 'terrain.infected', speed: 0.9, cover: null, conceal: 0, color: [0.2, 0.155, 0.16], wet: 0.65 },
  { id: 'field', key: 'terrain.field', speed: 0.85, cover: null, conceal: 0.1, color: [0.3, 0.245, 0.17], wet: 0.25 },
  { id: 'bridge', key: 'terrain.bridge', speed: 1.0, cover: null, conceal: 0, color: [0.4, 0.38, 0.35], wet: 0.1 },
];

export function terrainSpeed(type) {
  return TERRAIN_TYPES[type].speed;
}
