// Entry point: settings, localization, storage, audio, menus and match lifecycle (new war, load,
// stress test, model gallery, pause, end screen). URL parameters allow automated / direct starts:
//   ?autostart=1&faction=black_grail&minutes=15&seed=7&quality=high&prep=60
//   ?stress=320 · ?view=gallery · &ff=120 (fast-forward s) · &cam=x,z,dist · &fog=0 · &debug=1 · &lang=en
import { createGame } from './app/game.js';
import { createHud } from './ui/hud.js';
import { createMinimap } from './ui/minimap.js';
import { createDebugOverlay } from './ui/debug.js';
import { createMenu } from './ui/menu.js';
import { el, button } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { t, setLanguage } from './ui/i18n.js';
import { createAudio } from './audio/audio.js';
import { createStorage, createSandboxStorage } from './save/storage.js';
import { serializeSave, deserializeSave } from './save/codec.js';

const SETTINGS_KEY = 'tcrts.settings';
const q = new URLSearchParams(location.search);

function safeStorage() {
  try {
    const s = window.localStorage;
    const k = '__tcrts_probe';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    // private mode / blocked storage: in-memory fallback (saves last for this page only)
    const mem = new Map();
    return { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  }
}

const backend = safeStorage();
function loadSettings() {
  try {
    const raw = backend.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const settings = {
  language: 'tr', quality: defaultQuality(), sound: true, volume: 0.8, debug: false, fog: true, uiScale: 1,
  ...loadSettings(),
};
if (q.get('lang')) settings.language = q.get('lang');
if (q.get('quality')) settings.quality = q.get('quality');
if (q.get('debug')) settings.debug = q.get('debug') === '1';
if (q.get('fog')) settings.fog = q.get('fog') !== '0';
setLanguage(settings.language);
document.documentElement.lang = settings.language;

function defaultQuality() {
  const ua = navigator.userAgent || '';
  // iPadOS Safari reports a Mac user agent: a touch-capable "Mac" is a tablet
  const iPadOS = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(ua) || iPadOS;
  if (!mobile) return 'high';
  const mem = navigator.deviceMemory; // Chromium only; Safari leaves it undefined
  return mem !== undefined && mem <= 3 ? 'low' : 'balanced';
}

function saveSettings() {
  try { backend.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

const app = document.getElementById('app');
const storage = createStorage(backend);
const sandboxStorage = createSandboxStorage(backend);
const audio = createAudio(settings);
let game = null;
let lastStart = null;

function applyUiScale() {
  document.documentElement.style.setProperty('--ui', String(settings.uiScale || 1));
}
applyUiScale();

// ---------------------------------------------------------------- WebGL2 availability
function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- match lifecycle
function stopGame() {
  if (game) { game.destroy(); game = null; }
  window.TC.game = null;
}

function startGame(opts, env = {}) {
  stopGame();
  menu.hide();
  const loading = el('div.loading', { text: t('app.loading') });
  app.appendChild(loading);
  // let the loading text paint before the heavy world build
  setTimeout(() => {
    try {
      game = createGame({
        root: app, settings, storage: env.storage === undefined ? storage : env.storage, audio,
        factories: { hud: createHud, minimap: createMinimap, debug: createDebugOverlay, audio: () => audio },
        onPause: pause,
        onContextLost: recoverFromContextLoss,
      }, {
        ...opts,
        onEnded: (ev) => {
          const ended = game;
          // a decided war is not something to "continue": drop its autosave
          if (ended && !ended.sim.state.settings.sandbox) storage.remove('auto');
          setTimeout(() => { if (game && game === ended) menu.showEnd(ended, ev); }, 2600);
        },
      });
      if (!game) throw new Error('webgl.unavailable');
      window.TC.game = game;
      // the in-match keyboard / shortcuts pause while a menu covers the battlefield
      Object.defineProperty(game.ui, 'menuOpen', { get: () => !!menu.current, configurable: true });
      if (env.after) env.after(game);
    } catch (e) {
      console.error(e);
      // release whatever the failed start left behind (canvas + live context)
      if (game) { try { game.destroy(); } catch { /* ignore */ } game = null; }
      for (const c of app.querySelectorAll('canvas.view')) c.remove();
      if (env.onFail) env.onFail(e);
      else startFailed(opts, env, e);
    } finally {
      loading.remove();
    }
  }, 30);
}

/**
 * A start that failed (no WebGL2, a driver that rejects a shader, a context lost during setup):
 * a short explanation and a way on — retry on low quality or back to the menu. Never a dead end.
 */
function startFailed(opts, env, e) {
  const msg = String(e && e.message || e);
  // WebGL2 itself was verified at boot: a refused context here is a device / driver hiccup
  const text = msg === 'webgl.context_lost' ? t('app.gpu_lost') : t('app.start_failed');
  const box = el('div.fatal');
  const close = () => box.remove();
  const btns = el('div.mlist');
  if ((settings.quality || 'balanced') !== 'low') {
    btns.append(button('big primary', icon('play') + t('app.retry_low'), () => {
      close();
      settings.quality = 'low';
      saveSettings();
      startGame(opts, env);
    }));
  } else {
    btns.append(button('big primary', icon('play') + t('app.retry'), () => { close(); startGame(opts, env); }));
  }
  btns.append(button('big', icon('menu') + t('end.menu'), () => { close(); menu.showMain(); }));
  box.append(el('p', { text }), btns);
  app.appendChild(box);
}

function startMatch({ faction, warMinutes, seed, prepSeconds, controllers }) {
  lastStart = () => startMatch({ faction, warMinutes, seed, prepSeconds, controllers });
  startGame({
    scenarioId: 'siege_default',
    seed: seed !== undefined ? seed : (Date.now() >>> 0) % 1000000,
    settings: { playerFaction: faction, warMinutes, prepSeconds, controllers },
  }, { after: urlAfter });
}

function startStress(n, quality) {
  if (quality) settings.quality = quality;
  lastStart = () => startStress(n, quality);
  startGame({
    scenarioId: 'stress', seed: 7, debugOverlay: true,
    settings: { playerFaction: 'new_antioch', stressSoldiers: n, controllers: { new_antioch: 'ai', black_grail: 'ai' } },
  }, {
    storage: sandboxStorage,
    after: (g) => {
      g.lookAt(160, 356);
      g.camera.dist = 95;
      urlAfter(g);
    },
  });
}

function startGallery(war = false) {
  lastStart = () => startGallery(war);
  startGame({
    scenarioId: 'gallery', seed: 1,
    // war=true: the same lineup fights at point-blank range (combat VFX / animation check)
    settings: { playerFaction: 'new_antioch', prepSeconds: war ? 0 : undefined, controllers: { new_antioch: 'player', black_grail: 'player' } },
  }, {
    storage: sandboxStorage,
    after: (g) => {
      g.setFog(false);
      g.lookAt(160, 389);
      g.camera.dist = 26;
      g.camera.yaw = 0.35;
      urlAfter(g);
    },
  });
}

/** Short message over the menu (no alert(): it is unavailable in embedded viewers). */
function flash(text) {
  const n = el('div.flash', { text });
  app.appendChild(n);
  setTimeout(() => n.remove(), 2600);
}

/** "Play again" after a loaded / resumed match: a fresh war with the same side and settings. */
function againLike(state) {
  const st = state.settings || {};
  return () => startMatch({ faction: st.playerFaction, warMinutes: st.warMinutes, prepSeconds: st.prepSeconds, controllers: st.controllers });
}

function loadSlot(slot) {
  const res = storage.load(slot);
  if (!res) { flash(t('notice.save_failed')); return; }
  lastStart = againLike(res.state);
  startGame({ state: res.state, memory: res.meta.memory }, { after: (g) => { g.notify('notice.loaded', 'good'); urlAfter(g); } });
}

/** Resume a match from a serialized save string (hot reload of the hosting page). */
function resumeFrom(str) {
  try {
    const res = deserializeSave(str);
    lastStart = againLike(res.state);
    startGame({ state: res.state, memory: res.meta.memory }, { after: (g) => g.notify('notice.loaded', 'good') });
    return true;
  } catch {
    return false;
  }
}

/**
 * Rebuild renderer / HUD around the live simulation state after a lost WebGL context. The match
 * itself lives in memory; a new context is only asked for once the page is visible again (a
 * backgrounded mobile tab gets none), with a few spaced retries before offering a manual retry.
 */
function recoverFromContextLoss(lost) {
  const state = lost.sim.state;
  let memory = null;
  try { memory = lost.renderer.exportMemory(); } catch { /* keep going without it */ }
  const speed = lost.session.speed;
  const wasPaused = menu.current === 'pause';
  const cam = { tx: lost.camera.tx, tz: lost.camera.tz, dist: lost.camera.dist, yaw: lost.camera.yaw };
  stopGame();
  const note = el('div.loading', { text: t('app.gpu_recovering') });
  app.appendChild(note);
  const opts = { state, memory };
  const env = {
    storage: state.settings.sandbox ? sandboxStorage : storage,
    after: (g) => {
      note.remove();
      g.lookAt(cam.tx, cam.tz);
      g.camera.dist = cam.dist;
      g.camera.yaw = cam.yaw;
      g.setSpeed(speed);
      if (wasPaused || speed === 0) { // never a frozen battlefield without its menu
        const resumeAt = pausedSpeed;
        pause();
        pausedSpeed = resumeAt;
      }
    },
  };
  let tries = 0;
  const attempt = () => {
    if (document.hidden) {
      document.addEventListener('visibilitychange', attempt, { once: true });
      return;
    }
    tries++;
    startGame(opts, {
      ...env,
      onFail: (e) => {
        if (tries < 4) setTimeout(attempt, 700 * tries);
        else { note.remove(); startFailed(opts, env, e); }
      },
    });
  };
  setTimeout(attempt, 250);
}

let pausedSpeed = 1;
function pause() {
  if (!game) return;
  pausedSpeed = game.session.speed || game.lastSpeed || 1;
  game.setSpeed(0);
  menu.showPause(game);
}

function resume() {
  menu.hide();
  if (game) game.setSpeed(pausedSpeed || 1);
}

function quit() {
  if (game && !game.session.ended) game.save('auto');
  stopGame();
  menu.showMain();
}

// ---------------------------------------------------------------- menus
const menu = createMenu({
  root: app, settings, storage,
  saveSettings,
  startMatch, startStress, startGallery, loadSlot,
  resume, quit,
  restart: () => { if (lastStart) lastStart(); else menu.showMain(); },
  applyLanguage: (lang) => { setLanguage(lang); document.documentElement.lang = lang; },
  applyAudio: () => { audio.setEnabled(settings.sound !== false); audio.setVolume(settings.volume !== undefined ? settings.volume : 0.8); },
  applyUiScale,
  applyDebug: () => { if (game && game.debug) { game.debug.setVisible(settings.debug); game.frame.debug.paths = !!settings.debug; } },
  applyFog: () => { if (game) game.setFog(settings.fog !== false); },
});

window.TC = { game: null, settings, menu, version: '0.1.0' };

// pause when the page is hidden (mobile app switch)
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game && game.session.speed > 0 && !menu.current) pause();
});
window.addEventListener('pointerdown', () => audio.unlock(), { once: false, passive: true });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && game && menu.current === 'pause') { e.preventDefault(); e.stopImmediatePropagation(); resume(); }
});

// ---------------------------------------------------------------- automation / direct starts
function urlAfter(g) {
  const ff = Number(q.get('ff') || 0);
  if (ff > 0) g.fastForward(ff);
  if (q.get('cam')) {
    const [x, z, d] = q.get('cam').split(',').map(Number);
    g.lookAt(x, z);
    if (d) g.camera.dist = d;
  }
  if (q.get('yaw')) g.camera.yaw = Number(q.get('yaw'));
  if (q.get('speed')) g.setSpeed(Number(q.get('speed')));
  if (q.get('select') === 'all') g.selection.set(g.sim.state.squads.filter((s) => s.faction === g.viewer).map((s) => s.id));
}

// keep a running match across a hot reload of the hosting page (when the host supports it)
const hot = window.claude && window.claude.hot;
if (hot && hot.snapshot) {
  try {
    hot.snapshot(() => (game && !game.session.ended && !game.sim.state.settings.sandbox
      ? { save: serializeSave(game.sim.state, game.saveMeta()) } : {}));
  } catch { /* optional */ }
}

function boot(data) {
  if (!hasWebGL2()) {
    app.appendChild(el('div.fatal', { text: t('app.webgl_missing') }));
    return;
  }
  if (data && data.save && resumeFrom(data.save)) return;
  bootFromUrl();
}

function bootFromUrl() {
  if (q.get('view') === 'gallery' || q.get('view') === 'duel') {
    startGallery(q.get('view') === 'duel');
  } else if (q.get('stress')) {
    startStress(Number(q.get('stress')) || 160, settings.quality);
  } else if (q.get('autostart')) {
    startMatch({
      faction: q.get('faction') || 'new_antioch',
      warMinutes: Number(q.get('minutes') || 15),
      seed: q.get('seed') !== null ? Number(q.get('seed')) : undefined,
      prepSeconds: q.get('prep') !== null ? Number(q.get('prep')) : undefined,
      controllers: q.get('aiai') ? { new_antioch: 'ai', black_grail: 'ai' } : undefined,
    });
  } else {
    menu.showMain();
  }
}

if (hot && hot.ready) hot.ready(boot);
else boot((hot && hot.data) || {});
