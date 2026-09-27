// Procedural score (Web Audio, no assets). Layers: low industrial drone, metallic resonance
// (struck iron), war percussion, an ominous tonal line (phrygian), a restrained choir-like formant
// pad, a sub rumble — and (Phase 4) a MID-FREQUENCY layer a phone speaker actually reproduces:
// a bowed string pad and ostinato (≈300-900 Hz), a brass-like horn call in war, and drum bodies /
// skins in the 180 Hz-1.2 kHz band. Real-device feedback was "there is no music": the old score
// lived almost entirely below 250 Hz.
//
// States: PREP (low but audible: pad + slow line), WAR (tension: drums, ostinato, horn),
// CRITICAL (objective in danger / last minute: denser, choir swell), LULL (operational lull: sparse
// pad, bell, no drums) + victory / defeat stings. Its own bus (music volume setting), ducked by big
// explosions. Variation from a private generator (never the simulation RNG).
//
// One instance per AudioContext: start() is idempotent (never two layer sets at once); stop() ends
// every running node; a scheduler that fell behind (tab in the background, suspended context)
// skips ahead instead of firing every missed beat at once.

const PHRYGIAN = [110, 116.54, 130.81, 146.83, 164.81, 174.61, 196, 220]; // A phrygian (A2..A3)
const OSTINATO = [220, 233.08, 220, 196, 220, 261.63, 246.94, 233.08]; // A3 area, phone-audible

/** Per-state targets (levels are linear gains on the score bus). */
export const MUSIC_LEVELS = {
  PREP: { intensity: 0.35, drone: 0.1, pad: 0.07, ostinato: 0, horn: 0, drums: 0 },
  LULL: { intensity: 0.3, drone: 0.09, pad: 0.08, ostinato: 0, horn: 0, drums: 0 },
  WAR: { intensity: 1, drone: 0.14, pad: 0.06, ostinato: 0.085, horn: 0.07, drums: 1 },
  CRITICAL: { intensity: 2, drone: 0.17, pad: 0.08, ostinato: 0.11, horn: 0.09, drums: 1 },
};

export function createMusic(ctx, bus, verb, bufs) {
  let started = false;
  let state = 'PREP';
  let intensity = 0; // 0 .. 1 war .. 2 critical (smoothed)
  const mix = ctx.createGain();
  mix.gain.value = 1;
  mix.connect(bus);
  const wet = ctx.createGain();
  wet.gain.value = 0.6;
  mix.connect(wet);
  if (verb) wet.connect(verb);
  const nodes = [];
  const L = {};
  let s = 0x1b873593;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
  let nextBeat = 0, beat = 0, nextMetal = 0, nextNote = 0, noteIdx = 0, nextOst = 0, ost = 0, nextHorn = 0, nextBell = 0;
  let ended = false;
  let starts = 0;

  function osc(type, f, dest, gain = 1, detune = 0) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = f; o.detune.value = detune;
    const g = ctx.createGain(); g.gain.value = gain;
    o.connect(g); g.connect(dest);
    o.start();
    nodes.push(o);
    return { o, g };
  }

  function start() {
    if (started) return; // idempotent: one layer set per instance
    started = true;
    starts++;
    const t = ctx.currentTime;
    // 1) industrial drone: detuned saws on A1 / E2, low-passed and slowly breathing
    L.droneG = ctx.createGain(); L.droneG.gain.value = 0.0001; L.droneG.connect(mix);
    L.droneF = ctx.createBiquadFilter(); L.droneF.type = 'lowpass'; L.droneF.frequency.value = 240; L.droneF.Q.value = 2.5;
    L.droneF.connect(L.droneG);
    osc('sawtooth', 55, L.droneF, 0.35, -6);
    osc('sawtooth', 55, L.droneF, 0.35, 7);
    osc('sawtooth', 82.41, L.droneF, 0.22, 3);
    osc('triangle', 110, L.droneF, 0.18);
    osc('sine', 0.07, L.droneF.frequency, 90);
    // 2) sub rumble
    L.rumbleG = ctx.createGain(); L.rumbleG.gain.value = 0.0001; L.rumbleG.connect(mix);
    const rs = ctx.createBufferSource(); rs.buffer = bufs.noiseLong; rs.loop = true;
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 75;
    rs.connect(rf); rf.connect(L.rumbleG); rs.start(); nodes.push(rs);
    // 3) choir-like pad: minor triad through vowel formants ("ah"), critical only
    L.choirG = ctx.createGain(); L.choirG.gain.value = 0.0001; L.choirG.connect(mix);
    const formants = [[700, 8, 1], [1150, 9, 0.5], [2600, 12, 0.18]].map(([f, q, a]) => {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const g = ctx.createGain(); g.gain.value = a;
      bp.connect(g); g.connect(L.choirG);
      return bp;
    });
    const choirIn = ctx.createGain(); choirIn.gain.value = 0.25;
    for (const bp of formants) choirIn.connect(bp);
    for (const [f, d] of [[220, -8], [220, 9], [261.63, -5], [329.63, 6], [164.81, 0]]) {
      const v = osc('sawtooth', f, choirIn, 0.5, d);
      osc('sine', 4.6 + rnd(), v.o.frequency, f * 0.004);
    }
    const trem = osc('sine', 0.11, L.choirG.gain, 0);
    L.choirTrem = trem.g;
    // 4) Phase 4 mid layer: bowed string pad (A minor-ish, 220-660 Hz), band-passed where a phone
    //    speaker is loud, with slow swell; always on (level per state)
    L.padG = ctx.createGain(); L.padG.gain.value = 0.0001; L.padG.connect(mix);
    const padBp = ctx.createBiquadFilter(); padBp.type = 'bandpass'; padBp.frequency.value = 620; padBp.Q.value = 0.7;
    const padLp = ctx.createBiquadFilter(); padLp.type = 'lowpass'; padLp.frequency.value = 1500;
    padBp.connect(padLp); padLp.connect(L.padG);
    for (const [f, d] of [[220, -9], [220, 8], [329.63, -6], [440, 5], [523.25, -4]]) {
      const v = osc('sawtooth', f, padBp, 0.18, d);
      osc('sine', 5.1 + rnd() * 0.8, v.o.frequency, f * 0.003);
    }
    L.ostG = ctx.createGain(); L.ostG.gain.value = 0.0001; L.ostG.connect(mix);
    L.hornG = ctx.createGain(); L.hornG.gain.value = 0.0001; L.hornG.connect(mix);
    nextBeat = t + 0.5; nextMetal = t + 2; nextNote = t + 4; nextOst = t + 1; nextHorn = t + 6; nextBell = t + 3;
  }

  // ------------------------------------------------------------------ one-shot voices
  function env(dest, t0, a, d, peak) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    g.connect(dest);
    return g;
  }

  function drum(t0, accent) {
    const g = env(mix, t0, 0.004, accent ? 0.9 : 0.55, accent ? 0.75 : 0.45);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(accent ? 120 : 140, t0);
    o.frequency.exponentialRampToValueAtTime(accent ? 46 : 60, t0 + 0.35);
    o.connect(g); o.start(t0); o.stop(t0 + 1);
    // tom body in the phone band (≈180-240 Hz) + skin noise up to ≈1.2 kHz
    const tb = env(mix, t0, 0.003, accent ? 0.35 : 0.22, accent ? 0.34 : 0.2);
    const to = ctx.createOscillator(); to.type = 'triangle';
    to.frequency.setValueAtTime(accent ? 230 : 250, t0);
    to.frequency.exponentialRampToValueAtTime(accent ? 170 : 190, t0 + 0.2);
    to.connect(tb); to.start(t0); to.stop(t0 + 0.5);
    const n = ctx.createBufferSource(); n.buffer = bufs.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = accent ? 900 : 1200; f.Q.value = 0.9;
    const ng = env(mix, t0, 0.002, 0.14, accent ? 0.2 : 0.12);
    n.connect(f); f.connect(ng); n.start(t0, rnd() * 0.5); n.stop(t0 + 0.25);
  }

  function metal(t0, level) {
    // struck iron: inharmonic partials, long ring into the reverb
    const base = [196, 233.08, 261.63, 311.13][Math.floor(rnd() * 4)];
    const g = ctx.createGain(); g.gain.value = level; g.connect(mix);
    for (const [k, a, d] of [[1, 0.5, 3.5], [2.76, 0.28, 2.2], [5.4, 0.12, 1.2], [8.93, 0.05, 0.6]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = base * k * (1 + (rnd() - 0.5) * 0.004);
      const e = env(g, t0, 0.002, d, a);
      o.connect(e); o.start(t0); o.stop(t0 + d + 0.1);
    }
  }

  function note(t0, f, dur, level) {
    // the tonal line one octave up from Phase 2 (phone-audible), soft attack
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.Q.value = 1;
    const g = env(lp, t0, dur * 0.35, dur * 0.65, level);
    void g;
    lp.connect(mix);
    for (const d of [-7, 6]) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f * 2; o.detune.value = d;
      o.connect(g); o.start(t0); o.stop(t0 + dur + 0.1);
    }
  }

  function pluck(t0, f, level) {
    // string ostinato: short bowed/plucked saw through a band-pass (≈400-900 Hz)
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2.4; bp.Q.value = 1.3;
    bp.connect(L.ostG);
    const g = env(bp, t0, 0.01, 0.32, level);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    o.connect(g); o.start(t0); o.stop(t0 + 0.45);
  }

  function hornCall(t0, level) {
    // a distant brass-like call: two notes, filtered saw with a slow attack
    const fs = rnd() < 0.5 ? [220, 293.66] : [196, 261.63];
    for (let i = 0; i < 2; i++) {
      const ts = t0 + i * 1.1;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(500, ts); lp.frequency.linearRampToValueAtTime(1500, ts + 0.4);
      lp.connect(L.hornG);
      const g = env(lp, ts, 0.25, 1.3, level);
      for (const d of [-5, 4]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fs[i]; o.detune.value = d;
        o.connect(g); o.start(ts); o.stop(ts + 1.7);
      }
    }
  }

  function bellTone(t0, level) {
    const base = [440, 392, 523.25][Math.floor(rnd() * 3)];
    for (const [k, a, d] of [[1, 0.6, 2.8], [2.0, 0.25, 1.8], [3.01, 0.12, 1.1]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = base * k;
      const e = env(mix, t0, 0.003, d, a * level);
      o.connect(e); o.start(t0); o.stop(t0 + d + 0.1);
    }
  }

  function sting(win) {
    const t0 = ctx.currentTime + 0.1;
    const chord = win ? [220, 277.18, 329.63, 440, 554.37] : [110, 116.54, 164.81, 174.61, 220];
    for (let i = 0; i < chord.length; i++) {
      const f = chord[i];
      const g = env(mix, t0 + (win ? i * 0.06 : 0), win ? 0.15 : 0.4, win ? 2.8 : 3.6, win ? 0.2 : 0.26);
      const o = ctx.createOscillator(); o.type = win ? 'sawtooth' : 'triangle';
      o.frequency.setValueAtTime(f, t0);
      if (!win) o.frequency.exponentialRampToValueAtTime(f * 0.94, t0 + 3.5);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = win ? 1800 : 900;
      o.connect(lp); lp.connect(g);
      o.start(t0); o.stop(t0 + 4.2);
    }
    for (let i = 0; i < (win ? 3 : 2); i++) drum(t0 + i * 0.42, true);
  }

  // ------------------------------------------------------------------ state
  function targetState(game) {
    const sess = game.session;
    const ph = sess.phase();
    if (ph === 'PREPARATION') return 'PREP';
    if (ph === 'LULL') return 'LULL';
    if (ph !== 'WAR') return state;
    const sim = game.sim;
    const known = game.renderer && game.renderer.knownStructures ? game.renderer.knownStructures() : sim.state.structures;
    let obj = null;
    for (const st of known) if (st.objective) { obj = st; break; }
    const low = obj && obj.hp / obj.maxHp < 0.45;
    const late = sess.phaseTimeLeft() < 60;
    return low || late ? 'CRITICAL' : 'WAR';
  }

  /** A scheduler that fell behind (background tab, suspended context) jumps to now. */
  function catchUp(t) {
    const behind = (x) => x < t - 0.2;
    if (behind(nextBeat)) nextBeat = t + 0.1;
    if (behind(nextMetal)) nextMetal = t + 1 + rnd() * 3;
    if (behind(nextNote)) nextNote = t + 0.5 + rnd() * 2;
    if (behind(nextOst)) nextOst = t + 0.2;
    if (behind(nextHorn)) nextHorn = t + 4 + rnd() * 6;
    if (behind(nextBell)) nextBell = t + 3 + rnd() * 5;
  }

  function update(dt, game) {
    if (ended) return;
    if (!started) start();
    state = targetState(game);
    const lv = MUSIC_LEVELS[state] || MUSIC_LEVELS.WAR;
    intensity += (lv.intensity - intensity) * Math.min(1, dt * 0.25);
    const t = ctx.currentTime;
    catchUp(t);
    L.droneG.gain.setTargetAtTime(lv.drone, t, 1.5);
    L.droneF.frequency.setTargetAtTime(200 + intensity * 120, t, 2);
    L.rumbleG.gain.setTargetAtTime(0.05 + Math.max(0, intensity - 0.8) * 0.12, t, 2);
    const choir = Math.max(0, intensity - 1.2) * 0.09;
    L.choirG.gain.setTargetAtTime(choir + 0.0001, t, 3);
    L.choirTrem.gain.setTargetAtTime(choir * 0.4, t, 3);
    L.padG.gain.setTargetAtTime(lv.pad + 0.0001, t, 2.5);
    L.ostG.gain.setTargetAtTime(lv.ostinato + 0.0001, t, 1.5);
    L.hornG.gain.setTargetAtTime(lv.horn + 0.0001, t, 1.5);
    // scheduler (lookahead): percussion, ostinato, metal, tonal line, horn, bell
    const ahead = t + 0.25;
    const bpm = 58 + Math.min(2, intensity) * 16;
    const beatLen = 60 / bpm;
    while (nextBeat < ahead) {
      const b = beat % 8;
      if (lv.drums && intensity > 0.5) {
        const pattern = intensity > 1.5 ? [1, 0, 1, 1, 1, 0, 1, 0] : [1, 0, 0, 1, 0, 0, 1, 0];
        if (pattern[b]) drum(nextBeat + (rnd() - 0.5) * 0.012, b === 0);
      }
      beat++;
      nextBeat += beatLen;
    }
    while (nextOst < ahead) {
      if (lv.ostinato > 0.001 && intensity > 0.6) pluck(nextOst, OSTINATO[ost % OSTINATO.length], 0.9);
      ost++;
      nextOst += beatLen / (intensity > 1.5 ? 2 : 1);
    }
    if (nextMetal < ahead) {
      metal(nextMetal, 0.05 + intensity * 0.03);
      nextMetal += (intensity > 1.5 ? 4 : 7) + rnd() * 6;
    }
    if (nextNote < ahead) {
      // slow phrygian random walk
      noteIdx = Math.max(0, Math.min(PHRYGIAN.length - 1, noteIdx + Math.floor(rnd() * 5) - 2));
      const dur = (intensity > 1.5 ? 2.2 : 3.4) + rnd() * 1.5;
      note(nextNote, PHRYGIAN[noteIdx], dur, 0.05 + intensity * 0.025);
      nextNote += dur * (intensity > 0.5 ? 0.8 : 1.4) + rnd();
    }
    if (nextHorn < ahead) {
      if (lv.horn > 0.001) hornCall(nextHorn, 1);
      nextHorn += (state === 'CRITICAL' ? 12 : 20) + rnd() * 14;
    }
    if (nextBell < ahead) {
      if (state === 'LULL' || state === 'PREP') bellTone(nextBell, state === 'LULL' ? 0.07 : 0.045);
      nextBell += 9 + rnd() * 9;
    }
  }

  function onEvent(ev, show, game) {
    if (ev.type === 'MATCH_ENDED' && !ended) {
      ended = true;
      const t = ctx.currentTime;
      if (started) {
        for (const k of ['droneG', 'choirG', 'rumbleG', 'padG', 'ostG', 'hornG']) L[k].gain.setTargetAtTime(0.0001, t, 0.8);
      }
      sting(ev.winner === game.viewer);
    }
  }

  /** Duck the score under a big blast (amount 0..1 = remaining level). */
  function duck(amount, seconds) {
    const t = ctx.currentTime;
    mix.gain.cancelScheduledValues(t);
    mix.gain.setTargetAtTime(amount, t, 0.02);
    mix.gain.setTargetAtTime(1, t + 0.1, seconds * 0.5);
  }

  /** Match over (back to the menu): silence everything; the next match starts a fresh score. */
  function stop() {
    for (const n of nodes) { try { n.stop(); } catch { /* already stopped */ } }
    nodes.length = 0;
    for (const k of ['droneG', 'rumbleG', 'choirG', 'padG', 'ostG', 'hornG']) if (L[k]) { try { L[k].disconnect(); } catch { /* ignore */ } L[k] = null; }
    started = false;
    ended = false;
    state = 'PREP';
    intensity = 0;
    beat = 0;
    ost = 0;
  }

  return {
    update, onEvent, duck, stop,
    get state() { return state; }, get intensity() { return intensity; },
    get active() { return started && !ended; },
    /** Diagnostics (tests): running continuous sources, how many times layers were built. */
    get liveNodes() { return nodes.length; }, get starts() { return starts; },
  };
}
