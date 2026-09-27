// New Antioch defender AI: layered defence around the objective.
//  - engineers dig/build the map's defence plan (trench, wire, sandbags, fire positions,
//    observation post, supply cache) through the normal BUILD pipeline; repair damage; salvage
//  - rifle squads garrison trenches (auto-slot occupancy), spread across segments
//  - heavy squads form a reserve that counter-attacks breaches near the objective
//  - depleted squads request replacements (they hold their ground; replacements walk to them);
//    bastion trains new squads when affordable
//  - artillery barrage on visible massed attackers in front of the line; mortar barrage pins
//    smaller groups closing on the wire
//  - Phase 2 plan items (aid station, ammunition dump, muster point, signal post, walls,
//    workshop) come from the same map defence plan; the reserve holds facing the front
//  - Phase 3: EXPANSION (ai/new_antioch_econ.js) — settlements on known sectors, farms / pens /
//    quarries, light works in front of exposed settlements, evacuation, pens; spare rifle squads
//    guard settlements, the reserve also answers raids on them; engineers burn infected dead
//    (SANITIZE); medics / flamers / clerics / lieutenant join the order of battle; speciality
//    choices (ai/spec_pick.js); PURGE with the Purification doctrine
import { UNITS, unitDef, hasRole } from '../data/units.js';
import { ABILITIES } from '../data/abilities.js';
import { STRUCTURES } from '../data/structures.js';
import { FACTIONS, areHostile } from '../data/factions.js';
import { CMD } from '../sim/commands.js';
import { dist } from '../core/dmath.js';
import { validatePlacement } from '../construction/construction.js';
import { trenchSlotCount, trenchNetwork, networkCapacity } from '../construction/trench.js';
import { unlockedBySpec, unitMaxSquads, unitCost, specHas, matchProgress } from '../sim/specialities.js';
import { aiIssue } from './issue.js';
import { aiPickSpeciality } from './spec_pick.js';
import {
  economyBuild, economyUpkeep, sanitizeSpot, purgeSpot, ownSettlements, exposure, hostilesNear,
} from './new_antioch_econ.js';

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
    return {
      planIndex: 0, reserveIds: [], lastTrain: -10000, lastArtillery: 0, lastRepairScan: 0, threat: null,
      // Phase 3 expansion memory (plain data: saved with the match)
      avoid: {}, owned: {}, seenThreat: {}, guards: {}, ecoTurn: 0, lastSanitize: -10000, lastPurge: -10000,
    };
  },

  think(sim, fid, ai) {
    const { state } = sim;
    // older saves: expansion memory appears on first think
    if (!ai.avoid) { ai.avoid = {}; ai.owned = {}; ai.seenThreat = {}; ai.guards = {}; ai.ecoTurn = 0; ai.lastSanitize = -10000; ai.lastPurge = -10000; }
    const squads = squadsOf(sim, fid);
    const stress = sim.scenario && sim.scenario.mode === 'stress';
    if (!stress) {
      aiPickSpeciality(sim, fid, ai, (tier) => this.specWeights(sim, fid, tier));
      if ((state.tick + 3) % 20 < 10) economyUpkeep(sim, fid, ai);
      this.engineers(sim, fid, ai, squads);
      this.garrison(sim, fid, ai, squads);
      if (state.match.phase === 'WAR') this.guards(sim, fid, ai, squads);
    }
    if (state.match.phase === 'WAR') {
      this.reserve(sim, fid, ai, squads);
      this.reinforce(sim, fid, ai, squads);
      this.train(sim, fid, ai, squads);
      this.artillery(sim, fid, ai, squads);
      this.mortar(sim, fid, ai, squads);
      if (!stress) this.purge(sim, fid, ai);
    }
  },

  /** Speciality weights from what the faction sees: settlements, infection among its men. */
  specWeights(sim, fid, tier) {
    const { state } = sim;
    let infected = 0;
    for (const sq of state.squads) if (sq.faction === fid) for (const m of sq.members) if (m.state === 'alive' && m.infection > 0) infected++;
    const settl = ownSettlements(state, fid).length;
    if (tier === 0) return { na_fortification: 4, na_logistics: 3.5, na_faith: 2.5 + (infected > 3 ? 2 : 0) };
    if (tier === 1) return settl >= 2 ? { na_fortified_settlements: 5, na_artillery: 3, na_mechanised: 2 } : { na_artillery: 4.5, na_mechanised: 3.5, na_fortified_settlements: 2 };
    return { na_purification: 3 + (infected > 4 ? 4 : 0), na_elite: 3.5, na_adv_logistics: 3.5 };
  },

  engineers(sim, fid, ai, squads) {
    const { state, world } = sim;
    const f = state.factions[fid];
    const engineers = squads.filter((sq) => hasRole(unitDef(sq.type), 'builder'));
    const bit = 1 << FACTIONS[fid].index;
    const busyTargets = new Set();
    for (const e of engineers) if (e.order.sid) busyTargets.add(e.order.sid);
    let placedEco = false; // one economy placement per think (commands resolve next tick)
    for (const e of engineers) {
      const o = e.order;
      if (o.t === 'build' || o.t === 'repair' || o.t === 'sanitize') continue;
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
      // 1b) infected dead near our lines: burn them before they rise (one crew at a time)
      if (state.match.phase === 'WAR' && state.tick - ai.lastSanitize > 20 * 12 && (f.resources.supply || 0) > 60 && o.t !== 'sanitize') {
        let sanitizing = false;
        for (const x of engineers) if (x.order.t === 'sanitize') sanitizing = true;
        const spot = sanitizing ? null : sanitizeSpot(sim, fid);
        ai.lastSanitize = state.tick;
        if (spot) { aiIssue(sim, { type: CMD.SANITIZE, faction: fid, squadIds: [e.id], x: spot.x, z: spot.z }); continue; }
      }
      if (o.t === 'sanitize') continue;
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
      // 3) economy and the defence plan take turns (the first settlement goes up early in the
      //    preparation, right after the first line of trenches)
      const plan = world.defensePlan;
      let planLeft = 0, planDoneN = 0;
      for (const item of plan) { if (planDone(sim, fid, item)) planDoneN++; else planLeft++; }
      const ecoFirst = ai.ecoTurn % 2 === 1 || !planLeft || (state.match.phase === 'PREPARATION' && planDoneN >= 2);
      if (ecoFirst && !placedEco) {
        const item = economyBuild(sim, fid, ai);
        placedEco = true;
        if (item) {
          aiIssue(sim, { type: CMD.BUILD, faction: fid, squadIds: [e.id], ...item });
          ai.ecoTurn++;
          continue;
        }
      }
      let placed = false;
      for (let k = 0; k < plan.length; k++) {
        const item = plan[k];
        if (planDone(sim, fid, item)) continue;
        const params = item.x1 !== undefined ? { x1: item.x1, z1: item.z1, x2: item.x2, z2: item.z2 } : { x: item.x, z: item.z, rot: item.rot || 0 };
        const v = validatePlacement(sim, fid, item.type, params);
        if (!v.ok) continue;
        aiIssue(sim, { type: CMD.BUILD, faction: fid, squadIds: [e.id], stype: item.type, ...params });
        placed = true;
        ai.ecoTurn++;
        break;
      }
      if (placed) continue;
      if (!placedEco) {
        const item = economyBuild(sim, fid, ai);
        placedEco = true;
        if (item) { aiIssue(sim, { type: CMD.BUILD, faction: fid, squadIds: [e.id], ...item }); continue; }
      }
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
    // capacity-aware spread: each squad to the least-filled segment near its position, and only
    // into a network with room for the WHOLE squad (the sim's own rule: no partial squads)
    const load = new Map(trenches.map((t) => [t.id, 0]));
    for (const sq of line) if (sq.order.t === 'hold_trench' && load.has(sq.order.sid)) load.set(sq.order.sid, load.get(sq.order.sid) + alive(sq));
    const netOf = new Map();
    for (const t of trenches) {
      if (netOf.has(t.id)) continue;
      const segs = trenchNetwork(state.structures, t, fid, 12);
      const net = { free: networkCapacity(state, segs, fid, null).free };
      for (const x of segs) netOf.set(x.id, net);
    }
    for (const sq of line) {
      const o = sq.order;
      if (o.t === 'hold_trench' || o.t === 'reinforce' || (o.t === 'move' && o.trench) || sq.engaged) continue;
      if (o.t !== 'idle' || ai.guards[sq.id]) continue;
      const need = alive(sq);
      let best = null, bestScore = 1e9;
      for (const t of trenches) {
        const net = netOf.get(t.id);
        if (!net || net.free < need) continue;
        const cap = trenchSlotCount(t);
        const used = load.get(t.id) || 0;
        const score = (used / cap) * 60 + dist(sq.x, sq.z, t.x, t.z);
        if (score < bestScore) { bestScore = score; best = t; }
      }
      if (!best) continue;
      netOf.get(best.id).free -= need;
      load.set(best.id, (load.get(best.id) || 0) + need);
      aiIssue(sim, { type: CMD.ENTER_TRENCH, faction: fid, squadIds: [sq.id], sid: best.id, x: best.x, z: best.z });
    }
  },

  /**
   * Spare line squads (no room left in the trenches) guard the most exposed settlements: they
   * stand in front of it on attack-move. One guard per settlement; the dead are replaced.
   */
  guards(sim, fid, ai, squads) {
    const { state, rt } = sim;
    if ((state.tick + 7) % 40 >= 10) return;
    for (const id in ai.guards) {
      const sq = rt.squadById.get(Number(id));
      const st = rt.structById.get(ai.guards[id]);
      if (!sq || !st || st.hp <= 0 || !sq.members.some((m) => m.state === 'alive')) delete ai.guards[id];
    }
    const guarded = new Set(Object.values(ai.guards));
    const want = ownSettlements(state, fid)
      .filter((st) => st.built && !guarded.has(st.id) && exposure(sim, fid, st.x, st.z) > 0.22)
      .sort((a, b) => exposure(sim, fid, b.x, b.z) - exposure(sim, fid, a.x, a.z) || a.id - b.id);
    if (!want.length) return;
    const spare = squads.filter((sq) => {
      const d = unitDef(sq.type);
      return d.combatUnit && d.canGarrison && !d.heavy && !ai.guards[sq.id] && ai.reserveIds.indexOf(sq.id) < 0 &&
        sq.order.t === 'idle' && !sq.engaged && state.tick - sq.spawnTick > 20 * 8;
    });
    for (const st of want) {
      const sq = spare.shift();
      if (!sq) break;
      ai.guards[sq.id] = st.id;
      const e = sim.world.anchors.home_bg ? sim.world.anchors.home_bg[0] : [st.x, 0];
      const dx = e[0] - st.x, dz = e[1] - st.z, d = Math.max(1, Math.sqrt(dx * dx + dz * dz));
      aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: [sq.id], x: st.x + (dx / d) * 12, z: st.z + (dz / d) * 12, attackMove: true });
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
    // no threat at the walls: a raid on a settlement close enough to answer
    if (!threat) {
      let best = 50;
      for (const st of ownSettlements(state, fid)) {
        if (!st.built || dist(st.x, st.z, objective.x, objective.z) > 190) continue;
        for (const e of state.squads) {
          if (!areHostile(fid, e.faction) || !(e.visibleTo & bit)) continue;
          const d = dist(e.cx, e.cz, st.x, st.z);
          if (d < best) { best = d; threat = e; }
        }
      }
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
        // back to the reserve position, facing the front (north: PI)
        aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: [id], x: home[0], z: home[1], face: Math.PI });
      }
    }
  },

  reinforce(sim, fid, ai, squads) {
    const f = sim.state.factions[fid];
    if ((f.resources.manpower || 0) < 2) return;
    // ammunition first: replacements are only requested while supply stays above the ammo reserve
    if ((f.resources.supply || 0) < 55) return;
    if (sim.state.tick - (ai.lastReinf || -1e9) < 40) return;
    ai.lastReinf = sim.state.tick;
    for (const sq of squads) {
      const def = unitDef(sq.type);
      // the squad keeps holding its post; replacements walk up to it (even under fire)
      if (!def.combatUnit || sq.reinf) continue;
      if (sim.state.tick - sq.lastHitTick < 20 * 3) continue;
      if (sq.members.length >= Math.ceil(def.squadSize * 0.75)) continue;
      aiIssue(sim, { type: CMD.REINFORCE, faction: fid, squadIds: [sq.id] });
    }
  },

  train(sim, fid, ai, squads) {
    const { state, world } = sim;
    const f = state.factions[fid];
    const bastion = state.structures.find((s) => s.faction === fid && s.built && s.queue && STRUCTURES[s.type].hq);
    if (!bastion || bastion.queue.length) return;
    if (state.tick - ai.lastTrain < 20 * 5) return;
    const count = (type) => squads.filter((sq) => sq.type === type).length;
    const engineers = squads.filter((sq) => hasRole(unitDef(sq.type), 'builder')).length;
    const heavies = squads.filter((sq) => unitDef(sq.type).heavy).length;
    const r = f.resources;
    const artilleryReserve = 60;
    const can = (type, reserve = artilleryReserve) => {
      const u = UNITS[type];
      if (!unlockedBySpec(state, fid, u)) return false;
      // structure-gated units (flamer teams need a finished workshop)
      if (u.requiresStructure && !state.structures.some((s) => s.faction === fid && s.type === u.requiresStructure && s.built)) return false;
      const max = unitMaxSquads(state, fid, type);
      if (max && count(type) >= max) return false;
      const c = unitCost(state, fid, type);
      for (const k in c) if ((r[k] || 0) < c[k] + (k === 'supply' ? reserve : 0)) return false;
      return true;
    };
    // what the faction sees of the plague and the horde
    const bit = 1 << FACTIONS[fid].index;
    let horde = 0, infectedDead = 0;
    for (const e of state.squads) if (areHostile(fid, e.faction) && (e.visibleTo & bit)) horde += alive(e);
    for (const c of state.corpses) if (c.infected && (c.seenBy & bit)) infectedDead++;
    const settlements = ownSettlements(state, fid).length;
    let unit = null;
    if (engineers < (settlements >= 2 ? 3 : 2) && r.manpower >= 5 && r.material >= 40) unit = 'combat_engineer';
    else if (heavies < 2 && can('mech_heavy')) unit = 'mech_heavy';
    else if (can('trench_cleric')) unit = 'trench_cleric';
    else if (can('na_lieutenant')) unit = 'na_lieutenant';
    else if (count('combat_medic') < 1 && matchProgress(state) > 0.08 && can('combat_medic')) unit = 'combat_medic';
    else if (count('shock_flamer') < (specHas(state, fid, 'na_purification') ? 2 : 1) && (horde >= 24 || infectedDead >= 4) && can('shock_flamer')) unit = 'shock_flamer';
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

  /** PURGE (Purification doctrine): fire and prayer over a visible cluster of infected dead. */
  purge(sim, fid, ai) {
    const { state } = sim;
    const f = state.factions[fid];
    const st = f.abilities.purge;
    if (!st || st.readyTick > state.tick || !unlockedBySpec(state, fid, ABILITIES.purge)) return;
    if ((f.resources.supply || 0) < ABILITIES.purge.cost.supply + 60 || state.tick - ai.lastPurge < 40) return;
    ai.lastPurge = state.tick;
    const spot = purgeSpot(sim, fid);
    if (spot && hostilesNear(sim, fid, spot.x, spot.z, 10) === 0) aiIssue(sim, { type: CMD.USE_ABILITY, faction: fid, ability: 'purge', x: spot.x, z: spot.z });
  },

  /** Mortar: smaller, closer groups approaching the line (suppression / area denial). */
  mortar(sim, fid, ai, squads) {
    const { state } = sim;
    const f = state.factions[fid];
    const ab = ABILITIES.mortar_barrage;
    const st = f.abilities.mortar_barrage;
    if (!st || st.readyTick > state.tick || (f.resources.supply || 0) < ab.cost.supply + 50) return;
    if (state.tick - (ai.lastMortar || -1e9) < 30) return;
    ai.lastMortar = state.tick;
    const bit = 1 << FACTIONS[fid].index;
    const objective = state.structures.find((s) => s.objective && s.faction === fid);
    if (!objective) return;
    let best = null, bestN = 5;
    for (const e of state.squads) {
      if (!areHostile(fid, e.faction) || !(e.visibleTo & bit)) continue;
      const d = dist(e.cx, e.cz, objective.x, objective.z);
      if (d > 110 || d < 30) continue;
      let close = false;
      for (const s of squads) if (dist(s.cx, s.cz, e.cx, e.cz) < ab.radius + 6) { close = true; break; }
      if (close) continue;
      const n = alive(e);
      if (n > bestN) { bestN = n; best = e; }
    }
    if (best) aiIssue(sim, { type: CMD.USE_ABILITY, faction: fid, ability: 'mortar_barrage', x: best.cx, z: best.cz });
  },
};
