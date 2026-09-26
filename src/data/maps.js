// Map layout definitions. The generator (world/mapgen.js) turns a layout + seed into terrain.
// Coordinates in meters. x: west->east, z: north(0)->south(H). New Antioch holds the south,
// Black Grail approaches from the north. Regions (north->south):
//   BLACK GRAIL APPROACH -> FORESTS/CRATERS/MUD -> RIVER/CROSSINGS -> NO MAN'S LAND
//   -> OUTSKIRTS/RUINS -> NEW ANTIOCH DEFENSIVE AREA

export const MAPS = {
  antioch_outskirts: {
    id: 'antioch_outskirts', nameKey: 'map.antioch_outskirts',
    width: 320, height: 576, cell: 2,
    waterLevel: -0.55,
    bands: {
      bgApproach: [0, 110],
      forest: [110, 240],
      river: [240, 290],
      noMansLand: [290, 400],
      ruins: [400, 470],
      naArea: [470, 576],
    },
    edges: { ridgeWidth: 20, ridgeHeight: 13, roadGaps: [[150, 170]] },
    river: {
      baseZ: 262, amp1: 10, freq1: 0.021, phase1: 1.3, amp2: 5, freq2: 0.053, phase2: 0.4,
      halfWidth: 11, halfWidthVar: 2, deep: -3.2, bankWidth: 7,
      fords: [
        { x0: 60, x1: 84, depth: -0.9 },
        { x0: 236, x1: 260, depth: -0.9 },
      ],
      bridges: [{ x: 162, width: 9 }],
    },
    roads: [
      { width: 3.2, points: [[158, 0], [161, 60], [160, 150], [163, 220], [162, 262], [160, 320], [160, 400], [160, 470], [160, 509]] },
      { width: 2.6, points: [[30, 504], [100, 506], [160, 509], [220, 506], [290, 503]] },
      { width: 2.2, points: [[100, 506], [100, 540]] },
    ],
    forests: [
      { x: 58, z: 188, r: 34, density: 0.028 },
      { x: 252, z: 176, r: 38, density: 0.028 },
      { x: 150, z: 214, r: 20, density: 0.018 },
      { x: 110, z: 138, r: 22, density: 0.022 },
      { x: 212, z: 110, r: 18, density: 0.02 },
      { x: 34, z: 330, r: 16, density: 0.014 },
      { x: 292, z: 312, r: 18, density: 0.014 },
    ],
    craterBands: [
      { z0: 110, z1: 240, count: 42, rMin: 2.4, rMax: 6.5 },
      { z0: 290, z1: 400, count: 70, rMin: 2.2, rMax: 7.5 },
      { z0: 400, z1: 462, count: 14, rMin: 2.0, rMax: 5.0 },
      { z0: 20, z1: 110, count: 12, rMin: 2.0, rMax: 5.0 },
    ],
    mud: { z0: 120, z1: 400, threshold: 0.58, riverBoost: 0.22 },
    infected: [
      { x: 95, z: 58, r: 42 },
      { x: 162, z: 42, r: 46 },
      { x: 232, z: 62, r: 42 },
    ],
    ruins: [
      { x: 70, z: 430, w: 11, d: 9, rot: 0.2, kind: 'house' },
      { x: 96, z: 414, w: 9, d: 8, rot: -0.3, kind: 'house' },
      { x: 128, z: 440, w: 12, d: 8, rot: 0.05, kind: 'house' },
      { x: 196, z: 424, w: 10, d: 9, rot: 0.4, kind: 'house' },
      { x: 232, z: 442, w: 11, d: 10, rot: -0.15, kind: 'house' },
      { x: 258, z: 418, w: 9, d: 8, rot: 0.9, kind: 'house' },
      { x: 108, z: 458, w: 8, d: 7, rot: 0.6, kind: 'house' },
      { x: 214, z: 456, w: 14, d: 9, rot: 0.0, kind: 'chapel' },
      { x: 44, z: 404, w: 7, d: 7, rot: 0.3, kind: 'house' },
      { x: 286, z: 440, w: 8, d: 7, rot: -0.5, kind: 'house' },
      { x: 150, z: 372, w: 6, d: 5, rot: 0.2, kind: 'wall' },
      { x: 214, z: 338, w: 7, d: 4, rot: -0.4, kind: 'wall' },
    ],
    houses: [
      { x: 208, z: 552, w: 9, d: 7, rot: 0.0 },
      { x: 226, z: 540, w: 8, d: 7, rot: 0.15 },
      { x: 120, z: 552, w: 8, d: 7, rot: -0.1 },
      { x: 196, z: 530, w: 7, d: 6, rot: 0.05 },
      { x: 128, z: 534, w: 7, d: 6, rot: 0.0 },
    ],
    graveyards: [{ x: 238, z: 516, w: 18, d: 12 }, { x: 60, z: 486, w: 12, d: 9 }],
    structures: [
      { type: 'bastion', faction: 'new_antioch', x: 160, z: 524, rot: 3.141592653589793, objective: true },
      { type: 'supply_depot', faction: 'new_antioch', x: 100, z: 550, rot: 3.141592653589793 },
      { type: 'field', faction: 'new_antioch', x: 50, z: 534, rot: 0 },
      { type: 'field', faction: 'new_antioch', x: 268, z: 536, rot: 0 },
      { type: 'grail_altar', faction: 'black_grail', x: 95, z: 58, rot: 0.3 },
      { type: 'grail_altar', faction: 'black_grail', x: 162, z: 40, rot: 0.0 },
      { type: 'grail_altar', faction: 'black_grail', x: 232, z: 62, rot: -0.4 },
      // pre-dug New Antioch line
      { type: 'trench', faction: 'new_antioch', x1: 136, z1: 477, x2: 150, z2: 475 },
      { type: 'trench', faction: 'new_antioch', x1: 150, z1: 475, x2: 164, z2: 475 },
      { type: 'trench', faction: 'new_antioch', x1: 164, z1: 475, x2: 178, z2: 477 },
      // old remnants in no man's land (neutral, collapsed)
      { type: 'trench', faction: 'neutral', x1: 54, z1: 352, x2: 68, z2: 348, variant: 'old', progress: 0.7 },
      { type: 'trench', faction: 'neutral', x1: 100, z1: 358, x2: 114, z2: 355, variant: 'old', progress: 0.65 },
      { type: 'trench', faction: 'neutral', x1: 196, z1: 354, x2: 210, z2: 357, variant: 'old', progress: 0.7 },
      { type: 'trench', faction: 'neutral', x1: 242, z1: 347, x2: 256, z2: 351, variant: 'old', progress: 0.6 },
      { type: 'wire', faction: 'neutral', x1: 88, z1: 330, x2: 102, z2: 327, variant: 'old' },
      { type: 'wire', faction: 'neutral', x1: 214, z1: 327, x2: 228, z2: 331, variant: 'old' },
      { type: 'wire', faction: 'neutral', x1: 130, z1: 320, x2: 144, z2: 322, variant: 'old' },
    ],
    nodes: [
      { type: 'salvage_rubble', x: 84, z: 442, amount: 300 },
      { type: 'salvage_rubble', x: 142, z: 426, amount: 260 },
      { type: 'salvage_rubble', x: 210, z: 438, amount: 300 },
      { type: 'salvage_rubble', x: 250, z: 430, amount: 240 },
      { type: 'salvage_wreck', x: 182, z: 384, amount: 220 },
      { type: 'salvage_gun', x: 62, z: 372, amount: 240 },
      { type: 'salvage_wreck', x: 122, z: 342, amount: 180 },
      { type: 'salvage_gun', x: 232, z: 368, amount: 240 },
    ],
    anchors: {
      na_line: [[112, 486], [132, 484], [152, 483], [172, 484], [192, 486], [208, 488]],
      na_base: [[140, 500], [180, 500]],
      na_reserve: [[160, 498]],
      bg_mass: [[84, 186], [112, 192], [140, 196], [182, 196], [210, 190], [238, 184], [98, 166], [160, 172], [226, 166], [128, 176]],
      bg_support: [[132, 158], [192, 158]],
      bg_elite: [[150, 146], [174, 146]],
      home: [[160, 486]],
      // model gallery lineup (presentation sandbox)
      gallery_na_a: [[146, 394]], gallery_na_b: [[160, 394]], gallery_na_c: [[174, 394]],
      gallery_bg_a: [[146, 381]], gallery_bg_b: [[160, 381]], gallery_bg_c: [[174, 381]],
    },
    zones: {
      new_antioch: { x0: 0, z0: 330, x1: 320, z1: 576 },
      black_grail: { x0: 0, z0: 0, x1: 320, z1: 228 },
    },
    lanes: {
      west: [[82, 214], [72, 262], [80, 330], [100, 410], [128, 472], [150, 508]],
      center: [[160, 218], [162, 262], [160, 330], [160, 410], [160, 470], [160, 508]],
      east: [[240, 212], [248, 262], [238, 330], [218, 410], [192, 472], [170, 508]],
    },
    // Defender AI build plan (priority order). Engineers use the normal BUILD pipeline.
    defensePlan: [
      { type: 'trench', x1: 122, z1: 479, x2: 136, z2: 477 },
      { type: 'trench', x1: 178, z1: 477, x2: 192, z2: 479 },
      { type: 'fire_post', x: 160, z: 466, rot: 3.141592653589793 },
      { type: 'wire', x1: 128, z1: 458, x2: 144, z2: 456 },
      { type: 'wire', x1: 176, z1: 456, x2: 192, z2: 458 },
      { type: 'sandbags', x1: 106, z1: 484, x2: 116, z2: 482 },
      { type: 'sandbags', x1: 204, z1: 482, x2: 214, z2: 484 },
      { type: 'supply_cache', x: 160, z: 488, rot: 3.141592653589793 },
      { type: 'trench', x1: 108, z1: 481, x2: 122, z2: 479 },
      { type: 'trench', x1: 192, z1: 479, x2: 206, z2: 481 },
      { type: 'wire', x1: 146, z1: 455, x2: 160, z2: 454 },
      { type: 'wire', x1: 160, z1: 454, x2: 174, z2: 455 },
      { type: 'observation_post', x: 146, z: 492, rot: 3.141592653589793 },
      { type: 'fire_post', x: 118, z: 470, rot: 3.3 },
      { type: 'fire_post', x: 202, z: 470, rot: 2.98 },
    ],
  },
};

export function mapDef(id) {
  const d = MAPS[id];
  if (!d) throw new Error('Unknown map: ' + id);
  return d;
}
