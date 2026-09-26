// Canvas sizing for the renderer. Changing canvas.width/height clears the drawing buffer, so a new
// size (window resize, orientation change, dynamic-resolution step) is only *requested* here and
// applied right before the next frame is drawn — in the same animation frame as the redraw. Applying
// it between a draw and compositing would present one cleared (black) frame.

export const RENDER_SCALE_MIN = 0.5;

/**
 * @param {{width:number,height:number}} canvas  anything with writable width/height
 * @param {number} dprCap  quality preset's device-pixel-ratio cap
 * @param {number} [renderScale]  dynamic resolution factor (RENDER_SCALE_MIN..1)
 * @param {number} [maxPixels]  backbuffer pixel budget of the quality preset
 */
export function createCanvasSizer(canvas, dprCap, renderScale = 1, maxPixels = Infinity) {
  const s = {
    width: 0, height: 0, dpr: 1,
    renderScale: clampScale(renderScale),
    pending: null, // [w, h, scale] waiting for the next frame
    css: null, // last CSS size + device pixel ratio
  };

  /** Record the wanted size; the very first request applies at once (nothing drawn yet). */
  s.request = (cssW, cssH, dpr) => {
    s.css = [cssW, cssH, dpr];
    let scale = Math.min(dpr || 1, dprCap);
    const area = Math.max(1, cssW * cssH);
    if (area * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / area); // pixel budget
    scale *= s.renderScale; // dynamic resolution always acts below the budget
    s.pending = [Math.max(1, Math.round(cssW * scale)), Math.max(1, Math.round(cssH * scale)), scale];
    if (!s.width) s.apply();
  };

  s.setRenderScale = (k) => {
    s.renderScale = clampScale(k);
    if (s.css) s.request(s.css[0], s.css[1], s.css[2]);
  };

  /** Apply a pending size (call at the start of a frame). Returns true when the canvas changed. */
  s.apply = () => {
    const p = s.pending;
    if (!p) return false;
    s.pending = null;
    const changed = canvas.width !== p[0] || canvas.height !== p[1];
    if (changed) { canvas.width = p[0]; canvas.height = p[1]; }
    s.width = p[0]; s.height = p[1]; s.dpr = p[2];
    return changed;
  };

  return s;
}

function clampScale(k) {
  return Math.max(RENDER_SCALE_MIN, Math.min(1, Number.isFinite(k) ? k : 1));
}
