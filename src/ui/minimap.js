// Minimap (2D canvas): pre-rendered terrain, real 3-state fog of war, known structures (trenches
// from the same segment data), visible squads only, camera footprint, attack pings. Tap / drag to
// move the camera. Oriented like the camera (Black Grail view is rotated 180°).
import { el } from './dom.js';
import { TERRAIN_TYPES } from '../data/terrain_types.js';
import { STRUCTURES } from '../data/structures.js';
import { sideIndex } from '../data/factions.js';
import { CELL_FLAG } from '../world/terrain.js';
import { isSquadVisibleTo, isStructureKnownTo, isNodeKnownTo, visibleCentroid, isSectorKnownTo, isConvoyVisibleTo } from '../sim/perception.js';
import { isSquadAlive } from '../sim/state.js';
import { viewFootprint } from '../render/camera.js';
import { EV } from '../core/events.js';
import { economyViewItems, usesResourceSectors } from '../sim/economy_view.js';

const COL = {
  own: '#d8c48e', ownDim: '#9c8c62', enemy: '#c4402c', enemyDim: '#7a2a20', neutral: '#6c6456',
  sel: '#fff6d8', cam: 'rgba(235,225,190,0.85)', node: '#8fa0a8', civ: '#b9b6a4', convoy: '#a88252',
};
// resource sector kinds (same hues as the world overlay)
const SECTOR_COL = {
  fertile: '#9aa45a', pasture: '#7fa06a', quarry: '#9c9a92', scrap: '#8a7f70', depot: '#b08c52', hamlet: '#c2a878',
};

export function createMinimap(game) {
  const { sim, viewer } = game;
  const world = sim.world;
  const W = world.width, H = world.height;
  const flip = game.camera.yaw > 1.5; // looking south
  const canvas = el('canvas.minimap');
  const wrap = el('div.minimap-wrap', null, canvas);
  (game.hud ? game.hud.minimapSlot : game.env.root).appendChild(wrap);
  const ctx = canvas.getContext('2d');
  let cw = 0, ch = 0, dpr = 1;

  // ---------------------------------------------------------------- static terrain image
  const t = world.terrain;
  const base = document.createElement('canvas');
  base.width = t.cols; base.height = t.rows;
  {
    const bctx = base.getContext('2d');
    const img = bctx.createImageData(t.cols, t.rows);
    for (let cz = 0; cz < t.rows; cz++) {
      for (let cx = 0; cx < t.cols; cx++) {
        const i = cz * t.cols + cx;
        const ty = TERRAIN_TYPES[t.types[i]];
        let [r, g, b] = ty.color;
        const fl = t.flags[i];
        if (fl & CELL_FLAG.ROAD) { r = 0.42; g = 0.39; b = 0.33; }
        if (fl & CELL_FLAG.RUIN) { r *= 0.8; g *= 0.8; b *= 0.8; }
        if (ty.water) { r = 0.1; g = 0.13; b = 0.13; }
        // hillshade from the base heightfield
        const h0 = t.heights[cz * t.vcols + cx], h1 = t.heights[cz * t.vcols + Math.min(t.vcols - 1, cx + 1)];
        const h2 = t.heights[Math.min(t.vrows - 1, cz + 1) * t.vcols + cx];
        const shade = Math.max(0.6, Math.min(1.35, 1 + (h0 - h1) * 0.25 + (h0 - h2) * 0.18));
        const o = i * 4;
        img.data[o] = Math.min(255, r * shade * 300);
        img.data[o + 1] = Math.min(255, g * shade * 300);
        img.data[o + 2] = Math.min(255, b * shade * 300);
        img.data[o + 3] = 255;
      }
    }
    bctx.putImageData(img, 0, 0);
  }
  // fog layer at fog-grid resolution
  const fog = sim.state.fog;
  const fogCanvas = document.createElement('canvas');
  fogCanvas.width = fog.cols; fogCanvas.height = fog.rows;
  const fctx = fogCanvas.getContext('2d');
  const fogImg = fctx.createImageData(fog.cols, fog.rows);

  // ---------------------------------------------------------------- mapping
  function toMini(x, z, out) {
    let u = x / W, v = z / H;
    if (flip) { u = 1 - u; v = 1 - v; }
    out[0] = u * cw; out[1] = v * ch;
    return out;
  }
  function toWorld(px, py, out) {
    let u = px / cw, v = py / ch;
    if (flip) { u = 1 - u; v = 1 - v; }
    out[0] = u * W; out[1] = v * H;
    return out;
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(40, Math.round(r.width * dpr)), h = Math.max(60, Math.round(r.height * dpr));
    if (w !== canvas.width || h !== canvas.height) { canvas.width = w; canvas.height = h; }
    cw = canvas.width; ch = canvas.height;
  }

  // ---------------------------------------------------------------- pings
  const pings = [];
  function ping(x, z, color, life = 2) {
    if (pings.length > 12) pings.shift();
    pings.push({ x, z, color, t: 0, life });
  }
  let lastHitPing = 0;
  function onEvent(ev) {
    const now = performance.now() / 1000;
    if ((ev.type === EV.HIT || ev.type === EV.DEATH) && ev.faction === viewer && now - lastHitPing > 1.5) {
      const sq = sim.rt.squadById.get(ev.sq);
      if (sq) { ping(sq.cx, sq.cz, COL.enemy); lastHitPing = now; }
    } else if (ev.type === EV.STRUCTURE_DAMAGED && ev.faction === viewer && now - lastHitPing > 1.5) {
      ping(ev.x, ev.z, COL.enemy); lastHitPing = now;
    } else if (ev.type === EV.ABILITY_CAST) {
      ping(ev.x, ev.z, ev.faction === viewer ? COL.own : COL.enemy, 3);
    } else if ((ev.type === EV.CONVOY_LOST || ev.type === EV.EVACUATION) && ev.faction === viewer) {
      ping(ev.x, ev.z, ev.type === EV.CONVOY_LOST ? COL.enemy : '#e0b050', 3);
    } else if (ev.type === EV.NOTICE && ev.faction === viewer && ev.key === 'settle.lost') {
      ping(ev.x, ev.z, COL.enemy, 4);
    }
  }

  // ---------------------------------------------------------------- draw
  const P = [0, 0], Q = [0, 0], VC = [0, 0];
  const FP = new Float32Array(8);
  function draw() {
    resize();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.save();
    if (flip) { ctx.translate(cw, ch); ctx.rotate(Math.PI); }
    ctx.drawImage(base, 0, 0, cw, ch);
    // fog of war: unexplored black, explored dimmed, visible clear
    if (game.renderer.fogEnabled) {
      const j = sideIndex(viewer);
      const vis = fog.vis[j], seen = fog.seen[j];
      const d = fogImg.data;
      for (let i = 0; i < vis.length; i++) {
        const o = i * 4;
        d[o] = 6; d[o + 1] = 6; d[o + 2] = 8;
        d[o + 3] = vis[i] ? 0 : seen[i] ? 130 : 240;
      }
      fctx.putImageData(fogImg, 0, 0);
      ctx.drawImage(fogCanvas, 0, 0, cw, ch);
    }
    ctx.restore();
    const sx = cw / W;
    // resource sectors the faction knows (economic map: where to expand)
    for (const sec of sim.state.sectors || []) {
      if (!usesResourceSectors(viewer)) break;
      if (!isSectorKnownTo(sec, viewer)) continue;
      toMini(sec.x, sec.z, P);
      const rr = Math.max(3 * dpr, sec.r * sx);
      ctx.strokeStyle = SECTOR_COL[sec.kind] || COL.neutral;
      ctx.globalAlpha = sec.sid ? 0.45 : 0.9;
      ctx.lineWidth = dpr;
      ctx.setLineDash([2 * dpr, 2 * dpr]);
      ctx.beginPath(); ctx.arc(P[0], P[1], rr, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = SECTOR_COL[sec.kind] || COL.neutral;
      for (let k = 0; k <= sec.rich; k++) ctx.fillRect(P[0] - 2.5 * dpr + k * 2.2 * dpr, P[1] - 0.8 * dpr, 1.5 * dpr, 1.5 * dpr);
      ctx.globalAlpha = 1;
    }
    // structures (known)
    if (game.ui.econView && !usesResourceSectors(viewer)) for (const it of economyViewItems(sim, viewer)) {
      toMini(it.x, it.z, P);
      ctx.strokeStyle = !it.safe ? '#d16b45' : it.kind === 'habitat' ? '#a6c164' : it.kind === 'fortification' ? '#66b8bc' : '#aaa278';
      ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.arc(P[0], P[1], Math.max(2 * dpr, it.r * sx), 0, Math.PI * 2); ctx.stroke();
    }
    const known = game.renderer.knownStructures ? game.renderer.knownStructures() : sim.state.structures.filter((s) => s.faction === viewer || s.faction === 'neutral' || isStructureKnownTo(s, viewer));
    for (const st of known) {
      const def = STRUCTURES[st.type];
      const col = st.faction === viewer ? (st.built ? COL.own : COL.ownDim) : st.faction === 'neutral' ? COL.neutral : COL.enemy;
      if (def.kind === 'linear') {
        toMini(st.x1, st.z1, P); toMini(st.x2, st.z2, Q);
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(1.5, (st.type === 'trench' ? 2.4 : 1.2) * sx * 1.4);
        if (st.type === 'wire') ctx.setLineDash([2 * dpr, 2 * dpr]);
        ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.lineTo(Q[0], Q[1]); ctx.stroke();
        ctx.setLineDash([]);
      } else if (def.footprint) {
        toMini(st.x, st.z, P);
        const w = Math.max(3 * dpr, def.footprint.w * sx), h = Math.max(3 * dpr, def.footprint.d * sx);
        ctx.save();
        ctx.translate(P[0], P[1]);
        ctx.rotate(-st.rot + (flip ? Math.PI : 0));
        ctx.fillStyle = def.kind === 'area' ? 'rgba(160,140,90,0.25)' : col;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        if (st.objective) { ctx.strokeStyle = COL.sel; ctx.lineWidth = dpr; ctx.strokeRect(-w / 2 - dpr, -h / 2 - dpr, w + 2 * dpr, h + 2 * dpr); }
        ctx.restore();
      }
    }
    // resource nodes (discovered only, as last seen)
    ctx.fillStyle = COL.node;
    const nodes = game.renderer.memory ? game.renderer.memory.nodes() : sim.state.nodes;
    for (const n of nodes) {
      if (n.amount <= 0 || (!game.renderer.memory && !isNodeKnownTo(n, viewer))) continue;
      toMini(n.x, n.z, P);
      ctx.fillRect(P[0] - dpr, P[1] - dpr, 2 * dpr, 2 * dpr);
    }
    // supply convoys (own; enemy ones only while seen)
    for (const c of sim.state.convoys || []) {
      if (!isConvoyVisibleTo(c, viewer)) continue;
      toMini(c.x, c.z, P);
      ctx.fillStyle = c.faction === viewer ? COL.convoy : COL.enemy;
      ctx.fillRect(P[0] - 1.8 * dpr, P[1] - 1.8 * dpr, 3.6 * dpr, 3.6 * dpr);
    }
    // squads (visible only)
    const sel = game.selection.squads;
    for (const sq of sim.state.squads) {
      if (!isSquadAlive(sq) || !isSquadVisibleTo(sq, viewer)) continue;
      if (!visibleCentroid(sim, sq, viewer, VC)) continue; // enemies: where they are actually seen
      toMini(VC[0], VC[1], P);
      const own = sq.faction === viewer;
      const r = (sq.civ ? 1.5 : own ? 2.2 : 2.4) * dpr;
      ctx.fillStyle = sq.civ ? COL.civ : own ? COL.own : COL.enemy;
      ctx.beginPath(); ctx.arc(P[0], P[1], r, 0, Math.PI * 2); ctx.fill();
      if (sel.has(sq.id)) { ctx.strokeStyle = COL.sel; ctx.lineWidth = dpr; ctx.stroke(); }
    }
    // pings
    for (let i = pings.length - 1; i >= 0; i--) {
      const p = pings[i];
      const k = p.t / p.life;
      toMini(p.x, p.z, P);
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.arc(P[0], P[1], (3 + k * 12) * dpr, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // camera footprint
    viewFootprint(game.camera, FP);
    ctx.strokeStyle = COL.cam;
    ctx.lineWidth = 1.2 * dpr;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      toMini(Math.max(-40, Math.min(W + 40, FP[i * 2])), Math.max(-40, Math.min(H + 40, FP[i * 2 + 1])), P);
      if (i === 0) ctx.moveTo(P[0], P[1]); else ctx.lineTo(P[0], P[1]);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // ---------------------------------------------------------------- input
  let dragging = false;
  const Wp = [0, 0];
  function moveCam(e) {
    const r = canvas.getBoundingClientRect();
    toWorld(((e.clientX - r.left) / r.width) * cw, ((e.clientY - r.top) / r.height) * ch, Wp);
    game.lookAt(Math.max(0, Math.min(W, Wp[0])), Math.max(0, Math.min(H, Wp[1])));
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    dragging = true;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    moveCam(e);
  });
  canvas.addEventListener('pointermove', (e) => { if (dragging) moveCam(e); });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointercancel', () => { dragging = false; });

  let acc = 1;
  function update(dt) {
    for (const p of pings) p.t += dt;
    for (let i = pings.length - 1; i >= 0; i--) if (pings[i].t >= pings[i].life) pings.splice(i, 1);
    acc += dt;
    if (acc >= (pings.length ? 0.05 : 0.1)) { acc = 0; draw(); }
  }

  return { update, onEvent, ping, destroy() { wrap.remove(); }, canvas };
}
