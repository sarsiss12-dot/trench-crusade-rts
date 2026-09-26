// Player actions: high-level intents from input / HUD turned into plain-data commands issued
// through the session (INPUT -> COMMAND -> SIMULATION). Pre-validation here only reads state
// (same validators the simulation uses) to give instant feedback; the simulation stays the
// authority and reports rejections as COMMAND_REJECTED events.
import { CMD } from '../sim/commands.js';
import { unitDef } from '../data/units.js';
import { STRUCTURES } from '../data/structures.js';
import { validatePlacement } from '../construction/construction.js';
import { validateAbility } from '../sim/abilities.js';
import { canTrain } from '../sim/production.js';
import { isSquadAlive } from '../sim/state.js';

export function createActions(game) {
  const { session, selection } = game;
  const sim = session.sim;
  const viewer = session.viewer;

  function own() {
    return selection.ownSquads(sim, viewer);
  }

  function feedback(kind, x, z) {
    if (game.renderer && game.renderer.overlays && typeof x === 'number') game.renderer.overlays.addMarker(kind, x, z);
    if (game.audio) game.audio.ui(kind === 'attack' ? 'attack' : 'confirm');
  }

  function fail(reason) {
    if (game.notify) game.notify(reason, 'warn');
    if (game.audio) game.audio.ui('error');
    return false;
  }

  const A = {
    moveTo(x, z, attackMove = false) {
      const squads = own();
      if (!squads.length) return false;
      session.issue(CMD.MOVE, { squadIds: squads.map((s) => s.id), x, z, attackMove: !!attackMove });
      feedback(attackMove ? 'attack' : 'move', x, z);
      return true;
    },

    attack(kind, id, x, z) {
      const squads = own();
      if (!squads.length) return false;
      if (sim.state.match.phase === 'PREPARATION') return fail('match.prep_no_attack');
      session.issue(CMD.ATTACK, { squadIds: squads.map((s) => s.id), tk: kind, tid: id });
      feedback('attack', x, z);
      return true;
    },

    enterTrench(sid, x, z) {
      const squads = own().filter((sq) => unitDef(sq.type).canGarrison);
      if (!squads.length) return false;
      session.issue(CMD.ENTER_TRENCH, { squadIds: squads.map((s) => s.id), sid, x, z });
      feedback('move', x, z);
      return true;
    },

    stop() {
      const squads = own();
      if (!squads.length) return false;
      session.issue(CMD.STOP, { squadIds: squads.map((s) => s.id) });
      if (game.audio) game.audio.ui('click');
      return true;
    },

    formation(f) {
      const squads = own();
      if (!squads.length) return false;
      session.issue(CMD.FORMATION, { squadIds: squads.map((s) => s.id), formation: f });
      if (game.audio) game.audio.ui('click');
      return true;
    },

    reinforce() {
      const squads = own();
      if (!squads.length) return false;
      session.issue(CMD.REINFORCE, { squadIds: squads.map((s) => s.id) });
      if (game.audio) game.audio.ui('confirm');
      return true;
    },

    /** Builders for a new site: selected builders, else the nearest idle (then any) builder squad. */
    buildersFor(x, z) {
      const sel = own().filter((sq) => unitDef(sq.type).roles.indexOf('builder') >= 0);
      if (sel.length) return sel;
      let best = null, bestScore = Infinity;
      for (const sq of sim.state.squads) {
        if (sq.faction !== viewer || !isSquadAlive(sq)) continue;
        if (unitDef(sq.type).roles.indexOf('builder') < 0) continue;
        const busy = sq.order.t === 'build' || sq.order.t === 'repair' ? 150 : sq.order.t === 'idle' ? 0 : 60;
        const score = Math.hypot(sq.cx - x, sq.cz - z) + busy;
        if (score < bestScore) { bestScore = score; best = sq; }
      }
      return best ? [best] : [];
    },

    /** Validate a placement for the ghost (read-only). */
    validate(stype, params) {
      return validatePlacement(sim, viewer, stype, params);
    },

    build(stype, params) {
      const v = validatePlacement(sim, viewer, stype, params);
      if (!v.ok) return fail(v.reason);
      const cx = STRUCTURES[stype].kind === 'linear' ? (v.params.x1 + v.params.x2) / 2 : v.params.x;
      const cz = STRUCTURES[stype].kind === 'linear' ? (v.params.z1 + v.params.z2) / 2 : v.params.z;
      const builders = A.buildersFor(cx, cz);
      if (!builders.length) return fail('cmd.no_engineers'); // nobody could ever dig it: do not pay
      session.issue(CMD.BUILD, { squadIds: builders.map((s) => s.id), stype, ...v.params });
      feedback('build', cx, cz);
      return true;
    },

    assist(st) {
      const squads = own().filter((sq) => unitDef(sq.type).roles.indexOf(st.built ? 'repairer' : 'builder') >= 0);
      if (!squads.length) return false;
      if (st.built && st.hp >= st.maxHp) return fail('cmd.no_damage');
      session.issue(st.built ? CMD.REPAIR : CMD.ASSIST_BUILD, { squadIds: squads.map((s) => s.id), sid: st.id });
      feedback('build', st.x, st.z);
      return true;
    },

    /** Structure panel "repair / help build": sends the nearest suitable engineer squad. */
    assistWithNearest(st) {
      if (st.built && st.hp >= st.maxHp) return fail('cmd.no_damage');
      const role = st.built ? 'repairer' : 'builder';
      let best = null, bestD = Infinity;
      for (const sq of sim.state.squads) {
        if (sq.faction !== viewer || !isSquadAlive(sq)) continue;
        if (unitDef(sq.type).roles.indexOf(role) < 0) continue;
        const busy = sq.order.t === 'build' || sq.order.t === 'repair' ? 80 : 0;
        const d = Math.hypot(sq.cx - st.x, sq.cz - st.z) + busy;
        if (d < bestD) { bestD = d; best = sq; }
      }
      if (!best) return fail('cmd.no_builders');
      session.issue(st.built ? CMD.REPAIR : CMD.ASSIST_BUILD, { squadIds: [best.id], sid: st.id });
      feedback('build', st.x, st.z);
      return true;
    },

    gather(node) {
      const squads = own().filter((sq) => unitDef(sq.type).roles.indexOf('gatherer') >= 0);
      if (!squads.length) return fail('cmd.no_gatherers');
      session.issue(CMD.GATHER, { squadIds: squads.map((s) => s.id), nid: node.id });
      feedback('build', node.x, node.z);
      return true;
    },

    train(st, unit) {
      const why = canTrain(sim, viewer, st, unit);
      if (why) return fail(why);
      session.issue(CMD.TRAIN, { sid: st.id, unit });
      if (game.audio) game.audio.ui('confirm');
      return true;
    },

    cancelTrain(st) {
      if (!st.queue || !st.queue.length) return false;
      session.issue(CMD.CANCEL_TRAIN, { sid: st.id });
      if (game.audio) game.audio.ui('click');
      return true;
    },

    cancelBuild(st) {
      if (st.built) return false;
      session.issue(CMD.CANCEL_BUILD, { sid: st.id });
      if (game.audio) game.audio.ui('click');
      return true;
    },

    setRally(st, x, z) {
      session.issue(CMD.SET_RALLY, { sid: st.id, x, z });
      feedback('rally', x, z);
      return true;
    },

    abilityCheck(id, x, z) {
      return validateAbility(sim, viewer, id, x, z);
    },

    ability(id, x, z) {
      const why = validateAbility(sim, viewer, id, x, z);
      if (why) return fail(why);
      session.issue(CMD.USE_ABILITY, { ability: id, x, z });
      feedback('attack', x, z);
      return true;
    },
  };
  return A;
}
