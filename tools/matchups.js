#!/usr/bin/env node
// Phase 5A headless AI-vs-AI MATCHUP runner (deterministic: same seed + setup -> same result).
// Generic over sides: works for the classic Lore preset, the reversed roles and mirror matches.
// Usage: node tools/matchups.js [--setups classic,reverse,na_mirror,bg_mirror] [--seeds 1,2,3,4]
//          [--minutes 15] [--scenario siege_default] [--verbose] [--json out.json]
// Reports per run: winner (side / faction / role), reason, end time, soldiers alive per side,
// kills / losses, HQ-capable structures standing, objective hp, counterattacks, state hash.
// No human playtest is implied by these numbers — they are AI-vs-AI measurements only.
import { writeFileSync } from 'node:fs';
import { createSimulation, stepSimulation, stateHash } from '../src/sim/simulation.js';
import { TICK_RATE } from '../src/sim/constants.js';
import { STRUCTURES } from '../src/data/structures.js';

export const SETUPS = {
  classic: [{ faction: 'new_antioch', role: 'defender' }, { faction: 'black_grail', role: 'attacker' }],
  reverse: [{ faction: 'new_antioch', role: 'attacker' }, { faction: 'black_grail', role: 'defender' }],
  na_mirror: [{ faction: 'new_antioch', role: 'defender' }, { faction: 'new_antioch', role: 'attacker' }],
  bg_mirror: [{ faction: 'black_grail', role: 'defender' }, { faction: 'black_grail', role: 'attacker' }],
};

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};

function alive(state, id) {
  let n = 0;
  for (const sq of state.squads) if (sq.faction === id && !sq.civ) for (const m of sq.members) if (m.state === 'alive') n++;
  return n;
}
const mmss = (s) => (s < 0 ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

export function runMatchup(setup, seed, minutes, scenarioId = 'siege_default', verbose = false) {
  const sides = SETUPS[setup].map((s) => ({ ...s, controller: 'ai' }));
  const sim = createSimulation({ scenarioId, seed, settings: { warMinutes: minutes, sides, allAi: true } });
  const prepS = sim.state.match.prepEndTick / TICK_RATE;
  const cap = Math.round((prepS + minutes * 60 + 5) * TICK_RATE);
  let worst = 0, total = 0;
  for (let i = 0; i < cap; i++) {
    const a = process.hrtime.bigint();
    stepSimulation(sim);
    const ms = Number(process.hrtime.bigint() - a) / 1e6;
    total += ms; if (ms > worst) worst = ms;
    sim.events.length = 0;
    const s = sim.state;
    if (verbose && s.tick % (TICK_RATE * 60) === 0) {
      console.log(`  ${setup} seed ${seed} ${mmss(s.tick / TICK_RATE)} ${s.match.phase} ` + s.sides.map((sd) => `${sd.id}(${sd.role}) ${alive(s, sd.id)}`).join(' | '));
    }
    if (s.match.phase === 'ENDED') break;
  }
  const s = sim.state;
  const obj = s.structures.find((x) => x.objective);
  const per = s.sides.map((sd) => {
    const f = s.factions[sd.id];
    return {
      id: sd.id, faction: sd.faction, role: sd.role, alive: alive(s, sd.id),
      kills: f.stats.kills, losses: f.stats.losses, raised: f.stats.raised,
      hq: s.structures.filter((x) => x.faction === sd.id && x.hp > 0 && STRUCTURES[x.type].hq).length,
      counter: f.stats.counterattacks || 0, settlements: f.stats.settlementsBuilt || 0, pest: Math.round(f.stats.pestMax || 0),
    };
  });
  const w = s.sides.find((sd) => sd.id === s.match.winner);
  return {
    setup, seed, winner: w ? `${w.id}/${w.role}` : s.match.winner === null && s.match.phase === 'ENDED' ? 'draw' : '-',
    winnerRole: w ? w.role : '-', reason: s.match.reason || 'running', end: mmss(s.tick / TICK_RATE),
    objHp: obj ? Math.round(obj.hp) : s.objectives.length ? 'destroyed' : 'n/a', sides: per,
    avgTickMs: +(total / Math.max(1, s.tick)).toFixed(3), worstTickMs: +worst.toFixed(1), hash: stateHash(sim).toString(16),
  };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const setups = String(opt('setups', 'classic,reverse,na_mirror,bg_mirror')).split(',');
  const seeds = String(opt('seeds', '1,2,3,4')).split(',').map(Number);
  const minutes = Number(opt('minutes', 15));
  const scenarioId = opt('scenario', 'siege_default');
  const verbose = args.includes('--verbose');
  const rows = [];
  for (const setup of setups) for (const seed of seeds) rows.push(runMatchup(setup, seed, minutes, scenarioId, verbose));
  console.table(rows.map((r) => ({
    setup: r.setup, seed: r.seed, winner: r.winner, reason: r.reason, end: r.end, obj: r.objHp,
    ...Object.fromEntries(r.sides.flatMap((sd, i) => [[`s${i}`, `${sd.id}/${sd.role}`], [`alive${i}`, sd.alive], [`k/l${i}`, `${sd.kills}/${sd.losses}`], [`hq${i}`, sd.hq], [`ca${i}`, sd.counter]])),
    ms: r.avgTickMs, worst: r.worstTickMs,
  })));
  console.log(`\nSUMMARY (${minutes} min war, scenario ${scenarioId}, seeds ${seeds.join(',')}) — AI vs AI only, no human test`);
  for (const setup of setups) {
    const rs = rows.filter((r) => r.setup === setup);
    const by = {};
    for (const r of rs) by[r.winnerRole] = (by[r.winnerRole] || 0) + 1;
    const reasons = {};
    for (const r of rs) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    console.log(`  ${setup.padEnd(10)} defender ${by.defender || 0} / attacker ${by.attacker || 0} / other ${rs.length - (by.defender || 0) - (by.attacker || 0)}   reasons ${JSON.stringify(reasons)}`);
  }
  const out = opt('json', null);
  if (out) writeFileSync(out, JSON.stringify(rows, null, 1));
}
