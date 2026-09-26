// Deterministic value noise (integer hashing + polynomial interpolation only).
// Safe for simulation/map generation; identical results on every JS engine.
import { hash32 } from './rng.js';

const INV32 = 1 / 4294967296;

export function valueNoise(x, z, seed) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash32(xi, zi, seed) * INV32;
  const b = hash32(xi + 1, zi, seed) * INV32;
  const c = hash32(xi, zi + 1, seed) * INV32;
  const d = hash32(xi + 1, zi + 1, seed) * INV32;
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal value noise in [0,1]. */
export function fbm(x, z, seed, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, z * freq, seed + i * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** Ridged variant (sharp creases) in [0,1]. */
export function ridged(x, z, seed, octaves = 3) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise(x * freq, z * freq, seed + i * 733) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}
