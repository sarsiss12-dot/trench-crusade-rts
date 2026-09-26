// New Antioch defender AI: layered defence around the objective.
//  - engineers dig/build the map's defence plan (trench, wire, sandbags, fire positions,
//    observation post, supply cache) through the normal BUILD pipeline; repair damage; salvage
//  - rifle squads garrison trenches (auto-slot occupancy), spread across segments
//  - heavy squads form a reserve that counter-attacks breaches near the objective
//  - depleted squads walk back for replacements; bastion trains new squads when affordable
//  - artillery barrage on visible massed attackers in front of the line
import { unitDef, hasRole } from '../data/units.js';
import { ABILITIES } from '../data/abilities.js';
import { STRUCTURES } from '../data/structures.js';
import { FACTIONS, areHostile } from '../data/factions.js';
import { CMD } from '../sim/commands.js';
import { dist } from '../core/dmath.js';
import { validatePlacement } from '../construction/construction.js';
import { trenchSlotCount } from '../construction/trench.js';
import { aiIssue } from './issue.js';

function squadsOf(sim, fid) {
  return sim.state.squads.filter((sq) => sq.faction === fid && sq.members.some((m) => m.state === 'alive' || m.state === 'joining'));
}

function alive(sq) {
  let n = 0;
  for (const m of sq.members) if (m.state === 'alive' || m.state === 'joining') n++;
  return n;
}

function planDone(sim, fid, item) {
  for (const s of sim.state.structures) {
    if (s.type !== item.type || s.faction !== fid) continue;
    if (item.x1 !== undefined) {
      if (dist(s.x, s.z, (item.x1 + item.x2) / 2, (item.z1 + item.z2) / 2) < 3) return s;
    } else if (dist(s.x, s.z, item.x, item.z) < 3) return s;
  }
  return null;
}

export const newAntiochAI = {
  init() {
    return { planIndex: 0, reserveIds: [], lastTrain: -10000, lastArtillery: 0, lastRepairScan: 0, threat: null };
  },

  think(sim, fid, ai) {
    const { state } = sim;
    const squads = squadsOf(sim, fid);
    const stress = sim.scenario && sim.scenario.mode === 'stress';
    if (!stress) {
      this.engineers(sim, fid, ai, squads);
      this.garrison(sim, fid, ai, squads);
    }
    if (state.match.phase === 'WAR') {
      this.reserve(sim, fid, ai, squads);
      this.reinforce(sim, fid, ai, squads);
      this.train(sim, fid, ai, squads);
      this.artillery(sim, fid, ai, squads);
    }
  },

  engineers(sim, fid, ai, squads) {
    const { state, world } = sim;
    const f = state.factions[fid];
    const engineers = squads.filter((sq) => hasRole(unitDef(sq.type), 'builder'));
    const bit = 1 << FACTIONS[fid].index;
    const busyTargets = new Set();
    for (const e of engineers) if (e.order.sid) busyTargets.add(e.order.sid);
    for (const e of engineers) {
      const o = e.order;
      if (o.t === 'build' || o.t === 'repair') continue;
      if (o.t === 'gather' && (f.resources.material || 0) < 160) continue;
      // 1) repairs (war damage) — objective first
      if (state.match.phase === 'WAR') {
        let rep = null, worst = 0.72;
        for (const s of state.structures) {
          if (s.faction !== fid || !s.built || busyTargets.has(s.id)) continue;
          const ratio = s.hp / s.maxHp;
          const w = s.objective ? ratio - 0.15 : ratio;
          if (w < worst) {
            // do not walk into an active melee
            let hot = false;
            for (const en of state.squads) if (areHostile(fid, en.faction) && (en.visibleTo & bit) && dist(en.cx, en.cz, s.x, s.z) < 18) { hot = true; break; }
            if (!hot) { worst = w; rep = s; }
          }
        }
        if (rep && (f.resources.material || 0) > 20) {
          aiIssue(sim, { type: CMD.REPAIR, faction: fid, squadIds: [e.id], sid: rep.id });
          busyTargets.add(rep.id);
          continue;
        }
      }
      // 2) unfinished own sites
      let site = null, sd = 1e9;
      for (const s of state.structures) {
        if (s.faction !== fid || s.built || busyTargets.has(s.id)) continue;
        const d = dist(e.x, e.z, s.x, s.z);
        if (d < sd) { sd = d; site = s; }
      }
      if (site) {
        aiIssue(sim, { type: CMD.ASSIST_BUILD, faction: fid, squadIds: [e.id], sid: site.id });
        busyTargets.add(site.id);
        continue;
      }
      // 3) next defence plan item
      let placed = false;
      const plan = world.defensePlan;
      for (let k = 0; k < plan.length; k++) {
        const item = plan[k];
        if (planDone(sim, fid, item)) continue;
        const params = item.x1 !== undefined ? { x1: item.x1, z1: item.z1, x2: item.x2, z2: item.z2 } : { x: item.x, z: item.z, rot: item.rot || 0 };
        const v = validatePlacement(sim, fid, item.type, params);
        if (!v.ok) continue;
        aiIssue(sim, { type: CMD.BUILD, faction: fid, squadIds: [e.id], stype: item.type, ...params });
        placed = true;
        break;
      }
      if (placed) continue;
      // 4) salvage material when low and the node is safe
      if ((f.resources.material || 0) < 200 && o.t !== 'gather') {
        let node = null, nd = 1e9;
        for (const n of state.nodes) {
          if (n.amount <= 0 || !(n.seenBy & bit)) continue;
          let unsafe = false;
          for (const en of state.squads) if (areHostile(fid, en.faction) && (en.visibleTo & bit) && dist(en.cx, en.cz, n.x, n.z) < 60) { unsafe = true; break; }
          if (unsafe) continue;
          const d = dist(e.x, e.z, n.x, n.z);
          if (d < nd) { nd = d; node = n; }
        }
        if (node) aiIssue(sim, { type: CMD.GATHER, faction: fid, squadIds: [e.id], nid: node.id });
      }
    }
  },

  garrison(sim, fid, ai, squads) {
    const { state } = sim;
    const trenches = state.structures
      .filter((s) => s.type === 'trench' && s.faction === fid && (s.built || s.progress >= 0.35))
      .sort((a, b) => a.x - b.x || a.id - b.id);
    if (!trenches.length) return;
    const line = squads.filter((sq) => {
      const d = unitDef(sq.type);
      return d.combatUnit && d.canGarrison && !d.heavy && ai.reserveIds.indexOf(sq.id) < 0;
    });
    // capacity-aware spread: each squad to the least-filled segment near its position
    const load = new Map(trenches.map((t) => [t.id, 0]));
    for (const sq of line) if (sq.order.t === 'hold_trench' && load.has(sq.order.sid)) load.set(sq.order.sid, load.get(sq.order.sid) + alive(sq));
    for (const sq of line) {
      const o = sq.order;
      if (o.t === 'hold_trench' || o.t === 'reinforce' || (o.t === 'move' && o.trench) || sq.engaged) continue;
      if (o.t !== 'idle') continue;
      let best = null, bestScore = 1e9;
      for (const t of trenches) {
        const cap = trenchSlotCount(t);
        const used = load.get(t.id) || 0;
        if (used >= cap) continue;
        const score = used * 40 + dist(sq.x, sq.z, t.x, t.z);
        if (score < bestScore) { bestScore = score; best = t; }
      }
      if (!best) continue;
      load.set(best.id, (load.get(best.id) || 0) + alive(sq));
      aiIssue(sim, { type: CMD.ENTER_TRENCH, faction: fid, squadIds: [sq.id], sid: best.id, x: best.x, z: best.z });
    }
  },

  reserve(sim, fid, ai, squads) {
    const { state, world } = sim;
    const bit = 1 << FACTIONS[fid].index;
    // heavies are the reserve
    ai.reserveIds = squads.filter((sq) => unitDef(sq.type).heavy).map((sq) => sq.id);
    const objective = state.structures.find((s) => s.objective && s.faction === fid);
    if (!objective) return;
    // threat: nearest visible hostile squad close to the line/objective
    let threat = null, td = 95;
    for (const e of state.squads) {
      if (!areHostile(fid, e.faction) || !(e.visibleTo & bit)) continue;
      const d = dist(e.cx, e.cz, objective.x, objective.z);
      if (d < td) { td = d; threat = e; }
    }
    const home = world.anchors.na_reserve[0];
    for (const id of ai.reserveIds) {
      const sq = sim.rt.squadById.get(id);
      if (!sq) continue;
      if (threat) {
        if (sq.order.t !== 'attack' || sq.order.tid !== threat.id) {
          if (!sq.engaged) aiIssue(sim, { type: CMD.ATTACK, faction: fid, squadIds: [id], tk: 'squad', tid: threat.id });
        }
      } else if (sq.order.t === 'idle' && dist(sq.x, sq.z, home[0], home[1]) > 12) {
        aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: [id], x: home[0], z: home[1] });
      }
    }
  },

  reinforce(sim, fid, ai, squads) {
    const f = sim.state.factions[fid];
    if ((f.resources.manpower || 0) < 2) return;
    for (const sq of squads) {
      const def = unitDef(sq.type);
      if (!def.combatUnit || sq.engaged || sq.order.t === 'reinforce') continue;
      if (sim.state.tick - sq.lastHitTick < 20 * 8) continue;
      if (alive(sq) >= Math.ceil(def.squadSize * 0.6)) continue;
      aiIssue(sim, { type: CMD.REINFORCE, faction: fid, squadIds: [sq.id] });
    }
  },

  train(sim, fid, ai, squads) {
    const { state, world } = sim;
    const f = state.factions[fid];
    const bastion = state.structures.find((s) => s.faction === fid && s.built && s.queue && STRUCTURES[s.type].trains);
    if (!bastion || bastion.queue.length) return;
    if (state.tick - ai.lastTrain < 20 * 5) return;
    const engineers = squads.filter((sq) => hasRole(unitDef(sq.type), 'builder')).length;
    const heavies = squads.filter((sq) => unitDef(sq.type).heavy).length;
    let unit = null;
    const r = f.resources;
    const artilleryReserve = 60;
    if (engineers < 2 && r.manpower >= 5 && r.material >= 40) unit = 'combat_engineer';
    else if (heavies < 2 && r.manpower >= 3 && r.supply >= 110 + artilleryReserve && r.material >= 90) unit = 'mech_heavy';
    else if (r.manpower >= 8 && r.supply >= 50 + artilleryReserve) unit = 'yeoman_rifle';
    if (!unit) return;
    ai.lastTrain = state.tick;
    const line = world.anchors.na_line;
    const rally = line[Math.floor(line.length / 2)];
    aiIssue(sim, { type: CMD.SET_RALLY, faction: fid, sid: bastion.id, x: rally[0], z: rally[1] });
    aiIssue(sim, { type: CMD.TRAIN, faction: fid, sid: bastion.id, unit });
  },

  artillery(sim, fid, ai, squads) {
    const { state } = sim;
    const f = state.factions[fid];
    const ab = ABILITIES.artillery_barrage;
    const st = f.abilities.artillery_barrage;
    if (!st || st.readyTick > state.tick || (f.resources.supply || 0) < ab.cost.supply + 30) return;
    if (state.tick - ai.lastArtillery < 40) return;
    ai.lastArtillery = state.tick;
    const bit = 1 << FACTIONS[fid].index;
    let best = null, bestN = 11;
    for (const e of state.squads) {
      if (!areHostile(fid, e.faction) || !(e.visibleTo & bit)) continue;
      // danger-close check: never shell our own squads
      let close = false;
      for (const s of squads) if (dist(s.cx, s.cz, e.cx, e.cz) < ab.radius + 8) { close = true; break; }
      if (close) continue;
      let n = 0;
      for (const o of state.squads) {
        if (o.faction !== e.faction || !(o.visibleTo & bit)) continue;
        if (dist(o.cx, o.cz, e.cx, e.cz) < ab.radius) n += alive(o);
      }
      if (n > bestN) { bestN = n; best = e; }
    }
    if (best) aiIssue(sim, { type: CMD.USE_ABILITY, faction: fid, ability: 'artillery_barrage', x: best.cx, z: best.cz });
  },
};
