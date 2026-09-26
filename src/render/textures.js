// Procedurally generated textures (no external image assets).
import { createTexture2D } from './gl.js';
import { hash32 } from '../core/rng.js';

function latticeValue(ix, iy, period, seed) {
  const x = ((ix % period) + period) % period;
  const y = ((iy % period) + period) % period;
  return hash32(x, y, seed) / 4294967296;
}

function periodicValueNoise(x, y, period, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = latticeValue(ix, iy, period, seed), b = latticeValue(ix + 1, iy, period, seed);
  const c = latticeValue(ix, iy + 1, period, seed), d = latticeValue(ix + 1, iy + 1, period, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function periodicFbm(px, py, size, basePeriod, octaves, seed) {
  let sum = 0, amp = 0.5, norm = 0, period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    const scale = period / size;
    sum += amp * periodicValueNoise(px * scale, py * scale, period, seed + o * 131);
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

function periodicWorley(px, py, size, cells, seed) {
  const cs = size / cells;
  const cx = Math.floor(px / cs), cy = Math.floor(py / cs);
  let d1 = 1e9, d2 = 1e9;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const gx = cx + ox, gy = cy + oy;
      const wx = ((gx % cells) + cells) % cells, wy = ((gy % cells) + cells) % cells;
      const fx = (gx + hash32(wx, wy, seed) / 4294967296) * cs;
      const fy = (gy + hash32(wx, wy, seed + 7) / 4294967296) * cs;
      const d = Math.hypot(px - fx, py - fy) / cs;
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
  }
  return Math.min(1, (d2 - d1) * 1.4); // cell-edge distance: dark cracks at 0
}

/** 256x256 RGBA tileable noise: R fbm, G fbm2, B worley cracks, A fine grain. */
export function generateNoiseData(size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = Math.round(periodicFbm(x, y, size, 4, 5, 11) * 255);
      data[i + 1] = Math.round(periodicFbm(x + 37, y + 91, size, 8, 4, 53) * 255);
      data[i + 2] = Math.round(periodicWorley(x, y, size, 12, 97) * 255);
      data[i + 3] = Math.round(periodicFbm(x, y, size, 32, 3, 171) * 255);
    }
  }
  // stretch contrast of the fbm channels to use the full range
  for (let ch = 0; ch < 4; ch++) {
    if (ch === 2) continue;
    let lo = 255, hi = 0;
    for (let i = ch; i < data.length; i += 4) { if (data[i] < lo) lo = data[i]; if (data[i] > hi) hi = data[i]; }
    const k = 255 / Math.max(1, hi - lo);
    for (let i = ch; i < data.length; i += 4) data[i] = Math.round((data[i] - lo) * k);
  }
  return data;
}

export function createNoiseTexture(gl) {
  const size = 256;
  const data = generateNoiseData(size);
  return createTexture2D(gl, size, size, { data, wrap: gl.REPEAT, mipmap: true });
}
