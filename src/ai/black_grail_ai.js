// Black Grail attacker AI: lanes, probes, assault waves, pressure and weak-point search.
//  PREPARATION: deploy groups to lane staging points inside the deployment zone.
//  WAR: existing combat squads assault immediately (no "wait 45s then spawn" script).
//  - groups advance waypoint by waypoint with attack-move; idle squads are re-ordered
//  - failed paths are retried, then re-routed to another lane
//  - lane danger grows with losses -> reinforcements pick the weakest-defended lane
//  - Fly Swarm is cast on entrenched / clustered visible defenders
//  - biomass is spent raising hordes at Altars; risen dead join the nearest assault
// Noncombat squads never join assault groups (combatUnit flag, not unit names).
//  - Phase 2 corpse economy: a few capped Grail Thrall work gangs haul uninfected bodies to
//    altars / corpse mounds and raise the map's organic build plan (corpse mound, fly nest,
//    plague pits, bone barricades) through the same BUILD / GATHER commands as a player
//  - Phase 3: gangs FORAGE (animals first, then bodies) from the preparation on; small Thrall
//    packs RAID known farms / pens / isolated settlements / convoys — more often while biomass is
//    low — and rejoin the waves after; speciality choices; Great Pestilence on the biggest visible
//    entrenched cluster; Black Tide on an engaged wave; heralds / amalgams / the Lord of Tumours
import { unitDef, hasRole } from '../data/units.js';
import { ABILITIES } from '../data/abilities.js';
import { areHostile, sideBit, baseFaction } from '../data/factions.js';
import { strategyFor } from '../data/ai.js';
import { lanesFor, planFor, homeStructure, enemyTarget, sideForward, sideAnchors } from '../sim/sides.js';
import { CMD } from '../sim/commands.js';
import { dist } from '../core/dmath.js';
import { STRUCTURES } from '../data/structures.js';
import { validatePlacement } from '../construction/construction.js';
import { rngFloat } from '../core/rng.js';
import { unitCost, unitMaxSquads, specHas, unlockedBySpec } from '../sim/specialities.js';
import { aiIssue } from './issue.js';
import { aiPickSpeciality } from './spec_pick.js';
import { forageSpot, habitatSpot, raidTarget, convoyNear, clusterTarget, visibleHostiles } from './black_grail_econ.js';
import { isLull } from '../sim/lull.js';
import { policyFor, aggressionScore } from './doctrine.js';

const LANES = ['west', 'center', 'east'];
const WAYPOINT_REACHED = 16;
const RAID_AFTER = 20 * 70; // first raid not before this much war
const RAID_EVERY = 20 * 120; // between raids (x2 while biomass is plentiful)
const RAID_MAX = 20 * 150; // a raid gives up after this

function combatSquads(sim, fid) {
  // Lords of Tumours are not wave members: they follow the horde (escortLords())
  return sim.state.squads.filter((sq) => sq.faction === fid && !sq.autonomous && unitDef(sq.type).combatUnit && sq.type !== 'lord_of_tumours' && sq.type !== 'herald' && sq.members.some((m) => m.state === 'alive' || m.state === 'rising'));
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

/** Fielded + queued squads of a type (read-only; the force cap itself is enforced by TRAIN). */
function squadCount(sim, fid, type) {
  let n = 0;
  for (const sq of sim.state.squads) if (sq.faction === fid && sq.type === type && !sq.autonomous) n++;
  for (const st of sim.state.structures) if (st.faction === fid && st.queue) for (const q of st.queue) if (q.unit === type) n++;
  return n;
}

function planDone(sim, fid, item) {
  for (const s of sim.state.structures) {
    if (s.type !== item.type || s.faction !== fid) continue;
    const x = item.x1 !== undefined ? (item.x1 + item.x2) / 2 : item.x;
    const z = item.x1 !== undefined ? (item.z1 + item.z2) / 2 : item.z;
    if (dist(s.x, s.z, x, z) < 3) return true;
  }
  return false;
}

function newGroup(ai, lane, role) {
  const g = { id: ai.nextGroupId++, lane, role, stage: 0, mode: 'forming', squadIds: [], formedTick: 0, peak: 0, lostSince: 0 };
  ai.groups.push(g);
  return g;
}

/**
 * STRATEGIC ROLE: a horde that holds home (defender) forms up just in front of its own base line
 * (region 'line' anchors: west / centre / east by lane), not at the lane heads out in the field.
 */
function roleStrategy(sim, fid) {
  const f = sim.state.factions[fid];
  const S = strategyFor(baseFaction(fid), f ? f.role : 'attacker');
  // the stress benchmark is a pure soldier load: every horde goes at once
  return sim.scenario && sim.scenario.mode === 'stress' ? { ...S, holdHome: false } : S;
}

function holdsHome(sim, fid) {
  return !!roleStrategy(sim, fid).holdHome;
}

function homeStage(sim, fid, lane) {
  const line = (sideAnchors(sim, fid).line || []).slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (!line.length) return null;
  const p = lane === 'west' ? line[0] : lane === 'east' ? line[line.length - 1] : line[(line.length - 1) >> 1];
  const fw = sideForward(sim, fid);
  return [p[0] + fw[0] * 12, p[1] + fw[1] * 12];
}

function laneWaypoint(sim, fid, lane, stage) {
  if (stage <= 0 && holdsHome(sim, fid)) {
    const h = homeStage(sim, fid, lane);
    if (h) return h;
  }
  const pts = lanesFor(sim, fid)[lane];
  return pts[Math.max(0, Math.min(stage, pts.length - 1))];
}

/** Stage index (next waypoint) along a lane for a position: nearest polyline segment + 1. */
function laneStageFor(sim, fid, lane, x, z) {
  const pts = lanesFor(sim, fid)[lane];
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

/** The enemy's headquarters if this side has seen it (fog-honest), else null. */
function knownEnemyHome(sim, fid) {
  const t = enemyTarget(sim, fid);
  return t && ((t.visibleTo | t.seenBy) & sideBit(fid)) ? t : null;
}

export const blackGrailAI = {
  init(sim, fid) {
    const ai = {
      phase: 'deploy', groups: [], nextGroupId: 1,
      danger: { west: 0, center: 0, east: 0 },
      lastLosses: 0, lastAbilityCheck: 0, trainCounter: 0, altarIndex: 0, retry: {}, stage: {},
      launchedTick: 0,
      // Phase 3: raid in progress { gid, sid, start } / last raid tick; speciality bookkeeping
      raid: null, lastRaid: 0,
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
          const wp = laneWaypoint(sim, fid, best.lane, best.stage);
          aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: [sq.id], x: wp[0], z: wp[1], attackMove: true });
        }
      } else {
        const g = ai.groups[0] || newGroup(ai, 'center', 'main');
        g.squadIds.push(sq.id);
        sq.aiGroup = g.id;
      }
    }
    ai.groups = ai.groups.filter((g) => g.squadIds.length || g.mode === 'forming');
    const stress = sim.scenario && sim.scenario.mode === 'stress';
    if (!stress) aiPickSpeciality(sim, fid, ai, (tier) => this.specWeights(sim, fid, tier));

    if (state.match.phase === 'PREPARATION') {
      this.deploy(sim, fid, ai);
      this.gangs(sim, fid, ai); // foraging starts before the war (own half: animals, old dead)
      return;
    }
    if (state.match.phase !== 'WAR') return;
    // reorganisation window (no ceasefire): waves that are not in contact pull back to regroup
    // and gather in strength; waves already fighting keep fighting, raids / abilities go on
    if (isLull(state)) this.lullRegroup(sim, fid, ai);
    const S = roleStrategy(sim, fid);
    if (ai.phase === 'deploy') {
      ai.phase = 'assault';
      ai.launchedTick = state.tick;
      // STRATEGIC ROLE: an attacking horde goes at once; a defending one holds its staging points
      // (defendHome) and sallies out when it is strong enough (sally())
      if (!S.holdHome) for (const g of ai.groups) if (g.squadIds.length) this.launch(sim, fid, ai, g);
    }
    if (S.holdHome) this.defendHome(sim, fid, ai);
    this.manageGroups(sim, fid, ai);
    if (!stress) this.raids(sim, fid, ai);
    this.useAbility(sim, fid, ai);
    this.escortLords(sim, fid, ai);
    this.plague(sim, fid, ai);
    this.produce(sim, fid, ai);
    this.gangs(sim, fid, ai);
  },

  /**
   * Once per reorganisation window: every wave NOT in contact becomes a forming group back at its
   * lane's staging point (it prefers to regroup; nothing stops it from fighting).
   */
  lullRegroup(sim, fid, ai) {
    const { state, rt } = sim;
    const l = state.match.lull;
    if (ai.lullSeen === l.idx + 1) return;
    ai.lullSeen = l.idx + 1;
    for (const g of ai.groups) {
      if (!g.squadIds.length || g.mode === 'raid') continue;
      // A lull is an opportunity for idle waves, not a recall of a travelling assault.
      if (g.squadIds.some((id) => { const q = rt.squadById.get(id); return q && (q.engaged || q.order.t !== 'idle'); })) continue;
      g.mode = 'forming';
      g.formedTick = state.tick;
      g.stage = 0;
      const wp = laneWaypoint(sim, fid, g.lane, 0);
      const ids = [];
      for (const id of g.squadIds) {
        const sq = rt.squadById.get(id);
        if (!sq) continue;
        ai.stage[id] = 0;
        ids.push(id);
      }
      if (ids.length) aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: ids, x: wp[0], z: wp[1], attackMove: true });
    }
  },

  specWeights(sim, fid, tier) {
    const f = sim.state.factions[fid];
    if (tier === 0) return { bg_horde: 4, bg_touch: 3, bg_hunger: 3 + ((f.resources.biomass || 0) < 80 ? 1 : 0) };
    if (tier === 1) return { bg_heralds: 3.5, bg_amalgam: 3.5, bg_dominion: 3 };
    return { bg_black_tide: 3.5, bg_great_pestilence: 3 + ((f.pestilence || 0) >= 50 ? 2 : 0), bg_lord: 3.5 };
  },

  /**
   * RAIDS: a small Thrall pack (taken from the forming wave) hits a known economic target —
   * farms, pens, quarries, isolated settlements — and intercepts visible convoys on the way; when
   * the target is gone and nothing else is near, the pack rejoins the waves.
   */
  raids(sim, fid, ai) {
    const { state, rt } = sim;
    const tick = state.tick;
    const f = state.factions[fid];
    if (ai.raid) {
      const g = groupById(ai, ai.raid.gid);
      if (!g || !g.squadIds.length) { ai.raid = null; ai.lastRaid = tick; return; }
      if (tick - ai.raid.start > RAID_MAX || !groupCentroid(sim, g, C)) { this.endRaid(sim, fid, ai, g); return; }
      const cv = convoyNear(sim, fid, C[0], C[1], 70);
      let tgt = rt.structById.get(ai.raid.sid);
      if (!tgt || tgt.hp <= 0) {
        const home = knownEnemyHome(sim, fid);
        tgt = raidTarget(sim, fid, C[0], C[1], 90, home ? home.x : undefined, home ? home.z : undefined);
        if (!tgt && !cv) { this.endRaid(sim, fid, ai, g); return; }
        ai.raid.sid = tgt ? tgt.id : 0;
      }
      for (const id of g.squadIds) {
        const sq = rt.squadById.get(id);
        if (!sq || sq.engaged) continue;
        if (cv) {
          if (sq.order.t !== 'move' || dist(sq.order.x, sq.order.z, cv.x, cv.z) > 8) aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: [id], x: cv.x, z: cv.z, attackMove: true });
        } else if (tgt && !(sq.order.t === 'attack' && sq.order.tid === tgt.id)) {
          aiIssue(sim, { type: CMD.ATTACK, faction: fid, squadIds: [id], tk: 'struct', tid: tgt.id });
        }
      }
      return;
    }
    if (tick - ai.launchedTick < RAID_AFTER) return;
    const hungry = (f.resources.biomass || 0) < 90;
    if (tick - (ai.lastRaid || 0) < (hungry ? RAID_EVERY : RAID_EVERY * 2)) return;
    const forming = ai.groups.find((g) => g.mode === 'forming' && g.squadIds.length >= 2);
    if (!forming || !groupCentroid(sim, forming, C)) return;
    const home = knownEnemyHome(sim, fid);
    const tgt = raidTarget(sim, fid, C[0], C[1], 420, home ? home.x : undefined, home ? home.z : undefined);
    if (!tgt) { ai.lastRaid = tick - RAID_EVERY / 2; return; }
    const pack = [];
    for (const id of forming.squadIds) {
      const sq = rt.squadById.get(id);
      if (sq && unitDef(sq.type).roles.indexOf('horde') >= 0 && pack.length < 2) pack.push(id);
    }
    if (!pack.length) return;
    forming.squadIds = forming.squadIds.filter((id) => pack.indexOf(id) < 0);
    const g = newGroup(ai, forming.lane, 'raid');
    g.mode = 'raid';
    g.formedTick = tick;
    for (const id of pack) { g.squadIds.push(id); const sq = rt.squadById.get(id); if (sq) sq.aiGroup = g.id; }
    ai.raid = { gid: g.id, sid: tgt.id, start: tick };
    ai.lastRaid = tick;
    ai.raidCount = (ai.raidCount || 0) + 1; // AI memory (balance statistics read it)
    aiIssue(sim, { type: CMD.ATTACK, faction: fid, squadIds: pack.slice(), tk: 'struct', tid: tgt.id });
  },

  endRaid(sim, fid, ai, g) {
    g.role = 'wave';
    g.mode = 'forming';
    g.formedTick = sim.state.tick;
    g.stage = 0;
    for (const id of g.squadIds) ai.stage[id] = 0;
    ai.raid = null;
    ai.lastRaid = sim.state.tick;
  },

  /** Great Pestilence (meter full) on the biggest visible cluster; Black Tide on an engaged wave. */
  plague(sim, fid, ai) {
    const { state } = sim;
    const f = state.factions[fid];
    if (state.tick - (ai.lastPlague || 0) < 20) return;
    ai.lastPlague = state.tick;
    const gp = ABILITIES.great_pestilence;
    const gs = f.abilities.great_pestilence;
    if (gs && gs.readyTick <= state.tick && (f.pestilence || 0) >= gp.requiresPestilence && (f.resources.biomass || 0) >= gp.cost.biomass) {
      const t = clusterTarget(sim, fid, gp.radius, gp.castRange, 14);
      if (t) aiIssue(sim, { type: CMD.USE_ABILITY, faction: fid, ability: 'great_pestilence', x: t.cx, z: t.cz });
    }
    const bt = ABILITIES.black_tide;
    const ts = f.abilities.black_tide;
    if (ts && ts.readyTick <= state.tick && unlockedBySpec(state, fid, bt) && (f.resources.biomass || 0) >= bt.cost.biomass + 30) {
      for (const g of ai.groups) {
        if (g.mode !== 'advance' || g.squadIds.length < 3 || !groupCentroid(sim, g, C)) continue;
        if (visibleHostiles(sim, fid, C[0], C[1], 45) < 8) continue;
        aiIssue(sim, { type: CMD.USE_ABILITY, faction: fid, ability: 'black_tide', x: C[0], z: C[1] });
        break;
      }
    }
  },

  /** Work gangs: keep a couple, build the organic plan, haul corpses. Never used in assaults. */
  gangs(sim, fid, ai) {
    const { state, world } = sim;
    if (state.tick - (ai.lastGangThink || -1e9) < 20) return;
    ai.lastGangThink = state.tick;
    if (sim.scenario && sim.scenario.mode === 'stress') return;
    const f = state.factions[fid];
    const bit = sideBit(fid);
    const gangs = state.squads.filter((sq) => sq.faction === fid && hasRole(unitDef(sq.type), 'builder') && sq.members.some((m) => m.state === 'alive'));
    // production: two gangs (three with the Hunger), the first as soon as it is affordable
    const want = Math.min(unitMaxSquads(state, fid, 'thrall_gang') || 2, specHas(state, fid, 'bg_hunger') ? 3 : 2);
    const have = squadCount(sim, fid, 'thrall_gang');
    const gcost = unitCost(state, fid, 'thrall_gang').biomass;
    if (have < want && (f.resources.biomass || 0) >= gcost + (have ? 40 : 0) && state.tick - (ai.lastGang || -1e9) > 20 * (have ? 30 : 5)) {
      const altar = state.structures.find((s) => s.faction === fid && s.built && s.queue && s.queue.length === 0 && STRUCTURES[s.type].trains.indexOf('thrall_gang') >= 0);
      if (altar) {
        ai.lastGang = state.tick;
        aiIssue(sim, { type: CMD.SET_RALLY, faction: fid, sid: altar.id, x: altar.x, z: altar.z + sideForward(sim, fid)[1] * 12 });
        aiIssue(sim, { type: CMD.TRAIN, faction: fid, sid: altar.id, unit: 'thrall_gang' });
      }
    }
    const busy = new Set();
    let placedNow = false;
    for (const g of gangs) if (g.order.sid) busy.add(g.order.sid);
    for (const g of gangs) {
      const o = g.order;
      if (o.t === 'build') continue;
      // Finish the first economic circuit before taking the only hunter away to construction.
      // Loaded workers always deliver; a remote new site must not strand their biomass.
      if (g.carry > 0) continue;
      if (gangs.length === 1 && o.t === 'gather' && o.auto && o.phase === 'travel' &&
        !Object.keys(f.stats.biomass).some((k) => k !== 'passive' && f.stats.biomass[k] > 0)) continue;
      if (o.t === 'gather' && o.phase !== 'to_node' && o.phase !== 'seek' && !(o.auto && o.phase === 'travel' && g.carry <= 0)) continue;
      // 1) unfinished own sites
      let site = null, sd = 1e9;
      for (const st of state.structures) {
        if (st.faction !== fid || st.built || busy.has(st.id)) continue;
        const d = dist(g.x, g.z, st.x, st.z);
        if (d < sd) { sd = d; site = st; }
      }
      if (site) { busy.add(site.id); aiIssue(sim, { type: CMD.ASSIST_BUILD, faction: fid, squadIds: [g.id], sid: site.id }); continue; }
      // Phase 05B: an attacking horde deliberately establishes the authored bridge-entry plague
      // node. Infection still traverses the bridge cell-by-cell; this only supplies its near end.
      const strategy = roleStrategy(sim, fid);
      if (!placedNow && strategy.bridgePlague && state.match.phase === 'WAR' && state.tick - (state.match.prepEndTick || 0) > 20 * 45 / policyFor(state, fid).plague) {
        const item = planFor(sim, fid, 'organic').find((it) => it.type === 'plague_pit' && it.frontline);
        const cost = STRUCTURES.plague_pit.cost.biomass;
        if (item && !planDone(sim, fid, item) && (f.resources.biomass || 0) >= cost + 10) {
          const params = { x: item.x, z: item.z, rot: item.rot || 0 };
          if (validatePlacement(sim, fid, 'plague_pit', params).ok) {
            aiIssue(sim, { type: CMD.BUILD, faction: fid, squadIds: [g.id], stype: 'plague_pit', ...params });
            placedNow = true;
          }
        }
        if (placedNow) continue;
      }
      // 2a) Phase 4 organic defences: one Viscera Cannon nest, then one Belcher nest over the altar
      //     approaches, once the war is two minutes old and the biomass is there (with a reserve)
      if (!placedNow && state.match.phase === 'WAR' && state.tick - (state.match.prepEndTick || 0) > 20 * 120) {
        for (const type of ['viscera_nest', 'belcher_nest']) {
          if (state.structures.some((s) => s.faction === fid && s.type === type)) continue;
          const item = planFor(sim, fid, 'organic').find((it) => it.type === type);
          const cost = STRUCTURES[type].cost.biomass;
          if (!item || (f.resources.biomass || 0) < cost) break;
          const params = { x: item.x, z: item.z, rot: item.rot || 0 };
          if (!validatePlacement(sim, fid, type, params).ok) continue;
          aiIssue(sim, { type: CMD.BUILD, faction: fid, squadIds: [g.id], stype: type, ...params });
          placedNow = true;
          break;
        }
        if (placedNow) continue;
      }
      // 2) next organic plan item: with a surplus, or when one is due (every ~90 s of war the
      //    altars hold back its price — production alone would never leave a surplus)
      if (!placedNow && state.match.phase === 'WAR') {
        const due = state.tick - (ai.lastPlan || state.match.prepEndTick || 0) > 20 * 90 / policyFor(state, fid).plague;
        let placed = false, want = 0;
        for (const item of planFor(sim, fid, 'organic')) {
          if (planDone(sim, fid, item)) continue;
          const params = item.x1 !== undefined ? { x1: item.x1, z1: item.z1, x2: item.x2, z2: item.z2 } : { x: item.x, z: item.z, rot: item.rot || 0 };
          if (!validatePlacement(sim, fid, item.type, params).ok) continue;
          const cost = (STRUCTURES[item.type].cost && STRUCTURES[item.type].cost.biomass) || 0;
          want = cost;
          if ((f.resources.biomass || 0) <= (due ? cost + 10 : 120)) break;
          aiIssue(sim, { type: CMD.BUILD, faction: fid, squadIds: [g.id], stype: item.type, ...params });
          placed = true;
          placedNow = true; // one new site per think (commands resolve next tick)
          ai.lastPlan = state.tick;
          break;
        }
        ai.planReserve = !placed && due ? want : 0;
        if (placed) continue;
      }
      if (o.t === 'gather') {
        // a forage field that has run dry (the gang waits there for new prey): after a while the
        // AI looks for fresh prey elsewhere, like a player re-pointing the gang
        if (!ai.gangSeek) ai.gangSeek = {};
        if (o.mode !== 'forage' || o.phase !== 'seek' || g.carry > 0) { delete ai.gangSeek[g.id]; continue; }
        if (!ai.gangSeek[g.id]) ai.gangSeek[g.id] = state.tick;
        if (state.tick - ai.gangSeek[g.id] < 20 * 15) continue;
        delete ai.gangSeek[g.id];
      }
      // 3) FORAGE an area: visible animals first, then known uninfected bodies with an own assault
      //    squad close by (gangs are expendable labour, not scouts); the gang hunts, strips and
      //    hauls on its own until the area is empty (no per-body orders)
      const spot = forageSpot(sim, fid, g);
      if (spot) { aiIssue(sim, { type: CMD.FORAGE, faction: fid, squadIds: [g.id], x: spot.x, z: spot.z, auto: 1 }); continue; }
      // nothing in sight: sweep a known pasture / wood of its own country (one gang per habitat)
      if (!ai.habMemo) ai.habMemo = {};
      const h = habitatSpot(sim, fid, g, ai.habMemo);
      if (h) {
        ai.habMemo[h.id] = state.tick + 20 * 100;
        aiIssue(sim, { type: CMD.FORAGE, faction: fid, squadIds: [g.id], x: h.x, z: h.z, auto: 1 });
      }
    }
  },

  deploy(sim, fid, ai) {
    if (ai.deployed) return;
    ai.deployed = true;
    for (const g of ai.groups) {
      const wp = laneWaypoint(sim, fid, g.lane, 0);
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
      const st = Math.max(1, laneStageFor(sim, fid, g.lane, sq.cx, sq.cz));
      ai.stage[id] = st;
      if (st < minStage) minStage = st;
      if (!byStage.has(st)) byStage.set(st, []);
      byStage.get(st).push(id);
    }
    g.stage = minStage === Infinity ? 1 : minStage;
    for (const [st, ids] of byStage) {
      const wp = laneWaypoint(sim, fid, g.lane, st);
      aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: ids, x: wp[0], z: wp[1], attackMove: true });
    }
  },

  /**
   * Lords of Tumours ride BEHIND the strongest advancing waves (22 m back toward the altars; with
   * several lords, each follows a different wave — their courts do not stack), fight what reaches
   * them, and fall back to an altar when badly hurt.
   */
  escortLords(sim, fid, ai) {
    const { state } = sim;
    if (state.tick - (ai.escortTick || -10000) < 40) return;
    ai.escortTick = state.tick;
    const lords = state.squads.filter((q) => q.faction === fid && (q.type === 'lord_of_tumours' || q.type === 'herald') && q.members.some((m) => m.state === 'alive')).sort((a, b) => a.id - b.id);
    if (!lords.length) return;
    const altar = state.structures.find((s) => s.faction === fid && s.type === 'grail_altar' && s.built);
    const waves = [];
    for (const g of ai.groups) if (g.mode === 'advance' && g.squadIds.length && groupCentroid(sim, g, C)) waves.push({ n: g.squadIds.length, x: C[0], z: C[1], id: g.id });
    waves.sort((a, b) => b.n - a.n || a.id - b.id);
    lords.forEach((lord, i) => {
      let hp = 0;
      for (const m of lord.members) if (m.state === 'alive') hp += m.hp;
      if (hp < unitDef(lord.type).hp * Math.min(0.75, 0.4 * policyFor(state, fid).reserve) && altar) {
        if (dist(lord.cx, lord.cz, altar.x, altar.z) > 20 && lord.order.t !== 'move') aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: [lord.id], x: altar.x, z: altar.z + sideForward(sim, fid)[1] * 14 });
        return;
      }
      const w = waves[i % Math.max(1, waves.length)];
      if (!w || lord.engaged || lord.order.t === 'attack') return;
      const home = altar ? [altar.x, altar.z] : [lord.cx, lord.cz - sideForward(sim, fid)[1] * 30];
      const dx = home[0] - w.x, dz = home[1] - w.z, d = Math.max(1, dist(0, 0, dx, dz));
      const tx = w.x + (dx / d) * 22, tz = w.z + (dz / d) * 22;
      if (dist(lord.cx, lord.cz, tx, tz) > 10) aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: [lord.id], x: tx, z: tz, attackMove: true });
    });
  },

  /**
   * DEFENDER role: forming waves answer visible enemies near the own base (HQ / structures) with
   * attack-moves; when the threat is gone they walk back to their staging points (manageGroups).
   */
  defendHome(sim, fid, ai) {
    const { state, rt } = sim;
    if (state.tick - (ai.defCheck || 0) < 20) return;
    ai.defCheck = state.tick;
    const bit = sideBit(fid);
    const home = homeStructure(state, fid);
    if (!home) return;
    let threat = null, td = 150;
    for (const e of state.squads) {
      if (!areHostile(fid, e.faction) || e.civ || !(e.visibleTo & bit) || !unitDef(e.type).combatUnit) continue;
      if (!e.members.some((m) => m.state === 'alive')) continue;
      const d = dist(e.cx, e.cz, home.x, home.z);
      if (d < td || (d === td && threat && e.id < threat.id)) { td = d; threat = e; }
    }
    ai.defending = threat ? threat.id : 0;
    if (!threat) return;
    for (const g of ai.groups) {
      if (g.mode !== 'forming') continue;
      const ids = [];
      for (const id of g.squadIds) {
        const sq = rt.squadById.get(id);
        if (!sq || sq.engaged || sq.order.t === 'attack') continue;
        if (sq.order.t === 'move' && sq.order.am && dist(sq.order.x, sq.order.z, threat.cx, threat.cz) < 12) continue;
        ids.push(id);
      }
      if (ids.length) aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: ids, x: threat.cx, z: threat.cz, attackMove: true });
    }
  },

  /**
   * DEFENDER role: a counter-wave sallies out when the horde clearly outnumbers what it has seen of
   * the enemy recently (memory decays; fog-honest), or late in the war. Returns true to launch.
   */
  sally(sim, fid, ai, S) {
    const { state } = sim;
    const bit = sideBit(fid);
    let foe = 0, mine = 0;
    for (const e of state.squads) {
      if (!unitDef(e.type).combatUnit || e.civ) continue;
      let n = 0;
      for (const m of e.members) if (m.state === 'alive') n++;
      if (e.faction === fid) mine += n;
      else if (areHostile(fid, e.faction) && (e.visibleTo & bit)) foe += n;
    }
    if (state.tick - (ai.foeTick || 0) >= 20) {
      ai.foe = Math.max(foe, Math.floor((ai.foe || 0) * 0.97));
      ai.foePeak = Math.max(ai.foePeak || 0, foe);
      ai.foeTick = state.tick;
    }
    if (ai.defending) return false;
    // the horde only sallies against an enemy it has actually measured (never blind): clearly
    // outnumbering the strongest force it has seen, after the first minutes of the war — or late
    // in the war, when time is on the attacker's side no longer (endless: after the nominal length)
    const war = state.tick - state.match.prepEndTick;
    const nominal = Math.max(1, (state.match.warMinutes || 30) * 60 * 20);
    const late = war > nominal * 0.55;
    if (mine < 30) return false;
    const aggression = aggressionScore(sim, fid, ai);
    if (late) return aggression > 0.85;
    return war > 20 * 120 && aggression >= S.sallyRatio && mine >= Math.max(24, foe * 1.15);
  },

  manageGroups(sim, fid, ai) {
    const { state, rt } = sim;
    const bit = sideBit(fid);
    // the ENEMY's headquarters (objective first) — never the own base, whatever the role
    const objective = enemyTarget(sim, fid);
    const objKnown = objective && ((objective.visibleTo | objective.seenBy) & bit);
    const S = roleStrategy(sim, fid);
    const sally = !S.holdHome || this.sally(sim, fid, ai, S);
    for (const g of ai.groups) {
      if (!g.squadIds.length || g.mode === 'raid') continue;
      if (g.mode === 'forming') {
        // launch the wave when strong enough or after waiting long enough
        if (!g.formedTick) g.formedTick = state.tick;
        // Phase 4: the first minutes of the war come in smaller, quicker swarms (the horde should be
        // felt early); later waves gather in strength
        const early = state.tick - (ai.launchedTick || state.tick) < 20 * 180;
        // in a reorganisation window the horde gathers in strength before it goes again
        const lull = isLull(state);
        const policy = policyFor(state, fid);
        const need = Math.max(2, Math.round((lull ? 5 : early ? 2 : 3) * policy.wave)), wait = (lull ? 60 : early ? 25 : 40) * policy.cadence;
        if (sally && (g.squadIds.length >= need || state.tick - g.formedTick > 20 * wait)) {
          g.lane = safestLane(ai, state.rng.ai);
          this.launch(sim, fid, ai, g);
        } else {
          const wp = laneWaypoint(sim, fid, g.lane, 0);
          for (const id of g.squadIds) {
            const sq = rt.squadById.get(id);
            if (sq && sq.order.t === 'idle' && dist(sq.cx, sq.cz, wp[0], wp[1]) > 20) aiIssue(sim, { type: CMD.MOVE, faction: fid, squadIds: [id], x: wp[0], z: wp[1] });
          }
        }
        continue;
      }
      const pts = lanesFor(sim, fid)[g.lane];
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
        if (o.t === 'storm') continue;
        if (sq.type === 'amalgam' && o.t !== 'attack') {
          let breach = null, best = 95 * policyFor(state, fid).breach;
          for (const st of state.structures) {
            if (!areHostile(fid, st.holder || st.faction) || !((st.visibleTo | st.seenBy) & bit) || st.hp <= 0) continue;
            const d = dist(sq.cx, sq.cz, st.x, st.z) - (STRUCTURES[st.type].heavyDefense ? 30 : 0);
            if (d < best) { best = d; breach = st; }
          }
          if (breach) { aiIssue(sim, { type: CMD.ATTACK, faction: fid, squadIds: [id], tk: 'struct', tid: breach.id }); continue; }
        }
        // retry failed paths, then re-route to a different lane
        if (sq.pathState === 'failed') {
          const n = (ai.retry[id] || 0) + 1;
          ai.retry[id] = n;
          if (n > 3) {
            g.lane = LANES[(LANES.indexOf(g.lane) + 1) % LANES.length];
            ai.retry[id] = 0;
          }
          const w2 = laneWaypoint(sim, fid, g.lane, ai.stage[id]);
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
        const wp = laneWaypoint(sim, fid, g.lane, ai.stage[id]);
        // arrival is judged by the squad anchor (always on its path), not by the centroid a
        // straggler can drag away
        if (dist(sq.x, sq.z, wp[0], wp[1]) < WAYPOINT_REACHED) {
          if (ai.stage[id] < last && ai.stage[id] <= minStage) {
            ai.stage[id]++;
            const nwp = laneWaypoint(sim, fid, g.lane, ai.stage[id]);
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
        const back = laneWaypoint(sim, fid, g.lane, 0);
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
    const bit = sideBit(fid);
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
    const trainers = state.structures.filter((s) => s.faction === fid && s.built && s.queue);
    if (!trainers.length) return;
    const busy = trainers.filter((a) => a.queue.length > 0).length;
    if (busy >= 2) return;
    // keep a reserve for the swarm when it is almost ready
    const ab = f.abilities.fly_swarm;
    const reserve = (ab && ab.readyTick - state.tick < 20 * 10 ? ABILITIES.fly_swarm.cost.biomass : 0) + (ai.planReserve || 0);
    // Phase 4.1: elites have no game cap — the horde keeps its own proportions (a Lord per ~10
    // fighting squads, at most two; two Heralds)
    const fighting = combatSquads(sim, fid).length;
    const P = policyFor(state, fid);
    const soft = { lord_of_tumours: Math.min(2, 1 + Math.floor(fighting / 10)), herald: Math.min(4, Math.ceil(2 * P.support)) };
    const room = (type) => {
      if (!unlockedBySpec(state, fid, unitDef(type))) return false;
      const max = unitMaxSquads(state, fid, type);
      if (soft[type] !== undefined && squadCount(sim, fid, type) >= soft[type]) return false;
      return !max || squadCount(sim, fid, type) < max;
    };
    ai.trainCounter++;
    const bio = f.resources.biomass || 0;
    const afford = (type) => bio >= unitCost(state, fid, type).biomass + reserve;
    let unit = 'grail_thrall';
    if (room('lord_of_tumours') && afford('lord_of_tumours')) unit = 'lord_of_tumours';
    else if (ai.trainCounter % Math.max(2, Math.round(6 / P.support)) === 0 && room('herald')) unit = 'herald';
    else if (ai.trainCounter % Math.max(2, Math.round(4 / P.breach)) === 0 && room('amalgam') && trainers.some((s) => STRUCTURES[s.type].trains.indexOf('amalgam') >= 0 && !s.queue.length)) unit = 'amalgam';
    else if (ai.trainCounter % Math.round(5 / P.elite) === 0) unit = 'plague_knight';
    else if (ai.trainCounter % Math.round(3 / P.elite) === 0) unit = 'corpse_guard';
    if (!afford(unit)) {
      // saving up for an elite never stalls the altars: after a while the horde takes thralls
      if (unit === 'grail_thrall' || !ai.eliteSince || state.tick - ai.eliteSince < 20 * 25) {
        if (unit !== 'grail_thrall' && !ai.eliteSince) ai.eliteSince = state.tick;
        ai.trainCounter--;
        return;
      }
      unit = 'grail_thrall';
      if (!afford(unit)) { ai.trainCounter--; return; }
    }
    ai.eliteSince = 0;
    const altars = trainers.filter((s) => STRUCTURES[s.type].trains.indexOf(unit) >= 0 && !s.queue.length);
    if (!altars.length) { ai.trainCounter--; return; }
    const altar = altars[ai.altarIndex % altars.length];
    ai.altarIndex++;
    const lane = safestLane(ai, state.rng.ai);
    const stage = laneWaypoint(sim, fid, lane, 0);
    aiIssue(sim, { type: CMD.SET_RALLY, faction: fid, sid: altar.id, x: stage[0], z: stage[1] });
    aiIssue(sim, { type: CMD.TRAIN, faction: fid, sid: altar.id, unit });
  },
};
