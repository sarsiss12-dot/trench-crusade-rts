// STARTING PACKAGES (Phase 5A): what a side starts a match with — structures, forces,
// resources — chosen by FACTION + BATTLE ROLE (+ the scenario, which picks the region and may add
// its own features). Faction identity stays intact: a New Antioch attacker is still engineers,
// logistics and settlements (from a forward field headquarters); a Black Grail defender is still
// altars, corpses and biomass (an organic home, never a bunker economy).
//
// Coordinates are authored for ONE region of the siege map ('authored'); a side placed in the other
// region gets them point-reflected (sim/sides.js). `primary: true` marks the side's primary HQ —
// the one a siege scenario turns into the defender's objective. Force anchors are the region's
// generic anchor names (line / base / reserve / mass / support / elite).
// Numbers are gameplay tuning (abstraction), not lore.
const PI = 3.141592653589793;

export const PACKAGES = {
  new_antioch: {
    // the classic fortress: bastion, depot, fields, a pre-dug line
    defender: {
      authored: 'south',
      resources: { material: 280, supply: 320, manpower: 24, food: 100 },
      population: 40,
      structures: [
        { type: 'bastion', x: 160, z: 524, rot: PI, primary: true },
        { type: 'supply_depot', x: 100, z: 550, rot: PI },
        { type: 'field', x: 50, z: 534, rot: 0 },
        { type: 'field', x: 268, z: 536, rot: 0 },
        { type: 'trench', x1: 136, z1: 477, x2: 150, z2: 475 },
        { type: 'trench', x1: 150, z1: 475, x2: 164, z2: 475 },
        { type: 'trench', x1: 164, z1: 475, x2: 178, z2: 477 },
      ],
      forces: [
        { unit: 'yeoman_rifle', anchor: 'line', count: 6 },
        { unit: 'combat_engineer', anchor: 'base', count: 2 },
        { unit: 'mech_heavy', anchor: 'reserve', count: 1 },
      ],
    },
    // an expeditionary force: a forward field headquarters, its supply dump, one requisitioned field
    // and a short dug-in line — no fortress-city behind it (smaller population); it has to take
    // ground and settle as it advances
    attacker: {
      authored: 'south',
      resources: { material: 260, supply: 360, manpower: 24, food: 90 },
      population: 26,
      structures: [
        { type: 'field_hq', x: 160, z: 514, rot: PI, primary: true },
        { type: 'supply_depot', x: 100, z: 550, rot: PI },
        { type: 'field', x: 50, z: 534, rot: 0 },
        { type: 'trench', x1: 146, z1: 490, x2: 160, z2: 489 },
        { type: 'trench', x1: 160, z1: 489, x2: 174, z2: 490 },
      ],
      forces: [
        { unit: 'yeoman_rifle', anchor: 'line', count: 6 },
        { unit: 'combat_engineer', anchor: 'base', count: 2 },
        { unit: 'mech_heavy', anchor: 'reserve', count: 1 },
      ],
    },
  },
  black_grail: {
    // the classic assault: three altars on rotten ground, a forward corpse mound, the horde massing
    attacker: {
      authored: 'north',
      resources: { biomass: 110 },
      structures: [
        { type: 'grail_altar', x: 95, z: 58, rot: 0.3 },
        { type: 'grail_altar', x: 162, z: 40, rot: 0.0, primary: true },
        { type: 'grail_altar', x: 232, z: 62, rot: -0.4 },
        { type: 'corpse_mound', x: 160, z: 176, rot: 0 },
      ],
      forces: [
        { unit: 'grail_thrall', anchor: 'mass', count: 7 },
        { unit: 'corpse_guard', anchor: 'support', count: 2 },
        { unit: 'plague_knight', anchor: 'elite', count: 2 },
      ],
    },
    // an organic home: altars close together, a corpse mound and a viscera nest covering them, the
    // horde held back as a garrison (still a biomass / forage / plague economy)
    defender: {
      authored: 'south',
      resources: { biomass: 140 },
      structures: [
        { type: 'grail_altar', x: 88, z: 528, rot: 0 },
        { type: 'grail_altar', x: 160, z: 530, rot: PI, primary: true },
        { type: 'grail_altar', x: 262, z: 502, rot: 0.2 },
        { type: 'corpse_mound', x: 160, z: 462, rot: 0 },
        { type: 'viscera_nest', x: 140, z: 470, rot: PI },
      ],
      forces: [
        { unit: 'grail_thrall', anchor: 'line', count: 5 },
        { unit: 'corpse_guard', anchor: 'base', count: 3 },
        { unit: 'plague_knight', anchor: 'reserve', count: 2 },
      ],
    },
  },
};

export function startingPackage(fid, role) {
  const byRole = PACKAGES[fid];
  if (!byRole || !byRole[role]) throw new Error('No starting package for ' + fid + ' / ' + role);
  return byRole[role];
}
