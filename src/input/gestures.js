// DOM-free gesture recognizer (Pointer Events semantics) for touch, pen and mouse.
// Raw pointer samples in, semantic gestures out: tap, double tap, long press, drag (with release
// velocity for inertia), box drag, two-finger pinch (zoom + centroid pan), hover and wheel.
// Deterministic and unit-testable with synthetic events (no timers: call tick(t) every frame).
//
// handlers (all optional):
//   onTap(x, y, info) · onDoubleTap(x, y, info)
//   onLongPress(x, y, info) -> bool : return true when the press was used (it then ends the
//     gesture); otherwise the same press can still become a tap or a drag
//   onDragStart(x, y, info) · onDrag(dx, dy, x, y, info) · onDragEnd(vx, vy, info)
//     (info.pan: a camera-only drag continued by the finger left after a pinch)
//   onBoxStart(x, y) · onBox(x0, y0, x1, y1) · onBoxEnd(x0, y0, x1, y1) · onBoxCancel()
//   onPinchStart(cx, cy) · onPinch(scale, cx, cy, dcx, dcy) · onPinchEnd()
//   onHover(x, y) · onWheel(dy, x, y, info)
//   wantsBox(info) -> bool : should a primary drag become a box selection?
//   wantsFace(x, y, info) -> bool : may this press become a FACING drag? (mobile: the second
//     press of a double tap, held and dragged past faceSlop; mouse: a right-button drag)
//   onFaceStart(x, y, info) · onFace(x, y, info) · onFaceEnd(x, y, info) · onFaceCancel()
//     A double tap released without dragging stays a normal double tap (no conflict).
// opts.scale() -> input px per CSS px: distance thresholds are CSS pixels (finger-sized on every
// screen density and render resolution).

export const GESTURE_DEFAULTS = Object.freeze({
  tapSlop: 10, // CSS px of movement before a press becomes a drag
  tapTime: 520, // ms: longer touch presses are long presses, not taps (mouse clicks ignore this)
  longPress: 520, // ms
  doubleTap: 330, // ms between taps
  doubleTapSlop: 24, // CSS px
  faceSlop: 16, // CSS px a held second tap must travel before it becomes a facing drag
});

export function createGestures(handlers = {}, opts = {}) {
  const cfg = { ...GESTURE_DEFAULTS, ...opts };
  const H = handlers;
  const scale = typeof opts.scale === 'function' ? opts.scale : () => 1;
  const pointers = new Map(); // id -> { x, y, sx, sy, t0, info }
  let mode = 'none'; // none | pending | drag | box | pinch | panPending | ignore
  let primary = -1;
  let longTried = false; // long-press time reached (handler asked once)
  let longFired = false; // ... and the handler used it
  let pinch = null;
  let lastTap = { t: -1e9, x: -1e9, y: -1e9 };
  const samples = []; // recent drag samples for release velocity [t, x, y]

  function info(p) {
    return p.info;
  }

  function call(name, ...args) {
    if (H[name]) H[name](...args);
  }

  function centroidAndDistance() {
    const pts = [...pointers.values()];
    const a = pts[0], b = pts[1];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  }

  function endDrag(silent) {
    if (mode === 'drag') {
      let vx = 0, vy = 0;
      if (!silent && samples.length >= 2) {
        const last = samples[samples.length - 1];
        let first = samples[0];
        for (const s of samples) if (last[0] - s[0] <= 90) { first = s; break; }
        const dt = (last[0] - first[0]) / 1000;
        if (dt > 0.008) { vx = (last[1] - first[1]) / dt; vy = (last[2] - first[2]) / dt; }
      }
      const p = pointers.get(primary);
      call('onDragEnd', vx, vy, p ? info(p) : {});
    } else if (mode === 'box') {
      // an interrupted box (second finger, cancel, blur) is dropped, never committed half-drawn
      const p = pointers.get(primary);
      if (silent || !p) call('onBoxCancel');
      else call('onBoxEnd', p.sx, p.sy, p.x, p.y);
    }
    samples.length = 0;
  }

  function startPinch() {
    if (mode === 'drag' || mode === 'box') endDrag(true);
    mode = 'pinch';
    const c = centroidAndDistance();
    pinch = { d: c.d, cx: c.cx, cy: c.cy };
    call('onPinchStart', c.cx, c.cy);
  }

  /**
   * Pinch lost a finger: the remaining finger may keep panning the camera once it really moves
   * (never a tap; a finger lifted a moment later does not fling the camera).
   */
  function continueWithOneFinger() {
    const [id, p] = pointers.entries().next().value;
    primary = id;
    p.sx = p.x; p.sy = p.y;
    mode = 'panPending';
    samples.length = 0;
  }

  /** Pointer pressed. info: { button, type: 'touch'|'mouse'|'pen', shift, ctrl } */
  function down(id, x, y, t, inf = {}) {
    const i = { button: inf.button || 0, type: inf.type || 'touch', shift: !!inf.shift, ctrl: !!inf.ctrl };
    const p0 = { x, y, sx: x, sy: y, t0: t, info: i, face: false };
    pointers.set(id, p0);
    if (pointers.size === 1) {
      // second press of a double tap (same spot, in time): a candidate facing drag
      const dblPress = i.button === 0 && t - lastTap.t <= cfg.doubleTap && Math.hypot(x - lastTap.x, y - lastTap.y) <= cfg.doubleTapSlop * scale();
      if (dblPress && H.wantsFace && H.wantsFace(x, y, i)) p0.face = true;
      primary = id;
      mode = 'pending';
      longTried = false;
      longFired = false;
      samples.length = 0;
      samples.push([t, x, y]);
    } else if (pointers.size === 2) {
      // second finger (also a finger put back after a pinch): any drag/box/facing turns into a pinch
      if (mode === 'face') call('onFaceCancel');
      startPinch();
    } else {
      if (mode === 'pinch') { call('onPinchEnd'); pinch = null; }
      mode = 'ignore';
    }
  }

  function move(id, x, y, t) {
    const p = pointers.get(id);
    if (!p) {
      if (pointers.size === 0) call('onHover', x, y);
      return;
    }
    p.x = x; p.y = y;
    if (mode === 'pending' && id === primary && p.face) {
      if (Math.hypot(x - p.sx, y - p.sy) > cfg.faceSlop * scale()) {
        mode = 'face';
        call('onFaceStart', p.sx, p.sy, p.info);
        call('onFace', x, y, p.info);
      }
    } else if (mode === 'face' && id === primary) {
      call('onFace', x, y, p.info);
    } else if (mode === 'pending' && id === primary) {
      if (Math.hypot(x - p.sx, y - p.sy) > cfg.tapSlop * scale() && !longFired) {
        // mouse right-button drag with a selection: facing (desktop equivalent)
        if (p.info.button === 2 && H.wantsFace && H.wantsFace(p.sx, p.sy, p.info)) {
          mode = 'face';
          call('onFaceStart', p.sx, p.sy, p.info);
          call('onFace', x, y, p.info);
          return;
        }
        const wantBox = H.wantsBox ? H.wantsBox(p.info) : false;
        if (wantBox && p.info.button === 0) {
          mode = 'box';
          call('onBoxStart', p.sx, p.sy);
          call('onBox', p.sx, p.sy, x, y);
        } else {
          mode = 'drag';
          call('onDragStart', p.sx, p.sy, p.info);
          call('onDrag', x - p.sx, y - p.sy, x, y, p.info);
          p.lx = x; p.ly = y;
          samples.push([t, x, y]);
        }
      }
    } else if (mode === 'panPending' && id === primary) {
      if (Math.hypot(x - p.sx, y - p.sy) > cfg.tapSlop * scale()) {
        mode = 'drag';
        p.info = { ...p.info, pan: true };
        call('onDragStart', p.sx, p.sy, p.info);
        call('onDrag', x - p.sx, y - p.sy, x, y, p.info);
        p.lx = x; p.ly = y;
        samples.push([t, x, y]);
      }
    } else if (mode === 'drag' && id === primary) {
      call('onDrag', x - (p.lx ?? p.sx), y - (p.ly ?? p.sy), x, y, p.info);
      p.lx = x; p.ly = y;
      samples.push([t, x, y]);
      if (samples.length > 12) samples.shift();
    } else if (mode === 'box' && id === primary) {
      call('onBox', p.sx, p.sy, x, y);
    } else if (mode === 'pinch' && pointers.size >= 2) {
      const c = centroidAndDistance();
      const scale = c.d / pinch.d;
      call('onPinch', scale, c.cx, c.cy, c.cx - pinch.cx, c.cy - pinch.cy);
      pinch.d = c.d; pinch.cx = c.cx; pinch.cy = c.cy;
    }
  }

  function up(id, x, y, t) {
    const p = pointers.get(id);
    if (!p) return;
    if (x !== undefined) { p.x = x; p.y = y; }
    if (mode === 'pending' && id === primary) {
      // a press the long-press handler did not want is still a (slow) tap
      const quick = p.info.type === 'mouse' || t - p.t0 <= cfg.tapTime || longTried;
      if (!longFired && quick) {
        const dbl = t - lastTap.t <= cfg.doubleTap && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) <= cfg.doubleTapSlop * scale() && p.info.button === 0;
        if (dbl) {
          call('onDoubleTap', p.x, p.y, p.info);
          lastTap = { t: -1e9, x: -1e9, y: -1e9 };
        } else {
          call('onTap', p.x, p.y, p.info);
          lastTap = { t, x: p.x, y: p.y };
        }
      }
    } else if ((mode === 'drag' || mode === 'box') && id === primary) {
      endDrag(false);
    } else if (mode === 'face' && id === primary) {
      call('onFaceEnd', p.x, p.y, p.info);
      lastTap = { t: -1e9, x: -1e9, y: -1e9 };
      mode = 'ignore';
    }
    pointers.delete(id);
    afterRelease(t);
  }

  function afterRelease(t) {
    if (mode === 'pinch' && pointers.size < 2) {
      call('onPinchEnd');
      pinch = null;
      if (pointers.size === 1) continueWithOneFinger();
    } else if (mode === 'ignore' && pointers.size === 2) {
      startPinch(); // third finger lifted: back to a pinch
    } else if (mode !== 'drag' && mode !== 'pinch' && mode !== 'panPending' && pointers.size) {
      mode = 'ignore';
    }
    if (pointers.size === 0) { mode = 'none'; primary = -1; }
  }

  function cancel(id, t = 0) {
    if (!pointers.has(id)) return;
    if ((mode === 'drag' || mode === 'box') && id === primary) { endDrag(true); mode = 'ignore'; }
    if (mode === 'face' && id === primary) { call('onFaceCancel'); mode = 'ignore'; }
    pointers.delete(id);
    afterRelease(t);
  }

  /** Call every frame with the current time (ms) to detect long presses. */
  function tick(t) {
    if (mode !== 'pending' || longTried) return;
    const p = pointers.get(primary);
    if (!p || p.info.type === 'mouse' || p.face) return; // a held second tap aims, it is no long press
    if (t - p.t0 >= cfg.longPress) {
      longTried = true;
      longFired = !!(H.onLongPress && H.onLongPress(p.x, p.y, p.info));
    }
  }

  function wheel(dy, x, y, inf = {}) {
    call('onWheel', dy, x, y, inf);
  }

  /** Forget every pointer (window blur, page hidden): finish drags quietly, drop a half box. */
  function reset() {
    if (mode === 'drag' || mode === 'box') endDrag(true);
    if (mode === 'face') call('onFaceCancel');
    if (mode === 'pinch') call('onPinchEnd');
    pointers.clear();
    mode = 'none';
    primary = -1;
    pinch = null;
    samples.length = 0;
  }

  return { down, move, up, cancel, tick, wheel, reset, get mode() { return mode; }, get count() { return pointers.size; } };
}
