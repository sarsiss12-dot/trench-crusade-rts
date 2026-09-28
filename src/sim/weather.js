// Weather (Phase 4.1): procedural rain + traffic mud. Data: data/weather.js.
// Deterministic plain state:
//  state.weather = { type, auto, idx, on, start, end, k, rain, wet }
//    rain: current shower intensity 0..1 (ramps in / out), wet: ground wetness 0..1
//  state.mud = { cs, cols, rows, v: Uint8Array, live, ver }
//    v: traffic mud per cell (0..255); live: cells above 0 (the update skips an all-dry grid);
//    ver: bumped when the grid changes (the renderer re-uploads its mud texture only then)
// Showers are computed per index from the seed (hash, no RNG stream consumed), like the lull plan.
// Cost: one pass over the squads every 0.5 s (a stamp per moving squad), one pass over the grid
// every 0.5 s only while some cell is muddy.
import { WEATHER } from '../data/weather.js';
import { hash32 } from '../core/rng.js';
import { TICK_RATE } from './constants.js';

const R = WEATHER.rain, W = WEATHER.wet, M = WEATHER.mud;

function frac(seed, k) {
  return hash32(seed >>> 0, 0x7a1 + k, 0x3a1e) / 4294967296;
}

/** Shower i: { at, dur, k } in match ticks. */
export function rainWindow(seed, i) {
  let atMin = R.firstMin[0] + (R.firstMin[1] - R.firstMin[0]) * frac(seed, 0);
  let prevDur = 0;
  for (let k = 0; k <= i; k++) {
    const dur = R.durMin[0] + (R.durMin[1] - R.durMin[0]) * frac(seed, k * 4 + 1);
    if (k > 0) atMin += prevDur + R.gapMin[0] + (R.gapMin[1] - R.gapMin[0]) * frac(seed, k * 4 + 2);
    prevDur = dur;
  }
  const k = R.intensity[0] + (R.intensity[1] - R.intensity[0]) * frac(seed, i * 4 + 3);
  return { at: Math.round(atMin * 60 * TICK_RATE), dur: Math.round(prevDur * 60 * TICK_RATE), k: Math.round(k * 1000) / 1000 };
}

export function createWeatherState(scenarioWeather, rainSetting, width, height) {
  const cols = Math.ceil(width / M.cell), rows = Math.ceil(height / M.cell);
  const w = scenarioWeather || {};
  const auto = rainSetting === 0 || rainSetting === 'off' || w.rain === 'off' ? 0 : 1;
  return {
    weather: { type: w.type || 'overcast', auto, idx: 0, on: 0, start: 0, end: 0, k: 0, rain: 0, wet: 0 },
    mud: { cs: M.cell, cols, rows, v: new Uint8Array(cols * rows), live: 0, ver: 0 },
  };
}

function rampOf(state, wx) {
  const ramp = R.rampSec * TICK_RATE;
  const a = Math.min(1, (state.tick - wx.start) / ramp);
  const b = Math.min(1, Math.max(0, (wx.end - state.tick) / ramp));
  return Math.max(0, Math.min(a, b));
}

/** Per tick: shower schedule, rain intensity, ground wetness; the mud grid every M.every ticks. */
export function updateWeather(sim) {
  const { state } = sim;
  const wx = state.weather;
  if (!wx || wx.auto === undefined) return;
  if (wx.auto) {
    if (wx.on) {
      if (state.tick >= wx.end) { wx.on = 0; wx.idx++; wx.rain = 0; }
      else wx.rain = Math.round(wx.k * rampOf(state, wx) * 1000) / 1000;
    } else {
      const next = rainWindow(state.seed, wx.idx);
      if (state.tick >= next.at) { wx.on = 1; wx.start = state.tick; wx.end = state.tick + next.dur; wx.k = next.k; wx.rain = 0; }
    }
  }
  // wetness: soaks toward 1 in the rain, dries slowly after (a few decimals keep it exact)
  if (wx.rain > 0) wx.wet = Math.min(1, wx.wet + wx.rain / (W.riseSec * TICK_RATE));
  else if (wx.wet > 0) wx.wet = Math.max(0, wx.wet - 1 / (W.drySec * TICK_RATE));
  wx.wet = Math.round(wx.wet * 1e6) / 1e6;
  if (state.tick % M.every === 5) updateMud(sim);
}

function updateMud(sim) {
  const { state } = sim;
  const mud = state.mud;
  if (!mud) return;
  const wet = state.weather.wet;
  const { cs, cols, rows, v } = mud;
  let changed = false;
  // traffic: every moving squad churns the cell under it (only wet ground turns to mud)
  if (wet > 0.05) {
    const floor = Math.round(M.wetFloor * wet);
    for (const sq of state.squads) {
      if (sq.civ || sq.vx * sq.vx + sq.vz * sq.vz < 1e-4) continue; // standing squads churn nothing
      let n = 0;
      for (const m of sq.members) if (m.state === 'alive') n++;
      if (!n) continue;
      const cx = Math.floor(sq.cx / cs), cz = Math.floor(sq.cz / cs);
      if (cx < 0 || cz < 0 || cx >= cols || cz >= rows) continue;
      const i = cz * cols + cx;
      const add = Math.round(n * M.stampPerMan * wet);
      if (!add) continue;
      const before = v[i];
      const nv = Math.min(255, Math.max(before, floor) + add);
      if (nv !== before) { if (!before) mud.live++; v[i] = nv; changed = true; }
    }
  }
  // drying: once the ground itself has dried below the threshold, mud fades back
  if (mud.live > 0 && wet < M.dryBelow && state.weather.rain === 0) {
    const dec = Math.max(1, Math.round((M.decayPerSec * M.every) / TICK_RATE));
    let live = 0;
    for (let i = 0; i < v.length; i++) {
      if (!v[i]) continue;
      v[i] = v[i] > dec ? v[i] - dec : 0;
      if (v[i]) live++;
    }
    mud.live = live;
    changed = true;
  }
  if (changed) mud.ver = (mud.ver + 1) | 0;
}

/** Effective mud value at a point: traffic mud, or the rain-wide wet floor (0..255). */
export function mudValueAt(state, x, z) {
  const mud = state.mud, wx = state.weather;
  if (!mud || !wx) return 0;
  const floor = wx.wet > 0 ? M.wetFloor * wx.wet : 0;
  const cx = Math.floor(x / mud.cs), cz = Math.floor(z / mud.cs);
  if (cx < 0 || cz < 0 || cx >= mud.cols || cz >= mud.rows) return floor;
  return Math.max(floor, mud.v[cz * mud.cols + cx]);
}

/** 0 DRY, 1 WET, 2 MUD, 3 HEAVY MUD. */
export function mudLevelAt(state, x, z) {
  const val = mudValueAt(state, x, z);
  const L = M.levels;
  return val >= L[2] ? 3 : val >= L[1] ? 2 : val >= L[0] ? 1 : 0;
}

/** Surface movement multiplier at a point (1 on dry ground). */
export function mudSpeedAt(state, x, z) {
  if (!state.mud || !state.weather || (!state.mud.live && !state.weather.wet)) return 1;
  return M.speed[mudLevelAt(state, x, z)];
}
