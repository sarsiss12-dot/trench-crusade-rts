// Match wiring: session (simulation) + renderer + camera + selection + input + HUD + minimap +
// audio + debug overlay, and the frame loop. UI / audio / debug factories are injected by the
// entry point so this module stays independent of concrete DOM widgets.
import { factionHome } from '../sim/home.js';
import { sideFacing } from '../sim/sides.js';
import { createSession, SPEEDS } from './session.js';
import { createActions } from './actions.js';
import { createRenderer } from '../render/renderer.js';
import { createCamera } from '../render/camera.js';
import { createSelection } from '../input/selection.js';
import { createInputController } from '../input/controller.js';
import { EV } from '../core/events.js';
import { createEngineerHighlights } from '../ui/engineer_highlight.js';
import { createControlGroups } from '../input/control_groups.js';
import { unitDef } from '../data/units.js';
import { sideDef } from '../data/factions.js';

function homeView(sim, viewer) {
  const h = factionHome(sim, viewer);
  // Phase 5A: the camera looks toward the enemy from the side's start region (south region looks
  // north, north region looks south: yaw PI) — whatever the faction or role
  const f = sim.state.factions[viewer];
  const role = f ? f.role : 'defender';
  const dist = role === 'defender' ? 80 : 90;
  if (sideFacing(sim, viewer) !== 0) return { x: h.x, z: h.z - 8, yaw: 0, dist };
  return { x: h.x, z: h.z + 6, yaw: Math.PI, dist };
}

/**
 * env: { root, settings, storage, factories: { hud, minimap, audio, debug } }
 * opts: { scenarioId, seed, settings } | { state }, plus { onExit(reason), camera,
 *   memory: the viewer's fog memory (from a save or from a renderer lost with its GPU context) }
 */
export function createGame(env, opts) {
  const root = env.root;
  const settings = env.settings;
  const canvas = document.createElement('canvas');
  canvas.className = 'view';
  root.appendChild(canvas);
  const renderer = createRenderer(canvas, { quality: settings.quality || 'balanced', preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
  if (!renderer) {
    canvas.remove();
    return null;
  }
  const session = createSession(opts);
  const sim = session.sim;
  const viewer = session.viewer;
  // the fog can only be lifted for development (debug on) or in sandbox sessions (stress, gallery)
  const mayLiftFog = !!(sim.state.settings.sandbox || settings.debug);
  renderer.fogEnabled = settings.fog !== false || !mayLiftFog;
  const hv = homeView(sim, viewer);
  renderer.attach(sim, viewer, hv.yaw, opts.memory || null);

  const camera = createCamera({ x: hv.x, z: hv.z, dist: hv.dist, bounds: { x0: 0, z0: 0, x1: sim.world.width, z1: sim.world.height } });
  camera.yaw = hv.yaw;
  camera.groundFn = renderer.groundAt;
  if (opts.camera) Object.assign(camera, opts.camera);

  const game = {
    env, settings, canvas, renderer, session, sim, viewer, camera,
    selection: createSelection(sim),
    mode: { kind: 'normal' },
    // Two distinct lifecycles: Area Select is consumed after one box; Multi Select stays on until
    // the player presses its button again.
    ui: { areaSelect: false, multiSelect: false, attackMove: false, inspect: false, menuOpen: false },
    frame: { dt: 0, visDt: 0, alpha: 1, selection: null, selectedStruct: 0, hover: null, placement: null, abilityTarget: null, debug: { paths: false }, uiScale: 1 },
    pointer: null,
    hud: null, minimap: null, audio: null, debug: null,
    fps: 0, frameMs: 0,
    running: true,
    lastSpeed: 1,
  };
  /** A structure as the local player knows it: live when own / visible, else the remembered snapshot. */
  game.knownStructure = (id) => (renderer.memory ? renderer.memory.known(sim, viewer, id) : sim.rt.structById.get(id) || null);
  game.actions = createActions(game);
  // auto-dispatched engineers: HUD chip glow + world beam for a few seconds (presentation only)
  game.engineerHighlights = createEngineerHighlights();
  // control groups 1/2/3 (+ desktop 4..9): presentation state, saved in the save meta
  game.controlGroups = createControlGroups();
  if (opts.groups) game.controlGroups.restore(opts.groups);
  let salvSelV = -1, salvSel = false;
  function salvagerSelected() {
    if (salvSelV === game.selection.version) return salvSel;
    salvSelV = game.selection.version;
    salvSel = game.selection.ownSquads(sim, viewer).some((sq) => { const g = unitDef(sq.type).gathers; return !!g && g !== 'corpse'; });
    return salvSel;
  }
  game.notify = (key, level, params) => { if (game.hud) game.hud.notify(key, level, params); };

  game.home = () => {
    const h = homeView(sim, viewer);
    camera.tx = h.x; camera.tz = h.z; camera.vx = 0; camera.vz = 0;
  };
  game.lookAt = (x, z) => { camera.tx = x; camera.tz = z; camera.vx = 0; camera.vz = 0; };
  /** Skip ahead (tools / URL automation); presentation state is re-synced afterwards. */
  game.fastForward = (seconds) => {
    session.fastForward(seconds);
    renderer.units.syncCorpses(sim, viewer);
  };
  game.setSpeed = (v) => {
    session.setSpeed(v);
    if (v > 0) game.lastSpeed = v;
    if (game.hud) game.hud.onSpeedChanged();
  };
  game.togglePause = () => game.setSpeed(session.speed > 0 ? 0 : game.lastSpeed || 1);
  game.speedStep = (d) => {
    const i = Math.max(1, SPEEDS.indexOf(session.speed));
    game.setSpeed(SPEEDS[Math.max(1, Math.min(SPEEDS.length - 1, i + d))]);
  };
  game.toggleDebug = () => {
    settings.debug = !settings.debug;
    if (game.debug) game.debug.setVisible(settings.debug);
    game.frame.debug.paths = !!settings.debug;
  };
  game.setFog = (on) => { renderer.fogEnabled = on || !mayLiftFog; };

  const F = env.factories || {};
  game.input = createInputController(canvas, game);
  if (F.audio) game.audio = env.audio || F.audio(settings);
  if (F.hud) game.hud = F.hud(game);
  if (F.minimap) game.minimap = F.minimap(game);
  if (F.debug) {
    game.debug = F.debug(game);
    game.debug.setVisible(!!settings.debug || !!opts.debugOverlay);
    game.frame.debug.paths = !!settings.debug;
  }

  // presentation event fan-out (already fog-filtered by the session)
  session.subscribe((ev, show) => {
    game.engineerHighlights.onEvent(ev, viewer, performance.now() / 1000);
    renderer.onEvent(ev, show);
    if (game.hud) game.hud.onEvent(ev, show);
    if (game.audio) game.audio.onEvent(ev, show, game);
    if (game.minimap) game.minimap.onEvent(ev, show);
    if (ev.type === EV.MATCH_ENDED && opts.onEnded) opts.onEnded(ev);
  });

  function resize() {
    const r = root.getBoundingClientRect();
    renderer.resize(r.width, r.height, window.devicePixelRatio || 1);
    game.frame.uiScale = settings.uiScale || 1;
  }
  resize();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(root); else window.addEventListener('resize', resize);

  let last = performance.now();
  let raf = 0;
  let fpsAcc = 0, fpsFrames = 0, jitterAcc = 0, prevRaw = 0;
  let lastIdleDraw = -1e9;
  // adaptive resolution keeps mobile GPUs near the frame budget (settings.adaptive, default on)
  let slow = 0, fast = 0;
  function adaptResolution(jitterMs) {
    if (settings.adaptive === false) return;
    // a rock-steady ~30 fps with little work per frame is a browser / battery-saver cap, not an
    // overloaded GPU: lowering the resolution would only blur the picture
    const capped = game.fps > 26 && game.fps < 34 && jitterMs < 2.5 && game.frameMs < 18;
    if (game.fps < 32 && !capped) { slow++; fast = 0; } else if (game.fps > 55) { fast++; slow = 0; } else { slow = 0; fast = 0; }
    if (slow >= 3 && renderer.renderScale > 0.55) { renderer.setRenderScale(renderer.renderScale * 0.85); slow = 0; }
    if (fast >= 6 && renderer.renderScale < 1) { renderer.setRenderScale(renderer.renderScale * 1.1); fast = 0; }
  }
  function frame(now) {
    if (!game.running) return;
    raf = requestAnimationFrame(frame);
    const rawDt = Math.max(0, (now - last) / 1000);
    const dt = Math.min(0.1, rawDt);
    last = now;
    // paused under a menu: nothing moves, so redraw only now and then (battery, heat)
    if (session.speed === 0 && game.ui.menuOpen) {
      if (now - lastIdleDraw < 500) return;
      lastIdleDraw = now;
    }
    const t0 = performance.now();
    game.input.update(dt, now);
    session.update(dt);
    game.selection.prune(sim, viewer, game.knownStructure);
    const f = game.frame;
    f.dt = dt;
    f.visDt = dt * Math.min(session.speed, 4);
    f.alpha = session.alpha;
    f.selection = game.selection.squads;
    f.selectedStruct = game.selection.struct;
    f.engineerHighlights = game.engineerHighlights.active(performance.now() / 1000);
    // ECONOMY VIEW + resource heap glow (gather / salvage targeting, or a salvage crew selected)
    f.econView = !!game.ui.econView;
    f.showSectors = f.econView;
    const gm = game.mode;
    f.nodeGlow = gm.kind === 'gather' || (gm.kind === 'area' && gm.area === 'salvage') ? 2 : (f.econView && sideDef(viewer).economyView !== 'hunting') || salvagerSelected() ? 1 : 0;
    renderer.render(camera, f);
    if (game.hud) game.hud.update(dt);
    if (game.minimap) game.minimap.update(dt);
    if (game.audio) game.audio.update(dt, game);
    if (session.autosaveDue(settings.autosaveSeconds || 60) && env.storage) {
      const res = env.storage.save('auto', sim.state, game.saveMeta());
      if (game.hud) game.hud.notify(res.ok ? 'notice.autosaved' : 'notice.save_failed', res.ok ? 'info' : 'warn');
    }
    game.frameMs += (performance.now() - t0 - game.frameMs) * 0.1;
    if (session.speed === 0 && game.ui.menuOpen) return; // idle frames say nothing about the GPU
    fpsAcc += rawDt; fpsFrames++;
    jitterAcc += Math.abs(rawDt - prevRaw) * 1000; prevRaw = rawDt;
    if (fpsAcc >= 0.5) {
      game.fps = fpsFrames / fpsAcc;
      const jitter = jitterAcc / fpsFrames;
      fpsAcc = 0; fpsFrames = 0; jitterAcc = 0;
      adaptResolution(jitter);
    }
    if (game.debug) game.debug.update(dt);
  }
  raf = requestAnimationFrame(frame);

  /** Save to a campaign slot (never for sandbox sessions: storage refuses). */
  game.save = (slot = 'manual') => {
    if (!env.storage) return { ok: false, reason: 'save.storage_error' };
    if (session.ended) return { ok: false, reason: 'save.match_over' }; // it would reject every command
    return env.storage.save(slot, sim.state, game.saveMeta());
  };
  /** Save metadata: the side played and what that player knows (fog memory is not world state). */
  game.saveMeta = () => ({ faction: viewer, memory: renderer.exportMemory(), groups: game.controlGroups.export() });

  // GPU context loss (mobile app switch, driver reset): the simulation state is intact in memory,
  // so the host rebuilds the presentation around it instead of losing the match.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (!game.running) return;
    game.running = false;
    cancelAnimationFrame(raf);
    if (env.onContextLost) setTimeout(() => env.onContextLost(game), 0);
  });

  game.destroy = () => {
    game.running = false;
    cancelAnimationFrame(raf);
    if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
    game.input.destroy();
    if (game.hud) game.hud.destroy();
    if (game.minimap) game.minimap.destroy();
    if (game.debug) game.debug.destroy();
    if (game.audio && game.audio.stopMatch) game.audio.stopMatch();
    const lose = renderer.gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    canvas.remove();
  };

  return game;
}
