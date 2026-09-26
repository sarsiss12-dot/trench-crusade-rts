// Deterministic math for the simulation.
// Only + - * / and Math.sqrt/floor/abs/min/max (all IEEE exact) are used, so results are
// bit-identical across JS engines. Math.sin/cos/atan2/exp/pow/hypot are NOT guaranteed to be
// identical between engines and are forbidden in simulation code (enforced by tests).

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function wrapAngle(a) {
  a = a % TAU;
  if (a > PI) a -= TAU;
  else if (a < -PI) a += TAU;
  return a;
}

/** sin via range reduction + odd Taylor polynomial (err < 4e-8). */
export function dsin(x) {
  x = wrapAngle(x);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 / 6227020800))))));
}

export function dcos(x) {
  return dsin(x + HALF_PI);
}

/** atan for any z using half-angle reduction; err < 1e-9 */
export function datan(z) {
  const t = z / (1 + Math.sqrt(1 + z * z)); // tan(a/2), |t| < 1
  // second halving to get |u| <= tan(pi/8)
  const u = t / (1 + Math.sqrt(1 + t * t));
  const u2 = u * u;
  let s = 0;
  // atan(u) series to u^21
  let term = u;
  let k = 1;
  let sign = 1;
  for (let i = 0; i < 11; i++) {
    s += (sign * term) / k;
    term *= u2;
    k += 2;
    sign = -sign;
  }
  return 4 * s;
}

export function datan2(y, x) {
  if (x > 0) return datan(y / x);
  if (x < 0) return y >= 0 ? datan(y / x) + PI : datan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}

export function dist(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

export function dist2(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  return dx * dx + dz * dz;
}

/** Heading angle (radians) for direction (dx,dz); 0 = +z (south), increases toward +x. */
export function headingOf(dx, dz) {
  return datan2(dx, dz);
}

/**
 * Rotate local (right=lx, forward=lz) offset by heading into world dx,dz. Writes into out[0..1].
 * forward = (sin h, cos h); right = forward x up = (-cos h, sin h)  (y-up, right-handed).
 */
export function rotateOffset(out, lx, lz, heading) {
  const s = dsin(heading), c = dcos(heading);
  out[0] = -lx * c + lz * s;
  out[1] = lx * s + lz * c;
  return out;
}

/** Turn angle `cur` toward `target` by at most `maxStep` radians. */
export function turnToward(cur, target, maxStep) {
  const d = wrapAngle(target - cur);
  if (d > maxStep) return wrapAngle(cur + maxStep);
  if (d < -maxStep) return wrapAngle(cur - maxStep);
  return target;
}

/** Distance from point to segment, plus projection parameter t (0..1). out = [dist, t] */
export function pointSegment(out, px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 1e-9 ? ((px - ax) * abx + (pz - az) * abz) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + abx * t, cz = az + abz * t;
  out[0] = dist(px, pz, cx, cz);
  out[1] = t;
  return out;
}

/** Round to fixed decimals for stable hashing/serialization when needed. */
export function roundTo(v, decimals) {
  const m = decimals === 3 ? 1000 : decimals === 2 ? 100 : decimals === 1 ? 10 : 10000;
  return Math.round(v * m) / m;
}
