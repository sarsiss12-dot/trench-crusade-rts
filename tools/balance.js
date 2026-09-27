#!/usr/bin/env node
// Headless AI-vs-AI balance / soak runner (deterministic: same seed -> same result).
// Usage: node tools/balance.js [--seeds 1,2,3,4] [--minutes 15] [--prep <s>] [--verbose] [--json out.json]
//
// Reports the Phase 3 balance measurements (brief §71) per seed and as a batch summary:
// first Grail biomass (forage, not the altar trickle), first meaningful Thrall wave, first New
// Antioch settlement, settlement survival, manpower income, animal / corpse / passive biomass
// shares, Pestilence progress (tier times, peak, Great Pestilence casts), breach timing, raids.
// Times are match seconds (m:ss) unless marked "war+" (after the preparation phase).
import { writeFileSync } from 'node:fs';
import { createSimulation, stepSimulation, stateHash } from '../src/sim/simulation.js';
import { TICK_RATE } from '../src/sim/constants.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const seeds = String(opt('seeds', '1,2,3,4')).split(',').map(Number);
const minutes = Number(opt('minutes', 15));
const prepArg = opt('prep', null);
const verbose = args.includes('--verbose');
const jsonOut = opt('json', null);

const GRAIL = 'black_grail', NA = 'new_antioch';

function aliveSoldiers(state, fid) {
  let n = 0;
  for (const sq of state.squads) if (sq.faction === fid && !sq.civ) for (const m of sq.members) if (m.state === 'alive') n++;
  return n;
}
const sec = (tick) => (tick < 0 ? -1 : Math.round(tick / TICK_RATE));
const mmss = (s) => (s < 0 ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const pct = (a, b) => (b > 0 ? Math.round((100 * a) / b) : 0);

const rows = [];
for (const seed of seeds) {
  const settings = { warMinutes: minutes, controllers: { [NA]: 'ai', [GRAIL]: 'ai' } };
  if (prepArg !== null) settings.prepSeconds = Number(prepArg);
  const sim = createSimulation({ scenarioId: 'siege_default', seed, settings });
  const prepS = sim.state.match.prepEndTick / TICK_RATE;
  // Phase 4: operational lulls extend the war clock (warEndTick moves) — run until the match ends
  const hardCap = (prepS + minutes * 60 + 5 + 3 * 70) * TICK_RATE;
  let worst = 0, total = 0, firstContact = -1, peakSoldiers = 0, mpWar0 = -1, firstHaul = -1, bio60 = -1;
  let lullEnds = [], postLull = [], waitLull = -1, gunStructDmg0 = 0;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < hardCap && sim.state.tick < sim.state.match.warEndTick + 5 * TICK_RATE; i++) {
    const a = process.hrtime.bigint();
    stepSimulation(sim);
    const ms = Number(process.hrtime.bigint() - a) / 1e6;
    total += ms;
    if (ms > worst) worst = ms;
    const s = sim.state;
    if (firstContact < 0 && sim.events.some((e) => e.type === 'FIRE' || e.type === 'MELEE')) firstContact = s.tick;
    if (firstHaul < 0 && sim.events.some((e) => e.type === 'RESOURCE_DELIVERED' && e.faction === GRAIL && e.resource === 'biomass')) firstHaul = s.tick;
    // post-lull tempo: first shot / blow after the front stirs again
    for (const e of sim.events) {
      if (e.type === 'PHASE_CHANGED' && e.afterLull) { lullEnds.push(s.tick); waitLull = s.tick; }
      if (waitLull >= 0 && (e.type === 'FIRE' || e.type === 'MELEE')) { postLull.push(Math.round((s.tick - waitLull) / TICK_RATE)); waitLull = -1; }
      if (e.type === 'STRUCTURE_DAMAGED' && e.faction === GRAIL) void gunStructDmg0;
    }
    if (bio60 < 0 && s.tick % 10 === 0) {
      const by = s.factions[GRAIL].stats.biomass;
      let earned = 0;
      for (const k in by) if (k !== 'passive') earned += by[k];
      if (earned >= 60) bio60 = s.tick; // one Thrall squad's worth from bodies / animals (not the altar trickle)
    }
    sim.events.length = 0;
    if (mpWar0 < 0 && s.match.phase === 'WAR') mpWar0 = s.factions[NA].stats.manpowerGained;
    if (s.tick % TICK_RATE === 0) peakSoldiers = Math.max(peakSoldiers, aliveSoldiers(s, NA) + aliveSoldiers(s, GRAIL));
    if (verbose && s.tick % (TICK_RATE * 60) === 0) {
      const obj = s.structures.find((x) => x.objective);
      const na = s.factions[NA], bg = s.factions[GRAIL];
      const setts = s.structures.filter((x) => x.type === 'settlement').map((x) => `${x.built ? 'B' : 'u'}${x.evac ? 'E' : ''}${x.pop | 0}`).join(',');
      console.log(`  seed ${seed} ${mmss(s.tick / TICK_RATE)} ${s.match.phase} NA ${aliveSoldiers(s, NA)} BG ${aliveSoldiers(s, GRAIL)} obj ${obj ? Math.round(obj.hp) : 'destroyed'} | NA mat ${na.resources.material | 0} sup ${na.resources.supply | 0} mp ${na.resources.manpower | 0} food ${na.resources.food | 0} setts[${setts}] | BG bio ${bg.resources.biomass | 0} pest ${(bg.pestilence || 0).toFixed(0)} animals ${s.animals.length} corpses ${s.corpses.length}`);
    }
    if (s.match.phase === 'ENDED') break;
  }
  const wall = Number(process.hrtime.bigint() - t0) / 1e6;
  const s = sim.state;
  const na = s.factions[NA], bg = s.factions[GRAIL];
  const nas = na.stats, bgs = bg.stats;
  const prepEnd = s.match.prepEndTick;
  const war = (tick) => (tick < 0 ? -1 : Math.max(0, Math.round((tick - prepEnd) / TICK_RATE)));
  const endS = s.tick / TICK_RATE;
  const warMin = Math.max(1 / 60, (s.tick - prepEnd) / TICK_RATE / 60);
  const bio = bgs.biomass;
  const bioTotal = Object.values(bio).reduce((a, b) => a + b, 0);
  const corpseBio = (bio.corpse || 0) + (bio.soldier || 0) + (bio.old || 0) + (bio.civilian || 0);
  const settlementsAlive = s.structures.filter((x) => x.faction === NA && x.type === 'settlement' && x.built).length;
  const ai = (s.ai && s.ai[GRAIL]) || {};
  rows.push({
    seed,
    winner: s.match.winner || '-',
    reason: s.match.reason || 'running',
    end: mmss(endS),
    prepS,
    contact: mmss(sec(firstContact)),
    // Black Grail economy
    bgFirstBio: mmss(sec(bgs.firstBiomassTick)),
    bgFirstHaul: mmss(sec(firstHaul)),
    bgBio60: mmss(sec(bio60)),
    bgWave: bgs.firstWaveTick < 0 ? '—' : 'war+' + mmss(war(bgs.firstWaveTick)),
    bioTotal: Math.round(bioTotal),
    bioAnimalPct: pct(bio.animal || 0, bioTotal),
    bioCorpsePct: pct(corpseBio, bioTotal),
    bioPassivePct: pct(bio.passive || 0, bioTotal),
    raids: ai.raidCount || 0,
    // New Antioch economy
    naFirstSettle: mmss(sec(nas.firstSettlementTick)),
    settBuilt: nas.settlementsBuilt, settLost: nas.settlementsLost, settAlive: settlementsAlive, evac: nas.evacuations,
    mpTotal: nas.manpowerGained,
    mpPerMinWar: +((nas.manpowerGained - Math.max(0, mpWar0)) / warMin).toFixed(1),
    civLost: nas.civLost, convoys: `${nas.convoysArrived}/${nas.convoysLost}`,
    // Pestilence
    pestTiers: bgs.pestTierTick.slice(1).map((t) => (t < 0 ? '—' : mmss(war(t)))).join(' '),
    pestMax: Math.round(bgs.pestMax || 0),
    gp: bgs.greatPestilence || 0,
    breach: bgs.breachTick < 0 ? '—' : 'war+' + mmss(war(bgs.breachTick)),
    // Phase 4
    lulls: lullEnds.length, postLull: postLull.join('/') || '—',
    gunShots: nas.gunShots || 0, gunKills: nas.gunKills || 0, gunDmg: Math.round(nas.gunDmg || 0),
    nestShots: bgs.gunShots || 0, nestKills: bgs.gunKills || 0,
    nests: s.structures.filter((x) => x.faction === GRAIL && (x.type === 'viscera_nest' || x.type === 'belcher_nest') && x.built).length,
    gunBuilt: s.structures.some((x) => x.faction === NA && x.type === 'field_gun' && x.built) || (nas.gunShots || 0) > 0 ? 1 : 0,
    naCmdr: nas.commanderDeathTick === undefined ? 'alive' : 'fell ' + mmss(sec(nas.commanderDeathTick)),
    bgCmdr: bgs.commanderDeathTick === undefined ? 'alive' : 'fell ' + mmss(sec(bgs.commanderDeathTick)),
    garrisons: (s.ai && s.ai[NA] && s.ai[NA].garrisonOrders) || 0,
    // combat
    naKills: nas.kills, naLosses: nas.losses, bgKills: bgs.kills, bgLosses: bgs.losses, raised: bgs.raised,
    peakSoldiers,
    avgTickMs: +(total / s.tick).toFixed(3), worstTickMs: +worst.toFixed(1), wallS: +(wall / 1000).toFixed(1),
    hash: stateHash(sim).toString(16),
    _raw: {
      firstBiomassS: sec(bgs.firstBiomassTick), firstHaulS: sec(firstHaul), bio60S: sec(bio60), firstWaveWarS: war(bgs.firstWaveTick), firstSettleS: sec(nas.firstSettlementTick),
      breachWarS: war(bgs.breachTick), tierWarS: bgs.pestTierTick.slice(1).map((t) => war(t)), pestBy: bgs.pestBy, pestLostBy: bgs.pestLostBy,
      biomass: bio, endS, postLull, naCmdrDied: nas.commanderDeathTick !== undefined, bgCmdrDied: bgs.commanderDeathTick !== undefined,
      gunShots: nas.gunShots || 0, gunKills: nas.gunKills || 0, nestKills: bgs.gunKills || 0,
      nests: s.structures.filter((x) => x.faction === GRAIL && (x.type === 'viscera_nest' || x.type === 'belcher_nest') && x.built).length,
      gunBuilt: (nas.gunShots || 0) > 0 || s.structures.some((x) => x.faction === NA && x.type === 'field_gun' && x.built),
    },
  });
}

const cols = ['seed', 'winner', 'end', 'contact', 'bgFirstBio', 'bgFirstHaul', 'bgBio60', 'bgWave', 'bioAnimalPct', 'bioCorpsePct', 'bioPassivePct', 'raids',
  'naFirstSettle', 'settBuilt', 'settLost', 'settAlive', 'evac', 'mpPerMinWar', 'civLost', 'pestTiers', 'pestMax', 'gp', 'breach'];
console.table(rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))));
console.table(rows.map((r) => ({ seed: r.seed, lulls: r.lulls, postLull: r.postLull, gunShots: r.gunShots, gunKills: r.gunKills, gunDmg: r.gunDmg, nestShots: r.nestShots, nestKills: r.nestKills, naCmdr: r.naCmdr, bgCmdr: r.bgCmdr, garrisons: r.garrisons })));
console.table(rows.map((r) => ({ seed: r.seed, reason: r.reason, naKills: r.naKills, naLosses: r.naLosses, bgKills: r.bgKills, bgLosses: r.bgLosses, raised: r.raised, bioTotal: r.bioTotal, mpTotal: r.mpTotal, convoys: r.convoys, peakSoldiers: r.peakSoldiers, avgTickMs: r.avgTickMs, worstTickMs: r.worstTickMs, wallS: r.wallS, hash: r.hash })));

// batch summary (medians over the seeds that reached the milestone)
const med = (xs) => {
  const v = xs.filter((x) => x >= 0).sort((a, b) => a - b);
  if (!v.length) return -1;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};
const reached = (xs) => `${xs.filter((x) => x >= 0).length}/${xs.length}`;
const R = rows.map((r) => r._raw);
const nWin = rows.filter((r) => r.winner === NA).length, bWin = rows.filter((r) => r.winner === GRAIL).length;
console.log(`\nBATCH  seeds ${seeds.join(',')}  (${minutes} min war, prep ${rows[0] ? rows[0].prepS : '?'} s)`);
console.log(`  result          New Antioch ${nWin} / Black Grail ${bWin} / unfinished ${rows.length - nWin - bWin}`);
console.log(`  Grail 1st bio   median ${mmss(med(R.map((r) => r.firstBiomassS)))} (any non-passive source, match time; reached ${reached(R.map((r) => r.firstBiomassS))})`);
console.log(`  Grail 1st haul  median ${mmss(med(R.map((r) => r.firstHaulS)))} (first forage delivery; reached ${reached(R.map((r) => r.firstHaulS))})`);
console.log(`  Grail 60 bio    median ${mmss(med(R.map((r) => r.bio60S)))} (a Thrall squad's worth earned from bodies / animals; reached ${reached(R.map((r) => r.bio60S))})`);
console.log(`  1st Thrall wave median war+${mmss(med(R.map((r) => r.firstWaveWarS)))} (reached ${reached(R.map((r) => r.firstWaveWarS))})`);
console.log(`  NA 1st settle   median ${mmss(med(R.map((r) => r.firstSettleS)))} (reached ${reached(R.map((r) => r.firstSettleS))})`);
console.log(`  settlements     built ${rows.reduce((a, r) => a + r.settBuilt, 0)}, lost ${rows.reduce((a, r) => a + r.settLost, 0)}, standing at end ${rows.reduce((a, r) => a + r.settAlive, 0)}, evacuations ${rows.reduce((a, r) => a + r.evac, 0)}`);
console.log(`  manpower        median ${med(rows.map((r) => r.mpPerMinWar)).toFixed(1)}/min in war (total median ${med(rows.map((r) => r.mpTotal))})`);
const bsum = (k) => R.reduce((a, r) => a + (r.biomass[k] || 0), 0);
const btot = ['passive', 'animal', 'corpse', 'civilian', 'soldier', 'old'].reduce((a, k) => a + bsum(k), 0);
console.log(`  biomass shares  animal ${pct(bsum('animal'), btot)}%  corpses ${pct(bsum('corpse') + bsum('soldier') + bsum('old') + bsum('civilian'), btot)}%  passive altar ${pct(bsum('passive'), btot)}%`);
for (let t = 0; t < 4; t++) console.log(`  pest tier ${t + 1}     median war+${mmss(med(R.map((r) => r.tierWarS[t])))} (reached ${reached(R.map((r) => r.tierWarS[t]))})`);
console.log(`  breach          median war+${mmss(med(R.map((r) => r.breachWarS)))} (reached ${reached(R.map((r) => r.breachWarS))})`);
const allPost = R.flatMap((r) => r.postLull);
console.log(`  post-lull tempo first shot after the front stirs: median ${med(allPost)} s (${allPost.length} lull ends)`);
console.log(`  field gun       shots ${R.reduce((a, r) => a + r.gunShots, 0)}, kills ${R.reduce((a, r) => a + r.gunKills, 0)} (Grail nests kills ${R.reduce((a, r) => a + r.nestKills, 0)})`);
console.log(`  emplacements    field gun in action in ${R.filter((r) => r.gunBuilt).length}/${R.length}; Grail nests standing at the end: ${R.reduce((a, r) => a + r.nests, 0)} (in ${R.filter((r) => r.nests > 0).length}/${R.length} matches)`);
console.log(`  commanders      NA fell in ${R.filter((r) => r.naCmdrDied).length}/${R.length}, Grail fell in ${R.filter((r) => r.bgCmdrDied).length}/${R.length}`);
console.log(`  perf            avg tick ${med(rows.map((r) => r.avgTickMs)).toFixed(3)} ms (median), worst ${Math.max(...rows.map((r) => r.worstTickMs))} ms, peak soldiers ${Math.max(...rows.map((r) => r.peakSoldiers))}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
