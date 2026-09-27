// Minimal Web Audio stand-in for Node tests: records node creation / start / stop / connections
// and lets a test drive the context state (suspended / running / interrupted / closed).
function param(v = 0) {
  return {
    value: v,
    setValueAtTime(x) { this.value = x; return this; },
    setTargetAtTime(x) { if (!Number.isFinite(x)) throw new TypeError('non-finite'); this.value = x; return this; },
    linearRampToValueAtTime(x) { this.value = x; return this; },
    exponentialRampToValueAtTime(x) { if (!(x > 0)) throw new RangeError('exp ramp to ' + x); this.value = x; return this; },
    cancelScheduledValues() { return this; },
  };
}

export function createFakeContext(opts = {}) {
  const created = [];
  let state = opts.state || 'suspended';
  const ctx = {
    sampleRate: 8000, currentTime: 0, destination: { connect() {} }, onstatechange: null,
    resumeResult: opts.resumeResult || 'ok', // 'ok' | 'reject' | 'stay'
    closed: false,
    get state() { return state; },
    setState(s) { state = s; if (ctx.onstatechange) ctx.onstatechange(); },
    resume() {
      ctx.resumeCalls = (ctx.resumeCalls || 0) + 1;
      if (ctx.resumeResult === 'reject') return Promise.reject(new Error('not allowed'));
      if (ctx.resumeResult === 'ok' && state !== 'closed') state = 'running';
      return Promise.resolve();
    },
    suspend() { if (state === 'running') state = 'suspended'; return Promise.resolve(); },
    close() { state = 'closed'; ctx.closed = true; return Promise.resolve(); },
    created,
  };
  const node = (kind, extra = {}) => {
    const n = { kind, started: false, stopped: false, connections: 0, connect() { n.connections++; return arguments[0]; }, disconnect() { n.connections = 0; }, ...extra };
    created.push(n);
    return n;
  };
  ctx.createGain = () => node('gain', { gain: param(1) });
  ctx.createDynamicsCompressor = () => node('comp', { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
  ctx.createDelay = () => node('delay', { delayTime: param() });
  ctx.createBiquadFilter = () => node('filter', { type: 'lowpass', frequency: param(350), Q: param(1), gain: param() });
  ctx.createStereoPanner = () => node('pan', { pan: param() });
  ctx.createWaveShaper = () => node('shaper', { curve: null });
  const source = (kind) => node(kind, {
    start() { this.started = true; }, stop() { if (!this.started) throw new Error('stop before start'); this.stopped = true; },
  });
  ctx.createOscillator = () => Object.assign(source('osc'), { type: 'sine', frequency: param(440), detune: param() });
  ctx.createBufferSource = () => Object.assign(source('buffer'), { buffer: null, loop: false, playbackRate: param(1) });
  ctx.createBuffer = (ch, n) => { const d = new Float32Array(n); return { getChannelData: () => d, length: n }; };
  return ctx;
}

/** A presentation-side game object just rich enough for audio.update / music.update. */
export function fakeGame(phase = 'WAR') {
  return {
    viewer: 'new_antioch',
    session: { phase: () => phase, phaseTimeLeft: () => 300 },
    sim: { state: { structures: [], squads: [], animals: [] } },
    renderer: null,
    camera: { tx: 0, tz: 0, dist: 60, width: 800 },
    selection: { squads: new Set() },
    setPhase(p) { phase = p; },
  };
}
