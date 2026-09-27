// Player actions: high-level intents from input / HUD turned into plain-data commands issued
// through the session (INPUT -> COMMAND -> SIMULATION). Pre-validation here only reads state
// (same validators the simulation uses) to give instant feedback; the simulation stays the
// authority and reports rejections as COMMAND_REJECTED events.
import { CMD } from '../sim/commands.js';
import { unitDef } from '../data/units.js';
import { STRUCTURES } from '../data/structures.js';
import { validatePlacement } from '../construction/construction.js';
import { validateAbility, abilityCooldown } from '../sim/abilities.js';
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
    /** face (optional, radians; heading 0 = +z): the squads turn to it on arrival. */
    moveTo(x, z, attackMove = false, face = undefined) {
      const squads = own();
      if (!squads.length) return false;
      const cmd = { squadIds: squads.map((s) => s.id), x, z, attackMove: !!attackMove };
      if (Number.isFinite(face)) cmd.face = face;
      session.issue(CMD.MOVE, cmd);
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

    /**
     * Place a site. Selected builders take it; with none selected the SIMULATION auto-dispatches
     * the nearest available builder (or queues it) — the player never has to hunt for engineers.
     */
    build(stype, params) {
      const v = validatePlacement(sim, viewer, stype, params);
      if (!v.ok) return fail(v.reason);
      const cx = STRUCTURES[stype].kind === 'linear' ? (v.params.x1 + v.params.x2) / 2 : v.params.x;
      const cz = STRUCTURES[stype].kind === 'linear' ? (v.params.z1 + v.params.z2) / 2 : v.params.z;
      const selected = own().filter((sq) => unitDef(sq.type).roles.indexOf('builder') >= 0);
      if (!selected.length && !A.buildersFor(cx, cz).length) return fail('cmd.no_engineers'); // nobody could ever dig it: do not pay
      const cmd = { stype, ...v.params };
      if (selected.length) cmd.squadIds = selected.map((s) => s.id);
      session.issue(CMD.BUILD, cmd);
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
      const squads = own().filter((sq) => unitDef(sq.type).roles.indexOf('gatherer') >= 0 && unitDef(sq.type).gathers !== 'corpse');
      if (!squads.length) return fail('cmd.no_gatherers');
      session.issue(CMD.GATHER, { squadIds: squads.map((s) => s.id), nid: node.id });
      feedback('build', node.x, node.z);
      return true;
    },

    /** Grail work gangs: haul a known, uninfected body (and the field around it) to a drop-off. */
    haul(corpse) {
      const squads = own().filter((sq) => unitDef(sq.type).gathers === 'corpse');
      if (!squads.length) return fail('cmd.no_gatherers');
      if (corpse.infected) return fail('cmd.corpse_infected');
      session.issue(CMD.GATHER, { squadIds: squads.map((s) => s.id), cid: corpse.id });
      feedback('build', corpse.x, corpse.z);
      return true;
    },

    /** Selected squads (own, missing soldiers) that could request replacements. */
    reinforceable() {
      return own().filter((sq) => sq.members.length < unitDef(sq.type).squadSize);
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

    // ---------------------------------------------------------------- Phase 3
    /** Grail work gangs: hunt / strip / haul everything in an area until it is empty. */
    forage(x, z) {
      const squads = own().filter((sq) => unitDef(sq.type).gathers === 'corpse');
      if (!squads.length) return fail('cmd.no_gatherers');
      session.issue(CMD.FORAGE, { squadIds: squads.map((s) => s.id), x, z });
      feedback('build', x, z);
      return true;
    },

    /** Engineers burn the dead and scour infected ground (selected ones, else the nearest free). */
    sanitize(x, z) {
      const squads = own().filter((sq) => unitDef(sq.type).roles.indexOf('sanitizer') >= 0);
      const cmd = { x, z };
      if (squads.length) cmd.squadIds = squads.map((s) => s.id);
      session.issue(CMD.SANITIZE, cmd);
      feedback('build', x, z);
      return true;
    },

    herdArea(st, x, z) {
      session.issue(CMD.HERD_AREA, { sid: st.id, x, z });
      feedback('rally', x, z);
      return true;
    },

    slaughter(st) {
      session.issue(CMD.SLAUGHTER, { sid: st.id });
      if (game.audio) game.audio.ui('confirm');
      return true;
    },

    evacuate(st) {
      if (st.evac) return fail('evac.already');
      session.issue(CMD.EVACUATE, { sid: st.id });
      if (game.audio) game.audio.ui('confirm');
      return true;
    },

    chooseSpec(tier, spec) {
      session.issue(CMD.CHOOSE_SPECIALITY, { tier, spec });
      if (game.audio) game.audio.ui('confirm');
      return true;
    },

    abilityCooldown(id) {
      return abilityCooldown(sim, viewer, id);
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
