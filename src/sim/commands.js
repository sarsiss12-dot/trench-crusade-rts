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
import { setOrder, trenchNear, releasePosts } from '../units/orders.js';
import { validatePlacement, placeStructure, cancelStructure } from '../construction/construction.js';
import { canTrain, queueTraining, cancelTraining } from './production.js';
import { validateAbility, castAbility } from './abilities.js';
import { requestReinforcement } from '../factions/reinforcement.js';

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
});

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
    if (sq && sq.faction === cmd.faction && sq.members.some((m) => m.state === 'alive' || m.state === 'joining' || m.state === 'rising')) res.push(sq);
  }
  return res;
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
        // posts carry their own facing, so an explicit facing does not apply there)
        const seg = def.canGarrison ? trenchNear(sim, sq.faction, p[0], p[1], 3.5) : null;
        const o = { t: 'move', x: p[0], z: p[1], am: cmd.attackMove ? 1 : 0, trench: seg ? seg.id : 0 };
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
      squads.forEach((sq) => {
        const p = clampPrep(sim, cmd.faction, [px, pz]);
        setOrder(sim, sq, { t: 'move', x: p[0], z: p[1], am: 0, trench: seg.id });
      });
      ack(sim, cmd, squads, px, pz);
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
      const builders = ownSquads(sim, cmd).filter((sq) => hasRole(unitDef(sq.type), 'builder'));
      // a site nobody can ever dig is not paid for
      if (!builders.length && !state.squads.some((sq) => sq.faction === cmd.faction && hasRole(unitDef(sq.type), 'builder') && sq.members.some((m) => m.state === 'alive'))) {
        return reject(sim, cmd, 'cmd.no_engineers');
      }
      const st = placeStructure(sim, cmd.faction, cmd.stype, v);
      for (const sq of builders) setOrder(sim, sq, { t: 'build', sid: st.id, arrived: 0 });
      ack(sim, cmd, builders, st.x, st.z, { sid: st.id });
      return { ok: true, id: st.id };
    }
    case CMD.ASSIST_BUILD:
    case CMD.REPAIR: {
      const st = rt.structById.get(cmd.sid);
      if (!st || st.faction !== cmd.faction) return reject(sim, cmd, 'cmd.invalid_target');
      const builders = ownSquads(sim, cmd).filter((sq) => hasRole(unitDef(sq.type), cmd.type === CMD.REPAIR ? 'repairer' : 'builder'));
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
    default:
      return reject(sim, cmd, 'cmd.invalid');
  }
}

