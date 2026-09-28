// RAIN (Phase 4.1, presentation only): falling streaks around the camera as plain GL line
// segments in ONE dynamic buffer — no particle system, no per-drop objects. The streak count is
// fixed per quality (bounded) and scaled by the shower's intensity (state.weather.rain, the same
// for every viewer: the weather is public). Positions are a pure function of time and a fixed
// per-streak seed, so nothing accumulates.
import { createBuffer, createVAO, drawArrays } from './gl.js';

const COUNT = { low: 140, balanced: 280, high: 460 };
const FALL = 17; // m/s
const LEN = 1.5; // m
const H = 26; // fall column height (m)

export function createRain(gl, lineProgram, quality = 'balanced') {
  const max = COUNT[quality] || COUNT.balanced;
  const seeds = new Float32Array(max * 3);
  let s = 0x2f6b;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < max; i++) { seeds[i * 3] = rnd() * 2 - 1; seeds[i * 3 + 1] = rnd() * 2 - 1; seeds[i * 3 + 2] = rnd(); }
  const data = new Float32Array(max * 2 * 7);
  const buf = createBuffer(gl, gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
  const vao = createVAO(gl, [{
    buffer: buf, stride: 28, attribs: [
      { loc: 0, size: 3, type: gl.FLOAT, offset: 0 },
      { loc: 2, size: 4, type: gl.FLOAT, offset: 12 },
    ],
  }]);
  let n = 0;
  const stats = { streaks: 0 };

  /** intensity 0..1; ground(x, z) -> y. */
  function update(camera, intensity, t, ground) {
    n = 0;
    if (!(intensity > 0.01)) { stats.streaks = 0; return; }
    const count = Math.round(max * Math.min(1, intensity));
    const span = Math.max(22, Math.min(70, camera.dist * 0.55));
    const gy = ground(camera.tx, camera.tz);
    // slight wind slant
    const wx = 0.18, wz = 0.07;
    const a = 0.3 + 0.3 * intensity;
    let o = 0;
    for (let i = 0; i < count; i++) {
      const x = camera.tx + seeds[i * 3] * span;
      const z = camera.tz + seeds[i * 3 + 1] * span;
      const ph = seeds[i * 3 + 2];
      const u = (ph * H + t * FALL) % H;
      const y = gy + H - u;
      data[o] = x; data[o + 1] = y; data[o + 2] = z;
      data[o + 3] = 0.62; data[o + 4] = 0.66; data[o + 5] = 0.7; data[o + 6] = 0;
      o += 7;
      data[o] = x - wx * LEN; data[o + 1] = y - LEN; data[o + 2] = z - wz * LEN;
      data[o + 3] = 0.66; data[o + 4] = 0.7; data[o + 5] = 0.74; data[o + 6] = a;
      o += 7;
      n += 2;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 7);
    stats.streaks = n / 2;
  }

  function draw(setCommon) {
    if (!n) return;
    gl.useProgram(lineProgram.program);
    setCommon(lineProgram);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(vao);
    drawArrays(gl, gl.LINES, 0, n);
    gl.bindVertexArray(null);
  }

  return { update, draw, stats };
}
