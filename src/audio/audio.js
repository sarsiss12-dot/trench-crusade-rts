// Procedural audio (Web Audio API, no sound files): weapon reports, explosions, melee, death
// cries, reanimation, construction, UI blips, bells and ambience (wind, distant front, fly swarms,
// digging). Driven only by fog-filtered presentation events: a hidden shooter is never heard as a
// muzzle report — only the impact on your own men. Distance / screen position spatialization,
// voice limiting and per-category rate limits keep big fights readable and cheap.
import { WEAPONS } from '../data/weapons.js';
import { projectToScreen } from '../render/camera.js';
import { isSquadVisibleTo } from '../sim/perception.js';

const MAX_VOICES = 30;

export function createAudio(settings = {}) {
  let ctx = null;
  let master = null, sfx = null, amb = null, ui = null, verb = null;
  let noise = null, noiseLong = null;
  let enabled = settings.sound !== false;
  let volume = settings.volume !== undefined ? settings.volume : 0.8;
  let voices = 0;
  const lastPlay = new Map();
  const ambient = { wind: null, flies: null, dig: null, rumbleT: 6 };
  const P = [0, 0, 0, 0];

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
        comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
        master.connect(comp);
        comp.connect(ctx.destination);
        sfx = ctx.createGain(); sfx.gain.value = 0.9; sfx.connect(master);
        amb = ctx.createGain(); amb.gain.value = 0.55; amb.connect(master);
        ui = ctx.createGain(); ui.gain.value = 0.5; ui.connect(master);
        // cheap "field" reverb: filtered feedback delay network of two taps
        verb = ctx.createGain(); verb.gain.value = 0.22;
        const d1 = ctx.createDelay(1), d2 = ctx.createDelay(1), fb = ctx.createGain(), lp = ctx.createBiquadFilter();
        d1.delayTime.value = 0.13; d2.delayTime.value = 0.21; fb.gain.value = 0.38; lp.type = 'lowpass'; lp.frequency.value = 1400;
        verb.connect(d1); d1.connect(lp); lp.connect(d2); d2.connect(fb); fb.connect(d1); d2.connect(master); lp.connect(master);
        noise = makeNoise(1.0);
        noiseLong = makeNoise(4.0, true);
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch {
      enabled = false;
    }
  }

  function makeNoise(seconds, brown) {
    const n = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let seed = 1234567, last = 0;
    for (let i = 0; i < n; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const w = (seed / 4294967296) * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }

  function ready() {
    return enabled && ctx && ctx.state === 'running';
  }

  // ------------------------------------------------------------------ building blocks
  function voice(dur) {
    if (voices >= MAX_VOICES) return false;
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

  function noiseBurst(dest, t0, dur, type, freq, q, attack = 0.002, buffer = noise, peak = 1) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = 0.85 + ((t0 * 997) % 0.3);
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0, (t0 * 13.7) % 0.5);
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

  // spatial parameters from the camera: [gain, pan, lowpass cutoff]
  const SP = [0, 0, 20000];
  function spatial(game, x, z) {
    const cam = game.camera;
    const d = Math.hypot(x - cam.tx, z - cam.tz);
    const zoom = Math.max(0.35, Math.min(1.2, 70 / cam.dist));
    let g = Math.max(0, 1 - d / 260);
    g = g * g * (0.45 + 0.55 * zoom);
    projectToScreen(cam, x, 1, z, P);
    const pan = P[3] ? (P[0] / Math.max(1, cam.width)) * 2 - 1 : x < cam.tx ? -0.8 : 0.8;
    SP[0] = g; SP[1] = pan * 0.8; SP[2] = 800 + 17000 * Math.max(0, 1 - d / 160);
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
  function gunshot(game, x, z, kind, loud = 1) {
    const s = spatial(game, x, z);
    if (s[0] < 0.01) return;
    const key = 'gun:' + kind;
    if (!rate(key, kind === 'mg' || kind === 'mg_heavy' ? 0.03 : 0.012)) return;
    if (!voice(0.5)) return;
    const t0 = ctx.currentTime + 0.001;
    const bus = muffled(out(sfx, s[0] * loud * 0.55, s[1], 0.35), s[2]);
    if (kind === 'rifle_bio') {
      noiseBurst(bus, t0, 0.16, 'bandpass', 520, 1.2, 0.003, noise, 0.8);
      tone(bus, t0, 0.18, 'sine', 320, 70, 0.6);
      noiseBurst(bus, t0 + 0.03, 0.22, 'lowpass', 300, 0.7, 0.01, noise, 0.4);
      return;
    }
    const heavy = kind === 'mg_heavy';
    const shot = kind === 'shotgun';
    const dur = kind === 'mg' ? 0.08 : heavy ? 0.12 : shot ? 0.2 : 0.13;
    noiseBurst(bus, t0, dur, 'bandpass', shot ? 800 : heavy ? 900 : 1400, 0.7, 0.0015, noise, 1);
    noiseBurst(bus, t0, dur * 0.5, 'highpass', 3200, 0.5, 0.001, noise, 0.5);
    tone(bus, t0, 0.09, 'sine', heavy ? 95 : 130, 50, heavy ? 0.9 : 0.6);
    noiseBurst(bus, t0 + 0.02, dur * 3.5, 'lowpass', 600, 0.5, 0.02, noise, 0.18); // echo tail
  }

  function incoming(game, x, z) {
    // your own men being hit by an unseen shooter: crack + thud at the target, no source report
    const s = spatial(game, x, z);
    if (s[0] < 0.02 || !rate('incoming', 0.05) || !voice(0.3)) return;
    const t0 = ctx.currentTime;
    const bus = muffled(out(sfx, s[0] * 0.35, s[1]), s[2]);
    noiseBurst(bus, t0, 0.05, 'highpass', 2600, 0.6, 0.001, noise, 0.8);
    noiseBurst(bus, t0 + 0.02, 0.08, 'lowpass', 400, 0.7, 0.002, noise, 0.6);
  }

  function explosionSound(game, x, z, heavy) {
    const s = spatial(game, x, z);
    if (s[0] < 0.005 || !voice(2.2)) return;
    const t0 = ctx.currentTime + Math.min(0.25, Math.hypot(x - game.camera.tx, z - game.camera.tz) / 900);
    const bus = muffled(out(sfx, Math.min(1.2, s[0] * (heavy ? 1.3 : 0.8) + 0.08), s[1], 0.5), Math.min(s[2], 9000));
    const f = noiseBurst(bus, t0, heavy ? 1.8 : 1.0, 'lowpass', heavy ? 2600 : 3200, 0.6, 0.004, noiseLong, 1.2);
    f.frequency.exponentialRampToValueAtTime(160, t0 + (heavy ? 1.2 : 0.7));
    tone(bus, t0, heavy ? 1.1 : 0.6, 'sine', heavy ? 70 : 90, 28, 1.1, 0.004);
    noiseBurst(bus, t0 + 0.05, 0.5, 'bandpass', 3500, 0.8, 0.01, noise, 0.25); // debris rattle
  }

  function meleeSound(game, x, z, weapon, hit) {
    const s = spatial(game, x, z);
    if (s[0] < 0.02 || !rate('melee', 0.03) || !voice(0.4)) return;
    const t0 = ctx.currentTime;
    const bus = muffled(out(sfx, s[0] * 0.45, s[1], 0.15), s[2]);
    const blade = weapon === 'plague_greatblade' || weapon === 'plague_blade' || weapon === 'bayonet';
    const heavy = weapon === 'great_hammer' || weapon === 'plague_greatblade';
    if (blade) noiseBurst(bus, t0, 0.12, 'bandpass', 3000, 3, 0.002, noise, 0.5);
    if (hit) {
      noiseBurst(bus, t0 + 0.02, heavy ? 0.22 : 0.12, 'lowpass', heavy ? 350 : 600, 0.8, 0.003, noise, 1);
      tone(bus, t0 + 0.02, 0.12, 'sine', heavy ? 70 : 110, 45, 0.7);
      if (weapon === 'thrall_claws') noiseBurst(bus, t0 + 0.04, 0.2, 'bandpass', 700, 2, 0.01, noise, 0.4);
    }
  }

  function cry(game, x, z, faction) {
    const s = spatial(game, x, z);
    if (s[0] < 0.04 || !rate('cry', 0.35) || !voice(0.9)) return;
    const t0 = ctx.currentTime + 0.05;
    const bus = muffled(out(sfx, s[0] * 0.28, s[1], 0.3), s[2]);
    const bg = faction === 'black_grail';
    const f0 = bg ? 85 + (t0 * 37) % 25 : 170 + (t0 * 53) % 60;
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
    if (s[0] < 0.03 || !voice(0.8)) return;
    const bus = muffled(out(sfx, s[0] * 0.35, s[1], 0.2), s[2]);
    for (let i = 0; i < n; i++) {
      const t0 = ctx.currentTime + i * 0.18;
      noiseBurst(bus, t0, 0.07, 'bandpass', 900, 2, 0.001, noise, 0.8);
      tone(bus, t0, 0.08, 'triangle', 220, 160, 0.4);
    }
  }

  function bell() {
    if (!voice(5)) return;
    const t0 = ctx.currentTime + 0.05;
    const bus = out(sfx, 0.35, 0, 0.6);
    for (const [k, a, d] of [[1, 0.8, 4.5], [2.76, 0.35, 3], [5.4, 0.18, 1.8], [0.5, 0.3, 5]]) tone(bus, t0, d, 'sine', 196 * k, 196 * k * 0.998, a, 0.004);
    tone(bus, t0 + 1.4, 3.5, 'sine', 196, 195.6, 0.5, 0.004);
  }

  function horn(bg) {
    if (!voice(2.5)) return;
    const t0 = ctx.currentTime + 0.05;
    const bus = muffled(out(sfx, 0.22, 0, 0.5), 1600);
    if (bg) {
      tone(bus, t0, 2.2, 'sawtooth', 58, 52, 0.7, 0.3);
      tone(bus, t0, 2.2, 'sawtooth', 87, 80, 0.4, 0.3);
    } else {
      tone(bus, t0, 0.35, 'square', 392, 392, 0.5, 0.02);
      tone(bus, t0 + 0.4, 0.8, 'square', 523, 523, 0.5, 0.02);
    }
  }

  function whistle(game, x, z, delay) {
    const s = spatial(game, x, z);
    if (s[0] < 0.01 || !voice(delay + 0.2)) return;
    const t0 = ctx.currentTime + Math.max(0, delay - 1.3);
    const bus = out(sfx, s[0] * 0.25, s[1]);
    tone(bus, t0, 1.3, 'sine', 1500, 420, 0.5, 0.2);
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
  function onEvent(ev, show, game) {
    if (!ready()) return;
    const SRC = 1, TGT = 4;
    switch (ev.type) {
      case 'FIRE':
      case 'STRUCTURE_FIRE':
        if (show & SRC) {
          const w = WEAPONS[ev.weapon];
          gunshot(game, ev.x, ev.z, w ? w.sound : 'rifle');
        } else if ((show & TGT) && ev.hit) incoming(game, ev.tx, ev.tz);
        break;
      case 'MELEE':
        if (show) meleeSound(game, ev.tx, ev.tz, ev.weapon, ev.hit);
        break;
      case 'DEATH':
        if (show && ((ev.id * 7) % 3 === 0)) cry(game, ev.x, ev.z, ev.faction);
        break;
      case 'EXPLOSION':
        if (show) explosionSound(game, ev.x, ev.z, ev.size === 'heavy');
        break;
      case 'STRUCTURE_DESTROYED':
        if (show && !ev.cancelled) explosionSound(game, ev.x, ev.z, false);
        break;
      case 'STRUCTURE_COMPLETED':
        if (show) knocks(game, ev.x, ev.z, 3);
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
        if (ev.ability === 'artillery_barrage' && show) whistle(game, ev.x, ev.z, 3);
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

  function update(dt, game) {
    if (!ready()) return;
    if (!ambient.wind) {
      ambient.wind = loop(noiseLong, 'lowpass', 380, 0.4, 0.22);
      ambient.flies = loop(noise, 'bandpass', 210, 7, 0.0001);
      ambient.dig = loop(noise, 'bandpass', 1300, 1.2, 0.0001);
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
    // distant front: rumbles far away (atmosphere only, not tied to simulation events)
    ambient.rumbleT -= dt;
    if (ambient.rumbleT <= 0 && game.session.phase() === 'WAR') {
      ambient.rumbleT = 7 + ((t * 7919) % 13);
      if (voice(2.5)) {
        const bus = out(amb, 0.18, ((t * 31) % 2) - 1, 0.4);
        const f = noiseBurst(bus, t, 2.2, 'lowpass', 260, 0.6, 0.08, noiseLong, 0.9);
        f.frequency.exponentialRampToValueAtTime(90, t + 2);
      }
    }
  }

  function stopMatch() {
    if (!ctx) return;
    for (const k of ['wind', 'flies', 'dig']) {
      if (ambient[k]) { try { ambient[k].src.stop(); } catch { /* ignore */ } ambient[k] = null; }
    }
  }

  return {
    unlock, onEvent, update, ui: uiSound, stopMatch,
    setVolume(v) { volume = v; if (master) master.gain.value = v; },
    setEnabled(v) {
      enabled = !!v;
      if (!enabled && ctx) ctx.suspend();
      else if (enabled) unlock();
    },
    get enabled() { return enabled; },
  };
}
