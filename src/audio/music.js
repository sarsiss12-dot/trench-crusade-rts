// Procedural score (Web Audio, no assets). Layers: low industrial drone, metallic resonance
// (struck iron), low war percussion, an ominous tonal line (phrygian), a very restrained
// choir-like formant pad, and a sub rumble. States: PREP (low, sparse), WAR (tension: drums),
// CRITICAL (objective in danger / last minute: denser drums, choir swell), plus short victory /
// defeat stings. Mixed well under the gunfire: its own bus (music volume setting) and ducked by
// big explosions. Variation comes from a private generator (never the simulation RNG).

const PHRYGIAN = [110, 116.54, 130.81, 146.83, 164.81, 174.61, 196, 220]; // A phrygian (A2..A3)

export function createMusic(ctx, bus, verb, bufs) {
  let started = false;
  let state = 'PREP';
  let intensity = 0; // 0 prep .. 1 war .. 2 critical (smoothed)
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
  let nextBeat = 0, beat = 0, nextMetal = 0, nextNote = 0, noteIdx = 0;
  let ended = false;

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
    started = true;
    const t = ctx.currentTime;
    // 1) industrial drone: detuned saws on A1 / E2, low-passed and slowly breathing
    L.droneG = ctx.createGain(); L.droneG.gain.value = 0.0001; L.droneG.connect(mix);
    L.droneF = ctx.createBiquadFilter(); L.droneF.type = 'lowpass'; L.droneF.frequency.value = 240; L.droneF.Q.value = 2.5;
    L.droneF.connect(L.droneG);
    osc('sawtooth', 55, L.droneF, 0.35, -6);
    osc('sawtooth', 55, L.droneF, 0.35, 7);
    osc('sawtooth', 82.41, L.droneF, 0.22, 3);
    osc('triangle', 110, L.droneF, 0.18);
    const lfo = osc('sine', 0.07, L.droneF.frequency, 90);
    void lfo;
    // 2) sub rumble
    L.rumbleG = ctx.createGain(); L.rumbleG.gain.value = 0.0001; L.rumbleG.connect(mix);
    const rs = ctx.createBufferSource(); rs.buffer = bufs.noiseLong; rs.loop = true;
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 75;
    rs.connect(rf); rf.connect(L.rumbleG); rs.start(); nodes.push(rs);
    // 3) choir-like pad: minor triad through vowel formants ("ah"), kept very low
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
      const vib = osc('sine', 4.6 + rnd(), v.o.frequency, f * 0.004);
      void vib;
    }
    const trem = osc('sine', 0.11, L.choirG.gain, 0);
    L.choirTrem = trem.g;
    nextBeat = t + 0.5; nextMetal = t + 2; nextNote = t + 4;
  }

  // ------------------------------------------------------------------ one-shot voices
  function env(dest, t0, a, d, peak) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
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
    // skin: low noise thump (phone-audible band)
    const n = ctx.createBufferSource(); n.buffer = bufs.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 180; f.Q.value = 1;
    const ng = env(mix, t0, 0.002, 0.18, accent ? 0.4 : 0.22);
    n.connect(f); f.connect(ng); n.start(t0, rnd() * 0.5); n.stop(t0 + 0.3);
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
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 1;
    const g = env(lp, t0, dur * 0.35, dur * 0.65, level);
    void g;
    lp.connect(mix);
    for (const d of [-7, 6]) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = d;
      o.connect(g); o.start(t0); o.stop(t0 + dur + 0.1);
    }
  }

  function sting(win) {
    const t0 = ctx.currentTime + 0.1;
    const chord = win ? [110, 138.59, 164.81, 220, 277.18] : [55, 58.27, 82.41, 87.31, 110];
    for (let i = 0; i < chord.length; i++) {
      const f = chord[i];
      const g = env(mix, t0 + (win ? i * 0.06 : 0), win ? 0.15 : 0.4, win ? 2.8 : 3.6, win ? 0.22 : 0.3);
      const o = ctx.createOscillator(); o.type = win ? 'sawtooth' : 'triangle';
      o.frequency.setValueAtTime(f, t0);
      if (!win) o.frequency.exponentialRampToValueAtTime(f * 0.94, t0 + 3.5);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = win ? 1600 : 500;
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
    if (ph !== 'WAR') return state;
    const sim = game.sim;
    const known = game.renderer && game.renderer.knownStructures ? game.renderer.knownStructures() : sim.state.structures;
    let obj = null;
    for (const st of known) if (st.objective) { obj = st; break; }
    const low = obj && obj.hp / obj.maxHp < 0.45;
    const late = sess.phaseTimeLeft() < 60;
    return low || late ? 'CRITICAL' : 'WAR';
  }

  function update(dt, game) {
    if (ended) return;
    if (!started) start();
    state = targetState(game);
    const want = state === 'PREP' ? 0 : state === 'WAR' ? 1 : 2;
    intensity += (want - intensity) * Math.min(1, dt * 0.25);
    const t = ctx.currentTime;
    L.droneG.gain.setTargetAtTime(0.1 + intensity * 0.05, t, 1.5);
    L.droneF.frequency.setTargetAtTime(200 + intensity * 120, t, 2);
    L.rumbleG.gain.setTargetAtTime(0.05 + Math.max(0, intensity - 0.8) * 0.12, t, 2);
    const choir = Math.max(0, intensity - 1.2) * 0.09;
    L.choirG.gain.setTargetAtTime(choir + 0.0001, t, 3);
    L.choirTrem.gain.setTargetAtTime(choir * 0.4, t, 3);
    // scheduler (lookahead): percussion, metal, tonal line
    const ahead = t + 0.25;
    const bpm = 58 + intensity * 16;
    const beatLen = 60 / bpm;
    while (nextBeat < ahead) {
      const b = beat % 8;
      if (intensity > 0.5) {
        const pattern = intensity > 1.5 ? [1, 0, 1, 1, 1, 0, 1, 0] : [1, 0, 0, 1, 0, 0, 1, 0];
        if (pattern[b]) drum(nextBeat + (rnd() - 0.5) * 0.012, b === 0);
      }
      beat++;
      nextBeat += beatLen;
    }
    if (nextMetal < ahead) {
      metal(nextMetal, 0.05 + intensity * 0.03);
      nextMetal += (intensity > 1.5 ? 4 : 7) + rnd() * 6;
    }
    if (nextNote < ahead) {
      // slow phrygian random walk (never the tonic twice in a row)
      noteIdx = Math.max(0, Math.min(PHRYGIAN.length - 1, noteIdx + Math.floor(rnd() * 5) - 2));
      const dur = (intensity > 1.5 ? 2.2 : 3.4) + rnd() * 1.5;
      note(nextNote, PHRYGIAN[noteIdx], dur, 0.04 + intensity * 0.025);
      nextNote += dur * (intensity > 0.5 ? 0.8 : 1.4) + rnd();
    }
  }

  function onEvent(ev, show, game) {
    if (ev.type === 'MATCH_ENDED' && !ended) {
      ended = true;
      const t = ctx.currentTime;
      if (started) {
        L.droneG.gain.setTargetAtTime(0.0001, t, 0.8);
        L.choirG.gain.setTargetAtTime(0.0001, t, 0.8);
        L.rumbleG.gain.setTargetAtTime(0.0001, t, 0.8);
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
    for (const k of ['droneG', 'rumbleG', 'choirG']) if (L[k]) { try { L[k].disconnect(); } catch { /* ignore */ } }
    started = false;
    ended = false;
    state = 'PREP';
    intensity = 0;
    beat = 0;
  }

  return { update, onEvent, duck, stop, get state() { return state; }, get intensity() { return intensity; } };
}
