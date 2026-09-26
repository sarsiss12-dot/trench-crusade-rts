// Procedural mesh construction toolkit. Geometry is authored in local frames (push/pop affine
// transforms), with per-vertex bone bindings (2-bone skinning), sRGB colors + material ids,
// optional deterministic surface irregularity (jitter) and per-face color break-up.
// Output format (24 bytes/vertex): pos f32x3 | normal i8x4 | color u8x4 (rgb, material) | bones u8x4 (b0, b1, w, 0)
import { affFromEuler, affMul } from '../math3d.js';
import { hash32 } from '../../core/rng.js';
import { valueNoise } from '../../core/noise.js';

export const VERTEX_STRIDE = 24;

export const MAT = Object.freeze({
  CLOTH: 0, LEATHER: 1, METAL: 2, SKIN: 3, FLESH: 4, WOOD: 5, GLASS: 6, BONE: 7,
  ACCENT: 8, DARKMETAL: 9, GLOW: 10, SOIL: 11, MUD: 12, STONE: 13,
});

function noise3(x, y, z, seed) {
  return (valueNoise(x + z * 0.71, y + z * 0.37, seed) - 0.5) * 2;
}

export class MeshBuilder {
  constructor(opts = {}) {
    this.P = []; this.N = []; this.C = []; this.B = []; this.I = [];
    this.color = [0.5, 0.5, 0.5];
    this.mat = 0;
    this.b0 = 0; this.b1 = 0; this.w = 0;
    this.skin = null;
    this.m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
    this.stack = [];
    this.jitterAmp = 0; this.jitterFreq = 3; this.jitterSeed = 1;
    this.colorVar = 0; this.faceSeed = opts.seed || 1;
    this.lod = opts.lod || 0;
  }

  // ------------------------------------------------------------------ state
  col(rgb, mat) { this.color = rgb; if (mat !== undefined) this.mat = mat; return this; }
  material(mat) { this.mat = mat; return this; }
  bone(b0, b1 = b0, w = 0) { this.b0 = b0; this.b1 = b1; this.w = w; this.skin = null; return this; }
  skinWith(fn) { this.skin = fn; return this; }
  jitter(amp, freq = 3, seed = 1) { this.jitterAmp = amp; this.jitterFreq = freq; this.jitterSeed = seed; return this; }
  noJitter() { this.jitterAmp = 0; return this; }
  vary(amount) { this.colorVar = amount; return this; }

  push(tx = 0, ty = 0, tz = 0, rx = 0, ry = 0, rz = 0, s = 1) {
    this.stack.push(this.m.slice());
    const local = affFromEuler(new Array(12), rx, ry, rz, tx, ty, tz, s);
    const out = new Array(12);
    affMul(out, this.m, local);
    this.m = out;
    return this;
  }
  pop() { this.m = this.stack.pop(); return this; }

  // ------------------------------------------------------------------ low level
  _faceColor() {
    if (!this.colorVar) return this.color;
    const k = 1 + ((hash32(this.faceSeed++, 91) / 4294967296) - 0.5) * 2 * this.colorVar;
    return [this.color[0] * k, this.color[1] * k, this.color[2] * k];
  }

  vertex(x, y, z, nx, ny, nz, color) {
    const m = this.m;
    let wx = m[0] * x + m[1] * y + m[2] * z + m[3];
    let wy = m[4] * x + m[5] * y + m[6] * z + m[7];
    let wz = m[8] * x + m[9] * y + m[10] * z + m[11];
    let tnx = m[0] * nx + m[1] * ny + m[2] * nz;
    let tny = m[4] * nx + m[5] * ny + m[6] * nz;
    let tnz = m[8] * nx + m[9] * ny + m[10] * nz;
    const nl = Math.hypot(tnx, tny, tnz) || 1;
    tnx /= nl; tny /= nl; tnz /= nl;
    if (this.jitterAmp) {
      const f = this.jitterFreq, s = this.jitterSeed;
      wx += noise3(wx * f, wy * f, wz * f, s) * this.jitterAmp;
      wy += noise3(wy * f + 5.1, wz * f, wx * f, s + 1) * this.jitterAmp;
      wz += noise3(wz * f + 9.7, wx * f, wy * f, s + 2) * this.jitterAmp;
    }
    let b0 = this.b0, b1 = this.b1, w = this.w;
    if (this.skin) {
      const r = this.skin(wx, wy, wz);
      b0 = r[0]; b1 = r[1]; w = r[2];
    }
    const c = color || this.color;
    this.P.push(wx, wy, wz);
    this.N.push(tnx, tny, tnz);
    this.C.push(c[0], c[1], c[2], this.mat);
    this.B.push(b0, b1, w);
    return this.P.length / 3 - 1;
  }

  tri(a, b, c) { this.I.push(a, b, c); return this; }

  /** Flat polygon (convex, CCW seen from outside) with computed normal. pts: [[x,y,z]...] local */
  face(pts) {
    const [a, b, c] = pts;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const col = this._faceColor();
    const base = this.vertex(pts[0][0], pts[0][1], pts[0][2], nx, ny, nz, col);
    for (let i = 1; i < pts.length; i++) this.vertex(pts[i][0], pts[i][1], pts[i][2], nx, ny, nz, col);
    for (let i = 1; i < pts.length - 1; i++) this.I.push(base, base + i, base + i + 1);
    return this;
  }

  // ------------------------------------------------------------------ primitives

  /**
   * Box centered at origin. opts: bevel (m), taper [sx,sz] top scale, shift [dx,dz] top offset,
   * bottom 0/1: include bottom face.
   */
  box(w, h, d, opts = {}) {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const tx = opts.taper ? opts.taper[0] : 1, tz = opts.taper ? opts.taper[1] : 1;
    const sx = opts.shift ? opts.shift[0] : 0, sz = opts.shift ? opts.shift[1] : 0;
    const b = this.lod > 0 ? 0 : Math.min(opts.bevel || 0, hw * 0.45, hh * 0.45, hd * 0.45);
    const P = (x, y, z) => {
      const top = y > 0;
      return [top ? x * tx + sx : x, y, top ? z * tz + sz : z];
    };
    if (!b) {
      const c = [P(-hw, -hh, -hd), P(hw, -hh, -hd), P(hw, hh, -hd), P(-hw, hh, -hd), P(-hw, -hh, hd), P(hw, -hh, hd), P(hw, hh, hd), P(-hw, hh, hd)];
      this._faceOut([c[4], c[5], c[6], c[7]]); // +z
      this._faceOut([c[1], c[0], c[3], c[2]]); // -z
      this._faceOut([c[5], c[1], c[2], c[6]]); // +x
      this._faceOut([c[0], c[4], c[7], c[3]]); // -x
      this._faceOut([c[7], c[6], c[2], c[3]]); // +y
      if (opts.bottom !== false) this._faceOut([c[0], c[1], c[5], c[4]]); // -y
      return this;
    }
    // chamfered box: each corner split into 3 points; faces auto-oriented outward (box is convex)
    const pt = (sxn, syn, szn, axis) => {
      const x = sxn * (axis === 0 ? hw : hw - b);
      const y = syn * (axis === 1 ? hh : hh - b);
      const z = szn * (axis === 2 ? hd : hd - b);
      return P(x, y, z);
    };
    const S = [-1, 1];
    const out = (pts) => this._faceOut(pts);
    for (const s of S) {
      out([pt(s, -1, -1, 0), pt(s, 1, -1, 0), pt(s, 1, 1, 0), pt(s, -1, 1, 0)]);
      if (s > 0 || opts.bottom !== false) out([pt(-1, s, -1, 1), pt(1, s, -1, 1), pt(1, s, 1, 1), pt(-1, s, 1, 1)]);
      out([pt(-1, -1, s, 2), pt(1, -1, s, 2), pt(1, 1, s, 2), pt(-1, 1, s, 2)]);
    }
    for (const sx2 of S) for (const sy of S) {
      if (sy > 0 || opts.bottom !== false) out([pt(sx2, sy, -1, 0), pt(sx2, sy, 1, 0), pt(sx2, sy, 1, 1), pt(sx2, sy, -1, 1)]);
    }
    for (const sx2 of S) for (const sz2 of S) out([pt(sx2, -1, sz2, 0), pt(sx2, 1, sz2, 0), pt(sx2, 1, sz2, 2), pt(sx2, -1, sz2, 2)]);
    for (const sy of S) for (const sz2 of S) {
      if (sy > 0 || opts.bottom !== false) out([pt(-1, sy, sz2, 1), pt(1, sy, sz2, 1), pt(1, sy, sz2, 2), pt(-1, sy, sz2, 2)]);
    }
    for (const sx2 of S) for (const sy of S) for (const sz2 of S) {
      if (sy > 0 || opts.bottom !== false) out([pt(sx2, sy, sz2, 0), pt(sx2, sy, sz2, 1), pt(sx2, sy, sz2, 2)]);
    }
    return this;
  }

  /** Face oriented away from the local origin (for convex primitives centered at origin). */
  _faceOut(pts) {
    const [a, b, c] = pts;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    let cx = 0, cy = 0, cz = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
    if (nx * cx + ny * cy + nz * cz < 0) pts = pts.slice().reverse();
    return this.face(pts);
  }

  /** Smooth surface of revolution around +y. profile: [[r, y], ...] bottom->top. */
  lathe(profile, seg, opts = {}) {
    const sx = opts.sx || 1, sz = opts.sz || 1;
    const a0 = opts.a0 || 0, a1 = opts.a1 === undefined ? Math.PI * 2 : opts.a1;
    const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
    const cols = full ? seg : seg + 1;
    const rings = profile.length;
    const base = this.P.length / 3;
    for (let j = 0; j < rings; j++) {
      const [r, y] = profile[j];
      // profile tangent for normals
      const pa = profile[Math.max(0, j - 1)], pb = profile[Math.min(rings - 1, j + 1)];
      const dr = pb[0] - pa[0], dy = pb[1] - pa[1];
      let nr = dy, ny = -dr;
      const nl = Math.hypot(nr, ny) || 1;
      nr /= nl; ny /= nl;
      for (let i = 0; i < cols; i++) {
        const a = a0 + ((a1 - a0) * i) / seg;
        const ca = Math.cos(a), sa = Math.sin(a);
        this.vertex(r * sa * sx, y, r * ca * sz, nr * sa / sx, ny, nr * ca / sz);
      }
    }
    for (let j = 0; j < rings - 1; j++) {
      for (let i = 0; i < seg; i++) {
        const i2 = full ? (i + 1) % seg : i + 1;
        const a = base + j * cols + i, b = base + j * cols + i2;
        const c = base + (j + 1) * cols + i, d = base + (j + 1) * cols + i2;
        this.I.push(a, b, d, a, d, c);
      }
    }
    if (opts.capBottom && profile[0][0] > 0) this._cap(profile[0][0], profile[0][1], seg, -1, sx, sz);
    if (opts.capTop && profile[rings - 1][0] > 0) this._cap(profile[rings - 1][0], profile[rings - 1][1], seg, 1, sx, sz);
    return this;
  }

  _cap(r, y, seg, dir, sx, sz) {
    const c = this.vertex(0, y, 0, 0, dir, 0);
    const first = this.P.length / 3;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      this.vertex(Math.sin(a) * r * sx, y, Math.cos(a) * r * sz, 0, dir, 0);
    }
    for (let i = 0; i < seg; i++) {
      const a = first + i, b = first + ((i + 1) % seg);
      if (dir > 0) this.I.push(c, a, b); else this.I.push(c, b, a);
    }
  }

  /** Cylinder / cone along +y from 0..h. */
  cyl(r0, r1, h, seg, opts = {}) {
    return this.lathe([[r0, 0], [r1, h]], seg, { capBottom: opts.caps !== false && opts.bottom !== false, capTop: opts.caps !== false, sx: opts.sx, sz: opts.sz });
  }

  /** Cylinder between two local points. */
  cylBetween(p0, p1, r0, r1, seg, opts = {}) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const len = Math.hypot(dx, dy, dz) || 1e-6;
    // rotate +y onto (dx,dy,dz): pitch around x then yaw around y
    const yaw = Math.atan2(dx, dz);
    const pitch = Math.acos(Math.max(-1, Math.min(1, dy / len)));
    this.push(p0[0], p0[1], p0[2], 0, yaw, 0);
    this.push(0, 0, 0, pitch, 0, 0);
    this.cyl(r0, r1, len, seg, opts);
    this.pop();
    this.pop();
    return this;
  }

  /** Ellipsoid centered at origin. opts.hemi: 1 upper half only. */
  sphere(rx, ry, rz, seg = 10, rings = 7, opts = {}) {
    const prof = [];
    const start = opts.hemi ? rings / 2 : 0;
    for (let j = Math.floor(start); j <= rings; j++) {
      const t = -Math.PI / 2 + (Math.PI * j) / rings;
      prof.push([Math.cos(t), Math.sin(t)]);
    }
    const base = this.P.length / 3;
    const cols = seg;
    for (let j = 0; j < prof.length; j++) {
      const [cr, sy] = prof[j];
      for (let i = 0; i < cols; i++) {
        const a = (i / seg) * Math.PI * 2;
        const x = cr * Math.sin(a), z = cr * Math.cos(a);
        this.vertex(x * rx, sy * ry, z * rz, x / rx, sy / ry, z / rz);
      }
    }
    for (let j = 0; j < prof.length - 1; j++) {
      for (let i = 0; i < seg; i++) {
        const i2 = (i + 1) % seg;
        const a = base + j * cols + i, b = base + j * cols + i2;
        const c = base + (j + 1) * cols + i, d = base + (j + 1) * cols + i2;
        this.I.push(a, b, d, a, d, c);
      }
    }
    return this;
  }

  /** Polyline tube with per-point radius (limbs, branches, straps, cables). */
  tube(points, radii, seg, opts = {}) {
    const n = points.length;
    const base = this.P.length / 3;
    let prevN = null;
    for (let k = 0; k < n; k++) {
      const p = points[k];
      const a = points[Math.max(0, k - 1)], b = points[Math.min(n - 1, k + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      // stable frame: project previous normal / pick an up vector
      let ux, uy, uz;
      if (prevN) { ux = prevN[0]; uy = prevN[1]; uz = prevN[2]; }
      else if (Math.abs(ty) < 0.9) { ux = 0; uy = 1; uz = 0; }
      else { ux = 1; uy = 0; uz = 0; }
      // n1 = normalize(u - t*(u.t))
      const d = ux * tx + uy * ty + uz * tz;
      let n1x = ux - tx * d, n1y = uy - ty * d, n1z = uz - tz * d;
      const nl = Math.hypot(n1x, n1y, n1z) || 1;
      n1x /= nl; n1y /= nl; n1z /= nl;
      prevN = [n1x, n1y, n1z];
      const n2x = ty * n1z - tz * n1y, n2y = tz * n1x - tx * n1z, n2z = tx * n1y - ty * n1x;
      const r = Array.isArray(radii) ? radii[k] : radii;
      const rs = opts.flat ? [r * (opts.flat[0] || 1), r * (opts.flat[1] || 1)] : [r, r];
      for (let i = 0; i < seg; i++) {
        const ang = (i / seg) * Math.PI * 2;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const nx = n1x * ca + n2x * sa, ny = n1y * ca + n2y * sa, nz = n1z * ca + n2z * sa;
        this.vertex(p[0] + (n1x * ca * rs[0] + n2x * sa * rs[1]), p[1] + (n1y * ca * rs[0] + n2y * sa * rs[1]), p[2] + (n1z * ca * rs[0] + n2z * sa * rs[1]), nx, ny, nz);
      }
    }
    for (let k = 0; k < n - 1; k++) {
      for (let i = 0; i < seg; i++) {
        const i2 = (i + 1) % seg;
        const a = base + k * seg + i, b = base + k * seg + i2;
        const c = base + (k + 1) * seg + i, d = base + (k + 1) * seg + i2;
        this.I.push(a, b, d, a, d, c);
      }
    }
    if (opts.capEnd) {
      const p = points[n - 1];
      const c = this.vertex(p[0], p[1], p[2], 0, 1, 0);
      for (let i = 0; i < seg; i++) this.I.push(base + (n - 1) * seg + i, base + (n - 1) * seg + ((i + 1) % seg), c);
    }
    return this;
  }

  /** Extrude a simple polygon (XY plane, CCW) along Z, centered: z in [-d/2, d/2]. */
  extrude(poly, depth, opts = {}) {
    const hd = depth / 2;
    const n = poly.length;
    let area = 0;
    for (let i = 0; i < n; i++) area += poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1];
    // sides (outward for CCW polygons; reversed for CW)
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const q = [[a[0], a[1], hd], [a[0], a[1], -hd], [b[0], b[1], -hd], [b[0], b[1], hd]];
      this.face(area > 0 ? q : q.reverse());
    }
    // caps via ear clipping
    const tris = triangulate(poly);
    const col = this._faceColor();
    const f0 = this.P.length / 3;
    for (const p of poly) this.vertex(p[0], p[1], hd, 0, 0, 1, col);
    for (const t of tris) this.I.push(f0 + t[0], f0 + t[1], f0 + t[2]);
    if (opts.back !== false) {
      const b0 = this.P.length / 3;
      for (const p of poly) this.vertex(p[0], p[1], -hd, 0, 0, -1, col);
      for (const t of tris) this.I.push(b0 + t[0], b0 + t[2], b0 + t[1]);
    }
    return this;
  }

  /** Double-sided thin quad (cloth, banners, wings). Corners in local space. */
  sheet(a, b, c, d) {
    this.face([a, b, c, d]);
    this.face([d, c, b, a]);
    return this;
  }

  /** Append another builder's output under the current transform & state. */
  count() { return this.P.length / 3; }

  finish() {
    const n = this.P.length / 3;
    const buf = new ArrayBuffer(n * VERTEX_STRIDE);
    const f = new Float32Array(buf), i8 = new Int8Array(buf), u8 = new Uint8Array(buf);
    let ymin = Infinity, ymax = -Infinity, rmax = 0;
    for (let i = 0; i < n; i++) {
      const o = i * VERTEX_STRIDE;
      const x = this.P[i * 3], y = this.P[i * 3 + 1], z = this.P[i * 3 + 2];
      f[o / 4] = x; f[o / 4 + 1] = y; f[o / 4 + 2] = z;
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
      const r = Math.hypot(x, z);
      if (r > rmax) rmax = r;
      i8[o + 12] = Math.round(this.N[i * 3] * 127);
      i8[o + 13] = Math.round(this.N[i * 3 + 1] * 127);
      i8[o + 14] = Math.round(this.N[i * 3 + 2] * 127);
      i8[o + 15] = 0;
      u8[o + 16] = Math.max(0, Math.min(255, Math.round(this.C[i * 4] * 255)));
      u8[o + 17] = Math.max(0, Math.min(255, Math.round(this.C[i * 4 + 1] * 255)));
      u8[o + 18] = Math.max(0, Math.min(255, Math.round(this.C[i * 4 + 2] * 255)));
      u8[o + 19] = this.C[i * 4 + 3];
      u8[o + 20] = this.B[i * 3];
      u8[o + 21] = this.B[i * 3 + 1];
      u8[o + 22] = Math.round(Math.max(0, Math.min(1, this.B[i * 3 + 2])) * 255);
      u8[o + 23] = 0;
    }
    const indices = n > 65535 ? new Uint32Array(this.I) : new Uint16Array(this.I);
    return { vertices: buf, indices, vertexCount: n, indexCount: this.I.length, height: Math.max(0, ymax), radius: rmax, ymin };
  }
}

/** Ear clipping triangulation for simple polygons (CCW or CW). Returns index triples. */
export function triangulate(poly) {
  const n = poly.length;
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const ccw = area > 0;
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 1000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const a = poly[i0], b = poly[i1], c = poly[i2];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (ccw ? cross <= 0 : cross >= 0) continue;
      let inside = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (pointInTri(poly[j], a, b, c)) { inside = true; break; }
      }
      if (inside) continue;
      tris.push(ccw ? [i0, i1, i2] : [i0, i2, i1]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push(ccw ? [idx[0], idx[1], idx[2]] : [idx[0], idx[2], idx[1]]);
  return tris;
}

function pointInTri(p, a, b, c) {
  const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
  const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
  const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
