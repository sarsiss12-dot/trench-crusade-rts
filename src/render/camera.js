// RTS camera: high diagonal perspective view over a ground target. Pan / pinch / wheel zoom
// (zoom anchored under the finger/cursor), bounded to the map, inertia, zoom-dependent pitch.
// Narrow FOV gives a slightly orthographic feel while keeping depth.
import { mat4, mat4Perspective, mat4LookAt, mat4Mul, mat4Invert, frustumPlanes, transformPoint4 } from './math3d.js';

export const CAMERA_LIMITS = { minDist: 22, maxDist: 240 };

export function createCamera(opts = {}) {
  return {
    tx: opts.x || 160, tz: opts.z || 480, ty: 0,
    dist: opts.dist || 78,
    yaw: 0,
    fov: (36 * Math.PI) / 180,
    aspect: 1, near: 1.0, far: 1400,
    vx: 0, vz: 0, // pan inertia (m/s)
    bounds: opts.bounds || { x0: 0, z0: 0, x1: 320, z1: 576 },
    eye: [0, 0, 0],
    view: mat4(), proj: mat4(), viewProj: mat4(), invViewProj: mat4(),
    planes: new Float32Array(24),
    width: 1, height: 1,
    groundFn: null, // (x,z) -> y
  };
}

export function cameraPitch(cam) {
  const t = (cam.dist - CAMERA_LIMITS.minDist) / (CAMERA_LIMITS.maxDist - CAMERA_LIMITS.minDist);
  // closer = lower (more cinematic), farther = steeper (readable overview)
  return 0.8 + Math.min(1, Math.max(0, t)) * 0.36;
}

export function clampCamera(cam) {
  const b = cam.bounds;
  const m = 6;
  cam.tx = Math.min(b.x1 - m, Math.max(b.x0 + m, cam.tx));
  cam.tz = Math.min(b.z1 + 10, Math.max(b.z0 + m, cam.tz));
  cam.dist = Math.min(CAMERA_LIMITS.maxDist, Math.max(CAMERA_LIMITS.minDist, cam.dist));
}

export function updateCamera(cam, width, height, dt) {
  cam.width = width; cam.height = height;
  cam.aspect = width / Math.max(1, height);
  if (dt > 0 && (cam.vx || cam.vz)) {
    cam.tx += cam.vx * dt;
    cam.tz += cam.vz * dt;
    const damp = Math.exp(-dt * 5.5);
    cam.vx *= damp; cam.vz *= damp;
    if (Math.abs(cam.vx) < 0.05 && Math.abs(cam.vz) < 0.05) { cam.vx = 0; cam.vz = 0; }
  }
  clampCamera(cam);
  const gy = cam.groundFn ? cam.groundFn(cam.tx, cam.tz) : 0;
  cam.ty += (gy - cam.ty) * (dt > 0 ? Math.min(1, dt * 6) : 1);
  const pitch = cameraPitch(cam);
  const horiz = cam.dist * Math.cos(pitch);
  cam.eye[0] = cam.tx + Math.sin(cam.yaw) * horiz;
  cam.eye[1] = cam.ty + cam.dist * Math.sin(pitch);
  cam.eye[2] = cam.tz + Math.cos(cam.yaw) * horiz;
  // portrait screens get a wider vertical FOV so the battlefield stays readable
  const fov = cam.aspect < 1 ? cam.fov * 1.35 : cam.fov;
  mat4Perspective(cam.proj, fov, cam.aspect, cam.near, cam.far);
  mat4LookAt(cam.view, cam.eye, [cam.tx, cam.ty, cam.tz], [0, 1, 0]);
  mat4Mul(cam.viewProj, cam.proj, cam.view);
  mat4Invert(cam.invViewProj, cam.viewProj);
  frustumPlanes(cam.planes, cam.viewProj);
}

/** World units per screen pixel at the target distance (for pan scaling). */
export function worldPerPixel(cam) {
  const fov = cam.aspect < 1 ? cam.fov * 1.35 : cam.fov;
  return (2 * cam.dist * Math.tan(fov / 2)) / Math.max(1, cam.height);
}

export function panCamera(cam, dxPx, dyPx) {
  const k = worldPerPixel(cam);
  const pitch = cameraPitch(cam);
  const s = Math.sin(cam.yaw), c = Math.cos(cam.yaw);
  // ground right R = (c, -s); ground forward F = (-s, -c). Content follows the finger:
  // target -= dx*R ; target += dy*F (scaled for the oblique view)
  const fwdScale = 1 / Math.max(0.35, Math.sin(pitch));
  cam.tx += (-dxPx * c - dyPx * s * fwdScale) * k;
  cam.tz += (dxPx * s - dyPx * c * fwdScale) * k;
  clampCamera(cam);
}

const tmp4 = [0, 0, 0, 0];

/** Ray from screen pixel -> { ox,oy,oz, dx,dy,dz } */
export function screenRay(cam, sx, sy, out) {
  const nx = (sx / cam.width) * 2 - 1, ny = 1 - (sy / cam.height) * 2;
  const m = cam.invViewProj;
  transformPoint4(tmp4, m, nx, ny, -1);
  const x0 = tmp4[0] / tmp4[3], y0 = tmp4[1] / tmp4[3], z0 = tmp4[2] / tmp4[3];
  transformPoint4(tmp4, m, nx, ny, 1);
  const x1 = tmp4[0] / tmp4[3], y1 = tmp4[1] / tmp4[3], z1 = tmp4[2] / tmp4[3];
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const l = Math.hypot(dx, dy, dz) || 1;
  out.ox = x0; out.oy = y0; out.oz = z0;
  out.dx = dx / l; out.dy = dy / l; out.dz = dz / l;
  return out;
}

/** Intersect a screen ray with the terrain (ray-march + bisection). Returns [x,y,z] or null. */
export function pickGround(cam, sx, sy, out = [0, 0, 0]) {
  const r = screenRay(cam, sx, sy, RAY);
  const g = cam.groundFn || (() => 0);
  let t = 0, step = 2;
  let prevT = 0, prevAbove = true;
  for (let i = 0; i < 900; i++) {
    const x = r.ox + r.dx * t, y = r.oy + r.dy * t, z = r.oz + r.dz * t;
    const above = y > g(x, z);
    if (!above && prevAbove && i > 0) {
      let a = prevT, b = t;
      for (let k = 0; k < 20; k++) {
        const mdl = (a + b) / 2;
        const mx = r.ox + r.dx * mdl, my = r.oy + r.dy * mdl, mz = r.oz + r.dz * mdl;
        if (my > g(mx, mz)) a = mdl; else b = mdl;
      }
      out[0] = r.ox + r.dx * b; out[1] = r.oy + r.dy * b; out[2] = r.oz + r.dz * b;
      return out;
    }
    prevAbove = above;
    prevT = t;
    t += step;
    if (t > 2000) break;
  }
  // fallback: plane y = ty
  if (Math.abs(r.dy) > 1e-5) {
    const tt = (cam.ty - r.oy) / r.dy;
    if (tt > 0) { out[0] = r.ox + r.dx * tt; out[1] = cam.ty; out[2] = r.oz + r.dz * tt; return out; }
  }
  return null;
}
const RAY = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };

/** Project world point to screen pixels. out = [sx, sy, depth(0..1), visible(1/0)] */
export function projectToScreen(cam, x, y, z, out) {
  transformPoint4(tmp4, cam.viewProj, x, y, z);
  const w = tmp4[3];
  if (w <= 0.0001) { out[3] = 0; return out; }
  const nx = tmp4[0] / w, ny = tmp4[1] / w, nz = tmp4[2] / w;
  out[0] = (nx * 0.5 + 0.5) * cam.width;
  out[1] = (1 - (ny * 0.5 + 0.5)) * cam.height;
  out[2] = nz * 0.5 + 0.5;
  out[3] = nx > -1.2 && nx < 1.2 && ny > -1.2 && ny < 1.2 && nz < 1 ? 1 : 0;
  return out;
}

/** Zoom by factor keeping the ground point under (sx,sy) fixed on screen. */
export function zoomAt(cam, factor, sx, sy) {
  const before = pickGround(cam, sx, sy, [0, 0, 0]);
  cam.dist *= factor;
  clampCamera(cam);
  updateCamera(cam, cam.width, cam.height, 0);
  if (!before) return;
  const after = pickGround(cam, sx, sy, [0, 0, 0]);
  if (!after) return;
  cam.tx += before[0] - after[0];
  cam.tz += before[2] - after[2];
  clampCamera(cam);
  updateCamera(cam, cam.width, cam.height, 0);
}

/** Ground footprint of the view (4 corners) for the minimap. */
export function viewFootprint(cam, out) {
  const corners = [[0, 0], [cam.width, 0], [cam.width, cam.height], [0, cam.height]];
  for (let i = 0; i < 4; i++) {
    const r = screenRay(cam, corners[i][0], corners[i][1], RAY);
    let t = r.dy < -1e-4 ? (cam.ty - r.oy) / r.dy : 600;
    if (t < 0 || t > 900) t = 900;
    out[i * 2] = r.ox + r.dx * t;
    out[i * 2 + 1] = r.oz + r.dz * t;
  }
  return out;
}
