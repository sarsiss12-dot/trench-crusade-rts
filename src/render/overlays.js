// Overlays (presentation only): selection rings, order markers, dotted route lines, rally points,
// deployment-zone outline, placement ghosts / footprints, ability target rings, context-sensitive
// squad / structure bars (screen space) and debug lines. Every entity-derived overlay goes through
// the viewer's perception filters, so no overlay reveals anything hidden by the fog of war.
import { createBuffer, createVAO, drawElements, drawArrays } from './gl.js';
import { projectToScreen } from './camera.js';
import { unitDef } from '../data/units.js';
import { STRUCTURES } from '../data/structures.js';
import { COVER_TYPES, COVER_IDS } from '../data/cover.js';
import { isSquadVisibleTo, isStructureVisibleTo, isNodeKnownTo, isSoldierVisibleTo, visibleCentroid, isPointVisibleTo, isSectorKnownTo } from '../sim/perception.js';
import { FACTIONS } from '../data/factions.js';
import { exitPoint } from '../sim/production.js';
import { TICK_RATE } from '../sim/constants.js';

const DS = { DOT: 0, RING: 1, MARKER: 5, ATTACK: 7, AREA: 8, BOX: 9 };
const MAX_MARKS = 1600;
const MAX_BARS = 900;
const MAX_LINE_VERTS = 12000;
const OWN_RING = [0.86, 0.76, 0.48];
const ENEMY_RING = [0.86, 0.24, 0.16];
const HOVER_RING = [0.9, 0.86, 0.72];
const VALID = [0.55, 0.8, 0.45];
const INVALID = [0.9, 0.26, 0.18];
// Phase 3: resource sector kinds (same hues as the minimap), work areas
const SECTOR_COL = {
  fertile: [0.62, 0.66, 0.3], pasture: [0.5, 0.66, 0.4], quarry: [0.66, 0.65, 0.6],
  scrap: [0.58, 0.52, 0.44], depot: [0.74, 0.58, 0.3], hamlet: [0.8, 0.68, 0.46],
};
const FORAGE_COL = [0.55, 0.62, 0.2];
const SANITIZE_COL = [0.95, 0.55, 0.2];
const HERD_COL = [0.7, 0.62, 0.42];
const ENG_COL = [1.0, 0.82, 0.4];

function coverLevel(idx) {
  const c = COVER_TYPES[COVER_IDS[idx]];
  return c ? c.level : 0;
}

export function createOverlays(gl, overlayProgram, lineProgram, decalProgram) {
  // ------------------------------------------------------------------ ground marks (decal shader)
  const N = 4;
  const grid = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) grid.push(-1 + (2 * i) / N, -1 + (2 * j) / N);
  const gidx = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    gidx.push(a, c, b, b, c, d);
  }
  const gridBuf = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(grid));
  const gridIdx = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(gidx));
  const marks = new Float32Array(MAX_MARKS * 16);
  const markBuf = createBuffer(gl, gl.ARRAY_BUFFER, marks.byteLength, gl.DYNAMIC_DRAW);
  const inst16 = (buf) => ({
    buffer: buf, stride: 64, attribs: [
      { loc: 4, size: 4, type: gl.FLOAT, offset: 0, divisor: 1 },
      { loc: 5, size: 4, type: gl.FLOAT, offset: 16, divisor: 1 },
      { loc: 6, size: 4, type: gl.FLOAT, offset: 32, divisor: 1 },
      { loc: 7, size: 4, type: gl.FLOAT, offset: 48, divisor: 1 },
    ],
  });
  const markVao = createVAO(gl, [{ buffer: gridBuf, stride: 8, attribs: [{ loc: 0, size: 2, type: gl.FLOAT, offset: 0 }] }, inst16(markBuf)], gridIdx);
  let nMarks = 0;

  // ------------------------------------------------------------------ screen bars (overlay shader)
  const quad = createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
  const bars = new Float32Array(MAX_BARS * 12);
  const barBuf = createBuffer(gl, gl.ARRAY_BUFFER, bars.byteLength, gl.DYNAMIC_DRAW);
  const barVao = createVAO(gl, [
    { buffer: quad, stride: 8, attribs: [{ loc: 0, size: 2, type: gl.FLOAT, offset: 0 }] },
    {
      buffer: barBuf, stride: 48, attribs: [
        { loc: 4, size: 4, type: gl.FLOAT, offset: 0, divisor: 1 },
        { loc: 5, size: 4, type: gl.FLOAT, offset: 16, divisor: 1 },
        { loc: 6, size: 4, type: gl.FLOAT, offset: 32, divisor: 1 },
      ],
    },
  ]);
  let nBars = 0;

  // ------------------------------------------------------------------ debug lines (line shader)
  const lines = new Float32Array(MAX_LINE_VERTS * 7);
  const lineBuf = createBuffer(gl, gl.ARRAY_BUFFER, lines.byteLength, gl.DYNAMIC_DRAW);
  const lineVao = createVAO(gl, [{
    buffer: lineBuf, stride: 28, attribs: [
      { loc: 0, size: 3, type: gl.FLOAT, offset: 0 },
      { loc: 2, size: 4, type: gl.FLOAT, offset: 12 },
    ],
  }]);
  let nLineVerts = 0;

  const markers = []; // transient order markers { kind, x, z, t0, life }
  const stats = { marks: 0, bars: 0, lines: 0 };
  let renderer = null;
  const P = [0, 0, 0, 0];
  const EXIT = [0, 0];
  const VC = [0, 0];
  let curSim = null;

  function mark(x, z, y, size, rot, r, g, b, a, shape, p1 = 0, p2 = 0, aspect = 1, lift = 0.05) {
    if (nMarks >= MAX_MARKS) return;
    const o = nMarks++ * 16;
    marks[o] = x; marks[o + 1] = z; marks[o + 2] = size; marks[o + 3] = rot;
    marks[o + 4] = r; marks[o + 5] = g; marks[o + 6] = b; marks[o + 7] = a;
    marks[o + 8] = shape; marks[o + 9] = p1; marks[o + 10] = p2; marks[o + 11] = aspect;
    marks[o + 12] = y; marks[o + 13] = lift; marks[o + 14] = 0; marks[o + 15] = 0;
  }

  function bar(x, y, w, h, r, g, b, a, fill, pips) {
    if (nBars >= MAX_BARS) return;
    const o = nBars++ * 12;
    bars[o] = x; bars[o + 1] = y; bars[o + 2] = w; bars[o + 3] = h;
    bars[o + 4] = r; bars[o + 5] = g; bars[o + 6] = b; bars[o + 7] = a;
    bars[o + 8] = fill; bars[o + 9] = 0; bars[o + 10] = pips || 0; bars[o + 11] = 0;
  }

  function line(x0, y0, z0, x1, y1, z1, r, g, b, a) {
    if (nLineVerts + 2 > MAX_LINE_VERTS) return;
    let o = nLineVerts * 7;
    lines[o] = x0; lines[o + 1] = y0; lines[o + 2] = z0; lines[o + 3] = r; lines[o + 4] = g; lines[o + 5] = b; lines[o + 6] = a;
    o += 7;
    lines[o] = x1; lines[o + 1] = y1; lines[o + 2] = z1; lines[o + 3] = r; lines[o + 4] = g; lines[o + 5] = b; lines[o + 6] = a;
    nLineVerts += 2;
  }

  const ground = (x, z) => renderer.groundAt(x, z);

  /** Dotted ground line from (x0,z0) to (x1,z1); returns the leftover phase for chaining. */
  let zoomK = 1; // camera distance scale for dotted overlays (set per frame in update)
  function dots(x0, z0, x1, z1, spacing, size, col, a, phase = 0, maxDots = 90) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return phase;
    // readable from strategic zoom: dots grow and thin out with camera distance (zoomK)
    const k = zoomK, sp = spacing * k, sz = size * k;
    let d = phase * k, n = 0;
    while (d < len && n < maxDots) {
      const t = d / len;
      const x = x0 + dx * t, z = z0 + dz * t;
      mark(x, z, ground(x, z), sz, 0, col[0], col[1], col[2], a, DS.DOT);
      d += sp;
      n++;
    }
    return (d - len) / k;
  }

  /** Dotted ground circle (sector / work area outlines). Dots grow (and thin out) as the camera
   *  pulls back so an outline stays readable from strategic zoom on a phone. */
  function circle(x, z, r, col, a, spacing = 2.2, phase = 0) {
    const n = Math.max(10, Math.min(90, Math.round((Math.PI * 2 * r) / (spacing * zoomK))));
    const size = 0.22 * zoomK;
    for (let i = 0; i < n; i++) {
      const t = ((i + phase) / n) * Math.PI * 2;
      const px = x + Math.sin(t) * r, pz = z + Math.cos(t) * r;
      mark(px, pz, ground(px, pz), size, 0, col[0], col[1], col[2], a, DS.DOT);
    }
  }

  /** Phase 3 world overlays: sectors, settlement reach, auto-engineer beams, work areas. */
  function economyOverlays(sim, frame, viewer, t, sst) {
    const { state, rt } = sim;
    const pl = frame.placement;
    const pdef = pl && STRUCTURES[pl.stype];
    const econPlacing = !!(pdef && (pdef.requiresSector || pdef.requiresSettlement || pdef.requiresSectorKind));
    const settlementSel = !!(sst && STRUCTURES[sst.type] && STRUCTURES[sst.type].settlement);
    const prepEcon = state.match.phase === 'PREPARATION' && FACTIONS[viewer] && FACTIONS[viewer].population;
    if (econPlacing || settlementSel || prepEcon || frame.showSectors) {
      for (const sec of state.sectors || []) {
        if (!isSectorKnownTo(sec, viewer)) continue;
        const col = SECTOR_COL[sec.kind] || OWN_RING;
        const a = sec.sid ? 0.3 : econPlacing ? 0.9 : 0.6;
        const y = ground(sec.x, sec.z);
        // one dashed-ring decal per sector (cheap, readable from strategic zoom), lifted over the rolling ground
        mark(sec.x, sec.z, y, sec.r, 0, col[0], col[1], col[2], a, DS.AREA, 0, t * 0.35, 1, 0.45);
        for (let k = 0; k <= sec.rich; k++) mark(sec.x + (k - sec.rich / 2) * 1.4 * zoomK, sec.z, y, 0.5 * zoomK, 0, col[0], col[1], col[2], a + 0.1, DS.DOT);
      }
    }
    if (econPlacing || settlementSel) {
      for (const st of state.structures) {
        if (st.faction !== viewer || !STRUCTURES[st.type].settlement) continue;
        circle(st.x, st.z, STRUCTURES[st.type].settlement.econRadius, OWN_RING, st === sst ? 0.7 : 0.4, 2.6);
      }
    }
    // livestock pen selected: where its drovers gather animals
    if (sst && sst.faction === viewer && STRUCTURES[sst.type].pen) {
      const pd = STRUCTURES[sst.type].pen;
      circle(sst.herdX, sst.herdZ, pd.herdRadius, HERD_COL, 0.55, 3.2);
      dots(sst.x, sst.z, sst.herdX, sst.herdZ, 2.4, 0.2, HERD_COL, 0.55, (t * 2) % 2.4, 60);
    }
    // own work areas: selected gangs' forage fields, engineers' sanitation areas
    const sel = frame.selection;
    if (sel && sel.size) {
      for (const id of sel) {
        const sq = rt.squadById.get(id);
        if (!sq || sq.faction !== viewer) continue;
        const o = sq.order;
        if (o.t === 'gather' && o.mode === 'forage' && o.fr) circle(o.fx, o.fz, o.fr, FORAGE_COL, o.auto ? 0.35 : 0.6, 2.6, (t * 0.5) % 1);
        if (o.t === 'sanitize' && o.r) circle(o.x, o.z, o.r, SANITIZE_COL, 0.65, 2, (t * 0.6) % 1);
      }
    }
    // area targeting modes (forage / sanitize / herd): the area under the pointer
    const at = frame.areaTarget;
    if (at && typeof at.x === 'number') {
      const col = at.kind === 'forage' ? FORAGE_COL : at.kind === 'sanitize' ? SANITIZE_COL : HERD_COL;
      circle(at.x, at.z, at.r, at.valid === false ? INVALID : col, 0.9, 2, (t * 0.8) % 1);
      mark(at.x, at.z, ground(at.x, at.z), 1.2, 0, col[0], col[1], col[2], 0.9, DS.MARKER, 0.2);
    }
    // auto-dispatched engineers: pulse on the engineer, a beam to the site (fades in a few seconds)
    for (const h of frame.engineerHighlights || []) {
      const sq = rt.squadById.get(h.squadId);
      if (!sq || sq.faction !== viewer) continue;
      const pulse = 0.5 + 0.5 * Math.sin(t * 9);
      const y = ground(sq.cx, sq.cz);
      mark(sq.cx, sq.cz, y, 2.2 + pulse * 0.8, 0, ENG_COL[0], ENG_COL[1], ENG_COL[2], 0.9 * h.k, DS.RING);
      mark(sq.cx, sq.cz, y, 1.2, 0, ENG_COL[0], ENG_COL[1], ENG_COL[2], 0.6 * h.k, DS.RING);
      if (typeof h.x === 'number') {
        dots(sq.cx, sq.cz, h.x, h.z, 1.6, 0.34, ENG_COL, 0.9 * h.k, (t * 6) % 1.6, 160);
        mark(h.x, h.z, ground(h.x, h.z), 1.8, 0, ENG_COL[0], ENG_COL[1], ENG_COL[2], h.k, DS.MARKER, 0.15 + 0.1 * pulse);
      }
    }
  }

  /** Public: transient order marker at a ground point (called by input on command issue). */
  function addMarker(kind, x, z) {
    markers.push({ kind, x, z, t0: renderer ? renderer.time : 0, life: kind === 'attack' ? 0.9 : 0.75 });
    if (markers.length > 24) markers.shift();
  }

  function squadAnchorY(sq) {
    return ground(sq.cx, sq.cz);
  }

  function memberPos(m, out) {
    const v = renderer.units ? renderer.units.visualOf(m.id) : null;
    if (v) { out[0] = v.x; out[1] = v.y; out[2] = v.z; } else { out[0] = m.x; out[1] = ground(m.x, m.z); out[2] = m.z; }
    return out;
  }
  const MP = [0, 0, 0];

  function ringsFor(sq, col, alpha, sizeMul = 1) {
    const def = unitDef(sq.type);
    const size = (def.heavy ? 0.95 : 0.68) * sizeMul;
    for (const m of sq.members) {
      if (m.state !== 'alive' && m.state !== 'rising' && m.state !== 'joining') continue;
      if (!isSoldierVisibleTo(curSim, sq, m, renderer.viewer)) continue;
      memberPos(m, MP);
      mark(MP[0], MP[2], MP[1], size, 0, col[0], col[1], col[2], alpha, DS.RING);
    }
  }

  function orderTarget(sim, sq, out) {
    const o = sq.order;
    const { rt } = sim;
    switch (o.t) {
      case 'move': out[0] = o.x; out[1] = o.z; return 'move';
      case 'attack': {
        if (o.tk === 'squad') {
          const t = rt.squadById.get(o.tid);
          if (!t || !isSquadVisibleTo(t, renderer.viewer)) return null;
          out[0] = t.cx; out[1] = t.cz; return 'attack';
        }
        const st = rt.structById.get(o.tid);
        if (!st) return null;
        out[0] = st.x; out[1] = st.z; return 'attack';
      }
      case 'build': case 'repair': case 'reinforce': {
        const st = rt.structById.get(o.sid);
        if (!st) return null;
        out[0] = st.x; out[1] = st.z; return 'build';
      }
      case 'gather': {
        const n = rt.nodeById.get(o.nid);
        if (!n || !isNodeKnownTo(n, renderer.viewer)) return null;
        out[0] = n.x; out[1] = n.z; return 'build';
      }
      default: return null;
    }
  }
  const OT = [0, 0];
  const LINE_COL = { move: [0.86, 0.8, 0.62], attack: [0.9, 0.3, 0.2], build: [0.9, 0.66, 0.3] };

  function routeLine(sim, sq) {
    const kind = orderTarget(sim, sq, OT);
    if (!kind) return;
    const col = LINE_COL[kind];
    let px = sq.cx, pz = sq.cz, phase = 1.2;
    // follow the actual computed route while it runs through ground in sight; beyond that a
    // straight line (the route's shape in unseen ground would trace structures the viewer does not know)
    if (sq.path && sq.pathState === 'ready' && kind !== 'attack') {
      for (let i = sq.pathIndex; i * 2 < sq.path.length; i++) {
        const wx = sq.path[i * 2], wz = sq.path[i * 2 + 1];
        if (!isPointVisibleTo(sim, renderer.viewer, wx, wz)) break;
        phase = dots(px, pz, wx, wz, 1.9, 0.17, col, 0.55, phase);
        px = wx; pz = wz;
      }
    }
    dots(px, pz, OT[0], OT[1], 1.9, 0.17, col, 0.55, phase);
  }

  function structureBox(st, col, alpha) {
    const def = STRUCTURES[st.type];
    if (def.kind === 'linear') {
      const dx = st.x2 - st.x1, dz = st.z2 - st.z1;
      const len = Math.hypot(dx, dz) || 1;
      const rot = Math.atan2(dx, dz);
      const half = len / 2 + 0.5, hw = def.width / 2 + 0.4;
      mark(st.x, st.z, ground(st.x, st.z), half, rot, col[0], col[1], col[2], alpha, DS.BOX, 0, 0, hw / half, 0.08);
    } else if (def.footprint) {
      const w = def.footprint.w / 2 + 0.6, d = def.footprint.d / 2 + 0.6;
      mark(st.x, st.z, ground(st.x, st.z), d, st.rot, col[0], col[1], col[2], alpha, DS.BOX, 0, 0, w / d, 0.1);
    }
  }

  /** Dotted shaft + chevron head on the ground from (x0,z0) toward (x1,z1). */
  function faceArrow(x0, z0, x1, z1, col, alpha) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) return;
    const ux = dx / len, uz = dz / len;
    dots(x0 + ux * 1.2, z0 + uz * 1.2, x1, z1, 0.9, 0.22, col, alpha);
    // chevrons
    for (let k = 0; k < 2; k++) {
      const bx = x1 - ux * k * 1.1, bz = z1 - uz * k * 1.1;
      for (const s of [1, -1]) {
        const ex = bx - ux * 1.4 + uz * 1.1 * s, ez = bz - uz * 1.4 - ux * 1.1 * s;
        dots(ex, ez, bx, bz, 0.35, 0.2, col, alpha * (1 - k * 0.35));
      }
    }
  }

  function zoneOutline(zone, col, alpha) {
    const pts = [[zone.x0, zone.z0], [zone.x1, zone.z0], [zone.x1, zone.z1], [zone.x0, zone.z1], [zone.x0, zone.z0]];
    let phase = 0;
    for (let i = 0; i < 4; i++) phase = dots(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 3.2, 0.3, col, alpha, phase, 200);
  }

  // ------------------------------------------------------------------ bars
  function barColorOwn(ratio) {
    if (ratio > 0.6) return [0.52, 0.7, 0.34];
    if (ratio > 0.3) return [0.84, 0.64, 0.22];
    return [0.82, 0.22, 0.14];
  }

  function squadBars(sim, camera, frame, sq, own, selected, hovered) {
    const def = unitDef(sq.type);
    const { state } = sim;
    const recent = state.tick - sq.lastHitTick < 5 * TICK_RATE;
    const engaged = !!sq.target && sq.engaged;
    let hp = 0, alive = 0, lvl = 0;
    for (const m of sq.members) {
      if (m.state !== 'alive' && m.state !== 'joining' && m.state !== 'rising') continue;
      hp += Math.max(0, m.hp);
      alive++;
      const l = coverLevel(m.cover || 0);
      if (l > lvl) lvl = l;
    }
    if (!alive) return;
    const maxHp = def.hp * def.squadSize;
    const ratio = Math.min(1, hp / maxHp);
    const far = camera.dist > 165;
    const show = selected || hovered || recent || engaged || (!far && ratio < 0.999 && camera.dist < 95);
    if (!show) return;
    if (far && !selected && !engaged) return;
    // enemies: placed over the members actually in sight
    if (!visibleCentroid(sim, sq, renderer.viewer, VC)) return;
    const y = ground(VC[0], VC[1]) + (def.heavy ? 3.0 : 2.6);
    projectToScreen(camera, VC[0], y, VC[1], P);
    if (!P[3]) return;
    const dpr = renderer.dpr * (frame.uiScale || 1);
    const w = (16 + def.squadSize * 4.5) * dpr, h = Math.max(3, 5 * dpr);
    const x0 = P[0] - w / 2, y0 = P[1] - h;
    const col = own ? barColorOwn(ratio) : [0.74, 0.18, 0.13];
    const alpha = selected || hovered || engaged || recent ? 1 : 0.75;
    bar(x0, y0, w, h, col[0], col[1], col[2], alpha, ratio, def.squadSize);
    // ammo (own squads with ammunition logistics)
    if (own && sq.ammoMax > 0) {
      const ar = sq.ammo / sq.ammoMax;
      if (selected || ar < 0.3) {
        const blink = ar <= 0 ? (Math.sin(renderer.time * 8) > 0 ? 1 : 0.35) : 1;
        const c = ar <= 0 ? [0.85, 0.2, 0.15] : [0.46, 0.58, 0.74];
        bar(x0, y0 + h + Math.max(1, dpr), w, Math.max(2, 3 * dpr), c[0], c[1], c[2], blink, Math.max(0.04, ar), 0);
      }
    }
    // infection (visible sickness): a sickly pip bar with the share of infected soldiers
    let inf = 0;
    for (const m of sq.members) if (m.state === 'alive' && m.infection > 0 && (own || isSoldierVisibleTo(sim, sq, m, renderer.viewer))) inf++;
    if (inf && sq.faction !== 'black_grail') {
      const s = 5 * dpr;
      bar(x0 + w + 2 * dpr, y0, s * 2, h, 0.55, 0.62, 0.16, 1, inf / alive, 0);
    }
    // walking replacements on their way (own squads)
    if (own && sq.reinf) {
      const s = 4 * dpr;
      const pulse = 0.55 + 0.45 * Math.sin(renderer.time * 5);
      bar(x0 - s - 2 * dpr, y0 - s - 2 * dpr, s, s, 0.86, 0.66, 0.3, pulse, 1, 0);
    }
    // cover indicator (own squads, when it matters)
    if (own && lvl > 0 && (selected || engaged || recent)) {
      const c = lvl >= 3 ? [0.92, 0.84, 0.56] : lvl === 2 ? [0.72, 0.66, 0.5] : [0.5, 0.5, 0.45];
      const s = 5 * dpr;
      bar(x0 - s - 2 * dpr, y0, s, s, c[0], c[1], c[2], 1, 1, 0);
    }
  }

  function structureBars(sim, camera, frame, st, own, selected, hovered) {
    const def = STRUCTURES[st.type];
    const { state } = sim;
    const recent = state.tick - st.lastDamageTick < 6 * TICK_RATE;
    const ratio = st.hp / st.maxHp;
    const building = !st.built;
    if (!(selected || hovered || recent || building || (ratio < 0.999 && camera.dist < 110))) return;
    if (camera.dist > 180 && !selected && !building && !recent) return;
    const h3 = def.kind === 'linear' ? 1.6 : def.footprint ? Math.min(9, 3 + Math.max(def.footprint.w, def.footprint.d) * 0.35) : 3;
    projectToScreen(camera, st.x, ground(st.x, st.z) + h3, st.z, P);
    if (!P[3]) return;
    const dpr = renderer.dpr * (frame.uiScale || 1);
    const big = def.kind === 'building' && def.footprint && def.footprint.w > 12;
    const w = (big ? 90 : 46) * dpr, h = Math.max(3, (big ? 7 : 5) * dpr);
    const x0 = P[0] - w / 2, y0 = P[1] - h;
    if (building) {
      bar(x0, y0, w, h, 0.86, 0.64, 0.26, 1, Math.max(0.02, st.progress), 0);
    } else {
      const col = own ? barColorOwn(ratio) : [0.74, 0.18, 0.13];
      bar(x0, y0, w, h, col[0], col[1], col[2], 1, ratio, big ? 10 : 0);
    }
    if (own && selected && st.queue && st.queue.length) {
      const it = st.queue[0];
      bar(x0, y0 + h + 2 * dpr, w, 4 * dpr, 0.62, 0.6, 0.52, 1, 1 - it.remaining / it.total, 0);
    }
  }

  // ------------------------------------------------------------------ per frame
  function update(sim, camera, r, frame) {
    renderer = r;
    curSim = sim;
    nMarks = 0; nBars = 0; nLineVerts = 0;
    zoomK = Math.max(1, Math.min(4, camera.dist / 45));
    const viewer = r.viewer;
    const { state, rt, world } = sim;
    const t = r.time;
    const sel = frame.selection || null;
    const hover = frame.hover || null;

    // deployment zone during preparation
    if (state.match.phase === 'PREPARATION' && world.zones[viewer]) {
      zoneOutline(world.zones[viewer], [0.86, 0.76, 0.48], 0.45 + 0.15 * Math.sin(t * 2.5));
    }

    // selection rings, attack-target rings, route lines
    if (sel && sel.size) {
      for (const id of sel) {
        const sq = rt.squadById.get(id);
        if (!sq || !isSquadVisibleTo(sq, viewer)) continue;
        const own = sq.faction === viewer;
        ringsFor(sq, own ? OWN_RING : ENEMY_RING, 0.95);
        if (!own) continue;
        routeLine(sim, sq);
        // commanded facing at the destination / holding position
        const fh = sq.order.fh;
        if (fh !== undefined) {
          const ox = sq.order.t === 'move' ? sq.order.x : sq.x, oz = sq.order.t === 'move' ? sq.order.z : sq.z;
          faceArrow(ox, oz, ox + Math.sin(fh) * 6, oz + Math.cos(fh) * 6, OWN_RING, 0.7);
        }
        // requested replacements: the walk from the source
        if (sq.reinf) {
          const src = rt.structById.get(sq.reinf.src);
          if (src) dots(src.x, src.z, sq.cx, sq.cz, 2.6, 0.2, sq.reinf.cut ? INVALID : [0.9, 0.66, 0.3], 0.5, (t * 3) % 2.6, 120);
        }
        if (sq.order.t === 'attack' && sq.order.tk === 'squad') {
          const tg = rt.squadById.get(sq.order.tid);
          if (tg && isSquadVisibleTo(tg, viewer)) ringsFor(tg, ENEMY_RING, 0.55 + 0.25 * Math.sin(t * 6), 1.1);
        }
      }
    }
    if (hover && hover.k === 'squad' && !(sel && sel.has(hover.id))) {
      const sq = rt.squadById.get(hover.id);
      if (sq && isSquadVisibleTo(sq, viewer)) ringsFor(sq, sq.faction === viewer ? HOVER_RING : ENEMY_RING, 0.45);
    }

    // selected structure: footprint box, rally point
    const sst = frame.selectedStruct ? (r.memory ? r.memory.known(sim, viewer, frame.selectedStruct) : rt.structById.get(frame.selectedStruct)) : null;
    if (sst) {
      structureBox(sst, sst.faction === viewer ? OWN_RING : ENEMY_RING, 0.85);
      if (sst.faction === viewer && sst.rally) {
        exitPoint(sst, EXIT);
        dots(EXIT[0], EXIT[1], sst.rally.x, sst.rally.z, 2.2, 0.2, OWN_RING, 0.6, 0.5);
        mark(sst.rally.x, sst.rally.z, ground(sst.rally.x, sst.rally.z), 1.4, 0, OWN_RING[0], OWN_RING[1], OWN_RING[2], 0.9, DS.MARKER, 0.12 + 0.08 * Math.sin(t * 3));
      }
    }
    economyOverlays(sim, frame, viewer, t, sst);
    if (hover && hover.k === 'struct' && hover.id !== frame.selectedStruct) {
      const st = r.memory ? r.memory.known(sim, viewer, hover.id) : rt.structById.get(hover.id);
      if (st) structureBox(st, st.faction === viewer ? HOVER_RING : ENEMY_RING, 0.45);
    }

    // transient order markers
    for (let i = markers.length - 1; i >= 0; i--) {
      const m = markers[i];
      const u = (t - m.t0) / m.life;
      if (u >= 1 || u < 0) { markers.splice(i, 1); continue; }
      const y = ground(m.x, m.z);
      if (m.kind === 'attack') mark(m.x, m.z, y, 1.8, 0, 0.92, 0.25, 0.16, 1 - u, DS.ATTACK, 0, t * 2.5);
      else if (m.kind === 'build') mark(m.x, m.z, y, 1.9, 0, 0.92, 0.7, 0.3, 1, DS.MARKER, u);
      else if (m.kind === 'rally') mark(m.x, m.z, y, 1.6, 0, OWN_RING[0], OWN_RING[1], OWN_RING[2], 1, DS.MARKER, u);
      else mark(m.x, m.z, y, 1.7, 0, 0.9, 0.86, 0.66, 1, DS.MARKER, u);
    }

    // placement ghosts (linear fortifications + buildings) and footprints
    const pl = frame.placement;
    if (pl && pl.params) {
      const def = STRUCTURES[pl.stype];
      const col = pl.valid ? VALID : INVALID;
      if (def.kind === 'linear') {
        r.forts.setGhost({ stype: pl.stype, ...pl.params, valid: pl.valid });
        r.statics.setGhost(null);
        const p = pl.params;
        mark(p.x1, p.z1, ground(p.x1, p.z1), 0.9, 0, col[0], col[1], col[2], 0.95, DS.RING);
        mark(p.x2, p.z2, ground(p.x2, p.z2), 0.9, 0, col[0], col[1], col[2], 0.95, DS.RING);
      } else {
        r.forts.setGhost(null);
        r.statics.setGhost({ stype: pl.stype, x: pl.params.x, z: pl.params.z, rot: pl.params.rot || 0, valid: pl.valid });
        const w = def.footprint.w / 2, d = def.footprint.d / 2;
        mark(pl.params.x, pl.params.z, ground(pl.params.x, pl.params.z), d, pl.params.rot || 0, col[0], col[1], col[2], 0.9, DS.BOX, 0, 0, w / d, 0.1);
      }
    } else {
      r.forts.setGhost(null);
      r.statics.setGhost(null);
    }

    // facing drag (double-tap-hold-drag / right-drag): destination + direction arrow
    const fa = frame.faceArrow;
    if (fa) {
      const col = fa.valid === false ? INVALID : [0.95, 0.86, 0.55];
      mark(fa.x0, fa.z0, ground(fa.x0, fa.z0), 1.7, 0, col[0], col[1], col[2], 0.95, DS.MARKER, 0.2);
      faceArrow(fa.x0, fa.z0, fa.x1, fa.z1, col, 0.95);
    }

    // ability targeting
    const ab = frame.abilityTarget;
    if (ab && typeof ab.x === 'number') {
      const col = ab.valid ? [0.9, 0.7, 0.35] : INVALID;
      mark(ab.x, ab.z, ground(ab.x, ab.z), ab.radius, 0, col[0], col[1], col[2], 0.9, DS.AREA, 0, t * 1.5);
    }

    // bars (screen space)
    for (const sq of state.squads) {
      if (!isSquadVisibleTo(sq, viewer)) continue;
      const own = sq.faction === viewer;
      const selected = !!(sel && sel.has(sq.id));
      const hovered = !!(hover && hover.k === 'squad' && hover.id === sq.id);
      squadBars(sim, camera, frame, sq, own, selected, hovered);
    }
    for (const st of state.structures) {
      if (st.faction === 'neutral') continue;
      const own = st.faction === viewer;
      if (!own && !isStructureVisibleTo(st, viewer)) continue; // live values only while visible
      const selected = frame.selectedStruct === st.id;
      const hovered = !!(hover && hover.k === 'struct' && hover.id === st.id);
      structureBars(sim, camera, frame, st, own, selected, hovered);
    }

    // debug: squad routes + current engagement lines
    if (frame.debug && frame.debug.paths) {
      for (const sq of state.squads) {
        if (!isSquadVisibleTo(sq, viewer)) continue;
        const y0 = ground(sq.cx, sq.cz) + 0.3;
        if (sq.path) {
          let px = sq.x, pz = sq.z, py = ground(px, pz) + 0.3;
          for (let i = sq.pathIndex; i * 2 < sq.path.length; i++) {
            const wx = sq.path[i * 2], wz = sq.path[i * 2 + 1], wy = ground(wx, wz) + 0.3;
            line(px, py, pz, wx, wy, wz, 0.3, 0.9, 1.0, 0.9);
            px = wx; pz = wz; py = wy;
          }
        }
        if (sq.target && sq.target.k === 'squad') {
          const tg = rt.squadById.get(sq.target.id);
          if (tg && isSquadVisibleTo(tg, viewer)) line(sq.cx, y0 + 1, sq.cz, tg.cx, ground(tg.cx, tg.cz) + 1.3, tg.cz, 1, 0.25, 0.2, 0.8);
        }
        line(sq.x, y0, sq.z, sq.cx, y0, sq.cz, 1, 1, 0.3, 0.9); // anchor -> centroid
      }
    }

    if (nMarks) { gl.bindBuffer(gl.ARRAY_BUFFER, markBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, marks, 0, nMarks * 16); }
    if (nBars) { gl.bindBuffer(gl.ARRAY_BUFFER, barBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, bars, 0, nBars * 12); }
    if (nLineVerts) { gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, lines, 0, nLineVerts * 7); }
    stats.marks = nMarks; stats.bars = nBars; stats.lines = nLineVerts / 2;
  }

  function drawGroundMarks(setCommon) {
    if (!nMarks) return;
    const p = decalProgram;
    gl.useProgram(p.program);
    setCommon(p);
    gl.uniform1f(p.u.uAdditive, 0);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(markVao);
    drawElements(gl, gl.TRIANGLES, gidx.length, gl.UNSIGNED_SHORT, nMarks);
    gl.bindVertexArray(null);
  }

  function drawWorld(setCommon, r) {
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    r.forts.drawGhost(setCommon);
    r.statics.drawGhost(setCommon);
    if (nLineVerts) {
      const p = lineProgram;
      gl.useProgram(p.program);
      setCommon(p);
      gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(lineVao);
      drawArrays(gl, gl.LINES, 0, nLineVerts);
      gl.bindVertexArray(null);
      gl.enable(gl.DEPTH_TEST);
    }
  }

  function drawScreen(width, height) {
    if (!nBars) return;
    const p = overlayProgram;
    gl.useProgram(p.program);
    gl.uniform2f(p.u.uScreen, width, height);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE); // pixel-space quads are wound clockwise after the y flip
    gl.bindVertexArray(barVao);
    drawArrays(gl, gl.TRIANGLE_STRIP, 0, 4, nBars);
    gl.bindVertexArray(null);
    gl.enable(gl.CULL_FACE);
  }

  return { update, drawGroundMarks, drawWorld, drawScreen, addMarker, stats };
}
