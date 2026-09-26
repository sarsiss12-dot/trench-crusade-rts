// Black Grail attacker AI: lanes, probes, assault waves, pressure and weak-point search.
//  PREPARATION: deploy groups to lane staging points inside the deployment zone.
//  WAR: existing combat squads assault immediately (no "wait 45s then spawn" script).
//  - groups advance waypoint by waypoint with attack-move; idle squads are re-ordered
//  - failed paths are retried, then re-routed to another lane
//  - lane danger grows with losses -> reinforcements pick the weakest-defended lane
//  - Fly Swarm is cast on entrenched / clustered visible defenders
//  - biomass is spent raising hordes at Altars; risen dead join the nearest assault
// Noncombat squads never join assault groups (combatUnit flag, not unit names).
import { unitDef } from '../data/units.js';
import { ABILITIES } from '../data/abilities.js';
import { FACTIONS, areHostile } from '../data/factions.js';
import { CMD } from '../sim/commands.js';
import { dist } from '../core/dmath.js';
import { rngFloat } from '../core/rng.js';
import { aiIssue } from './issue.js';

const LANES = ['west', 'center', 'east'];
const WAYPOINT_REACHED = 16;

function combatSquads(sim, fid) {
  return sim.state.squads.filter((sq) => sq.faction === fid && unitDef(sq.type).combatUnit && sq.members.some((m) => m.state === 'alive' || m.state === 'rising'));
}

function aliveCount(sq) {
  let n = 0;
  for (const m of sq.members) if (m.state === 'alive' || m.state === 'rising') n++;
  return n;
}

function groupById(ai, id) {
  for (const g of ai.groups) if (g.id === id) return g;
  return null;
}

function newGroup(ai, lane, role) {
  const g = { id: ai.nextGroupId++, lane, role, stage: 0, mode: 'forming', squadIds: [], formedTick: 0, peak: 0, lostSince: 0 };
  ai.groups.push(g);
  return g;
}

function laneWaypoint(sim, lane, stage) {
  const pts = sim.world.lanes[lane];
  return pts[Math.max(0, Math.min(stage, pts.length - 1))];
}

/** Stage index (next waypoint) along a lane for a position: nearest polyline segment + 1. */
function laneStageFor(sim, lane, x, z) {
  const pts = sim.world.lanes[lane];
  let best = 0, bestD = Infinity;
  for (let k = 0; k < pts.length - 1; k++) {
    const ax = pts[k][0], az = pts[k][1], bx = pts[k + 1][0], bz = pts[k + 1][1];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = dist(x, z, ax + dx * t, az + dz * t);
    if (d < bestD) { bestD = d; best = k; }
  }
  return best + 1;
}

function safestLane(ai, rng) {
  let best = LANES[0], bestD = Infinity;
  for (const l of LANES) {
    const d = ai.danger[l] + rngFloat(rng) * 0.5; // small deterministic jitter breaks ties
    if (d < bestD) { bestD = d; best = l; }
  }
  return best;
}

function groupCentroid(sim, g, out) {
  let n = 0, x = 0, z = 0;
  for (const id of g.squadIds) {
    const sq = sim.rt.squadById.get(id);
    if (!sq) continue;
    x += sq.cx; z += sq.cz; n++;
  }
  if (!n) return null;
  out[0] = x / n; out[1] = z / n;
  return out;
}
const C = [0, 0];

export const blackGrailAI = {
  init(sim, fid) {
    const ai = {
      phase: 'deploy', groups: [], nextGroupId: 1,
      danger: { west: 0, center: 0, east: 0 },
      lastLosses: 0, lastAbilityCheck: 0, trainCounter: 0, altarIndex: 0, retry: {}, stage: {},
      launchedTick: 0,
    };
    // initial groups by lateral position (west/center/east); elites strengthen the center
    const squads = combatSquads(sim, fid).sort((a, b) => a.x - b.x || a.id - b.id);
    const groups = { west: newGroup(ai, 'west', 'main'), center: newGroup(ai, 'center', 'main'), east: newGroup(ai, 'east', 'probe') };
    const W = sim.world.width;
    for (const sq of squads) {
      const def = unitDef(sq.type);
      let lane = sq.x < W * 0.4 ? 'west' : sq.x > W * 0.6 ? 'east' : 'center';
      if (def.roles.indexOf('shock') >= 0) lane = 'center';
      groups[lane].squadIds.push(sq.id);
      sq.aiGroup = groups[lane].id;
    }
    return ai;
  },

  think(sim, fid, ai) {
    const { state } = sim;
    const f = state.factions[fid];
    // --- bookkeeping: prune dead squads, pick up unassigned combat squads
    const squads = combatSquads(sim, fid);
    const alive = new Set(squads.map((s) => s.id));
    for (const g of ai.groups) g.squadIds = g.squadIds.filter((id) => alive.has(id));
    for (const k in ai.stage) if (!alive.has(Number(k))) delete ai.stage[k];
    for (const k in ai.retry) if (!alive.has(Number(k))) delete ai.retry[k];
    // lane danger from losses (weak point search)
    const losses = f.stats.losses;
    if (losses > ai.lastLosses) {
      const delta = losses - ai.lastLosses;
      // attribute to lanes with active advancing groups (proportional to presence)
      const active = ai.groups.filter((g) => g.mode === 'advance' && g.squadIds.length);
      for (const g of active) ai.danger[g.lane] += delta / Math.max(1, active.length);
      ai.lastLosses = losses;
    }
    for (const l of LANES) ai.danger[l] *= 0.995;

    for (const sq of squads) {
      if (sq.aiGroup && groupById(ai, sq.aiGroup)) continue;
      // unassigned: risen dead / fresh from the altar
      if (ai.phase === 'assault') {
        // join the nearest advancing group if close, else form a new wave
        let best = null, bestD = 90;
        for (const g of ai.groups) {
          if (g.mode !== 'advance' || !g.squadIds.length) continue;
          if (!groupCentroid(sim, g, C)) continue;
          const d = dist(sq.cx, sq.cz, C[0], C[1]);
          if (d < bestD) { bestD = d; best = g; }
        }
        if (!best) {
          best = ai.groups.find((g) => g.mode === 'forming');
          if (!best) best = newGroup(ai, safestLane(ai, state.rng.ai), 'wave');
        }
        best.squadIds.push(sq.id);
        sq.aiGroup = best.id;
        if (best.mode === 'advance') {
          ai.stage[sq.id] = best.stage;
          const wp = laneWaypoint(sim, best.lane, best.stage);
          aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: [sq.id], x: wp[0], z: wp[1], attackMove: true });
        }
      } else {
        const g = ai.groups[0] || newGroup(ai, 'center', 'main');
        g.squadIds.push(sq.id);
        sq.aiGroup = g.id;
      }
    }
    ai.groups = ai.groups.filter((g) => g.squadIds.length || g.mode === 'forming');

    if (state.match.phase === 'PREPARATION') {
      this.deploy(sim, fid, ai);
      return;
    }
    if (state.match.phase !== 'WAR') return;
    if (ai.phase === 'deploy') {
      ai.phase = 'assault';
      ai.launchedTick = state.tick;
      for (const g of ai.groups) if (g.squadIds.length) this.launch(sim, fid, ai, g);
    }
    this.manageGroups(sim, fid, ai);
    this.useAbility(sim, fid, ai);
    this.produce(sim, fid, ai);
  },

  deploy(sim, fid, ai) {
    if (ai.deployed) return;
    ai.deployed = true;
    for (const g of ai.groups) {
      const wp = laneWaypoint(sim, g.lane, 0);
      if (g.squadIds.length) aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: g.squadIds.slice(), x: wp[0], z: wp[1] });
    }
  },

  launch(sim, fid, ai, g) {
    g.mode = 'advance';
    g.formedTick = sim.state.tick;
    g.peak = 0;
    // every squad continues from the next waypoint ahead of its current position
    const byStage = new Map();
    let minStage = Infinity;
    for (const id of g.squadIds) {
      const sq = sim.rt.squadById.get(id);
      if (!sq) continue;
      g.peak += aliveCount(sq);
      const st = Math.max(1, laneStageFor(sim, g.lane, sq.cx, sq.cz));
      ai.stage[id] = st;
      if (st < minStage) minStage = st;
      if (!byStage.has(st)) byStage.set(st, []);
      byStage.get(st).push(id);
    }
    g.stage = minStage === Infinity ? 1 : minStage;
    for (const [st, ids] of byStage) {
      const wp = laneWaypoint(sim, g.lane, st);
      aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: ids, x: wp[0], z: wp[1], attackMove: true });
    }
  },

  manageGroups(sim, fid, ai) {
    const { state, rt } = sim;
    const bit = 1 << FACTIONS[fid].index;
    const objective = state.structures.find((s) => s.objective);
    const objKnown = objective && ((objective.visibleTo | objective.seenBy) & bit);
    for (const g of ai.groups) {
      if (!g.squadIds.length) continue;
      if (g.mode === 'forming') {
        // launch the wave when strong enough or after waiting long enough
        if (!g.formedTick) g.formedTick = state.tick;
        if (g.squadIds.length >= 3 || state.tick - g.formedTick > 20 * 40) {
          g.lane = safestLane(ai, state.rng.ai);
          this.launch(sim, fid, ai, g);
        } else {
          const wp = laneWaypoint(sim, g.lane, 0);
          for (const id of g.squadIds) {
            const sq = rt.squadById.get(id);
            if (sq && sq.order.t === 'idle' && dist(sq.cx, sq.cz, wp[0], wp[1]) > 20) aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: [id], x: wp[0], z: wp[1] });
          }
        }
        continue;
      }
      const pts = sim.world.lanes[g.lane];
      const last = pts.length - 1;
      // per-squad stages; a squad may run at most one waypoint ahead of its group's rearmost
      let minStage = last;
      for (const id of g.squadIds) minStage = Math.min(minStage, ai.stage[id] !== undefined ? ai.stage[id] : g.stage);
      g.stage = minStage;
      for (const id of g.squadIds) {
        const sq = rt.squadById.get(id);
        if (!sq) continue;
        if (ai.stage[id] === undefined) ai.stage[id] = g.stage;
        const o = sq.order;
        // retry failed paths, then re-route to a different lane
        if (sq.pathState === 'failed') {
          const n = (ai.retry[id] || 0) + 1;
          ai.retry[id] = n;
          if (n > 3) {
            g.lane = LANES[(LANES.indexOf(g.lane) + 1) % LANES.length];
            ai.retry[id] = 0;
          }
          const w2 = laneWaypoint(sim, g.lane, ai.stage[id]);
          aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: [id], x: w2[0], z: w2[1], attackMove: true });
          continue;
        }
        if (sq.engaged || o.t === 'attack') continue;
        const nearEnd = ai.stage[id] >= last - 1;
        if (objKnown && nearEnd && dist(sq.cx, sq.cz, objective.x, objective.z) < 75) {
          aiIssue(sim, { type: CMD.ATTACK, faction: fid, squadIds: [id], tk: 'struct', tid: objective.id });
          continue;
        }
        if (o.t !== 'idle') continue; // still travelling
        // idle: advance when the current waypoint is reached, otherwise re-issue the order
        const wp = laneWaypoint(sim, g.lane, ai.stage[id]);
        // arrival is judged by the squad anchor (always on its path), not by the centroid a
        // straggler can drag away
        if (dist(sq.x, sq.z, wp[0], wp[1]) < WAYPOINT_REACHED) {
          if (ai.stage[id] < last && ai.stage[id] <= minStage) {
            ai.stage[id]++;
            const nwp = laneWaypoint(sim, g.lane, ai.stage[id]);
            aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: [id], x: nwp[0], z: nwp[1], attackMove: true });
          }
          // else: wait for the rest of the wave
        } else {
          aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: [id], x: wp[0], z: wp[1], attackMove: true });
        }
      }
      // pressure: shattered elite groups fall back to regroup with the next wave (hordes keep pushing)
      let now = 0, horde = true;
      for (const id of g.squadIds) {
        const sq = rt.squadById.get(id);
        if (!sq) continue;
        now += aliveCount(sq);
        if (unitDef(sq.type).roles.indexOf('horde') < 0) horde = false;
      }
      if (!horde && g.peak > 0 && now < g.peak * 0.3 && g.stage < last - 1) {
        g.mode = 'forming';
        g.formedTick = state.tick;
        g.stage = 0;
        for (const id of g.squadIds) ai.stage[id] = 0;
        const back = laneWaypoint(sim, g.lane, 0);
        aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: g.squadIds.slice(), x: back[0], z: back[1] });
      }
    }
  },

  useAbility(sim, fid, ai) {
    const { state } = sim;
    const f = state.factions[fid];
    const ab = ABILITIES.fly_swarm;
    if (!f.abilities.fly_swarm || f.abilities.fly_swarm.readyTick > state.tick) return;
    if ((f.resources.biomass || 0) < ab.cost.biomass) return;
    if (state.tick - ai.lastAbilityCheck < 20) return;
    ai.lastAbilityCheck = state.tick;
    const bit = 1 << FACTIONS[fid].index;
    const own = state.squads.filter((s) => s.faction === fid);
    let best = null, bestScore = 6;
    for (const e of state.squads) {
      if (!areHostile(fid, e.faction) || !(e.visibleTo & bit)) continue;
      let n = 0, entrenched = 0;
      for (const m of e.members) {
        if (m.state !== 'alive') continue;
        n++;
        if (m.postId || m.cover >= 4) entrenched++;
      }
      if (!n) continue;
      let inRange = false;
      for (const s of own) if (dist(s.cx, s.cz, e.cx, e.cz) <= ab.castRange) { inRange = true; break; }
      if (!inRange) continue;
      // neighbours within the swarm radius add value
      let cluster = 0;
      for (const o of state.squads) if (o !== e && o.faction === e.faction && dist(o.cx, o.cz, e.cx, e.cz) < ab.radius) cluster += 3;
      const score = n + entrenched * 1.5 + cluster;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    if (best) aiIssue(sim, { type: CMD.USE_ABILITY, faction: fid, ability: 'fly_swarm', x: best.cx, z: best.cz });
  },

  produce(sim, fid, ai) {
    const { state } = sim;
    const f = state.factions[fid];
    const altars = state.structures.filter((s) => s.faction === fid && s.built && s.queue);
    if (!altars.length) return;
    const busy = altars.filter((a) => a.queue.length > 0).length;
    if (busy >= 2) return;
    // keep a reserve for the swarm when it is almost ready
    const ab = f.abilities.fly_swarm;
    const reserve = ab && ab.readyTick - state.tick < 20 * 10 ? ABILITIES.fly_swarm.cost.biomass : 0;
    ai.trainCounter++;
    let unit = 'grail_thrall';
    if (ai.trainCounter % 5 === 0) unit = 'plague_knight';
    else if (ai.trainCounter % 3 === 0) unit = 'corpse_guard';
    const cost = unitDef(unit).cost.biomass;
    if ((f.resources.biomass || 0) < cost + reserve) { ai.trainCounter--; return; }
    const altar = altars[ai.altarIndex % altars.length];
    ai.altarIndex++;
    const lane = safestLane(ai, state.rng.ai);
    const stage = laneWaypoint(sim, lane, 0);
    aiIssue(sim, { type: CMD.SET_RALLY, faction: fid, sid: altar.id, x: stage[0], z: stage[1] });
    aiIssue(sim, { type: CMD.TRAIN, faction: fid, sid: altar.id, unit });
  },
};
