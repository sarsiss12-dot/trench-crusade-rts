// Faction SPECIALITY progression (Phase 3): three tiers, three exclusive choices each (one pick per
// tier, irreversible). Every option changes HOW the faction plays — new units / buildings /
// abilities, economy rules, gameplay rules — not a lone +5 % stat.
// Tier availability follows MATCH PROGRESS (share of the war timer), so short and long matches get
// the same arc: tier I from the start, II at ~30 %, III at ~60 %.
//
// mods: data-driven modifiers read through sim/specialities.js specValue():
//   multiplicative by default; SPEC_ADDITIVE keys add; SPEC_MIN keys take the lowest value.
// unlocks: { units, structures, abilities } gated by requiresSpec in their own data.
// Lore: names taken from official rules / roster where marked canon; others are abstractions and
// are marked as such (never presented as canon).

export const SPEC_TIERS = [
  { tier: 0, at: 0 },
  { tier: 1, at: 0.3 },
  { tier: 2, at: 0.6 },
];

export const SPEC_ADDITIVE = ['artilleryShells', 'artilleryRadius', 'flamerCap', 'thrallSize', 'heavySize', 'gangCap', 'swarmRadius', 'swarmDuration', 'greatRadius'];
export const SPEC_MIN = ['buildOnInfection', 'greatCost'];

export const SPECIALITIES = {
  // All nine titles are RTS doctrines, NOT names claimed from the tabletop rules.
  iron_sultanate: [
    [
      { id: 'is_engineering', icon: 'engineer', lore: { status: 'abstraction' },
        mods: { repairSpeed: 1.5, builderSpeed: 1.2 }, rules: {}, unlocks: { structures: ['sultanate_arsenal'] },
        ai: { defense: 1.4, engineers: 1.5, reserve: 1.15, expansion: 0.8 } },
      { id: 'is_discipline', icon: 'guard', lore: { status: 'abstraction' },
        mods: { janissaryTrain: 0.8, janissaryCost: 0.9 }, rules: {}, unlocks: {},
        ai: { elite: 1.8, reserve: 1.4, wave: 1.15, cadence: 1.2 } },
      { id: 'is_alchemy', icon: 'flame', lore: { status: 'abstraction' },
        mods: { alchemistCost: 0.8, sanitizeSpeed: 1.5 }, rules: {}, unlocks: { structures: ['jabirean_laboratory'] },
        ai: { support: 2, sanitation: 1.8, defense: 1.1 } },
    ],
    [
      { id: 'is_layered_defense', icon: 'fortified_wall', lore: { status: 'abstraction' },
        mods: { repairSpeed: 1.3 }, rules: {}, unlocks: { structures: ['sultanate_battery'] },
        ai: { defense: 1.35, reserve: 1.25, artillery: 1.5, expansion: 0.8 } },
      { id: 'is_counterguard', icon: 'guard', lore: { status: 'abstraction' },
        mods: { reinfInterval: 0.7 }, rules: {}, unlocks: {},
        ai: { elite: 1.5, sally: 0.8, wave: 1.3, reserve: 1.2 } },
      { id: 'is_fire_cordon', icon: 'flame', lore: { status: 'abstraction' },
        mods: { sanitizeSpeed: 1.5, alchemistTrain: 0.75 }, rules: {}, unlocks: { structures: ['jabirean_laboratory', 'sultanate_battery'] },
        ai: { support: 1.5, sanitation: 1.5, artillery: 1.4 } },
    ],
    [
      { id: 'is_preservation', icon: 'engineer', lore: { status: 'abstraction' },
        mods: { repairSpeed: 1.5, reinfSupply: 0.7 }, rules: {}, unlocks: { structures: ['sultanate_arsenal'] },
        ai: { engineers: 1.4, defense: 1.25, reserve: 1.25 } },
      { id: 'is_measured_advance', icon: 'guard', lore: { status: 'abstraction' },
        mods: { janissaryCost: 0.85, janissaryTrain: 0.85 }, rules: {}, unlocks: {},
        ai: { wave: 1.4, cadence: 0.8, expansion: 1.4, sally: 0.85 } },
      { id: 'is_purifying_fire', icon: 'flame', lore: { status: 'abstraction' },
        mods: { infectResist: 0.7, sanitizeSpeed: 2 }, rules: {}, unlocks: { structures: ['jabirean_laboratory'] },
        ai: { support: 1.6, sanitation: 2, defense: 1.15 } },
    ],
  ],
  new_antioch: [
    [
      {
        id: 'na_fortification', icon: 'fortified_wall',
        ai: { defense: 1.5, reserve: 1.3, expansion: 0.8 },
        lore: { status: 'abstraction', ref: 'Trench warfare doctrine; New Antioch is a walled fortress-city (official lore)' },
        mods: { trenchWork: 0.65, wallWork: 0.7, wireCost: 0.7 },
        unlocks: { structures: ['pillbox'] },
        rules: { fortifiedNoWorkshop: 1 },
      },
      {
        id: 'na_logistics', icon: 'supply',
        ai: { expansion: 1.5, engineers: 1.5, cadence: 0.9 },
        lore: { status: 'abstraction' },
        mods: { convoyCap: 2, convoySpeed: 1.3, reinfSupply: 0.5, reinfInterval: 0.6, builderSpeed: 1.15, builderQueue: 1.5 },
        unlocks: {},
        rules: { settlementReinforce: 1 },
      },
      {
        id: 'na_faith', icon: 'aid_station',
        ai: { sanitation: 1.6, support: 1.4 },
        lore: { status: 'canon-inspired', ref: 'Trench Clerics and Combat Medics are part of the official New Antioch roster' },
        mods: { medicCost: 0.6, aidCure: 2, infectResist: 0.75 },
        unlocks: { units: ['trench_cleric'] },
        rules: { consecrate: 1 },
      },
    ],
    [
      {
        id: 'na_artillery', icon: 'artillery_barrage',
        ai: { artillery: 1.8, support: 1.4, cadence: 0.85 },
        lore: { status: 'canon-inspired', ref: '"Artillery battalions, the pride and joy of New Antioch" (official lore)' },
        mods: { artilleryShells: 3, artilleryRadius: 3, artilleryCooldown: 0.7 },
        unlocks: {},
        rules: { artilleryExplored: 1 },
      },
      {
        id: 'na_mechanised', icon: 'heavy',
        ai: { elite: 1.8, reserve: 1.25, wave: 1.25 },
        lore: { status: 'canon-inspired', ref: 'Mechanised Heavy Infantry (official roster); reserve doctrine is an abstraction' },
        mods: { heavyCost: 0.75, heavySize: 1 },
        unlocks: {},
        rules: { heavyAtMuster: 1 },
      },
      {
        id: 'na_fortified_settlements', icon: 'settlement',
        ai: { defense: 1.6, reserve: 1.3, expansion: 0.85 },
        lore: { status: 'abstraction' },
        mods: { settlementHp: 2 },
        unlocks: {},
        rules: { settlementHeavyDefense: 1, settlementGuns: 1 },
      },
    ],
    [
      {
        id: 'na_adv_logistics', icon: 'depot',
        ai: { expansion: 1.4, engineers: 1.2, wave: 1.2 },
        lore: { status: 'abstraction' },
        mods: { manpowerRegen: 1.4, ammoCost: 0.5 },
        unlocks: { structures: ['supply_depot'] },
        rules: {},
      },
      {
        id: 'na_purification', icon: 'flame',
        ai: { sanitation: 2, support: 1.8 },
        lore: { status: 'canon-inspired', ref: 'Flamethrowers are part of the New Antioch armoury (official rules); the purification rite is an abstraction' },
        mods: { flamerCost: 0.7, flamerCap: 1, sanitizeSpeed: 2 },
        unlocks: { abilities: ['purge'], units: ['trench_cleric'] },
        rules: {},
      },
      {
        id: 'na_elite', icon: 'officer',
        ai: { elite: 1.5, reserve: 1.2, wave: 1.2 },
        lore: { status: 'canon-inspired', ref: 'Sniper Priest — New Antioch elite (official roster); the doctrine itself is a gameplay abstraction' },
        mods: { eliteCost: 0.8 },
        unlocks: { units: ['sniper_priest'] },
        rules: { trenchStand: 1 },
      },
    ],
  ],
  black_grail: [
    [
      {
        id: 'bg_horde', icon: 'thrall',
        ai: { wave: 0.8, cadence: 0.65, elite: 0.75 },
        lore: { status: 'canon-inspired', ref: '"Overwhelming Horde" is an official Black Grail rule (more dice per nearby Black Grail model)' },
        mods: { thrallCost: 0.7, thrallTrain: 0.6, thrallSize: 2, thrallDamage: 0.9 },
        unlocks: {},
        rules: { hordeWide: 1 },
      },
      {
        id: 'bg_touch', icon: 'infection',
        ai: { plague: 1.5, expansion: 1.2 },
        lore: { status: 'canon-inspired', ref: '"Beelzebub\'s Touch" is an official Black Grail rule (extra infection)' },
        mods: { infectSpread: 1.5, pestGain: 1.4, plagueClaim: 1.5, swarmCooldown: 0.8 },
        unlocks: {},
        rules: {},
      },
      {
        id: 'bg_hunger', icon: 'corpse_mound',
        ai: { engineers: 1.5, expansion: 1.3 },
        lore: { status: 'canon-inspired', ref: '"Great Hunger" is the name of an official Black Grail warband variant; the corpse economy is an abstraction' },
        mods: { corpseBiomass: 1.5, gangCap: 2, forageRadius: 1.5, moundHarvest: 1.6 },
        unlocks: {},
        rules: { pounce: 1 },
      },
    ],
    [
      {
        id: 'bg_heralds', icon: 'fly_swarm',
        ai: { support: 1.8, reserve: 1.15 },
        lore: { status: 'canon-inspired', ref: 'Herald of Beelzebub — Black Grail elite (official roster)' },
        mods: { swarmRadius: 3, swarmDuration: 3 },
        unlocks: { units: ['herald'] },
        rules: {},
      },
      {
        id: 'bg_amalgam', icon: 'amalgam',
        ai: { breach: 2, wave: 1.2 },
        lore: { status: 'canon-inspired', ref: 'Amalgam — Black Grail troop type (official roster)' },
        mods: {},
        unlocks: { units: ['amalgam'] },
        rules: {},
      },
      {
        id: 'bg_dominion', icon: 'plague_pit',
        ai: { plague: 1.8, defense: 1.3 },
        lore: { status: 'abstraction' },
        mods: { buildOnInfection: 60, pitRadius: 1.4, grailRegen: 2, infectedSlow: 0.8 },
        unlocks: {},
        rules: {},
      },
    ],
    [
      {
        id: 'bg_black_tide', icon: 'black_tide',
        ai: { cadence: 0.8, plague: 1.4 },
        lore: { status: 'abstraction' },
        mods: { reanimDelay: 0.5 },
        unlocks: { abilities: ['black_tide'] },
        rules: {},
      },
      {
        id: 'bg_great_pestilence', icon: 'great_pestilence',
        ai: { plague: 2, expansion: 1.3 },
        lore: { status: 'abstraction' },
        mods: { pestGain: 1.5, greatCost: 45, greatRadius: 6, pestDecay: 0.5 },
        unlocks: {},
        rules: {},
      },
      {
        id: 'bg_lord', icon: 'lord',
        ai: { wave: 1.3, reserve: 1.3, support: 1.4 },
        lore: { status: 'canon-inspired', ref: 'Lord of Tumours — Black Grail leader (official roster)' },
        mods: {},
        unlocks: { units: ['lord_of_tumours'] },
        rules: {},
      },
    ],
  ],
};

/** Every speciality option by id. */
export const SPEC_BY_ID = (() => {
  const m = {};
  for (const fid in SPECIALITIES) {
    SPECIALITIES[fid].forEach((tier, ti) => tier.forEach((o) => { m[o.id] = { ...o, faction: fid, tier: ti }; }));
  }
  return m;
})();

// ---------------------------------------------------------------------------- Pestilence
// Black Grail faction-wide momentum meter (0..100), separate from BIOMASS (matter): it rises with
// successful plague (infection, infected dead, risen thralls, plague pits, infected ground) and
// falls with burning, sanitation, cures, lost plague structures and long failure. Thresholds are
// data; effects are read by the plague systems. Using the Great Pestilence spends most of it.
export const PESTILENCE = {
  max: 100,
  tiers: [
    { id: 'dormant', at: 0 },
    { id: 'festering', at: 25 },
    { id: 'outbreak', at: 50 },
    { id: 'tide', at: 75 },
    { id: 'great', at: 100 },
  ],
  gain: {
    soldierStack: 0.07, civilianStack: 0.14, animalKill: 0.2, infectedCorpse: 0.45, rise: 0.25,
    // territory / pits only SUSTAIN the meter (per second, capped): ~3.6 / min at most
    pitPerSec: 0.01, territoryPerCell: 0.0004, territoryMax: 0.06,
  },
  // pacing: the plague grows harder to push the higher it already stands (gain x tierGain[tier]),
  // and long wars climb slower (gain x clamp(paceRefMinutes / warMinutes, paceMin, paceMax))
  tierGain: [1, 0.8, 0.6, 0.45, 0],
  paceRefMinutes: 15, paceMin: 0.35, paceMax: 1.5,
  loss: {
    burnInfected: 0.8, burnCorpse: 0.25, cleanCell: 0.03, cureStack: 0.05,
    pitDestroyed: 6, structDestroyed: 3, altarDestroyed: 8,
    idleAfterSec: 60, idleDecayPer10s: 0.6,
  },
  // tier effects (cumulative from the tier that reaches them)
  festering: { spread: 1.25 },
  outbreak: { reanimDelay: 0.6, swarmDps: 1.25, claimBonus: 0.1 },
  tide: { swarmCooldown: 0.8, corpseRot: 2, turnDelay: 0.6 },
  great: { cost: 60 },
  // an infected soldier who dies with this many stacks turns where he lies, Grail presence or not
  turnStacks: 3, turnDelaySec: 30,
};
