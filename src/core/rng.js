// Seeded deterministic RNG (sfc32) + integer hashing.
// RNG state is plain data ({ s: [int32 x4] }) so it lives inside GameState and
// serializes to JSON. Only 32-bit integer ops are used -> identical on every JS engine.

export function createRngState(seed) {
  const x = seed >>> 0;
  const st = { s: [(0x9e3779b9 ^ x) | 0, 0x243f6a88 | 0, (0xb7e15162 + x) | 0, x | 0] };
  for (let i = 0; i < 16; i++) rngNextU32(st);
  return st;
}

export function rngNextU32(st) {
  const s = st.s;
  let a = s[0], b = s[1], c = s[2], d = s[3];
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  s[0] = a; s[1] = b; s[2] = c; s[3] = d;
  return t >>> 0;
}

/** float in [0,1) */
export function rngFloat(st) {
  return rngNextU32(st) / 4294967296;
}

/** integer in [0,n) */
export function rngInt(st, n) {
  return Math.floor(rngFloat(st) * n);
}

export function rngRange(st, a, b) {
  return a + (b - a) * rngFloat(st);
}

export function rngChance(st, p) {
  return rngFloat(st) < p;
}

export function cloneRngState(st) {
  return { s: st.s.slice() };
}

/** Stateless 32-bit hash of up to three integers (murmur3-style finalizer). */
export function hash32(a, b = 0, c = 0) {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul((b | 0) + 0x27d4eb2f, 0xc2b2ae35);
  h = (h ^ (h >>> 15)) | 0;
  h = Math.imul(h ^ (c | 0), 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Stateless hash -> float [0,1). */
export function hashFloat(a, b = 0, c = 0) {
  return hash32(a, b, c) / 4294967296;
}

/** Hash a string to uint32 (FNV-1a). */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Small non-serialized RNG for render/audio-side variation.
 * Kept separate so visual randomness can never perturb simulation RNG.
 */
export function createVisualRng(seed) {
  const st = createRngState(seed ^ 0x5bd1e995);
  return {
    next: () => rngFloat(st),
    range: (a, b) => a + (b - a) * rngFloat(st),
    int: (n) => Math.floor(rngFloat(st) * n),
    sign: () => (rngFloat(st) < 0.5 ? -1 : 1),
  };
}
