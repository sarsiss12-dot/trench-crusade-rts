// Command pipeline: INPUT -> COMMAND (plain serializable data) -> SIMULATION.
// Commands never hold DOM/WebGL objects, functions or class instances. Every command carries
// the issuing faction; the simulation validates ownership, phase, costs and targets.
import { EV } from '../core/events.js';
import { unitDef, hasRole } from '../data/units.js';
import { STRUCTURES } from '../data/structures.js';
import { FACTIONS, areHostile } from '../data/factions.js';
import { dist, headingOf, rotateOffset, clamp, wrapAngle } from '../core/dmath.js';
import { inZone, clampToZone } from '../world/mapgen.js';
import { PLAYER_FORMATIONS, formationRadius } from '../units/formation.js';
import { setOrder, trenchNear, releasePosts, trenchForSquad, nextAreaNode, SALVAGE_AREA_R } from '../units/orders.js';
import { validatePlacement, placeStructure, cancelStructure } from '../construction/construction.js';
import { canTrain, queueTraining, cancelTraining } from './production.js';
import { validateAbility, castAbility } from './abilities.js';
import { requestReinforcement, AUTO_REINF_MODES } from '../factions/reinforcement.js';
import { lullRefusal } from './lull.js';
import { pickBuilder, assignSite, startSanitize } from '../units/engineers.js';
import { isGarrison, canGarrison, garrisonGeom, garrisonRefusal, startGarrison } from '../units/garrison.js';
import { commanderAbilityRefusal, castCommanderAbility } from './commander.js';
import { validateSpec, chooseSpec, specValue } from './specialities.js';
import { evacuateSettlement } from '../factions/civilians.js';
import { slaughterPen, pennedCount } from './wildlife.js';

export const CMD = Object.freeze({
  MOVE: 'MOVE',
  ATTACK: 'ATTACK',
  STOP: 'STOP',
  BUILD: 'BUILD',
  REPAIR: 'REPAIR',
  GATHER: 'GATHER',
  DELIVER: 'DELIVER',
  ASSIST_BUILD: 'ASSIST_BUILD',
  SET_RALLY: 'SET_RALLY',
  TRAIN: 'TRAIN',
  CANCEL_TRAIN: 'CANCEL_TRAIN',
  CANCEL_BUILD: 'CANCEL_BUILD',
  USE_ABILITY: 'USE_ABILITY',
  FORMATION: 'FORMATION',
  ENTER_TRENCH: 'ENTER_TRENCH',
  REINFORCE: 'REINFORCE',
  SET_AUTO_REINFORCE: 'SET_AUTO_REINFORCE', // { squadIds, on: -1 | 0 | 1 } per-squad override (Phase 4)
  SET_AUTO_REINFORCE_DEFAULT: 'SET_AUTO_REINFORCE_DEFAULT', // { mode: 'off' | 'important' | 'all' }
  // Phase 3
  EVACUATE: 'EVACUATE', // { sid } settlement
  HERD_AREA: 'HERD_AREA', // { sid, x, z } livestock pen: where its drovers look for animals
  SLAUGHTER: 'SLAUGHTER', // { sid } livestock pen: emergency slaughter (food now, less later)
  FORAGE: 'FORAGE', // { squadIds, x, z } Black Grail work gangs: hunt / strip / haul in an area
  COMMANDER_ABILITY: 'COMMANDER_ABILITY', // { } the living commander's ability (area follows him)
  GARRISON: 'GARRISON', // { squadIds, sid } occupy a ruin garrison (nearest entrance, then slots)
  UNGARRISON: 'UNGARRISON', // { squadIds } leave through the nearest doorway
  SALVAGE_AREA: 'SALVAGE_AREA', // { squadIds?, x, z } engineers: strip every known heap in an area, then home
  SANITIZE: 'SANITIZE', // { squadIds?, x, z } engineers: burn the dead + scour the ground in an area
  CHOOSE_SPECIALITY: 'CHOOSE_SPECIALITY', // { tier, spec }
});

const SANITIZE_R = 16;
const FORAGE_R = 34;

/** Queue a command for the next tick (lockstep-friendly: commands carry their tick). */
export function enqueueCommand(sim, cmd) {
  const { state } = sim;
  const c = JSON.parse(JSON.stringify(cmd)); // commands are plain data; defensive copy
  if (typeof c.tick !== 'number' || c.tick <= state.tick) c.tick = state.tick + 1;
  c.seq = ++state.commandSeq;
  state.pending.push(c);
  return c;
}

/** Build a plain command object. */
export function makeCommand(type, faction, fields = {}) {
  return { type, faction, ...fields };
}

function reject(sim, cmd, reason) {
  sim.events.push({ type: EV.COMMAND_REJECTED, faction: cmd.faction, cmd: cmd.type, reason });
  return { ok: false, reason };
}

function ownSquads(sim, cmd) {
  const res = [];
  if (!Array.isArray(cmd.squadIds)) return res;
  for (const id of cmd.squadIds) {
    const sq = sim.rt.squadById.get(id);
    // civilians are autonomous: they are never commanded directly
    if (sq && sq.faction === cmd.faction && !unitDef(sq.type).autonomous && sq.members.some((m) => m.state === 'alive' || m.state === 'joining' || m.state === 'rising')) res.push(sq);
  }
  return res;
}

function ownStructure(sim, cmd) {
  const st = sim.rt.structById.get(cmd.sid);
  return st && st.faction === cmd.faction && st.hp > 0 ? st : null;
}

const OFF = [0, 0];

/** Spread group destinations so squads do not pile onto one point. Deterministic. */
function groupDestinations(squads, x, z, face) {
  if (squads.length === 1) return [[x, z]];
  let cx = 0, cz = 0;
  for (const sq of squads) { cx += sq.x; cz += sq.z; }
  cx /= squads.length; cz /= squads.length;
  // an explicit facing orients the whole group line across it (formation facing)
  const heading = face === face && face !== undefined ? face : dist(cx, cz, x, z) > 1 ? headingOf(x - cx, z - cz) : squads[0].rot;
  const sorted = squads.slice().sort((a, b) => a.id - b.id);
  const perRow = Math.min(4, sorted.length);
  const res = new Map();
  sorted.forEach((sq, i) => {
    const def = unitDef(sq.type);
    const w = Math.max(9, formationRadius(sq.formation, def.squadSize, def.spacing) * 2 + 2);
    const row = Math.floor(i / perRow), col = i % perRow;
    const cnt = Math.min(perRow, sorted.length - row * perRow);
    rotateOffset(OFF, (col - (cnt - 1) / 2) * w, -row * 10, heading);
    res.set(sq.id, [x + OFF[0], z + OFF[1]]);
  });
  return squads.map((sq) => res.get(sq.id));
}

function clampPrep(sim, faction, p) {
  const { state, world } = sim;
  if (state.match.phase !== 'PREPARATION') return p;
  const zone = world.zones[faction];
  if (zone && !inZone(zone, p[0], p[1])) clampToZone(zone, p[0], p[1], p);
  return p;
}

function ack(sim, cmd, squads, x, z, extra) {
  sim.events.push({ type: EV.ORDER_ACK, faction: cmd.faction, cmd: cmd.type, squadIds: squads.map((s) => s.id), x, z, ...(extra || {}) });
}

export function applyCommand(sim, cmd) {
  const { state, rt } = sim;
  if (!cmd || !cmd.type || !state.factions[cmd.faction]) return { ok: false, reason: 'cmd.invalid' };
  if (state.match.phase === 'ENDED') return { ok: false, reason: 'match.over' };
  // operational lull: no attacks, attack-moves or offensive abilities (everything else works)
  const lullWhy = lullRefusal(sim, cmd);
  if (lullWhy) return reject(sim, cmd, lullWhy);
  switch (cmd.type) {
    case CMD.MOVE: {
      const squads = ownSquads(sim, cmd);
      if (!squads.length) return reject(sim, cmd, 'cmd.no_units');
      if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.z)) return reject(sim, cmd, 'cmd.invalid');
      // optional final facing (radians, plain number): the squad turns to it on arrival
      if (cmd.face !== undefined && cmd.face !== null && !Number.isFinite(cmd.face)) return reject(sim, cmd, 'cmd.invalid');
      const face = Number.isFinite(cmd.face) ? wrapAngle(cmd.face) : NaN;
      const dests = groupDestinations(squads, cmd.x, cmd.z, face);
      squads.forEach((sq, i) => {
        const p = clampPrep(sim, cmd.faction, dests[i]);
        const def = unitDef(sq.type);
        // auto trench alignment: a move ending on a friendly/neutral trench occupies it (trench
        // posts carry their own facing, so an explicit facing does not apply there) — only when
        // the whole squad fits; else another trench close by, else a plain move + warning
        let seg = def.canGarrison ? trenchNear(sim, sq.faction, p[0], p[1], 3.5) : null;
        if (seg) {
          const fit = trenchForSquad(sim, sq, seg, p[0], p[1], 25);
          if (!fit) sim.events.push({ type: EV.NOTICE, faction: cmd.faction, key: 'trench.full', squadId: sq.id, x: p[0], z: p[1] });
          seg = fit;
        }
        const o = { t: 'move', x: seg ? seg.x : p[0], z: seg ? seg.z : p[1], am: cmd.attackMove ? 1 : 0, trench: seg ? seg.id : 0 };
        if (seg && dist(seg.x, seg.z, p[0], p[1]) < 12) { o.x = p[0]; o.z = p[1]; } // the tapped spot on that trench
        if (face === face && !seg) o.fh = face;
        setOrder(sim, sq, o);
      });
      ack(sim, cmd, squads, cmd.x, cmd.z, face === face ? { attackMove: !!cmd.attackMove, face } : { attackMove: !!cmd.attackMove });
      return { ok: true };
    }
    case CMD.ENTER_TRENCH: {
      const squads = ownSquads(sim, cmd).filter((sq) => unitDef(sq.type).canGarrison);
      if (!squads.length) return reject(sim, cmd, 'cmd.no_units');
      const seg = rt.structById.get(cmd.sid);
      if (!seg || seg.type !== 'trench' || (seg.faction !== cmd.faction && seg.faction !== 'neutral')) return reject(sim, cmd, 'cmd.invalid_target');
      const px = Number.isFinite(cmd.x) ? cmd.x : seg.x;
      const pz = Number.isFinite(cmd.z) ? cmd.z : seg.z;
      // capacity: every squad goes in whole — into this network or the nearest one with room
      const placed = [];
      for (const sq of squads) {
        const fit = trenchForSquad(sim, sq, seg, px, pz, 40);
        if (!fit) continue;
        const same = fit === seg;
        const p = clampPrep(sim, cmd.faction, same ? [px, pz] : [fit.x, fit.z]);
        setOrder(sim, sq, { t: 'move', x: p[0], z: p[1], am: 0, trench: fit.id });
        placed.push(sq);
      }
      if (!placed.length) return reject(sim, cmd, 'trench.full');
      if (placed.length < squads.length) sim.events.push({ type: EV.NOTICE, faction: cmd.faction, key: 'trench.full', x: px, z: pz });
      ack(sim, cmd, placed, px, pz);
      return { ok: true };
    }
    case CMD.ATTACK: {
      if (state.match.phase === 'PREPARATION') return reject(sim, cmd, 'match.prep_no_attack');
      const squads = ownSquads(sim, cmd);
      if (!squads.length) return reject(sim, cmd, 'cmd.no_units');
      const bit = 1 << FACTIONS[cmd.faction].index;
      let tgt = null;
      if (cmd.tk === 'squad') {
        tgt = rt.squadById.get(cmd.tid);
        if (!tgt || !areHostile(cmd.faction, tgt.faction) || !(tgt.visibleTo & bit)) return reject(sim, cmd, 'cmd.invalid_target');
      } else if (cmd.tk === 'struct') {
        tgt = rt.structById.get(cmd.tid);
        if (!tgt || !areHostile(cmd.faction, tgt.faction) || !((tgt.visibleTo | tgt.seenBy) & bit)) return reject(sim, cmd, 'cmd.invalid_target');
      } else return reject(sim, cmd, 'cmd.invalid_target');
      const lx = cmd.tk === 'squad' ? tgt.cx : tgt.x, lz = cmd.tk === 'squad' ? tgt.cz : tgt.z;
      for (const sq of squads) setOrder(sim, sq, { t: 'attack', tk: cmd.tk, tid: cmd.tid, lx, lz });
      ack(sim, cmd, squads, tgt.x, tgt.z, { tk: cmd.tk, tid: cmd.tid });
      return { ok: true };
    }
    case CMD.STOP: {
      const squads = ownSquads(sim, cmd);
      for (const sq of squads) setOrder(sim, sq, { t: 'idle' });
      return { ok: true };
    }
    case CMD.FORMATION: {
      if (PLAYER_FORMATIONS.indexOf(cmd.formation) < 0) return reject(sim, cmd, 'cmd.invalid');
      const squads = ownSquads(sim, cmd);
      for (const sq of squads) sq.formation = cmd.formation;
      return { ok: true };
    }
    case CMD.BUILD: {
      const v = validatePlacement(sim, cmd.faction, cmd.stype, cmd);
      if (!v.ok) return reject(sim, cmd, v.reason);
      // manual selection first; otherwise AUTO DISPATCH: nearest available builder (or the
      // shortest queue when everyone is busy) — the player never has to hunt for an engineer
      const builders = ownSquads(sim, cmd).filter((sq) => hasRole(unitDef(sq.type), 'builder'));
      const cx = STRUCTURES[cmd.stype].kind === 'linear' ? (v.params.x1 + v.params.x2) / 2 : v.params.x;
      const cz = STRUCTURES[cmd.stype].kind === 'linear' ? (v.params.z1 + v.params.z2) / 2 : v.params.z;
      const auto = builders.length ? null : pickBuilder(sim, cmd.faction, cx, cz);
      // a site nobody can ever dig is not paid for
      if (!builders.length && !auto && !state.squads.some((sq) => sq.faction === cmd.faction && hasRole(unitDef(sq.type), 'builder') && sq.members.some((m) => m.state === 'alive'))) {
        return reject(sim, cmd, 'cmd.no_engineers');
      }
      const st = placeStructure(sim, cmd.faction, cmd.stype, v);
      for (const sq of builders) setOrder(sim, sq, { t: 'build', sid: st.id, arrived: 0 });
      if (auto) assignSite(sim, auto.sq, st, true);
      ack(sim, cmd, auto ? [auto.sq] : builders, st.x, st.z, { sid: st.id, auto: auto ? 1 : 0 });
      return { ok: true, id: st.id };
    }
    case CMD.ASSIST_BUILD:
    case CMD.REPAIR: {
      const st = rt.structById.get(cmd.sid);
      // own structures; Phase 4: also a standing ruin garrison that no enemy holds
      const ruinOk = st && cmd.type === CMD.REPAIR && isGarrison(st) && !st.collapsed && (!st.holder || st.holder === cmd.faction);
      if (!st || (st.faction !== cmd.faction && !ruinOk)) return reject(sim, cmd, 'cmd.invalid_target');
      let builders = ownSquads(sim, cmd).filter((sq) => hasRole(unitDef(sq.type), cmd.type === CMD.REPAIR ? 'repairer' : 'builder'));
      if (!builders.length && cmd.type === CMD.REPAIR && !(cmd.squadIds && cmd.squadIds.length)) {
        // auto-dispatch (Phase 4): the nearest free repair crew
        const pick = pickBuilder(sim, cmd.faction, st.x, st.z);
        if (pick && !pick.queued && hasRole(unitDef(pick.sq.type), 'repairer')) {
          builders = [pick.sq];
          sim.events.push({ type: EV.ENGINEER_ASSIGNED, faction: cmd.faction, squadId: pick.sq.id, sid: st.id, x: st.x, z: st.z, queued: 0 });
        }
      }
      if (!builders.length) return reject(sim, cmd, 'cmd.no_builders');
      const t = st.built ? 'repair' : 'build';
      if (t === 'repair' && st.hp >= st.maxHp) return reject(sim, cmd, 'cmd.no_damage');
      for (const sq of builders) setOrder(sim, sq, { t, sid: st.id, arrived: 0 });
      ack(sim, cmd, builders, st.x, st.z, { sid: st.id });
      return { ok: true };
    }
    case CMD.CANCEL_BUILD: {
      const st = rt.structById.get(cmd.sid);
      if (!st || st.faction !== cmd.faction || st.built) return reject(sim, cmd, 'cmd.invalid_target');
      cancelStructure(sim, st);
      return { ok: true };
    }
    case CMD.GATHER: {
      const bit = 1 << FACTIONS[cmd.faction].index;
      if (cmd.cid) {
        // corpse field (Black Grail work gangs): a known body that is not the plague's to raise
        const c = rt.corpseById.get(cmd.cid);
        if (!c || c.infected || c.riseAt || !(c.seenBy & bit)) return reject(sim, cmd, 'cmd.invalid_target');
        const gangs = ownSquads(sim, cmd).filter((sq) => hasRole(unitDef(sq.type), 'gatherer') && unitDef(sq.type).gathers === 'corpse');
        if (!gangs.length) return reject(sim, cmd, 'cmd.no_gatherers');
        for (const sq of gangs) setOrder(sim, sq, { t: 'gather', cid: c.id, fx: c.x, fz: c.z, phase: 'to_node' });
        ack(sim, cmd, gangs, c.x, c.z, { cid: c.id });
        return { ok: true };
      }
      const node = rt.nodeById.get(cmd.nid);
      if (!node || node.amount <= 0 || !(node.seenBy & bit)) return reject(sim, cmd, 'cmd.invalid_target');
      const gatherers = ownSquads(sim, cmd).filter((sq) => hasRole(unitDef(sq.type), 'gatherer') && unitDef(sq.type).gathers !== 'corpse');
      if (!gatherers.length) return reject(sim, cmd, 'cmd.no_gatherers');
      for (const sq of gatherers) setOrder(sim, sq, { t: 'gather', nid: node.id, phase: 'to_node' });
      ack(sim, cmd, gatherers, node.x, node.z, { nid: node.id });
      return { ok: true };
    }
    case CMD.DELIVER: {
      const carriers = ownSquads(sim, cmd).filter((sq) => sq.carry > 0);
      for (const sq of carriers) {
        const o = sq.order;
        setOrder(sim, sq, o.cid !== undefined ? { t: 'gather', cid: o.cid, fx: o.fx, fz: o.fz, phase: 'to_drop' } : { t: 'gather', nid: o.nid || 0, phase: 'to_drop' });
      }
      return { ok: true };
    }
    case CMD.SET_RALLY: {
      const st = rt.structById.get(cmd.sid);
      if (!st || st.faction !== cmd.faction || !st.queue) return reject(sim, cmd, 'cmd.invalid_target');
      if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.z)) return reject(sim, cmd, 'cmd.invalid');
      st.rally = { x: clamp(cmd.x, 1, sim.world.width - 1), z: clamp(cmd.z, 1, sim.world.height - 1) };
      return { ok: true };
    }
    case CMD.TRAIN: {
      const st = rt.structById.get(cmd.sid);
      const why = canTrain(sim, cmd.faction, st, cmd.unit);
      if (why) return reject(sim, cmd, why);
      queueTraining(sim, cmd.faction, st, cmd.unit);
      return { ok: true };
    }
    case CMD.CANCEL_TRAIN: {
      const st = rt.structById.get(cmd.sid);
      if (!st || st.faction !== cmd.faction) return reject(sim, cmd, 'cmd.invalid_target');
      cancelTraining(sim, st);
      return { ok: true };
    }
    case CMD.USE_ABILITY: {
      const why = validateAbility(sim, cmd.faction, cmd.ability, cmd.x, cmd.z);
      if (why) return reject(sim, cmd, why);
      castAbility(sim, cmd.faction, cmd.ability, cmd.x, cmd.z);
      return { ok: true };
    }
    case CMD.REINFORCE: {
      // the squad keeps its order and position (front line, trench posts); replacements walk to it
      const squads = ownSquads(sim, cmd);
      let n = 0, why = 'cmd.cannot_reinforce';
      for (const sq of squads) {
        const r = requestReinforcement(sim, sq, false);
        if (!r) n++;
        else if (r !== 'reinf.full') why = r;
      }
      if (!n) return reject(sim, cmd, why);
      ack(sim, cmd, squads, squads[0].cx, squads[0].cz, { reinforce: 1 });
      return { ok: true };
    }
    case CMD.SET_AUTO_REINFORCE: {
      const squads = ownSquads(sim, cmd);
      const on = cmd.on === 1 ? 1 : cmd.on === 0 ? 0 : -1;
      if (!squads.length || !FACTIONS[cmd.faction].reinforcements) return reject(sim, cmd, 'cmd.no_units');
      for (const sq of squads) sq.autoReinf = on;
      return { ok: true };
    }
    case CMD.SET_AUTO_REINFORCE_DEFAULT: {
      if (AUTO_REINF_MODES.indexOf(cmd.mode) < 0 || !FACTIONS[cmd.faction].reinforcements) return reject(sim, cmd, 'cmd.invalid');
      sim.state.factions[cmd.faction].autoReinf = cmd.mode;
      return { ok: true };
    }
    // ---------------------------------------------------------------- Phase 3
    case CMD.EVACUATE: {
      const st = ownStructure(sim, cmd);
      if (!st || !STRUCTURES[st.type].settlement || !st.built) return reject(sim, cmd, 'cmd.invalid_target');
      if (st.evac) return reject(sim, cmd, 'evac.already');
      const why = evacuateSettlement(sim, st);
      if (why) return reject(sim, cmd, why);
      return { ok: true };
    }
    case CMD.HERD_AREA: {
      const st = ownStructure(sim, cmd);
      if (!st || !STRUCTURES[st.type].pen) return reject(sim, cmd, 'cmd.invalid_target');
      if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.z)) return reject(sim, cmd, 'cmd.invalid');
      if (dist(st.x, st.z, cmd.x, cmd.z) > 160) return reject(sim, cmd, 'herd.too_far');
      st.herdX = clamp(cmd.x, 1, sim.world.width - 1);
      st.herdZ = clamp(cmd.z, 1, sim.world.height - 1);
      ack(sim, cmd, [], st.herdX, st.herdZ, { sid: st.id });
      return { ok: true };
    }
    case CMD.SLAUGHTER: {
      const st = ownStructure(sim, cmd);
      if (!st || !STRUCTURES[st.type].pen || !st.built) return reject(sim, cmd, 'cmd.invalid_target');
      if (!pennedCount(state, st.id)) return reject(sim, cmd, 'pen.empty');
      const res = slaughterPen(sim, st, cmd.faction);
      sim.events.push({ type: EV.NOTICE, faction: cmd.faction, key: 'pen.slaughtered', x: st.x, z: st.z, n: res.killed, food: Math.round(res.food) });
      return { ok: true };
    }
    case CMD.FORAGE: {
      if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.z)) return reject(sim, cmd, 'cmd.invalid');
      const gangs = ownSquads(sim, cmd).filter((sq) => unitDef(sq.type).gathers === 'corpse');
      if (!gangs.length) return reject(sim, cmd, 'cmd.no_gatherers');
      const r = FORAGE_R * specValue(state, cmd.faction, 'forageRadius', 1);
      for (const sq of gangs) setOrder(sim, sq, { t: 'gather', mode: 'forage', fx: cmd.x, fz: cmd.z, fr: r, phase: 'seek', cid: 0, aid: 0 });
      ack(sim, cmd, gangs, cmd.x, cmd.z, { forage: 1, r });
      return { ok: true };
    }
    case CMD.COMMANDER_ABILITY: {
      const why = commanderAbilityRefusal(sim, cmd.faction);
      if (why) return reject(sim, cmd, why);
      castCommanderAbility(sim, cmd.faction);
      return { ok: true };
    }
    case CMD.GARRISON: {
      const st = rt.structById.get(cmd.sid);
      if (!isGarrison(st)) return reject(sim, cmd, 'cmd.invalid_target');
      const squads = ownSquads(sim, cmd);
      if (!squads.length) return reject(sim, cmd, 'cmd.no_units');
      const able = squads.filter(canGarrison);
      if (!able.length) return reject(sim, cmd, 'garrison.unit');
      // capacity: squads already inside or on their way count (own knowledge only)
      const g = garrisonGeom(sim, st);
      let taken = st.holder === cmd.faction ? st.occ.length : 0;
      for (const o of state.squads) if (o.faction === cmd.faction && o.order.t === 'garrison' && o.order.sid === st.id && o.order.phase === 'to_door' && able.indexOf(o) < 0) taken++;
      const sent = [];
      for (const sq of able) {
        if (st.occ.indexOf(sq.id) >= 0) continue;
        const why = garrisonRefusal(sim, sq, st, false);
        if (why && why !== 'garrison.full') return reject(sim, cmd, why);
        if (taken >= g.cap) break;
        startGarrison(sim, sq, st);
        sent.push(sq);
        taken++;
      }
      if (!sent.length) return reject(sim, cmd, 'garrison.full');
      ack(sim, cmd, sent, st.x, st.z, { sid: st.id });
      return { ok: true };
    }
    case CMD.UNGARRISON: {
      const inside = ownSquads(sim, cmd).filter((sq) => sq.order.t === 'garrison');
      if (!inside.length) return reject(sim, cmd, 'cmd.no_units');
      for (const sq of inside) {
        const st = rt.structById.get(sq.order.sid);
        const g = st && garrisonGeom(sim, st);
        const e = g ? g.entrances[sq.order.door] || g.entrances[0] : null;
        if (!e) { setOrder(sim, sq, { t: 'idle' }); continue; }
        const dx = e.ox - e.ix, dz = e.oz - e.iz, dl = dist(0, 0, dx, dz) || 1;
        setOrder(sim, sq, { t: 'move', x: e.ox + (dx / dl) * 4, z: e.oz + (dz / dl) * 4, am: 0, trench: 0 });
      }
      ack(sim, cmd, inside, inside[0].cx, inside[0].cz, {});
      return { ok: true };
    }
    case CMD.SALVAGE_AREA: {
      if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.z)) return reject(sim, cmd, 'cmd.invalid');
      const probe = { faction: cmd.faction, cx: cmd.x, cz: cmd.z };
      const first = nextAreaNode(sim, probe, { fx: cmd.x, fz: cmd.z, fr: SALVAGE_AREA_R });
      if (!first) return reject(sim, cmd, 'salvage.none');
      const isCrew = (sq) => hasRole(unitDef(sq.type), 'gatherer') && unitDef(sq.type).gathers !== 'corpse';
      let crews = ownSquads(sim, cmd).filter(isCrew);
      if (!crews.length && !(cmd.squadIds && cmd.squadIds.length)) {
        const pick = pickBuilder(sim, cmd.faction, cmd.x, cmd.z);
        if (pick && isCrew(pick.sq) && !pick.queued) {
          crews = [pick.sq];
          sim.events.push({ type: EV.ENGINEER_ASSIGNED, faction: cmd.faction, squadId: pick.sq.id, sid: 0, x: cmd.x, z: cmd.z, queued: 0, salvage: 1 });
        }
      }
      if (!crews.length) return reject(sim, cmd, 'cmd.no_gatherers');
      for (const sq of crews) {
        const n = nextAreaNode(sim, sq, { fx: cmd.x, fz: cmd.z, fr: SALVAGE_AREA_R }) || first;
        setOrder(sim, sq, { t: 'gather', nid: n.id, phase: 'to_node', area: 1, fx: cmd.x, fz: cmd.z, fr: SALVAGE_AREA_R });
      }
      ack(sim, cmd, crews, cmd.x, cmd.z, { salvage: 1, r: SALVAGE_AREA_R });
      return { ok: true };
    }
    case CMD.SANITIZE: {
      if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.z)) return reject(sim, cmd, 'cmd.invalid');
      let crews = ownSquads(sim, cmd).filter((sq) => hasRole(unitDef(sq.type), 'sanitizer'));
      if (!crews.length) {
        const pick = pickBuilder(sim, cmd.faction, cmd.x, cmd.z);
        if (pick && hasRole(unitDef(pick.sq.type), 'sanitizer')) {
          crews = [pick.sq];
          sim.events.push({ type: EV.ENGINEER_ASSIGNED, faction: cmd.faction, squadId: pick.sq.id, sid: 0, x: cmd.x, z: cmd.z, queued: 0, sanitize: 1 });
        }
      }
      if (!crews.length) return reject(sim, cmd, 'cmd.no_engineers');
      for (const sq of crews) startSanitize(sim, sq, cmd.x, cmd.z, SANITIZE_R);
      ack(sim, cmd, crews, cmd.x, cmd.z, { sanitize: 1, r: SANITIZE_R });
      return { ok: true };
    }
    case CMD.CHOOSE_SPECIALITY: {
      const why = validateSpec(state, cmd.faction, cmd.tier, cmd.spec);
      if (why) return reject(sim, cmd, why);
      chooseSpec(sim, cmd.faction, cmd.tier, cmd.spec);
      return { ok: true };
    }
    default:
      return reject(sim, cmd, 'cmd.invalid');
  }
}

