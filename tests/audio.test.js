// Phase 4 audio regression tests (Node, fake Web Audio): the recovery state machine, the watchdog,
// no duplicate graph / score, the score scheduler never bursting after a stall, audible mix levels.
// NOTE: this proves the recovery LOGIC; it is not a phone-speaker listening test.
import { test, assert } from './harness.js';
import { createAudioRecovery, AUDIO_MODE } from '../src/audio/recovery.js';
import { createAudio } from '../src/audio/audio.js';
import { MUSIC_LEVELS } from '../src/audio/music.js';
import { createFakeContext, fakeGame } from './fake_audio.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

function adapterFor(box, makeOpts = {}) {
  return {
    hasContext: () => !!box.ctx,
    state: () => box.ctx.state,
    create: () => { box.created = (box.created || 0) + 1; box.ctx = createFakeContext(makeOpts); },
    rebuild: () => { box.rebuilt = (box.rebuilt || 0) + 1; box.ctx = createFakeContext(makeOpts); },
    resume: () => box.ctx.resume(),
    suspend: () => box.ctx.suspend(),
  };
}

test('audio recovery: first gesture creates one context and resumes it; repeated gestures create nothing more', async () => {
  const box = {};
  const r = createAudioRecovery(adapterFor(box));
  assert.equal(r.tick(0), false, 'watchdog does nothing before the first gesture');
  r.onGesture();
  await flush();
  assert.equal(box.created, 1);
  assert.equal(r.mode, AUDIO_MODE.RUNNING);
  r.onGesture(); r.onGesture();
  await flush();
  assert.equal(box.created, 1, 'no second context / graph');
});

test('audio recovery: suspended or interrupted mid-match -> watchdog resumes (at most once per second)', async () => {
  const box = {};
  const r = createAudioRecovery(adapterFor(box));
  r.onGesture(); await flush();
  box.ctx.onstatechange = () => r.onStateChange(); // audio.js wires this on every context it builds
  box.ctx.setState('suspended'); // OS took audio focus
  await flush();
  assert.equal(box.ctx.state, 'running', 'statechange handler resumed at once');
  box.ctx.resumeResult = 'stay';
  box.ctx.setState('interrupted'); // (statechange tries once; the OS keeps it interrupted)
  await flush();
  const calls0 = box.ctx.resumeCalls;
  r.tick(10000); await flush();
  r.tick(10200); await flush(); // same second: no extra work
  assert.equal(box.ctx.resumeCalls - calls0, 1, 'one watchdog attempt per second');
  box.ctx.resumeResult = 'ok';
  r.tick(11100); await flush();
  assert.equal(box.ctx.state, 'running');
  assert.equal(r.mode, AUDIO_MODE.RUNNING);
});

test('audio recovery: a refused resume blocks until the next tap, which recovers; never disables sound', async () => {
  const box = {};
  const r = createAudioRecovery(adapterFor(box, { resumeResult: 'reject' }));
  r.onGesture(); await flush();
  assert.equal(r.mode, AUDIO_MODE.BLOCKED);
  box.ctx.resumeResult = 'ok';
  r.onGesture(); await flush();
  assert.equal(r.mode, AUDIO_MODE.RUNNING);
  assert.ok(r.stats.resumeFails >= 1);
});

test('audio recovery: page hidden suspends on purpose, visible again resumes; closed context is rebuilt once on a tap', async () => {
  const box = {};
  const r = createAudioRecovery(adapterFor(box));
  r.onGesture(); await flush();
  r.onVisibility(false); await flush();
  assert.equal(box.ctx.state, 'suspended');
  assert.equal(r.mode, AUDIO_MODE.HIDDEN);
  assert.equal(r.tick(50000), false, 'watchdog does not fight a hidden page');
  assert.equal(box.ctx.state, 'suspended');
  r.onVisibility(true); await flush();
  assert.equal(box.ctx.state, 'running');
  box.ctx.close();
  r.tick(60000); await flush();
  assert.equal(box.rebuilt || 0, 0, 'no rebuild without a gesture (autoplay policy)');
  assert.equal(r.mode, AUDIO_MODE.BLOCKED);
  r.onGesture(); await flush();
  assert.equal(box.rebuilt, 1);
  assert.equal(r.mode, AUDIO_MODE.RUNNING);
  r.setEnabled(false);
  assert.equal(r.mode, AUDIO_MODE.OFF);
  assert.equal(box.ctx.state, 'suspended');
});

test('audio: one graph per context, the score starts once, restarts clean after a match (no duplicate layers)', async () => {
  const made = [];
  const audio = createAudio({ sound: true, musicVolume: 0.5 }, { createContext: () => { const c = createFakeContext(); made.push(c); return c; } });
  audio.unlock(); audio.unlock(); await flush();
  assert.equal(made.length, 1, 'one AudioContext');
  const game = fakeGame('WAR');
  for (let i = 0; i < 30; i++) { made[0].currentTime += 0.05; audio.update(0.05, game); }
  const m = audio.music;
  assert.ok(m.active, 'score running');
  assert.equal(m.starts, 1);
  const live1 = m.liveNodes;
  const ctx = made[0];
  const continuous = () => ctx.created.filter((n) => (n.kind === 'osc' || n.kind === 'buffer') && n.started && !n.stopped && n.freqLoop !== false).length;
  audio.stopMatch();
  assert.equal(m.liveNodes, 0, 'every continuous layer stopped');
  for (let i = 0; i < 30; i++) { ctx.currentTime += 0.05; audio.update(0.05, game); }
  assert.equal(m.starts, 2, 'fresh score for the next match');
  assert.equal(m.liveNodes, live1, 'exactly one layer set live (no stacking)');
  assert.ok(continuous() >= live1, 'layers really running');
  assert.equal(audio.health().errors, 0, 'no audio exceptions: ' + audio.health().lastError);
});

test('audio: a closed context is replaced by ONE new graph with ONE new score; the old one is dropped', async () => {
  const made = [];
  const audio = createAudio({ sound: true }, { createContext: () => { const c = createFakeContext(); made.push(c); return c; } });
  audio.unlock(); await flush();
  const game = fakeGame('PREPARATION');
  audio.update(0.05, game);
  const oldMusic = audio.music;
  made[0].close();
  audio.unlock(); await flush();
  assert.equal(made.length, 2);
  assert.ok(audio.music && audio.music !== oldMusic, 'new score instance');
  assert.equal(oldMusic.liveNodes, 0, 'old layers stopped');
  audio.update(0.05, game);
  assert.equal(audio.health().ctxState, 'running');
});

test('music: a stalled scheduler (background / suspended) skips ahead instead of bursting every missed beat', async () => {
  const made = [];
  const audio = createAudio({ sound: true }, { createContext: () => { const c = createFakeContext(); made.push(c); return c; } });
  audio.unlock(); await flush();
  const ctx = made[0];
  const game = fakeGame('WAR');
  for (let i = 0; i < 100; i++) { ctx.currentTime += 0.05; audio.update(0.05, game); }
  const before = ctx.created.filter((n) => n.kind === 'osc').length;
  ctx.currentTime += 120; // two minutes without updates (tab hidden)
  audio.update(0.05, game);
  const burst = ctx.created.filter((n) => n.kind === 'osc').length - before;
  assert.less(burst, 40, 'one update after a stall schedules only the next beats (' + burst + ' oscillators)');
});

test('music mix: every state has a phone-audible mid layer; war louder than preparation; lull quiet but present', () => {
  for (const k of ['PREP', 'LULL', 'WAR', 'CRITICAL']) assert.greater(MUSIC_LEVELS[k].pad + MUSIC_LEVELS[k].ostinato + MUSIC_LEVELS[k].horn, 0.05, k);
  const loud = (k) => MUSIC_LEVELS[k].drone + MUSIC_LEVELS[k].pad + MUSIC_LEVELS[k].ostinato + MUSIC_LEVELS[k].horn;
  assert.greater(loud('WAR'), loud('PREP') * 1.5);
  assert.greater(loud('CRITICAL'), loud('WAR'));
  assert.equal(MUSIC_LEVELS.LULL.drums, 0);
});

test('audio watchdog restores a silenced score bus; sound off stays off', async () => {
  const made = [];
  const audio = createAudio({ sound: true, musicVolume: 0.6 }, { createContext: () => { const c = createFakeContext(); made.push(c); return c; } });
  audio.unlock(); await flush();
  const game = fakeGame('WAR');
  audio.update(0.05, game);
  const bus = made[0].created.find((n) => n.kind === 'gain' && Math.abs(n.gain.value - 0.6 * 0.95) < 1e-6);
  assert.ok(bus, 'score bus at music volume');
  bus.gain.value = 0;
  audio.update(0.05, game);
  assert.greater(audio.health().musicBus, 0.3);
  audio.setEnabled(false);
  await flush();
  assert.equal(made[0].state, 'suspended');
  assert.equal(audio.health().mode, 'off');
});
