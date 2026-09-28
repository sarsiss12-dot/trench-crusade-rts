// Phase 3 economy data (New Antioch expansion + civilian population). Every number here is
// gameplay tuning, not lore. Sector names describe the ground (fields, pasture, a quarry, a scrap
// yard, an abandoned depot, a ruined hamlet); none of them is a named canon place.
//
// Model (see economy/settlements.js):
//  - resource SECTORS are natural economic zones of the map (map data), each with a per-match
//    richness rolled from the match seed -> the best expansion order differs between matches
//  - a CIVILIAN SETTLEMENT placed on a sector unlocks farms / a livestock pen / a quarry around it
//  - POPULATION (civilians) is never spent: it sets the manpower regeneration capacity; food feeds
//    it; losing civilians / settlements lowers manpower growth
//  - MANPOWER (recruitable men) = light passive trickle + population x food x safety
//  - remote settlements send their production home in physical CONVOYS (carts that can be lost)

export const SECTOR_KINDS = {
  fertile: {
    id: 'fertile', nameKey: 'sector.fertile', icon: 'food',
    lore: { status: 'abstraction', ref: 'Farmland around the fortress-city (New Antioch feeds a large population — setting abstraction)' },
    base: { food: 0.08 }, farmMult: 1.4, quarryMult: 0,
  },
  pasture: {
    id: 'pasture', nameKey: 'sector.pasture', icon: 'livestock',
    lore: { status: 'abstraction' },
    base: { food: 0.05 }, farmMult: 0.9, quarryMult: 0,
  },
  quarry: {
    id: 'quarry', nameKey: 'sector.quarry', icon: 'quarry',
    lore: { status: 'abstraction' },
    base: { material: 0.12 }, farmMult: 0.5, quarryMult: 1.3,
  },
  scrap: {
    id: 'scrap', nameKey: 'sector.scrap', icon: 'material',
    lore: { status: 'abstraction', ref: 'Wreckage of centuries of war — salvage yard abstraction' },
    base: { material: 0.08, supply: 0.04 }, farmMult: 0.5, quarryMult: 1.0,
  },
  depot: {
    id: 'depot', nameKey: 'sector.depot', icon: 'supply',
    lore: { status: 'abstraction' },
    base: { supply: 0.26 }, farmMult: 0.6, quarryMult: 0,
  },
  hamlet: {
    id: 'hamlet', nameKey: 'sector.hamlet', icon: 'settlement',
    lore: { status: 'abstraction' },
    base: {}, farmMult: 0.8, quarryMult: 0, popBonus: 10, growthMult: 1.6,
  },
};

/** Per-match richness classes (rolled per sector from the match seed): poor / fair / rich. */
export const RICHNESS = [0.7, 1.0, 1.35];

export const POPULATION = {
  baseStart: 40, baseCap: 50, // the fortress-city quarter behind the bastion
  // Phase 4.1: a sheltering building falls — share killed under the rubble (deterministic per
  // person), survivors scatter this far from the wreck; rotten ground this bad infects them (1 stack)
  collapse: { killShare: 0.45, spread: 4, infectGround: 120 },
  foodPerPopSec: 0.012, // upkeep
  manpowerPassivePerMin: 1.5, // the city never locks to zero
  manpowerPerPopMin: 0.1, // per SAFE civilian, x food factor
  foodPerManpower: 4, // a recruit has to be fed and equipped
  foodFactorFull: 60, // food stock at which recruitment runs at full rate (surplus up to x1.2)
  growthEverySec: 20, growthFood: 3, growthMinFood: 40,
  starveEverySec: 30, // with no food at all population slowly drops
  settlementStartPop: 6, settlementCap: 20,
  crewMax: 6, popPerCrew: 4, // visible civilian workers = the settlement's workforce
  crewRefillSec: 30,
  threatRadius: 45, safeAfterSec: 25, // a threatened settlement stops working; shelters / evacuates
  resettleAfterSec: 45, resettleMinBasePop: 16, // an evacuated settlement is resettled after this long in safety
  maxEconomyBuildings: { farm: 2, livestock_pen: 1, quarry: 1 },
  prepSettlementCap: 2, // "1-2 early settlements" during PREPARATION, never the whole map
};

/** Remote settlement production travels home in carts (lightweight physical logistics). */
export const CONVOY = {
  minCargo: 30, maxWaitSec: 70, capacity: 80, speed: 3.1, hp: 160,
  homeRadius: 75, // settlements this close to a home drop-off deliver directly (no cart)
  raidDps: 40, raidRange: 3.2,
  maxActive: 8,
};

/** Wounded / incapacitated soldiers (bounded). */
export const WOUNDED = {
  chance: 0.14, // of eligible lethal hits (bullets / blades; never blast or plague)
  maxPerFaction: 10,
  bleedOutSec: 50,
  reviveSec: 3.5, reviveHpFrac: 0.35,
};

/** Engineers / work gangs (auto dispatch, queue, return to hub). */
export const ENGINEERING = {
  queueMax: 4,
  dangerTicks: 60, // hit this recently = COMBAT/DANGER, not "available"
  highlightSec: 3,
  hubSearch: 400,
  salvageAreaR: 40, // SALVAGE AREA order radius (m), Phase 4
  // Phase 4.1 self-preservation: hit within this many ticks + an enemy fighting squad this close
  fleeHitTicks: 20, fleeThreatR: 26,
};
