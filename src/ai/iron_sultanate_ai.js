// Iron Sultanate AI: compact fortification, Azeb screen, preserved Janissary reserve and a
// controlled counterattack. It reads its own state / visible enemies and acts only through the
// normal plain-data command queue.
import { strategyFor } from '../data/ai.js';
import { sideDef, baseFaction, areHostile, sideBit } from '../data/factions.js';
import { unitDef, hasRole } from '../data/units.js';
import { STRUCTURES } from '../data/structures.js';
import { CMD } from '../sim/commands.js';
import { planFor, enemyHomeAnchor, sideAnchor } from '../sim/sides.js';
import { validatePlacement } from '../construction/construction.js';
import { dist } from '../core/dmath.js';
import { aiIssue } from './issue.js';

function ownSquads(sim, fid, pred) {
  return sim.state.squads.filter((q) => q.faction === fid && q.members.some((m) => m.state === 'alive') && (!pred || pred(q)));
}

function planDone(sim, fid, item) {
  const x = item.x1 !== undefined ? (item.x1 + item.x2) * 0.5 : item.x;
  const z = item.x1 !== undefined ? (item.z1 + item.z2) * 0.5 : item.z;
  return sim.state.structures.some((s) => s.faction === fid && s.type === item.type && dist(s.x, s.z, x, z) < 3);
}

function build(sim, fid, ai, strategy) {
  if (sim.state.tick < ai.nextBuild) return;
  ai.nextBuild = sim.state.tick + 80;
  const builders = ownSquads(sim, fid, (q) => hasRole(unitDef(q.type), 'builder'));
  if (!builders.length) return;
  const plan = planFor(sim, fid, strategy.buildPlan || 'sultanate');
  for (let n = 0; n < plan.length; n++) {
    const i = (ai.planIndex + n) % plan.length;
    const p = plan[i];
    if (planDone(sim, fid, p)) continue;
    const v = validatePlacement(sim, fid, p.type, p);
    if (!v.ok) continue;
    ai.planIndex = i + 1;
    aiIssue(sim, { type: CMD.BUILD, faction: fid, stype: p.type, squadIds: [builders[0].id], ...p });
    return;
  }
}

function queued(sim, fid, type) {
  let n = 0;
  for (const q of sim.state.squads) if (q.faction === fid && q.type === type) n++;
  for (const st of sim.state.structures) if (st.faction === fid && st.queue) for (const it of st.queue) if (it.unit === type) n++;
  return n;
}

function train(sim, fid, ai) {
  if (sim.state.tick < ai.nextTrain) return;
  ai.nextTrain = sim.state.tick + 35;
  const producers = sim.state.structures.filter((s) => s.faction === fid && s.built && s.queue && s.queue.length < 3);
  if (!producers.length) return;
  let type = 'azeb';
  if (queued(sim, fid, 'sultanate_sapper') < 2) type = 'sultanate_sapper';
  else if (queued(sim, fid, 'janissary') * 3 < queued(sim, fid, 'azeb')) type = 'janissary';
  else if (queued(sim, fid, 'jabirean_alchemist') < 2) type = 'jabirean_alchemist';
  const st = producers.find((s) => STRUCTURES[s.type].trains.indexOf(type) >= 0) || producers.find((s) => STRUCTURES[s.type].trains.indexOf('azeb') >= 0);
  if (st) aiIssue(sim, { type: CMD.TRAIN, faction: fid, sid: st.id, unit: STRUCTURES[st.type].trains.indexOf(type) >= 0 ? type : 'azeb' });
}

function visibleThreat(sim, fid, radius) {
  const bit = sideBit(fid);
  const home = sideAnchor(sim, fid, 'home');
  return sim.state.squads.some((q) => areHostile(fid, q.faction) && (q.visibleTo & bit) && dist(q.cx, q.cz, home[0], home[1]) <= radius);
}

function manoeuvre(sim, fid, ai, strategy) {
  if (sim.state.match.phase !== 'WAR' || sim.state.tick < ai.nextOrder) return;
  ai.nextOrder = sim.state.tick + 100;
  const combat = ownSquads(sim, fid, (q) => unitDef(q.type).combatUnit).sort((a, b) => a.id - b.id);
  if (combat.length <= strategy.reserve) return;
  const warTick = sim.state.tick - sim.state.match.prepEndTick;
  const threatened = visibleThreat(sim, fid, 115);
  if (strategy.holdHome && !threatened && warTick < strategy.firstPushSec * 20) return;
  const pool = combat.slice(strategy.reserve);
  const group = pool.slice(0, Math.min(strategy.waveSize, pool.length));
  if (!group.length) return;
  let target = enemyHomeAnchor(sim, fid);
  if (threatened) {
    const bit = sideBit(fid);
    const e = sim.state.squads.find((q) => areHostile(fid, q.faction) && (q.visibleTo & bit));
    if (e) target = [e.cx, e.cz];
  }
  aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: group.map((q) => q.id), x: target[0], z: target[1], attackMove: true });
}

export const ironSultanateAI = {
  id: 'iron_sultanate',
  init() { return { nextBuild: 0, nextTrain: 0, nextOrder: 0, planIndex: 0 }; },
  think(sim, fid, ai) {
    const f = sim.state.factions[fid];
    const strategy = strategyFor(baseFaction(fid), f.role);
    build(sim, fid, ai, strategy);
    train(sim, fid, ai);
    manoeuvre(sim, fid, ai, strategy);
  },
};
