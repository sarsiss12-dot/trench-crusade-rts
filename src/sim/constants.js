// Simulation constants. The simulation runs at a fixed tick rate; rendering interpolates.

export const STATE_VERSION = 7;
export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;

export const TARGET_INTERVAL = 8; // ticks between squad target re-evaluation (staggered by id)
export const FOG_INTERVAL = 4; // ticks between fog/visibility updates
export const DYING_TICKS = 34; // hit reaction + collapse before becoming a corpse
export const RISING_TICKS = 50; // reanimation / emergence duration
export const MAX_CORPSES = 360; // gameplay corpse bound (visual corpses have their own bound)
export const CORPSE_DECAY_TICKS = 20 * 60 * 7; // gameplay corpses decay after 7 minutes
export const PATHS_PER_TICK = 4; // throttled squad path computations per tick
export const DETOURS_PER_TICK = 2; // rescue paths for stuck soldiers per tick (soldiers normally never path)
// A* work budget per tick (node expansions, squad paths + detours share it; the first search of a
// tick always runs). A wave of cross-map orders is spread over a few ticks instead of one long
// hitch. Cache hits are charged what their search cost, so the budget is independent of the cache
// (a loaded save with a cold cache makes exactly the same decisions).
export const PATH_WORK_PER_TICK = 12000;
export const STUCK_WINDOW = 20; // ticks between soldier progress checks
export const JOIN_TIMEOUT_TICKS = 20 * 60; // a walking replacement counts as a member after this (it keeps walking)
export const REPATH_TICKS = 30; // attack-order chase re-path interval
export const MELEE_CHARGE_RANGE = 22; // melee squads charge targets within this distance
export const ACQUIRE_EXTRA = 8; // extra acquisition range beyond weapon range
export const INFECTION_MAX = 6;
export const MAX_CRATERS = 48; // persistent shell craters (bounded; nearby hits merge)
export const MAX_CRATER_R = 4.2;
