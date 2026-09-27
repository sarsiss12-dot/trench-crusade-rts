// Audio health / recovery state machine (Phase 4). DOM-free and unit-tested: audio.js feeds it the
// browser signals (user gestures, page visibility, AudioContext statechange, a 1 Hz watchdog tick)
// and gives it an adapter over the real AudioContext. Real-device feedback: sound could stop in the
// middle of a match and the score was not heard — a context left 'suspended' / 'interrupted' after
// an app switch, screen lock or audio-focus loss was only resumed on some taps, and one failed
// resume could disable sound for the rest of the session.
//
// Rules:
//  - one AudioContext and one graph at a time: a 'closed' context is REBUILT (old graph dropped,
//    fresh graph + fresh score), never duplicated; rebuilding needs a user gesture (autoplay policy)
//  - 'suspended' / 'interrupted' while audio is wanted -> resume() (at most one pending attempt);
//    a refused resume leaves the machine BLOCKED until the next tap / key press, which retries
//  - page hidden -> the context is suspended on purpose (battery) and the watchdog does not fight it;
//    page visible again -> resume attempt
//  - the watchdog checks at most once per second (no per-frame cost)
//
// adapter: { hasContext(), state(), create(), resume() -> Promise|undefined, suspend(), rebuild() }

export const AUDIO_MODE = { IDLE: 'idle', RUNNING: 'running', RESUMING: 'resuming', BLOCKED: 'blocked', HIDDEN: 'hidden', OFF: 'off' };

export function createAudioRecovery(adapter, opts = {}) {
  const period = opts.periodMs || 1000;
  let enabled = opts.enabled !== false;
  let visible = true;
  let pending = false;
  let mode = enabled ? AUDIO_MODE.IDLE : AUDIO_MODE.OFF;
  let lastTick = -Infinity;
  const stats = { resumes: 0, resumeFails: 0, rebuilds: 0, creates: 0, checks: 0 };

  function wanted() { return enabled && visible; }

  function settle() {
    const s = adapter.hasContext() ? adapter.state() : 'none';
    if (s === 'running') mode = AUDIO_MODE.RUNNING;
    else if (!pending) mode = AUDIO_MODE.BLOCKED;
  }

  function tryResume() {
    if (pending) return;
    pending = true;
    mode = AUDIO_MODE.RESUMING;
    stats.resumes++;
    let p;
    try { p = adapter.resume(); } catch { p = null; stats.resumeFails++; pending = false; mode = AUDIO_MODE.BLOCKED; return; }
    if (p && typeof p.then === 'function') {
      p.then(() => { pending = false; settle(); }, () => { pending = false; stats.resumeFails++; mode = AUDIO_MODE.BLOCKED; });
    } else { pending = false; settle(); }
  }

  /** Bring audio to the state it should be in. gesture: this call comes from a user tap / key. */
  function check(gesture) {
    stats.checks++;
    if (!enabled) { mode = AUDIO_MODE.OFF; return mode; }
    if (!visible) { mode = AUDIO_MODE.HIDDEN; return mode; }
    if (!adapter.hasContext()) {
      if (gesture) { stats.creates++; adapter.create(); settle(); if (mode !== AUDIO_MODE.RUNNING && adapter.hasContext()) tryResume(); } else mode = AUDIO_MODE.IDLE;
      return mode;
    }
    const s = adapter.state();
    if (s === 'running') { mode = AUDIO_MODE.RUNNING; return mode; }
    if (s === 'closed') {
      if (gesture) { stats.rebuilds++; adapter.rebuild(); settle(); if (mode !== AUDIO_MODE.RUNNING && adapter.hasContext()) tryResume(); } else mode = AUDIO_MODE.BLOCKED;
      return mode;
    }
    // 'suspended' | 'interrupted' (Safari / newer Chromium) | anything unknown
    tryResume();
    return mode;
  }

  return {
    get mode() { return mode; },
    get stats() { return stats; },
    get pending() { return pending; },
    /** User tap / key: the one moment browsers always allow creating or resuming audio. */
    onGesture() { return check(true); },
    onVisibility(isVisible) {
      visible = !!isVisible;
      if (!visible) {
        if (adapter.hasContext() && adapter.state() === 'running') { try { adapter.suspend(); } catch { /* ignore */ } }
        mode = enabled ? AUDIO_MODE.HIDDEN : AUDIO_MODE.OFF;
        return mode;
      }
      return check(false);
    },
    /** AudioContext 'statechange' (the OS interrupted or released audio focus). */
    onStateChange() {
      if (!adapter.hasContext()) return mode;
      if (adapter.state() === 'running') { mode = wanted() ? AUDIO_MODE.RUNNING : mode; return mode; }
      return wanted() ? check(false) : mode;
    },
    setEnabled(v) {
      enabled = !!v;
      if (!enabled) {
        if (adapter.hasContext() && adapter.state() === 'running') { try { adapter.suspend(); } catch { /* ignore */ } }
        mode = AUDIO_MODE.OFF;
        return mode;
      }
      return check(false);
    },
    /** Low-frequency watchdog; call every frame, it acts at most once per period. */
    tick(nowMs) {
      if (nowMs - lastTick < period) return false;
      lastTick = nowMs;
      if (!wanted()) return false;
      if (!adapter.hasContext()) return false; // nothing to recover before the first gesture
      if (adapter.state() !== 'running') { check(false); return true; }
      mode = AUDIO_MODE.RUNNING;
      return false;
    },
  };
}
