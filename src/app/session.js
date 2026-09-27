// Match session (DOM-free): fixed-timestep driver around the deterministic simulation, game speed
// (pause / 1x / 2x / 4x), fog-filtered presentation event fan-out for the local viewer, player
// command issuing (INPUT -> COMMAND -> SIMULATION), a command log (replay / lockstep ready) and the
// autosave cadence. Presentation code subscribes; it never mutates the simulation.
import { createSimulation, simulationFromState, stepSimulation, enqueueCommand } from '../sim/simulation.js';
import { makeCommand } from '../sim/commands.js';
import { eventVisibility, presentedEvent } from '../sim/perception.js';
import { DT } from '../sim/constants.js';
import { EV } from '../core/events.js';

export const SPEEDS = [0, 1, 2, 4];
const MAX_FRAME_DT = 0.25;
const FLOW_EVENTS = new Set([EV.PHASE_CHANGED, EV.PHASE_WARNING, EV.MATCH_ENDED]);

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

/**
 * opts: { scenarioId, seed, settings } for a new match, or { state } to resume a loaded GameState.
 */
export function createSession(opts = {}) {
  const sim = opts.state
    ? simulationFromState(opts.state)
    : createSimulation({ scenarioId: opts.scenarioId || 'siege_default', seed: opts.seed, settings: opts.settings || {} });
  const listeners = [];
  const s = {
    sim,
    viewer: sim.state.settings.playerFaction,
    speed: 1,
    acc: 0,
    alpha: 1,
    commandLog: [],
    tickMs: 0, // smoothed cost of one simulation tick (ms)
    tickMsMax: 0,
    ticksLastFrame: 0,
    lastAutosaveTick: sim.state.tick,
    ended: sim.state.match.phase === 'ENDED',
  };

  /** Subscribe to presentation events: fn(event, showFlags). Only events the viewer may perceive. */
  s.subscribe = (fn) => {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  };

  /** Issue a player command (plain data). Returns the queued command. */
  s.issue = (type, fields = {}) => {
    const cmd = enqueueCommand(sim, makeCommand(type, s.viewer, fields));
    s.commandLog.push(cmd);
    if (s.commandLog.length > 5000) s.commandLog.splice(0, 1000);
    return cmd;
  };

  function dispatch() {
    const evs = sim.events;
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      const show = eventVisibility(sim, ev, s.viewer);
      if (!show) continue;
      const pev = presentedEvent(sim, ev, show, s.viewer); // hidden shooters stay hidden
      for (let k = 0; k < listeners.length; k++) listeners[k](pev, show);
    }
    evs.length = 0;
  }

  /** One deterministic tick + event fan-out. */
  s.step = () => {
    const t0 = nowMs();
    stepSimulation(sim);
    const ms = nowMs() - t0;
    s.tickMs += (ms - s.tickMs) * 0.05;
    if (ms > s.tickMsMax) s.tickMsMax = ms;
    dispatch();
    if (sim.state.match.phase === 'ENDED') s.ended = true;
  };

  /** Advance by real time (seconds). Returns ticks simulated this frame. */
  s.update = (realDt) => {
    s.ticksLastFrame = 0;
    if (s.speed <= 0) { s.alpha = 1; return 0; }
    s.acc += Math.min(Math.max(0, realDt), MAX_FRAME_DT) * s.speed;
    const maxSteps = 3 * s.speed + 2;
    let n = 0;
    while (s.acc >= DT && n < maxSteps) {
      s.step();
      s.acc -= DT;
      n++;
    }
    if (n >= maxSteps) s.acc = 0; // too slow: drop time instead of spiralling
    s.alpha = Math.min(1, s.acc / DT);
    s.ticksLastFrame = n;
    return n;
  };

  /**
   * Run the simulation forward quickly (loading screens, tools). Per-shot presentation events are
   * dropped, but match-flow events (phase change, match end) still reach subscribers so the HUD and
   * the end screen follow. Stops when the match ends.
   */
  s.fastForward = (seconds) => {
    const n = Math.round(seconds / DT);
    const evs = sim.events;
    for (let i = 0; i < n && !s.ended; i++) {
      stepSimulation(sim);
      let k = 0;
      for (let j = 0; j < evs.length; j++) if (FLOW_EVENTS.has(evs[j].type)) evs[k++] = evs[j];
      evs.length = k;
      dispatch();
      if (sim.state.match.phase === 'ENDED') s.ended = true;
    }
  };

  s.setSpeed = (v) => {
    s.speed = SPEEDS.indexOf(v) >= 0 ? v : 1;
  };

  /** True when an autosave is due (every `seconds` of game time, never for sandbox sessions). */
  s.autosaveDue = (seconds = 60) => {
    if (sim.state.settings.sandbox || s.ended) return false;
    if (sim.state.tick - s.lastAutosaveTick < seconds / DT) return false;
    s.lastAutosaveTick = sim.state.tick;
    return true;
  };

  s.phase = () => (sim.state.match.lull && sim.state.match.lull.active && sim.state.match.phase === 'WAR' ? 'LULL' : sim.state.match.phase);

  /** Seconds remaining in the current phase (preparation countdown / war timer). */
  s.phaseTimeLeft = () => {
    const m = sim.state.match;
    if (m.phase === 'PREPARATION') return Math.max(0, (m.prepEndTick - sim.state.tick) * DT);
    if (m.phase === 'WAR' && m.lull && m.lull.active) return Math.max(0, (m.lull.end - sim.state.tick) * DT);
    if (m.phase === 'WAR') return Math.max(0, (m.warEndTick - sim.state.tick) * DT);
    return 0;
  };

  return s;
}
