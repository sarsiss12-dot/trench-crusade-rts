// New Antioch AI — the expansion economy (Phase 3). Same rules as a player: it reads only what
// its faction perceives (own structures, KNOWN sectors, VISIBLE enemies / animals, corpses it has
// seen) and acts only through commands (BUILD / EVACUATE / SLAUGHTER / HERD_AREA / SANITIZE /
// USE_ABILITY). Decisions:
//  - found settlements on known resource sectors: safe + rich first, exposed ones later, one site
//    at a time and never more than the army can cover (no over-expansion)
//  - host farms / a livestock pen / a quarry around each settlement (the sector kind decides)
//  - fortify exposed or threatened settlements with light works; heavy works only where the rules
//    allow them (near a fortress anchor, or with the Fortified Settlements speciality)
//  - evacuate a settlement about to be overrun, slaughter a threatened pen's herd, point drovers at
//    visible livestock, burn infected dead near its own lines, purge plague ground
import { sideAnchor, enemyHomeAnchor, sideFacing } from '../sim/sides.js';
import { STRUCTURES } from '../data/structures.js';
import { unitDef } from '../data/units.js';
import { SPECIES } from '../data/animals.js';
import { areHostile, sideBit } from '../data/factions.js';
import { ABILITIES } from '../data/abilities.js';
import { POPULATION } from '../data/economy.js';
import { CMD } from '../sim/commands.js';
import { dist, dsin, dcos, datan2 } from '../core/dmath.js';
import { matchProgress, unlockedBySpec } from '../sim/specialities.js';
import { isPointVisibleTo } from '../sim/perception.js';
import { validatePlacement, heavyDefenseAllowed, structureCost } from '../construction/construction.js';
import { aiIssue } from './issue.js';

const RICH_VALUE = [0.75, 1, 1.35];
const KIND_VALUE = { fertile: 1.0, pasture: 0.85, hamlet: 1.05, quarry: 0.8, scrap: 0.85, depot: 0.9 };
// what each settlement hosts, in build order (duplicates = several of that type)
const WANT = {
  fertile: ['farm', 'livestock_pen', 'farm'],
  pasture: ['livestock_pen', 'farm'],
  hamlet: ['farm', 'livestock_pen'],
  quarry: ['quarry', 'farm'],
  scrap: ['quarry', 'farm'],
  depot: ['farm'],
};
const RING = [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6], [8, 8], [-8, 8], [8, -8], [-8, -8], [12, 0], [-12, 0], [0, 12], [0, -12]];
const FORT_TYPES = ['wire', 'low_sandbags', 'sandbags', 'fire_post', 'pillbox'];
const SUPPLY_RESERVE = 120; // ammunition + replacements come first
const EXPAND_RESERVE = 60; // ...but a new settlement below the target may dig deeper (it pays back in men)
const HOME = [0, 0];
const ENEMY = [0, 0];

function bit(fid) {
  return sideBit(fid);
}

function aliveIn(sq) {
  let n = 0;
  for (const m of sq.members) if (m.state === 'alive') n++;
  return n;
}

/** Visible hostile soldiers whose squad stands within r of (x, z). */
export function hostilesNear(sim, fid, x, z, r) {
  const b = bit(fid);
  let n = 0;
  for (const sq of sim.state.squads) {
    if (!areHostile(fid, sq.faction) || !(sq.visibleTo & b)) continue;
    if (dist(sq.cx, sq.cz, x, z) > r) continue;
    n += aliveIn(sq);
  }
  return n;
}

export function defendersNear(sim, fid, x, z, r) {
  let n = 0;
  for (const sq of sim.state.squads) {
    if (sq.faction !== fid || !unitDef(sq.type).combatUnit) continue;
    if (dist(sq.cx, sq.cz, x, z) > r) continue;
    n += aliveIn(sq);
  }
  return n;
}

function homeXZ(sim, fid) {
  const hq = sim.state.structures.find((s) => s.faction === fid && STRUCTURES[s.type].hq && s.hp > 0);
  if (hq) { HOME[0] = hq.x; HOME[1] = hq.z; } else { const a = sideAnchor(sim, fid, 'home'); HOME[0] = a[0]; HOME[1] = a[1]; }
  return HOME;
}

/** Where the enemy comes from (map knowledge: the enemy side's start-region home anchor). */
function enemyXZ(sim, fid) {
  const a = enemyHomeAnchor(sim, fid);
  ENEMY[0] = a[0]; ENEMY[1] = a[1];
  return ENEMY;
}

/**
 * 0 = at home, 1 = at the enemy's door. Mostly how far the point lies ahead of the home line
 * toward the enemy (a flank sector level with the trenches is safer than one out in front at the
 * same distance), plus a little plain distance from home.
 */
export function exposure(sim, fid, x, z) {
  const h = homeXZ(sim, fid);
  const hx = h[0], hz = h[1];
  const dh = dist(x, z, hx, hz);
  const e = enemyXZ(sim, fid);
  const ex = e[0] - hx, ez = e[1] - hz;
  const len2 = Math.max(1, ex * ex + ez * ez);
  const ahead = Math.max(0, Math.min(1, ((x - hx) * ex + (z - hz) * ez) / len2));
  const de = dist(x, z, e[0], e[1]);
  return ahead * 0.8 + (dh / Math.max(1, dh + de)) * 0.2;
}

export function ownSettlements(state, fid) {
  return state.structures.filter((s) => s.faction === fid && STRUCTURES[s.type].settlement && s.hp > 0);
}

function armySize(state, fid) {
  let n = 0;
  for (const sq of state.squads) if (sq.faction === fid && unitDef(sq.type).combatUnit) n += aliveIn(sq);
  return n;
}

function affordable(state, fid, type, reserveSupply) {
  const r = state.factions[fid].resources;
  const c = structureCost(state, fid, type, 20); // linear works: priced for ~20 m
  for (const k in c) {
    const keep = k === 'supply' ? reserveSupply : k === 'material' ? 30 : 0;
    if ((r[k] || 0) < c[k] + keep) return false;
  }
  return true;
}

/** How many settlements the AI wants now: grows with the war, bounded by the army that covers them. */
export function settlementTarget(sim, fid) {
  const { state } = sim;
  if (state.match.phase === 'PREPARATION') return POPULATION.prepSettlementCap; // 1-2 early settlements
  const byTime = 2 + Math.floor(matchProgress(state) * 5);
  const byArmy = 1 + Math.floor(armySize(state, fid) / 14);
  return Math.max(1, Math.min(5, byTime, byArmy));
}

/** Best known free sector to settle (null when none is worth the risk). */
export function pickSector(sim, fid, ai) {
  const { state } = sim;
  const b = bit(fid);
  const r = state.factions[fid].resources;
  const needFood = (r.food || 0) < 160, needMat = (r.material || 0) < 160, needSup = (r.supply || 0) < 240;
  let best = null, bs = -Infinity;
  for (const sec of state.sectors) {
    if (!(sec.seenBy & b) || sec.sid) continue;
    if ((ai.avoid[sec.id] || 0) > state.tick) continue;
    if (hostilesNear(sim, fid, sec.x, sec.z, 80) > 0) continue;
    const k = sec.kind;
    let v = KIND_VALUE[k] || 0.8;
    if (needFood && (k === 'fertile' || k === 'pasture' || k === 'hamlet')) v += 0.45;
    if (needMat && (k === 'quarry' || k === 'scrap')) v += 0.45;
    if (needSup && (k === 'depot' || k === 'scrap')) v += 0.35;
    const score = v * (RICH_VALUE[sec.rich] || 1) - exposure(sim, fid, sec.x, sec.z) * 2.2;
    if (score > bs || (score === bs && best && sec.id < best.id)) { bs = score; best = sec; }
  }
  return best;
}

function placeSettlement(sim, fid, sec) {
  for (const [dx, dz] of RING) {
    const params = { x: sec.x + dx, z: sec.z + dz, rot: sideFacing(sim, fid) };
    if (validatePlacement(sim, fid, 'settlement', params).ok) return params;
  }
  return null;
}

/** A spot for an economic building around settlement st (the side away from the enemy first). */
function econSpot(sim, fid, st, sec, type) {
  const e = enemyXZ(sim, fid);
  const away = datan2(st.x - e[0], st.z - e[1]); // heading pointing away from the enemy
  const def = STRUCTURES[type];
  if (def.requiresSectorKind) {
    if (!sec) return null;
    for (const [dx, dz] of RING) {
      const params = { x: sec.x + dx * 0.9, z: sec.z + dz * 0.9, rot: 0 };
      if (dist(params.x, params.z, st.x, st.z) < 10) continue;
      if (validatePlacement(sim, fid, type, params).ok) return params;
    }
    return null;
  }
  const dists = def.kind === 'area' ? [24, 31, 37] : [17, 23, 29];
  const turns = [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.5, -2.5, 3.1];
  for (const d of dists) {
    for (const t of turns) {
      const h = away + t;
      const params = { x: st.x + dsin(h) * d, z: st.z + dcos(h) * d, rot: def.kind === 'area' ? (Math.abs(t) > 1 && Math.abs(t) < 2 ? 0 : Math.PI / 2) : h };
      if (validatePlacement(sim, fid, type, params).ok) return params;
    }
  }
  return null;
}

function econBuildFor(sim, fid, st) {
  const { state } = sim;
  const sec = state.sectors.find((s) => s.sid === st.id) || null;
  const want = WANT[sec ? sec.kind : 'hamlet'] || ['farm'];
  const have = {};
  for (const s of state.structures) if (s.faction === fid && s.host === st.id) have[s.type] = (have[s.type] || 0) + 1;
  const counted = {};
  for (const type of want) {
    counted[type] = (counted[type] || 0) + 1;
    if ((have[type] || 0) >= counted[type]) continue;
    if (!unlockedBySpec(state, fid, STRUCTURES[type]) || !affordable(state, fid, type, SUPPLY_RESERVE)) return null;
    const params = econSpot(sim, fid, st, sec, type);
    if (params) return { stype: type, ...params };
  }
  return null;
}

function fortCount(state, fid, st, type) {
  let n = 0;
  for (const s of state.structures) {
    if (s.faction !== fid || (type ? s.type !== type : FORT_TYPES.indexOf(s.type) < 0)) continue;
    if (dist(s.x, s.z, st.x, st.z) < 28) n++;
  }
  return n;
}

/** Light works in front of an exposed / threatened settlement; a fire post only where allowed. */
function fortifyFor(sim, fid, ai, st) {
  const { state } = sim;
  const threatened = state.tick - (ai.seenThreat[st.id] || -1e9) < 20 * 240;
  if (!threatened && exposure(sim, fid, st.x, st.z) < 0.3) return null;
  const e = enemyXZ(sim, fid);
  let dx = e[0] - st.x, dz = e[1] - st.z;
  const d = Math.max(1, Math.sqrt(dx * dx + dz * dz));
  dx /= d; dz /= d;
  const px = -dz, pz = dx;
  const heavy = heavyDefenseAllowed(sim, fid, st.x, st.z);
  let item = null;
  if (!fortCount(state, fid, st, 'wire')) {
    item = { stype: 'wire', x1: st.x + dx * 19 - px * 10, z1: st.z + dz * 19 - pz * 10, x2: st.x + dx * 19 + px * 10, z2: st.z + dz * 19 + pz * 10 };
  } else if (!fortCount(state, fid, st, 'low_sandbags')) {
    item = { stype: 'low_sandbags', x1: st.x + dx * 12 - px * 6, z1: st.z + dz * 12 - pz * 6, x2: st.x + dx * 12 + px * 6, z2: st.z + dz * 12 + pz * 6 };
  } else if (heavy && threatened && !fortCount(state, fid, st, 'fire_post')) {
    item = { stype: 'fire_post', x: st.x + dx * 11 + px * 7, z: st.z + dz * 11 + pz * 7, rot: datan2(dx, dz) };
  }
  if (!item || !affordable(state, fid, item.stype, SUPPLY_RESERVE)) return null;
  return validatePlacement(sim, fid, item.stype, item).ok ? item : null;
}

/**
 * The next economy BUILD for an idle engineer (or null): a new settlement when below the target,
 * else production around existing settlements, else fortification of exposed ones.
 */
export function economyBuild(sim, fid, ai) {
  const { state } = sim;
  const settlements = ownSettlements(state, fid);
  // one site at a time: an unfinished settlement / economy building is the engineers' job first
  for (const s of state.structures) {
    if (s.faction === fid && !s.built && (STRUCTURES[s.type].settlement || STRUCTURES[s.type].cat === 'economy')) return null;
  }
  if (settlements.length < settlementTarget(sim, fid) && affordable(state, fid, 'settlement', EXPAND_RESERVE)) {
    const sec = pickSector(sim, fid, ai);
    if (sec) {
      const p = placeSettlement(sim, fid, sec);
      if (p) return { stype: 'settlement', ...p };
      ai.avoid[sec.id] = state.tick + 20 * 60; // no room there: try another sector for a while
    }
  }
  // production first, then works, nearest to home first (they pay back sooner)
  const h = homeXZ(sim, fid);
  const hx = h[0], hz = h[1];
  const built = settlements.filter((s) => s.built && !s.evac).sort((a, b) => dist(a.x, a.z, hx, hz) - dist(b.x, b.z, hx, hz) || a.id - b.id);
  for (const st of built) {
    if (hostilesNear(sim, fid, st.x, st.z, 60) > 0) continue;
    const item = econBuildFor(sim, fid, st);
    if (item) return item;
  }
  for (const st of built) {
    const item = fortifyFor(sim, fid, ai, st);
    if (item) return item;
  }
  return null;
}

/** 1 Hz upkeep: threat memory, evacuation, pens (slaughter / herd area), lost-sector memory. */
export function economyUpkeep(sim, fid, ai) {
  const { state } = sim;
  const b = bit(fid);
  // sectors whose settlement fell: stay away for a while
  for (const sec of state.sectors) {
    const was = ai.owned[sec.id] || 0;
    if (sec.sid) {
      const st = sim.rt.structById.get(sec.sid);
      if (st && st.faction === fid) ai.owned[sec.id] = sec.sid;
    } else if (was) {
      delete ai.owned[sec.id];
      ai.avoid[sec.id] = state.tick + 20 * 150;
    }
  }
  for (const st of ownSettlements(state, fid)) {
    if (!st.built) continue;
    const h = hostilesNear(sim, fid, st.x, st.z, 55);
    if (h > 0) ai.seenThreat[st.id] = state.tick;
    if (!h || st.evac || !(st.pop > 0)) continue;
    const d = defendersNear(sim, fid, st.x, st.z, 55);
    const overrun = h >= 8 && d * 1.6 < h;
    const failing = st.hp < st.maxHp * 0.5 && h > d;
    if (overrun || failing) aiIssue(sim, { type: CMD.EVACUATE, faction: fid, sid: st.id });
  }
  for (const pen of state.structures) {
    if (pen.faction !== fid || !pen.built || !STRUCTURES[pen.type].pen) continue;
    let penned = 0;
    for (const a of state.animals) if (a.st === 'penned' && a.pen === pen.id) penned++;
    const h = hostilesNear(sim, fid, pen.x, pen.z, 35);
    if (penned > 0 && h >= 6 && defendersNear(sim, fid, pen.x, pen.z, 35) < h) {
      aiIssue(sim, { type: CMD.SLAUGHTER, faction: fid, sid: pen.id });
      continue;
    }
    if ((state.tick + pen.id) % 600 >= 20 || penned >= STRUCTURES[pen.type].pen.capacity) continue;
    // drovers find nothing near the herd point: point them at visible livestock
    let near = false, best = null, bd = 150;
    for (const a of state.animals) {
      if (a.st !== 'wild' || !SPECIES[a.sp].livestock || !(a.visibleTo & b)) continue;
      if (dist(a.x, a.z, pen.herdX, pen.herdZ) < STRUCTURES[pen.type].pen.herdRadius * 0.8) { near = true; break; }
      const d = dist(a.x, a.z, pen.x, pen.z);
      if (d < bd) { bd = d; best = a; }
    }
    if (!near && best && hostilesNear(sim, fid, best.x, best.z, 50) === 0) {
      aiIssue(sim, { type: CMD.HERD_AREA, faction: fid, sid: pen.id, x: best.x, z: best.z });
    }
  }
}

/** Densest known infected-body spot near own structures with no visible enemy close (or null). */
export function sanitizeSpot(sim, fid) {
  const { state } = sim;
  const b = bit(fid);
  let best = null, bn = 0;
  for (const c of state.corpses) {
    if (!c.infected || !(c.seenBy & b)) continue;
    let near = false;
    for (const s of state.structures) if (s.faction === fid && dist(s.x, s.z, c.x, c.z) < 70) { near = true; break; }
    if (!near || hostilesNear(sim, fid, c.x, c.z, 35) > 0) continue;
    let n = 0;
    for (const o of state.corpses) if (o.infected && (o.seenBy & b) && dist(o.x, o.z, c.x, c.z) < 14) n++;
    if (n > bn || (n === bn && best && c.id < best.id)) { bn = n; best = c; }
  }
  return best;
}

/** PURGE (Purification): a visible cluster of infected bodies / infected own soldiers. */
export function purgeSpot(sim, fid) {
  const { state } = sim;
  const b = bit(fid);
  const R = ABILITIES.purge.radius;
  let best = null, bn = 2;
  for (const c of state.corpses) {
    if (!c.infected || !(c.seenBy & b) || !isPointVisibleTo(sim, fid, c.x, c.z)) continue;
    let n = 0;
    for (const o of state.corpses) if (o.infected && dist(o.x, o.z, c.x, c.z) < R && (o.seenBy & b)) n++;
    for (const sq of state.squads) {
      if (sq.faction !== fid || dist(sq.cx, sq.cz, c.x, c.z) > R) continue;
      for (const m of sq.members) if (m.state === 'alive' && m.infection > 1) n++;
    }
    if (n > bn) { bn = n; best = c; }
  }
  return best;
}
