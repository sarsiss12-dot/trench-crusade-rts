// Procedural audio (Web Audio API, no sound files): layered weapon reports, explosions, melee,
// death cries, reanimation, construction, UI blips, bells, ambience and a procedural score
// (audio/music.js). Driven only by fog-filtered presentation events: a hidden shooter is never
// heard as a muzzle report — only the impact on your own men.
//
// Phase 2 mix (tuned for phone speakers as well as headphones):
//  - every report is layered: transient crack (2.5-6 kHz) + body punch (≈120-400 Hz, the band a
//    phone speaker actually reproduces) + mechanical detail + tail; sub content is extra, never
//    the only weight of a sound
//  - small audio-only variation (pitch, level, micro-timing) from a private generator — never the
//    gameplay RNG — so a machine gun is a rhythm, not a metronome
//  - voice budget with priority: artillery / heavy / near / selected squad / important impacts
//    first; distant fighting is folded into an aggregate crackle + rumble bed
//  - separate MUSIC and SFX gains; a limiter after the compressor keeps it from clipping
import { WEAPONS } from '../data/weapons.js';
import { projectToScreen } from '../render/camera.js';
import { isSquadVisibleTo } from '../sim/perception.js';
import { createMusic } from './music.js';

const VOICE_SOFT = 22; // ordinary sounds stop here
const VOICE_HARD = 34; // priority sounds may use the reserve up to here
const PRI = { LOW: 0, NORMAL: 1, HIGH: 2, TOP: 3 };

export function createAudio(settings = {}) {
  let ctx = null;
  let master = null, sfx = null, amb = null, ui = null, verb = null, musicBus = null;
  let noise = null, noiseLong = null, pink = null;
  let enabled = settings.sound !== false;
  let volume = settings.volume !== undefined ? settings.volume : 0.8;
  let sfxVol = settings.sfxVolume !== undefined ? settings.sfxVolume : 1;
  let musicVol = settings.musicVolume !== undefined ? settings.musicVolume : 0.5;
  let voices = 0;
  const lastPlay = new Map();
  const ambient = { wind: null, flies: null, dig: null, crackle: null, rumble: null, rumbleT: 6 };
  const distant = { shots: 0, booms: 0 }; // aggregated far-away fighting (decays)
  const P = [0, 0, 0, 0];
  let music = null;
  let shaper = null;
  // audio-only variation generator (xorshift) — independent of the simulation
  let vs = 0x2545f491;
  const vrand = () => { vs ^= vs << 13; vs ^= vs >>> 17; vs ^= vs << 5; return ((vs >>> 0) % 100000) / 100000; };
  const jit = (amt) => 1 + (vrand() - 0.5) * 2 * amt;

  function unlock() {
    if (!enabled) return;
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { enabled = false; return; }
        ctx = new AC({ latencyHint: 'interactive' });
        master = ctx.createGain();
        master.gain.value = volume;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -20; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.22;
        // brick-wall-ish limiter: nothing clips on small speakers
        const lim = ctx.createDynamicsCompressor();
        lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
        master.connect(comp); comp.connect(lim); lim.connect(ctx.destination);
        sfx = ctx.createGain(); sfx.gain.value = 0.9 * sfxVol; sfx.connect(master);
        amb = ctx.createGain(); amb.gain.value = 0.55 * sfxVol; amb.connect(master);
        ui = ctx.createGain(); ui.gain.value = 0.5; ui.connect(master);
        musicBus = ctx.createGain(); musicBus.gain.value = musicVol * 0.55; musicBus.connect(master);
        // cheap "field" reverb: filtered feedback delay network of two taps
        verb = ctx.createGain(); verb.gain.value = 0.22;
        const d1 = ctx.createDelay(1), d2 = ctx.createDelay(1), fb = ctx.createGain(), lp = ctx.createBiquadFilter();
        d1.delayTime.value = 0.13; d2.delayTime.value = 0.21; fb.gain.value = 0.38; lp.type = 'lowpass'; lp.frequency.value = 1400;
        verb.connect(d1); d1.connect(lp); lp.connect(d2); d2.connect(fb); fb.connect(d1); d2.connect(master); lp.connect(master);
        noise = makeNoise(1.0, 'white');
        noiseLong = makeNoise(4.0, 'brown');
        pink = makeNoise(2.0, 'pink');
        shaper = makeShaper(2.2);
        music = createMusic(ctx, musicBus, verb, { noise, noiseLong, pink });
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch {
      enabled = false;
    }
  }

  function makeNoise(seconds, kind) {
    const n = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let seed = 1234567, last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const w = (seed / 4294967296) * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
      else d[i] = w;
    }
    return b;
  }

  function makeShaper(k) {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * k) / Math.tanh(k); }
    return c;
  }

  function ready() {
    return enabled && ctx && ctx.state === 'running';
  }

  // ------------------------------------------------------------------ building blocks
  /** Voice budget with priority: ordinary sounds stop at VOICE_SOFT, important ones use the reserve. */
  function voice(dur, pri = PRI.NORMAL) {
    const cap = pri >= PRI.HIGH ? VOICE_HARD : pri === PRI.LOW ? VOICE_SOFT - 6 : VOICE_SOFT;
    if (voices >= cap) return false;
    voices++;
    setTimeout(() => { voices--; }, dur * 1000 + 60);
    return true;
  }

  function out(bus, gain, pan, wet) {
    const g = ctx.createGain();
    g.gain.value = gain;
    let node = g;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      node = p;
    }
    node.connect(bus);
    if (wet && verb) {
      const w = ctx.createGain();
      w.gain.value = wet;
      g.connect(w);
      w.connect(verb);
    }
    return g;
  }

  function saturate(dest, drive = 1) {
    const ws = ctx.createWaveShaper();
    ws.curve = shaper;
    const pre = ctx.createGain(); pre.gain.value = drive;
    pre.connect(ws); ws.connect(dest);
    return pre;
  }

  function noiseBurst(dest, t0, dur, type, freq, q, attack = 0.002, buffer = noise, peak = 1, rateJit = 0.15) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = (0.85 + vrand() * 0.3) * (1 + (vrand() - 0.5) * rateJit);
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0, vrand() * Math.max(0, buffer.duration - dur - 0.1));
    src.stop(t0 + dur + 0.05);
    return f;
  }

  function tone(dest, t0, dur, type, f0, f1, peak = 1, attack = 0.005) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.05);
    return o;
  }

  function rate(key, minGap) {
    const now = ctx.currentTime;
    const l = lastPlay.get(key) || -1;
    if (now - l < minGap) return false;
    lastPlay.set(key, now);
    return true;
  }

  // spatial parameters from the camera: [gain, pan, lowpass cutoff, distance]
  const SP = [0, 0, 20000, 0];
  function spatial(game, x, z) {
    const cam = game.camera;
    const d = Math.hypot(x - cam.tx, z - cam.tz);
    const zoom = Math.max(0.35, Math.min(1.2, 70 / cam.dist));
    let g = Math.max(0, 1 - d / 260);
    g = g * g * (0.45 + 0.55 * zoom);
    projectToScreen(cam, x, 1, z, P);
    const pan = P[3] ? (P[0] / Math.max(1, cam.width)) * 2 - 1 : x < cam.tx ? -0.8 : 0.8;
    SP[0] = g; SP[1] = pan * 0.8; SP[2] = 800 + 17000 * Math.max(0, 1 - d / 160); SP[3] = d;
    return SP;
  }

  function muffled(dest, cutoff) {
    if (cutoff > 15000) return dest;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.5;
    f.connect(dest);
    return f;
  }

  // ------------------------------------------------------------------ sound recipes
  /**
   * Layered firearm report. kind: rifle | shotgun | mg | mg_heavy | rifle_bio.
   * pri: voice priority (near / selected / heavy raise it).
   */
  function gunshot(game, x, z, kind, loud = 1, pri = PRI.NORMAL) {
    const s = spatial(game, x, z);
    if (s[0] < 0.01) return;
    // far away: no individual voice — it feeds the aggregate crackle of the distant front
    if (s[0] < 0.1 && pri < PRI.HIGH) { distant.shots += kind === 'mg' || kind === 'mg_heavy' ? 0.5 : 1; return; }
    const mg = kind === 'mg' || kind === 'mg_heavy';
    if (!rate('gun:' + kind, mg ? 0.028 + vrand() * 0.02 : 0.012)) return;
    if (!voice(0.6, s[0] > 0.45 ? Math.max(pri, PRI.HIGH) : pri)) { distant.shots += 1; return; }
    // micro-timing + level + pitch variation (audio-only): rhythm, never a metronome
    const t0 = ctx.currentTime + 0.002 + vrand() * (mg ? 0.018 : 0.006);
    const lv = jit(0.14), pj = jit(0.07);
    const bus = muffled(out(sfx, s[0] * loud * 0.55 * lv, s[1], 0.35), s[2]);
    if (kind === 'rifle_bio') {
      // wet, organic crack with a gurgling body
      noiseBurst(bus, t0, 0.012, 'highpass', 2800 * pj, 0.6, 0.001, noise, 0.9);
      noiseBurst(bus, t0, 0.16, 'bandpass', 480 * pj, 1.3, 0.003, noise, 0.85);
      tone(bus, t0, 0.14, 'triangle', 300 * pj, 110, 0.7);
      noiseBurst(bus, t0 + 0.03, 0.26, 'lowpass', 320, 0.7, 0.012, pink, 0.45);
      return;
    }
    const heavy = kind === 'mg_heavy';
    const shot = kind === 'shotgun';
    // 1) transient crack (supersonic snap)
    noiseBurst(bus, t0, shot ? 0.02 : 0.008, 'highpass', (heavy ? 2200 : 3200) * pj, 0.7, 0.0008, noise, shot ? 0.9 : 1.1);
    // 2) body punch in the phone-speaker band (≈120-400 Hz), saturated for weight
    const body = saturate(bus, heavy ? 1.8 : 1.3);
    const f0 = (heavy ? 190 : shot ? 240 : mg ? 260 : 300) * pj;
    tone(body, t0, heavy ? 0.13 : shot ? 0.12 : 0.085, 'sine', f0, f0 * 0.45, heavy ? 0.9 : 0.7, 0.002);
    noiseBurst(body, t0, shot ? 0.16 : heavy ? 0.12 : 0.08, 'bandpass', (heavy ? 180 : shot ? 420 : 260) * pj, shot ? 0.6 : 1.1, 0.0015, noise, shot ? 1 : 0.8);
    if (shot) noiseBurst(bus, t0, 0.18, 'bandpass', 1100 * pj, 0.4, 0.002, noise, 0.7); // wide, noisy spread
    // sub weight for bigger speakers (never the only weight)
    if (heavy || shot) tone(bus, t0, 0.12, 'sine', heavy ? 85 : 95, 45, 0.55, 0.003);
    // 3) mechanical: bolt cycling for rifles, belt clatter for machine guns
    if (kind === 'rifle' && s[0] > 0.3 && vrand() < 0.7) noiseBurst(bus, t0 + 0.32 + vrand() * 0.1, 0.03, 'bandpass', 2200, 3, 0.002, noise, 0.18);
    if (mg && s[0] > 0.3 && vrand() < 0.35) noiseBurst(bus, t0 + 0.02, 0.025, 'bandpass', 3000 * pj, 4, 0.001, noise, 0.14);
    // 4) tail: slap-back off the ground and trench walls
    noiseBurst(bus, t0 + 0.02, (heavy ? 0.5 : shot ? 0.45 : 0.38) * jit(0.2), 'lowpass', 700, 0.5, 0.02, pink, 0.2);
  }

  function incoming(game, x, z) {
    // your own men being hit by an unseen shooter: crack + thud at the target, no source report
    const s = spatial(game, x, z);
    if (s[0] < 0.02 || !rate('incoming', 0.05) || !voice(0.3, PRI.HIGH)) return;
    const t0 = ctx.currentTime;
    const bus = muffled(out(sfx, s[0] * 0.38, s[1]), s[2]);
    noiseBurst(bus, t0, 0.04, 'highpass', 2600, 0.6, 0.001, noise, 0.8);
    noiseBurst(bus, t0 + 0.02, 0.08, 'bandpass', 260, 1, 0.002, noise, 0.7);
  }

  /** Blast: sub boom + phone-band impact + broadband crack + debris + rolling rumble. */
  function explosionSound(game, x, z, size) {
    const s = spatial(game, x, z);
    const heavy = size !== 'light';
    if (s[0] < 0.03 && !heavy) { distant.booms += 0.4; return; }
    if (s[0] < 0.005) { distant.booms += 1; return; }
    if (!voice(heavy ? 2.8 : 1.4, PRI.TOP)) return;
    const d = s[3];
    const t0 = ctx.currentTime + Math.min(0.3, d / 800);
    const k = size === 'detonation' ? 1.25 : heavy ? 1 : 0.55;
    const bus = muffled(out(sfx, Math.min(1.25, s[0] * (heavy ? 1.35 : 0.9) + 0.1), s[1], 0.55), Math.min(s[2], 9000));
    // impact punch (audible on phones): 170 -> 60 Hz, saturated
    const body = saturate(bus, 2.2);
    tone(body, t0, 0.35 * k, 'sine', 170 * jit(0.08), 60, 1.0, 0.002);
    noiseBurst(body, t0, 0.25 * k, 'bandpass', 220, 0.8, 0.002, noise, 1);
    // crack of the burst
    noiseBurst(bus, t0, 0.05, 'highpass', 1800, 0.5, 0.001, noise, 0.9);
    // sub boom
    tone(bus, t0, (heavy ? 1.2 : 0.5) * k, 'sine', heavy ? 55 : 80, 26, 1.1, 0.004);
    // dirt / debris falling back
    noiseBurst(bus, t0 + 0.15, 0.6 * k, 'bandpass', 3200, 0.9, 0.05, noise, 0.22);
    // rolling rumble tail
    if (heavy) {
      const f = noiseBurst(bus, t0 + 0.05, 2.4 * k, 'lowpass', 900, 0.6, 0.02, noiseLong, 0.9);
      f.frequency.exponentialRampToValueAtTime(110, t0 + 2.0 * k);
    }
    if (music) music.duck(heavy ? 0.45 : 0.7, heavy ? 1.8 : 0.8);
  }

  function meleeSound(game, x, z, weapon, hit) {
    const s = spatial(game, x, z);
    if (s[0] < 0.02 || !rate('melee', 0.03) || !voice(0.4, PRI.LOW)) return;
    const t0 = ctx.currentTime + vrand() * 0.01;
    const bus = muffled(out(sfx, s[0] * 0.45 * jit(0.15), s[1], 0.15), s[2]);
    const blade = weapon === 'plague_greatblade' || weapon === 'plague_blade' || weapon === 'bayonet';
    const heavy = weapon === 'great_hammer' || weapon === 'plague_greatblade';
    if (blade) noiseBurst(bus, t0, 0.12, 'bandpass', 3000 * jit(0.1), 3, 0.002, noise, 0.5);
    if (hit) {
      noiseBurst(bus, t0 + 0.02, heavy ? 0.22 : 0.12, 'bandpass', heavy ? 200 : 320, 0.9, 0.003, noise, 1);
      tone(bus, t0 + 0.02, 0.12, 'sine', heavy ? 150 : 210, 70, 0.7);
      if (weapon === 'thrall_claws') noiseBurst(bus, t0 + 0.04, 0.2, 'bandpass', 700, 2, 0.01, noise, 0.4);
    }
  }

  /** Wet tearing for dismemberment the viewer saw (short, low priority). */
  function gore(game, x, z) {
    const s = spatial(game, x, z);
    if (s[0] < 0.08 || !rate('gore', 0.12) || !voice(0.4, PRI.LOW)) return;
    const t0 = ctx.currentTime;
    const bus = muffled(out(sfx, s[0] * 0.4, s[1], 0.1), s[2]);
    noiseBurst(bus, t0, 0.18, 'bandpass', 480, 1.4, 0.004, pink, 0.9);
    noiseBurst(bus, t0 + 0.05, 0.25, 'lowpass', 260, 0.8, 0.01, noise, 0.6);
  }

  function cry(game, x, z, faction) {
    const s = spatial(game, x, z);
    if (s[0] < 0.04 || !rate('cry', 0.35) || !voice(0.9, PRI.LOW)) return;
    const t0 = ctx.currentTime + 0.05;
    const bus = muffled(out(sfx, s[0] * 0.28, s[1], 0.3), s[2]);
    const bg = faction === 'black_grail';
    const f0 = bg ? 85 + vrand() * 25 : 170 + vrand() * 60;
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(f0 * 1.15, t0);
    src.frequency.exponentialRampToValueAtTime(f0 * 0.7, t0 + (bg ? 0.8 : 0.45));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.6, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (bg ? 0.9 : 0.5));
    for (const [fr, q, amp] of bg ? [[400, 4, 0.8], [900, 5, 0.4]] : [[750, 5, 0.9], [1250, 6, 0.5]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = fr; bp.Q.value = q;
      const a = ctx.createGain(); a.gain.value = amp;
      src.connect(bp); bp.connect(a); a.connect(g);
    }
    g.connect(bus);
    src.start(t0); src.stop(t0 + 1);
  }

  function knocks(game, x, z, n = 3) {
    const s = spatial(game, x, z);
    if (s[0] < 0.03 || !voice(0.8, PRI.LOW)) return;
    const bus = muffled(out(sfx, s[0] * 0.35, s[1], 0.2), s[2]);
    for (let i = 0; i < n; i++) {
      const t0 = ctx.currentTime + i * 0.18;
      noiseBurst(bus, t0, 0.07, 'bandpass', 900, 2, 0.001, noise, 0.8);
      tone(bus, t0, 0.08, 'triangle', 220, 160, 0.4);
    }
  }

  /** Organic structure raised / ruptured: wet crunch and a burst of flies. */
  function organic(game, x, z, big) {
    const s = spatial(game, x, z);
    if (s[0] < 0.03 || !voice(1.2, PRI.NORMAL)) return;
    const t0 = ctx.currentTime;
    const bus = muffled(out(sfx, s[0] * (big ? 0.7 : 0.4), s[1], 0.3), s[2]);
    noiseBurst(bus, t0, big ? 0.6 : 0.3, 'bandpass', 380, 1.2, 0.01, pink, 1);
    tone(bus, t0, big ? 0.5 : 0.25, 'sine', 160, 60, 0.6);
    noiseBurst(bus, t0 + 0.1, big ? 1.4 : 0.7, 'bandpass', 220, 6, 0.1, noise, 0.25); // buzzing
  }

  function bell() {
    if (!voice(5, PRI.HIGH)) return;
    const t0 = ctx.currentTime + 0.05;
    const bus = out(sfx, 0.35, 0, 0.6);
    for (const [k, a, d] of [[1, 0.8, 4.5], [2.76, 0.35, 3], [5.4, 0.18, 1.8], [0.5, 0.3, 5]]) tone(bus, t0, d, 'sine', 196 * k, 196 * k * 0.998, a, 0.004);
    tone(bus, t0 + 1.4, 3.5, 'sine', 196, 195.6, 0.5, 0.004);
  }

  function horn(bg) {
    if (!voice(2.5, PRI.HIGH)) return;
    const t0 = ctx.currentTime + 0.05;
    const bus = muffled(out(sfx, 0.22, 0, 0.5), 1600);
    if (bg) {
      tone(bus, t0, 2.2, 'sawtooth', 58, 52, 0.7, 0.3);
      tone(bus, t0, 2.2, 'sawtooth', 87, 80, 0.4, 0.3);
      tone(bus, t0, 2.2, 'sawtooth', 116, 104, 0.3, 0.3);
    } else {
      tone(bus, t0, 0.35, 'square', 392, 392, 0.5, 0.02);
      tone(bus, t0 + 0.4, 0.8, 'square', 523, 523, 0.5, 0.02);
    }
  }

  function whistle(game, x, z, delay, light) {
    const s = spatial(game, x, z);
    if (s[0] < 0.01 || !voice(delay + 0.2, PRI.HIGH)) return;
    const t0 = ctx.currentTime + Math.max(0, delay - (light ? 0.8 : 1.3));
    const bus = out(sfx, s[0] * 0.25, s[1]);
    tone(bus, t0, light ? 0.8 : 1.3, 'sine', light ? 1900 : 1500, light ? 700 : 420, 0.5, 0.2);
  }

  function swarmCast(game, x, z) {
    const s = spatial(game, x, z);
    if (s[0] < 0.02 || !voice(2, PRI.HIGH)) return;
    const t0 = ctx.currentTime;
    const bus = muffled(out(sfx, s[0] * 0.6, s[1], 0.3), s[2]);
    // a rising, beating drone of wings
    for (const f of [190, 205, 240]) {
      const o = tone(bus, t0, 1.8, 'sawtooth', f * 0.8, f * 1.05, 0.12, 0.4);
      o.detune.value = (vrand() - 0.5) * 30;
    }
    noiseBurst(bus, t0, 1.8, 'bandpass', 230, 5, 0.4, noise, 0.5);
  }

  function uiSound(kind) {
    if (!ready()) return;
    if (!rate('ui', 0.04)) return;
    const t0 = ctx.currentTime;
    switch (kind) {
      case 'click': tone(ui, t0, 0.04, 'sine', 950, 900, 0.3); break;
      case 'select': tone(ui, t0, 0.05, 'triangle', 620, 640, 0.35); tone(ui, t0 + 0.05, 0.05, 'triangle', 820, 840, 0.3); break;
      case 'confirm': tone(ui, t0, 0.07, 'triangle', 520, 780, 0.35); break;
      case 'attack': tone(ui, t0, 0.06, 'square', 300, 280, 0.18); tone(ui, t0 + 0.07, 0.07, 'square', 240, 220, 0.18); break;
      case 'error': tone(ui, t0, 0.14, 'square', 160, 150, 0.2); break;
      default: tone(ui, t0, 0.04, 'sine', 800, 800, 0.25);
    }
  }

  // ------------------------------------------------------------------ events (fog-filtered)
  function selectedSquad(game, id) {
    return !!(game.selection && game.selection.squads && game.selection.squads.has(id));
  }

  function onEvent(ev, show, game) {
    if (!ready()) return;
    const SRC = 1, TGT = 4;
    if (music) music.onEvent(ev, show, game);
    switch (ev.type) {
      case 'FIRE':
      case 'STRUCTURE_FIRE':
        if (show & SRC) {
          const w = WEAPONS[ev.weapon];
          const pri = ev.type === 'STRUCTURE_FIRE' || (ev.sq && selectedSquad(game, ev.sq)) || (ev.tsq && selectedSquad(game, ev.tsq)) ? PRI.HIGH : PRI.NORMAL;
          gunshot(game, ev.x, ev.z, w ? w.sound : 'rifle', 1, pri);
        } else if ((show & TGT) && ev.hit) incoming(game, ev.tx, ev.tz);
        break;
      case 'MELEE':
        if (show) meleeSound(game, ev.tx, ev.tz, ev.weapon, ev.hit);
        break;
      case 'DEATH':
        if (!show) break;
        if ((ev.id * 7) % 3 === 0) cry(game, ev.x, ev.z, ev.faction);
        if ((ev.cause === 'explosive' && (ev.force || 0) > 0.4) || (ev.ov || 0) > 1.5) gore(game, ev.x, ev.z);
        break;
      case 'EXPLOSION':
        if (show) explosionSound(game, ev.x, ev.z, ev.ability === 'detonation' ? 'detonation' : ev.size);
        else distant.booms += 0.6; // heard, not seen: only the far rumble (no position)
        break;
      case 'STRUCTURE_DESTROYED':
        if (show && !ev.cancelled) {
          if (ev.organic) organic(game, ev.x, ev.z, true);
          else explosionSound(game, ev.x, ev.z, 'light');
        }
        break;
      case 'STRUCTURE_COMPLETED':
        if (show) { if (ev.faction === 'black_grail') organic(game, ev.x, ev.z, false); else knocks(game, ev.x, ev.z, 3); }
        break;
      case 'SOLDIER_RISING':
        if (show && rate('rise', 1.2)) { cry(game, ev.x, ev.z, 'black_grail'); }
        break;
      case 'PHASE_CHANGED':
        if (ev.phase === 'WAR') { bell(); horn(game.viewer === 'black_grail'); }
        break;
      case 'TRAIN_COMPLETED':
        if (ev.faction === game.viewer) horn(game.viewer === 'black_grail');
        break;
      case 'ABILITY_CAST':
        if (!show) break;
        if (ev.ability === 'artillery_barrage') whistle(game, ev.x, ev.z, 3, false);
        else if (ev.ability === 'mortar_barrage') whistle(game, ev.x, ev.z, 1.6, true);
        else if (ev.ability === 'fly_swarm') swarmCast(game, ev.x, ev.z);
        break;
      case 'MATCH_ENDED':
        bell();
        break;
      default: break;
    }
  }

  // ------------------------------------------------------------------ ambience
  function loop(buffer, type, freq, q, gain) {
    const src = ctx.createBufferSource();
    src.buffer = buffer; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(amb);
    src.start();
    return { src, f, g };
  }

  let crackleT = 0;
  function update(dt, game) {
    if (!ready()) return;
    if (!ambient.wind) {
      ambient.wind = loop(noiseLong, 'lowpass', 380, 0.4, 0.22);
      ambient.flies = loop(noise, 'bandpass', 210, 7, 0.0001);
      ambient.dig = loop(noise, 'bandpass', 1300, 1.2, 0.0001);
      ambient.rumble = loop(noiseLong, 'lowpass', 140, 0.5, 0.0001);
    }
    const t = ctx.currentTime;
    ambient.wind.g.gain.setTargetAtTime(0.16 + 0.1 * Math.sin(t * 0.13) + 0.06 * Math.sin(t * 0.41), t, 0.8);
    ambient.wind.f.frequency.setTargetAtTime(320 + 140 * Math.sin(t * 0.21), t, 1);
    // flies: visible Black Grail near the camera; digging: own engineers working near the camera
    const cam = game.camera;
    let flies = 0, dig = 0;
    for (const sq of game.sim.state.squads) {
      const d = Math.hypot(sq.cx - cam.tx, sq.cz - cam.tz);
      if (d > 90) continue;
      const k = 1 - d / 90;
      if (sq.faction === 'black_grail' && isSquadVisibleTo(sq, game.viewer)) flies += k;
      if (sq.faction === game.viewer && sq.working) dig += k;
    }
    const zoom = Math.max(0.3, Math.min(1, 60 / cam.dist));
    ambient.flies.g.gain.setTargetAtTime(Math.min(0.12, flies * 0.03) * zoom, t, 0.4);
    ambient.flies.f.frequency.setTargetAtTime(190 + 40 * Math.sin(t * 7.3), t, 0.05);
    ambient.dig.g.gain.setTargetAtTime(dig > 0 ? Math.min(0.08, dig * 0.05) * zoom * (0.5 + 0.5 * Math.abs(Math.sin(t * 5.1))) : 0.0001, t, 0.05);
    // aggregate distant front: shots too far to voice become a crackle, blasts a low rumble
    distant.shots *= Math.exp(-dt * 1.6);
    distant.booms *= Math.exp(-dt * 0.5);
    ambient.rumble.g.gain.setTargetAtTime(Math.min(0.3, 0.02 + distant.booms * 0.05), t, 0.6);
    crackleT -= dt;
    if (crackleT <= 0 && distant.shots > 0.3) {
      crackleT = 0.04 + vrand() * 0.12 / Math.min(4, distant.shots);
      if (voice(0.15, PRI.LOW)) {
        const bus = out(amb, Math.min(0.14, 0.03 + distant.shots * 0.012) * jit(0.4), (vrand() - 0.5) * 1.4, 0.5);
        noiseBurst(bus, t, 0.05 + vrand() * 0.04, 'bandpass', 700 + vrand() * 900, 1.2, 0.002, noise, 0.8);
      }
    }
    // distant front: rumbles far away (atmosphere only, not tied to simulation events)
    ambient.rumbleT -= dt;
    if (ambient.rumbleT <= 0 && game.session.phase() === 'WAR') {
      ambient.rumbleT = 7 + vrand() * 13;
      if (voice(2.5, PRI.LOW)) {
        const bus = out(amb, 0.18, vrand() * 2 - 1, 0.4);
        const f = noiseBurst(bus, t, 2.2, 'lowpass', 260, 0.6, 0.08, noiseLong, 0.9);
        f.frequency.exponentialRampToValueAtTime(90, t + 2);
      }
    }
    if (music) music.update(dt, game);
  }

  function stopMatch() {
    if (!ctx) return;
    for (const k of ['wind', 'flies', 'dig', 'rumble']) {
      if (ambient[k]) { try { ambient[k].src.stop(); } catch { /* ignore */ } ambient[k] = null; }
    }
    if (music) music.stop();
  }

  return {
    unlock, onEvent, update, ui: uiSound, stopMatch,
    setVolume(v) { volume = v; if (master) master.gain.value = v; },
    setSfxVolume(v) { sfxVol = v; if (sfx) { sfx.gain.value = 0.9 * v; amb.gain.value = 0.55 * v; } },
    setMusicVolume(v) { musicVol = v; if (musicBus) musicBus.gain.value = v * 0.55; },
    setEnabled(v) {
      enabled = !!v;
      if (!enabled && ctx) ctx.suspend();
      else if (enabled) unlock();
    },
    get enabled() { return enabled; },
    get voices() { return voices; },
  };
}
