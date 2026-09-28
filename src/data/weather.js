// Weather data (Phase 4.1): procedural rain showers and TRAFFIC MUD.
// Rain-soaked, churned trench ground is a constant of the Trench Crusade setting's art and
// fiction; the shower schedule, the wetness model and the mud grid are gameplay abstractions.
//  - showers are seeded from the match seed (hash, no RNG stream), so a replay / save agrees
//  - rain wets the whole field (WET at worst on its own); only TRAFFIC turns wet ground into MUD /
//    HEAVY MUD, on a bounded low-resolution grid; it dries off after the rain
//  - movement on the surface is slowed a little (infantry ~10-15 % in mud); the reinforcement
//    walk, the AI and the player all pay the same
export const WEATHER = {
  lore: {
    status: 'abstraction',
    ref: 'Rain, flooded shell holes and trench mud are staples of the Trench Crusade setting art; the shower schedule and traffic-mud grid are gameplay abstractions',
  },
  rain: {
    firstMin: [5, 11], // first shower after the match starts (minutes)
    gapMin: [8, 17], // dry spell between showers
    durMin: [2.5, 5.5], // shower length
    intensity: [0.45, 1], // 0..1
    rampSec: 25, // fade in / out
  },
  wet: { riseSec: 70, drySec: 360 }, // ground wetness 0..1: soaks in the rain, dries after
  mud: {
    cell: 8, // metres per grid cell (bounded: 40 x 72 on the 320 x 576 map)
    every: 10, // ticks between mud updates (0.5 s)
    stampPerMan: 0.6, // mud added per moving man per update at full wetness
    wetFloor: 60, // rain alone makes ground at most this 'muddy' (WET, never MUD)
    decayPerSec: 1.2, // drying once the ground is below dryBelow wetness
    dryBelow: 0.35,
    // levels (grid value): DRY < 30 <= WET < 100 <= MUD < 175 <= HEAVY
    levels: [30, 100, 175],
    // movement multiplier per level (DRY, WET, MUD, HEAVY)
    speed: [1, 0.97, 0.89, 0.85],
  },
};

export const MUD_LEVELS = ['dry', 'wet', 'mud', 'heavy'];
