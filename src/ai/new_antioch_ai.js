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
//  - Phase 4.1: elites spread behind the line (passive auras); a LIMITED COUNTERATTACK on known
//    enemy structures when the walls are quiet (counterattack())
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
import { isLull } from '../sim/lull.js';
import { canGarrison } from '../units/garrison.js';

function squadsOf(sim, fid) {
  return sim.state.squads.filter((sq) => sq.faction === fid && sq.members.some((m) => m.state === 'alive' || m.state === 'joining'));
}

function alive(sq) {
  let n = 0;
  for (const m of sq.members) if (m.state === 'alive') n++; // fighting strength: replacements count once joined
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
      this.ruins(sim, fid, ai, squads);
      this.placeElites(sim, fid, ai, squads);
      if (state.match.phase === 'WAR') this.guards(sim, fid, ai, squads);
    }
    // positional auto reinforcement: trench / garrison squads top themselves up (sim default);
    // reinforce() asks for the open-field squads
    if (state.match.phase === 'WAR') {
      const lull = isLull(state);
      this.reserve(sim, fid, ai, squads);
      if (!stress) this.counterattack(sim, fid, ai, squads);
      this.reinforce(sim, fid, ai, squads, lull);
      this.train(sim, fid, ai, squads);
      // reorganisation windows are no ceasefire: the guns keep answering (the window only speeds
      // up repairs / replacements, which reinforce() and engineers() use)
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
          const ownRuin = STRUCTURES[s.type].garrison && s.holder === fid && !s.collapsed;
          if ((s.faction !== fid && !ownRuin) || !s.built || busyTargets.has(s.id)) continue;
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
      if (ai.gunSite && state.tick - ai.gunSite > 20 * 5) ai.gunSite = 0;
      // 2b) Phase 4: the field gun is a priority once the first line stands (it answers the waves in
      //     no man's land) — placed from the map plan when affordable, one site at a time
      if (!ai.gunSite && (f.resources.material || 0) >= 135 && !state.structures.some((s) => s.faction === fid && s.type === 'field_gun')) {
        const gi = world.defensePlan.find((it) => it.type === 'field_gun');
        // after the first line AND the first settlement (the economy is not starved for a gun)
        const setts = ownSettlements(state, fid).filter((s) => s.built).length;
        const warSec = state.match.phase === 'WAR' ? (state.tick - state.match.prepEndTick) / 20 : 0;
        const firstLine = state.structures.filter((s) => s.faction === fid && s.type === 'trench').length >= 2 &&
          (setts >= 2 || (setts >= 1 && warSec > 150));
        if (gi && firstLine) {
          const params = { x: gi.x, z: gi.z, rot: gi.rot || 0 };
          if (validatePlacement(sim, fid, 'field_gun', params).ok) {
            aiIssue(sim, { type: CMD.BUILD, faction: fid, squadIds: [e.id], stype: 'field_gun', ...params });
            ai.gunSite = state.tick; // one attempt per few seconds (the site appears next tick)
            continue;
          }
        }
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
      return d.combatUnit && d.canGarrison && !d.heavy && !d.aura && ai.reserveIds.indexOf(sq.id) < 0;
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
   * Phase 4 RUIN GARRISONS: spare line squads (no trench room) hold the ruined houses in front of
   * and around the line (own half, not deep in no man's land), nearest ruin first; a battered ruin
   * the side holds is repaired in quiet moments (engineers, see engineers()).
   */
  ruins(sim, fid, ai, squads) {
    const { state, rt } = sim;
    if ((state.tick + 11) % 40 >= 10 || state.match.phase !== 'WAR') return; // the trenches fill first
    const objective = state.structures.find((s) => s.objective && s.faction === fid);
    if (!objective) return;
    const ruins = state.structures.filter((s) => STRUCTURES[s.type].garrison && !s.collapsed &&
      (!s.holder || s.holder === fid) && dist(s.x, s.z, objective.x, objective.z) < 140 && s.z > objective.z - 140)
      .sort((a, b) => dist(a.x, a.z, objective.x, objective.z) - dist(b.x, b.z, objective.x, objective.z) || a.id - b.id);
    if (!ruins.length) return;
    const coming = new Map();
    for (const sq of squads) if (sq.order.t === 'garrison') coming.set(sq.order.sid, (coming.get(sq.order.sid) || 0) + 1);
    const spare = squads.filter((sq) => {
      const d = unitDef(sq.type);
      return canGarrison(sq) && !d.aura && !ai.guards[sq.id] && ai.reserveIds.indexOf(sq.id) < 0 &&
        sq.order.t === 'idle' && !sq.engaged && state.tick - sq.spawnTick > 20 * 6;
    });
    for (const st of ruins) {
      const cap = st.type === 'ruin_chapel' || STRUCTURES[st.type].footprint.w * STRUCTURES[st.type].footprint.d >= 110 ? 2 : 1;
      let n = (st.holder === fid ? st.occ.length : 0) + (coming.get(st.id) || 0);
      while (n < Math.min(cap, 1 + (state.match.phase === 'WAR' ? 1 : 0)) && spare.length) {
        spare.sort((a, b) => dist(a.cx, a.cz, st.x, st.z) - dist(b.cx, b.cz, st.x, st.z) || a.id - b.id);
        const sq = spare.shift();
        aiIssue(sim, { type: CMD.GARRISON, faction: fid, squadIds: [sq.id], sid: st.id });
        ai.garrisonOrders = (ai.garrisonOrders || 0) + 1;
        n++;
      }
      if (!spare.length) break;
    }
    void rt;
  },

  /**
   * ELITES with an aura (Lieutenants, Clerics) stand a few metres behind the trench segments, one
   * per segment (several over the same spot would not stack — spread they cover the whole line);
   * a badly hurt one steps back towards the bastion.
   */
  placeElites(sim, fid, ai, squads) {
    const { state } = sim;
    if ((state.tick + 13) % 40 !== 0) return;
    const bastion = state.structures.find((s) => s.objective && s.faction === fid);
    const trenches = state.structures.filter((s) => s.type === 'trench' && s.faction === fid && s.built).sort((a, b) => a.x - b.x || a.id - b.id);
    const elites = squads.filter((sq) => unitDef(sq.type).aura && unitDef(sq.type).elite).sort((a, b) => a.id - b.id);
    elites.forEach((el, i) => {
      if (el.engaged || el.order.t === 'attack' || el.order.t === 'move') return;
      let hp = 0;
      for (const m of el.members) if (m.state === 'alive') hp += m.hp;
      let post;
      if (hp < unitDef(el.type).hp * 0.5 && bastion) post = [bastion.x + 16 - (i % 3) * 16, bastion.z - 14];
      else if (trenches.length) {
        const t = trenches[i % trenches.length];
        const back = bastion ? Math.sign(bastion.z - t.z) || 1 : 1;
        post = [t.x, t.z + back * 6];
      } else post = (sim.world.anchors.na_base || [[160, 500]])[0];
      if (dist(el.cx, el.cz, post[0], post[1]) > 6) aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: [el.id], x: post[0], z: post[1], face: Math.PI });
    });
    void ai;
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
      return d.combatUnit && d.canGarrison && !d.heavy && !d.aura && !ai.guards[sq.id] && ai.reserveIds.indexOf(sq.id) < 0 &&
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

  /**
   * LIMITED COUNTERATTACK (Phase 4.1): attacker / defender are only the starting roles. When the
   * walls are quiet (no visible enemy near the objective) and the garrison is strong, a small
   * strike group (the heavy reserve + fresh open-field rifle squads, never the trench / ruin
   * holders) goes for the nearest KNOWN enemy structure within reach — a nest, a mound, an altar;
   * late in the war (or in an endless war) the enemy's base itself. It comes home when the target
   * falls, the group is bled, it takes too long, or the walls are threatened again. Cooldown
   * between strikes. Only what New Antioch has seen is used (seenBy / visibleTo), orders go
   * through the normal pipeline.
   */
  counterattack(sim, fid, ai, squads) {
    const { state, world } = sim;
    if (state.tick - (ai.caCheck || 0) < 40) return; // think() is itself staggered
    ai.caCheck = state.tick;
    const bit = 1 << FACTIONS[fid].index;
    const objective = state.structures.find((s) => s.objective && s.faction === fid);
    if (!objective) return;
    const home = world.anchors.na_reserve[0];
    if (ai.caNext === undefined) ai.caNext = state.match.prepEndTick + 20 * 60 * 8;
    // walls threatened? (any visible hostile fighting squad close to the objective)
    let threat = false;
    for (const e of state.squads) {
      if (!areHostile(fid, e.faction) || e.civ || !(e.visibleTo & bit) || !unitDef(e.type).combatUnit) continue;
      if (dist(e.cx, e.cz, objective.x, objective.z) < 120 && alive(e) > 0) { threat = true; break; }
    }
    const ca = ai.ca;
    if (ca) {
      const target = ca.sid ? sim.rt.structById.get(ca.sid) : null;
      const group = ca.ids.map((id) => sim.rt.squadById.get(id)).filter((q) => q && alive(q) > 0);
      let men = 0;
      for (const q of group) men += alive(q);
      // a probe (no known target) ends when it has found something or after a short push
      const found = !ca.sid && this.knownTarget(sim, fid, objective, false);
      const over = (ca.sid && (!target || target.hp <= 0)) || found || threat || men < ca.men * 0.55 ||
        state.tick - ca.start > 20 * 60 * (ca.sid ? 4 : 2.5);
      if (over) {
        if (group.length) aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: group.map((q) => q.id), x: home[0], z: home[1], face: Math.PI });
        ai.ca = null;
        ai.caNext = state.tick + 20 * 60 * 4;
        return;
      }
      const idle = group.filter((q) => q.order.t === 'idle' && !q.engaged);
      if (idle.length && target) aiIssue(sim, { type: CMD.ATTACK, faction: fid, squadIds: idle.map((q) => q.id), tk: 'struct', tid: target.id });
      return;
    }
    if (threat || state.tick < ai.caNext) return;
    // strength check: the line must stay manned
    const combat = squads.filter((q) => unitDef(q.type).combatUnit && alive(q) > 0);
    if (combat.length < 7) return;
    const fresh = (q) => alive(q) >= unitDef(q.type).squadSize * 0.75 && !q.engaged && q.order.t !== 'hold_trench' && q.order.t !== 'garrison' && !unitDef(q.type).aura && !unitDef(q.type).marksman;
    const heavies = combat.filter((q) => unitDef(q.type).heavy && fresh(q));
    const rifles = combat.filter((q) => !unitDef(q.type).heavy && (q.type === 'yeoman_rifle' || q.type === 'shock_flamer') && fresh(q) && !(ai.guards && ai.guards[q.id]));
    const strike = [...heavies, ...rifles].slice(0, 4);
    if (strike.length < 2) return;
    // target: nearest KNOWN enemy structure within reach; the base only late / in an endless war
    const late = state.match.endless || matchProgress(state) > 0.6;
    const target = this.knownTarget(sim, fid, objective, late);
    let men = 0;
    for (const q of strike) men += alive(q);
    state.factions[fid].stats.counterattacks = (state.factions[fid].stats.counterattacks || 0) + 1;
    if (target) {
      ai.ca = { ids: strike.map((q) => q.id), sid: target.id, start: state.tick, men };
      aiIssue(sim, { type: CMD.ATTACK, faction: fid, squadIds: ai.ca.ids, tk: 'struct', tid: target.id });
      return;
    }
    // nothing known: a short PROBE in force toward the enemy's side of the map (the map itself is
    // public knowledge — no hidden state is read); it comes back once it has found something
    const eb = world.anchors.home_bg && world.anchors.home_bg[0];
    if (!eb) { ai.caNext = state.tick + 20 * 60; return; }
    const px = objective.x + (eb[0] - objective.x) * 0.42, pz = objective.z + (eb[1] - objective.z) * 0.42;
    ai.ca = { ids: strike.slice(0, 3).map((q) => q.id), sid: 0, start: state.tick, men };
    aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: ai.ca.ids, x: px, z: pz, attackMove: true });
  },

  /** Nearest enemy structure New Antioch has SEEN within strike reach (the base only when `late`). */
  knownTarget(sim, fid, objective, late) {
    const bit = 1 << FACTIONS[fid].index;
    let target = null, td = 300;
    for (const st of sim.state.structures) {
      if (!areHostile(fid, st.faction) || st.hp <= 0 || !(st.seenBy & bit)) continue;
      if (STRUCTURES[st.type].hq && !late) continue;
      const dd = dist(st.x, st.z, objective.x, objective.z);
      if (dd < td || (dd === td && target && st.id < target.id)) { td = dd; target = st; }
    }
    return target;
  },

  reinforce(sim, fid, ai, squads, lull = false) {
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
      // during a lull every gap is filled; in battle only badly thinned squads call for men
      if (sq.members.length >= (lull ? def.squadSize : Math.ceil(def.squadSize * 0.75))) continue;
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
    // Phase 4.1: elites have no game cap any more — the AI keeps its own order of battle (a
    // Lieutenant per ~5 line squads, one Cleric — two when the plague is thick — one Sniper Priest)
    const lineSquads = squads.filter((sq) => sq.type === 'yeoman_rifle' || sq.type === 'mech_heavy' || sq.type === 'shock_flamer').length;
    const wantLt = lineSquads >= 3 ? Math.max(1, Math.floor(lineSquads / 5)) : 0;
    const wantCleric = lineSquads >= 3 ? (infectedDead >= 6 ? 2 : 1) : 0;
    let unit = null;
    if (engineers < (settlements >= 2 ? 3 : 2) && r.manpower >= 5 && r.material >= 40) unit = 'combat_engineer';
    else if (heavies < 2 && can('mech_heavy')) unit = 'mech_heavy';
    else if (count('trench_cleric') < wantCleric && can('trench_cleric')) unit = 'trench_cleric';
    else if (count('na_lieutenant') < wantLt && can('na_lieutenant')) unit = 'na_lieutenant';
    else if (count('sniper_priest') < 1 && lineSquads >= 6 && can('sniper_priest')) unit = 'sniper_priest';
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
