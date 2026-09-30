// ROLE supplies obligations; independent doctrine and specialities supply priorities.
import { strategyFor } from '../data/ai.js';
import { baseFaction, areHostile, sideBit } from '../data/factions.js';
import { unitDef, hasRole, commandable } from '../data/units.js';
import { STRUCTURES } from '../data/structures.js';
import { CMD } from '../sim/commands.js';
import { planFor, enemyHomeAnchor, sideAnchor, sideForward, sideFacing } from '../sim/sides.js';
import { validatePlacement } from '../construction/construction.js';
import { unlockedBySpec, unitCost } from '../sim/specialities.js';
import { canAfford } from '../economy/economy.js';
import { isAvailable } from '../units/engineers.js';
import { dist } from '../core/dmath.js';
import { aiIssue } from './issue.js';
import { aiPickSpeciality } from './spec_pick.js';
import { policyFor, aggressionScore } from './doctrine.js';
import { huntThreat } from '../units/hunt_targets.js';

function count(sim, fid, type) {
  let n = 0;
  for (const q of sim.state.squads) if (q.faction === fid && q.type === type && commandable(q) && q.members.some((m) => m.state === 'alive')) n++;
  for (const st of sim.state.structures) if (st.faction === fid && st.queue) for (const it of st.queue) if (it.unit === type) n++;
  return n;
}
function build(sim, fid, ai, strategy, policy) {
  if (sim.state.tick < ai.nextBuild) return;
  ai.nextBuild = sim.state.tick + 80;
  const material = sim.state.factions[fid].resources.material || 0;
  const builder = sim.state.squads.find((q) => q.faction === fid && (isAvailable(sim, q) ||
    hasRole(unitDef(q.type), 'builder') && q.order.t === 'gather' && q.carry <= 0 && material > 240));
  if (!builder) return;
  for (const st of sim.state.structures) {
    if (st.faction !== fid || st.hp <= 0) continue;
    if (huntThreat(sim, fid, st.x, st.z, 25)) continue;
    if (!st.built || st.hp < st.maxHp * 0.8) {
      aiIssue(sim, { type: st.built ? CMD.REPAIR : CMD.ASSIST_BUILD, faction: fid, squadIds: [builder.id], sid: st.id }); return;
    }
  }
  const home = sideAnchor(sim, fid, 'home'), fw = sideForward(sim, fid), rot = sideFacing(sim, fid);
  const need = [
    ['sultanate_supply', 1 + (policy.expansion > 1.2 ? 1 : 0)], ['sultanate_muster', 1],
    ['sultanate_arsenal', policy.engineers > 1.1 ? 1 : 0], ['jabirean_laboratory', policy.support > 1.1 ? 1 : 0],
    ['sultanate_redoubt', Math.ceil(2 * policy.defense)], ['sultanate_battery', Math.ceil(policy.artillery)],
  ];
  for (const [type, want] of need) {
    if (!want || !unlockedBySpec(sim.state, fid, STRUCTURES[type])) continue;
    const have = sim.state.structures.filter((s) => s.faction === fid && s.type === type).length;
    if (have >= want) continue;
    const ahead = STRUCTURES[type].cat === 'defense' ? 45 + have * 18 : have ? 65 : 10;
    for (const lateral of [28, -28, 48, -48, 0]) {
      const p = { x: home[0] + fw[0] * ahead - fw[1] * lateral, z: home[1] + fw[1] * ahead + fw[0] * lateral, rot };
      if (!validatePlacement(sim, fid, type, p).ok) continue;
      aiIssue(sim, { type: CMD.BUILD, faction: fid, stype: type, squadIds: [builder.id], ...p }); return;
    }
  }
  for (const p of planFor(sim, fid, strategy.buildPlan || 'sultanate')) {
    const x = p.x1 === undefined ? p.x : (p.x1 + p.x2) / 2, z = p.x1 === undefined ? p.z : (p.z1 + p.z2) / 2;
    if (sim.state.structures.some((s) => s.faction === fid && s.type === p.type && dist(s.x, s.z, x, z) < 3)) continue;
    if (validatePlacement(sim, fid, p.type, p).ok) { aiIssue(sim, { ...p, type: CMD.BUILD, faction: fid, stype: p.type, squadIds: [builder.id] }); return; }
  }
  if (material < 200) {
    let node = null, best = 180 * policy.expansion;
    for (const n of sim.state.nodes) {
      if (n.amount <= 0 || !(n.seenBy & sideBit(fid)) || huntThreat(sim, fid, n.x, n.z, 45)) continue;
      const d = dist(builder.cx, builder.cz, n.x, n.z);
      if (d < best) { best = d; node = n; }
    }
    if (node) aiIssue(sim, { type: CMD.SALVAGE_AREA, faction: fid, squadIds: [builder.id], x: node.x, z: node.z });
  }
}
function train(sim, fid, ai, p) {
  if (sim.state.tick < ai.nextTrain) return;
  ai.nextTrain = sim.state.tick + 60;
  const azeb = count(sim, fid, 'azeb'), jan = count(sim, fid, 'janissary'), support = count(sim, fid, 'jabirean_alchemist');
  const choices = [];
  if (count(sim, fid, 'sultanate_sapper') < Math.min(4, Math.ceil(2 * p.engineers))) choices.push('sultanate_sapper');
  if (jan < Math.max(1, Math.ceil(azeb * p.elite / 3))) choices.push('janissary');
  if (support < Math.min(5, Math.ceil((azeb + jan) * p.support / 6))) choices.push('jabirean_alchemist');
  choices.push('azeb');
  for (const type of choices) for (const st of sim.state.structures) {
    if (st.faction !== fid || !st.built || !st.queue || st.queue.length || !STRUCTURES[st.type].trains.includes(type)) continue;
    if (!unlockedBySpec(sim.state, fid, unitDef(type)) || !canAfford(sim.state.factions[fid].resources, unitCost(sim.state, fid, type))) continue;
    if (type === 'janissary' && sim.state.factions[fid].resources.material < 55 + 55 * p.defense) continue;
    aiIssue(sim, { type: CMD.TRAIN, faction: fid, sid: st.id, unit: type }); return;
  }
}
function move(sim, fid, q, p) {
  if (q.engaged || q.order.t === 'storm' || q.order.t === 'garrison' || q.order.t === 'hold_trench') return;
  if (q.order.t === 'move' && dist(q.order.x, q.order.z, p[0], p[1]) < 8) return;
  if (dist(q.cx, q.cz, p[0], p[1]) > 6) aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: [q.id], x: p[0], z: p[1], attackMove: true });
}
function manoeuvre(sim, fid, ai, strategy, p) {
  if (sim.state.tick < ai.nextOrder) return;
  ai.nextOrder = sim.state.tick + 100;
  const combat = sim.state.squads.filter((q) => q.faction === fid && commandable(q) && unitDef(q.type).combatUnit && q.members.some((m) => m.state === 'alive'));
  const home = sideAnchor(sim, fid, 'home'), reserve = sideAnchor(sim, fid, 'reserve'), fw = sideForward(sim, fid);
  const bit = sideBit(fid);
  let threat = null, best = 125;
  for (const q of sim.state.squads) {
    if (!areHostile(fid, q.faction) || !(q.visibleTo & bit) || !q.members.some((m) => m.state === 'alive')) continue;
    const d = dist(q.cx, q.cz, home[0], home[1]);
    if (d < best) { best = d; threat = q; }
  }
  const aggression = aggressionScore(sim, fid, ai), war = sim.state.tick - sim.state.match.prepEndTick;
  const push = sim.state.match.phase === 'WAR' && war > strategy.firstPushSec * 20 * p.cadence &&
    aggression > (strategy.holdHome ? 1.5 : 0.85) && combat.length > Math.ceil(strategy.reserve * p.reserve);
  const wave = Math.max(2, Math.round(strategy.waveSize * p.wave)), enemy = enemyHomeAnchor(sim, fid);
  let sent = 0, eliteKept = 0;
  for (const q of combat) {
    const d = unitDef(q.type), elite = hasRole(d, 'counterattack'), support = hasRole(d, 'support');
    let goal = reserve;
    if (threat) goal = [threat.cx - fw[0] * (support ? 14 : 0), threat.cz - fw[1] * (support ? 14 : 0)];
    else if (push && sent < wave && (!elite || ++eliteKept > Math.max(1, Math.floor(p.reserve)))) {
      goal = support ? [enemy[0] - fw[0] * 12, enemy[1] - fw[1] * 12] : enemy; sent++;
    } else if (hasRole(d, 'screen')) goal = [home[0] - fw[1] * ((q.id % 5 - 2) * 11) + fw[0] * 42, home[1] + fw[0] * ((q.id % 5 - 2) * 11) + fw[1] * 42];
    move(sim, fid, q, goal);
  }
}
export const ironSultanateAI = {
  id: 'iron_sultanate',
  init() { return { nextBuild: 0, nextTrain: 0, nextOrder: 0, planIndex: 0 }; },
  think(sim, fid, ai) {
    const strategy = strategyFor(baseFaction(fid), sim.state.factions[fid].role), p = policyFor(sim.state, fid);
    aiPickSpeciality(sim, fid, ai, (tier, ids) => {
      let plague = 0; for (const c of sim.state.corpses) if (c.infected && (c.seenBy & sideBit(fid))) plague++;
      const w = {}; for (const id of ids) w[id] = 3;
      if (plague > 3) w[['is_alchemy', 'is_fire_cordon', 'is_purifying_fire'][tier]] = 18;
      return w;
    });
    build(sim, fid, ai, strategy, p); train(sim, fid, ai, p); manoeuvre(sim, fid, ai, strategy, p);
  },
};
