#!/usr/bin/env node
// Headless AI-vs-AI balance / soak runner (deterministic: same seed -> same result).
// Usage: node tools/balance.js [--seeds 1,2,3,4] [--minutes 15] [--prep 60] [--verbose]
import { createSimulation, stepSimulation, stateHash } from '../src/sim/simulation.js';
import { TICK_RATE } from '../src/sim/constants.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const seeds = String(opt('seeds', '1,2,3,4')).split(',').map(Number);
const minutes = Number(opt('minutes', 15));
const prep = Number(opt('prep', 60));
const verbose = args.includes('--verbose');

function aliveSoldiers(state, fid) {
  let n = 0;
  for (const sq of state.squads) if (sq.faction === fid) for (const m of sq.members) if (m.state === 'alive') n++;
  return n;
}

const rows = [];
for (const seed of seeds) {
  const sim = createSimulation({
    scenarioId: 'siege_default', seed,
    settings: { warMinutes: minutes, prepSeconds: prep, controllers: { new_antioch: 'ai', black_grail: 'ai' } },
  });
  const maxTicks = (prep + minutes * 60 + 5) * TICK_RATE;
  let worst = 0, total = 0, firstContact = -1;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < maxTicks; i++) {
    const a = process.hrtime.bigint();
    stepSimulation(sim);
    const ms = Number(process.hrtime.bigint() - a) / 1e6;
    total += ms;
    if (ms > worst) worst = ms;
    if (firstContact < 0 && sim.events.some((e) => e.type === 'FIRE' || e.type === 'MELEE')) firstContact = sim.state.tick / TICK_RATE;
    sim.events.length = 0;
    if (verbose && sim.state.tick % (TICK_RATE * 60) === 0) {
      const s = sim.state;
      const obj = s.structures.find((x) => x.objective);
      console.log(`  seed ${seed} t=${s.tick / TICK_RATE}s ${s.match.phase} NA ${aliveSoldiers(s, 'new_antioch')} BG ${aliveSoldiers(s, 'black_grail')} objective ${obj ? Math.round(obj.hp) : 'destroyed'} corpses ${s.corpses.length}`);
    }
    if (sim.state.match.phase === 'ENDED') break;
  }
  const wall = Number(process.hrtime.bigint() - t0) / 1e6;
  const s = sim.state;
  const na = s.factions.new_antioch.stats, bg = s.factions.black_grail.stats;
  rows.push({
    seed,
    winner: s.match.winner || '-',
    reason: s.match.reason || 'running',
    endS: Math.round(s.tick / TICK_RATE),
    contactS: Math.round(firstContact),
    naKills: na.kills, naLosses: na.losses, naBuilt: na.built, naTrained: na.trained,
    bgKills: bg.kills, bgLosses: bg.losses, bgRaised: bg.raised, bgTrained: bg.trained,
    avgTickMs: +(total / s.tick).toFixed(3), worstTickMs: +worst.toFixed(1), wallS: +(wall / 1000).toFixed(1),
    hash: stateHash(sim).toString(16),
  });
}
console.table(rows);
const na = rows.filter((r) => r.winner === 'new_antioch').length;
console.log(`New Antioch ${na} / Black Grail ${rows.filter((r) => r.winner === 'black_grail').length} / unfinished ${rows.filter((r) => r.winner === '-').length}  (${minutes} min war, ${prep}s prep)`);
