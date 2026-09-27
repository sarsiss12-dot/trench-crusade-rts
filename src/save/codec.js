// Versioned save codec (pure, platform-independent). GameState -> JSON string and back.
// Typed arrays are encoded as { $ta: <type>, b64: <base64> }. Renderer/UI state never enters
// a save. Migrations upgrade older save versions step by step.
import { STATE_VERSION } from '../sim/constants.js';
import { UNITS } from '../data/units.js';
import { createRngState } from '../core/rng.js';
import { newStats } from '../sim/state.js';

export const SAVE_FORMAT = 'trench-crusade-rts-save';
export const SAVE_VERSION = STATE_VERSION;

const TYPED = {
  Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array,
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INV = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

export function bytesToBase64(u8) {
  let out = '';
  let i = 0;
  for (; i + 2 < u8.length; i += 3) {
    const n = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rem = u8.length - i;
  if (rem === 1) {
    const n = u8[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (u8[i] << 16) | (u8[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

export function base64ToBytes(str) {
  let len = str.length;
  while (len > 0 && str[len - 1] === '=') len--;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0, buf = 0, bits = 0;
  for (let i = 0; i < len; i++) {
    const v = B64_INV[str.charCodeAt(i)];
    if (v < 0) throw new Error('save.corrupt');
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 255;
    }
  }
  return out;
}

function replacer(key, value) {
  if (value && ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const u8 = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return { $ta: value.constructor.name, b64: bytesToBase64(u8) };
  }
  return value;
}

function reviver(key, value) {
  if (value && typeof value === 'object' && typeof value.$ta === 'string' && typeof value.b64 === 'string') {
    const Ctor = TYPED[value.$ta];
    if (!Ctor) throw new Error('save.corrupt');
    const bytes = base64ToBytes(value.b64);
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return new Ctor(copy.buffer, 0, bytes.length / Ctor.BYTES_PER_ELEMENT);
  }
  return value;
}

export function encodeState(state) {
  return JSON.stringify(state, replacer);
}

export function decodeState(json) {
  return JSON.parse(json, reviver);
}

/** Deep clone of GameState through the codec (used by tests and save snapshots). */
export function cloneState(state) {
  return decodeState(encodeState(state));
}

export function hashString32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashState(state) {
  return hashString32(encodeState(state));
}

// ------------------------------------------------------------------ migrations
// MIGRATIONS[n] upgrades a save object from version n to n+1.
// Version 0 = pre-release prototype layout (kept as the reference example of the pattern).
export const MIGRATIONS = {
  0: (save) => {
    const s = save.state;
    s.effects = s.effects || [];
    s.pending = s.pending || [];
    s.commandSeq = s.commandSeq || 0;
    s.objectives = s.objectives || [];
    for (const sq of s.squads || []) {
      if (sq.hordeBonus === undefined) sq.hordeBonus = 0;
      if (sq.debuffUntil === undefined) sq.debuffUntil = 0;
      for (const m of sq.members) if (m.killer === undefined) m.killer = '';
    }
    s.version = 1;
    return { ...save, version: 1 };
  },
  // v1 -> v2 (Phase 2): shell craters, walking replacement requests, mortar suppression, the
  // mortar barrage ability. Old 'reinforce' orders (squad walked back to base) become a request:
  // the squad stays where it was and replacements walk to it.
  1: (save) => {
    const s = save.state;
    if (!Array.isArray(s.craters)) s.craters = [];
    for (const sq of s.squads || []) {
      if (sq.suppressUntil === undefined) sq.suppressUntil = 0;
      if (sq.reinf === undefined) sq.reinf = null;
      if (sq.order && sq.order.t === 'reinforce') {
        sq.reinf = { src: sq.order.sid || 0, next: 0, cut: 0, wait: 0, auto: 0 };
        sq.order = { t: 'idle' };
        sq.path = null; sq.pathIndex = 0; sq.pathState = 'none';
      }
    }
    const na = s.factions && s.factions.new_antioch;
    if (na && na.abilities && !na.abilities.mortar_barrage) na.abilities.mortar_barrage = { readyTick: 0 };
    s.version = 2;
    return { ...save, version: 2 };
  },
  // v2 -> v3 (Phase 3): living world (sectors / wildlife / convoys — built on load from the save's
  // own seed, see simulationFromState p3init), civilian population, Pestilence, specialities,
  // builder queues, squad caps, wounded / burning soldier fields, new abilities.
  2: (save) => {
    const s = save.state;
    s.sectors = Array.isArray(s.sectors) ? s.sectors : [];
    s.animals = Array.isArray(s.animals) ? s.animals : [];
    s.convoys = Array.isArray(s.convoys) ? s.convoys : [];
    if (s.rng && !s.rng.eco) s.rng.eco = createRngState(((s.seed >>> 0) ^ 0xec0ca5) >>> 0);
    s.p3init = 0;
    for (const fid in s.factions || {}) {
      const f = s.factions[fid];
      f.stats = { ...newStats(), ...(f.stats || {}) };
      if (f.population === undefined) f.population = 0;
      if (f.pestilence === undefined) { f.pestilence = 0; f.pestTier = 0; f.pestLastGain = 0; }
      if (!Array.isArray(f.spec)) f.spec = [null, null, null];
      f.econ = { mpAcc: 0, mpPopAcc: 0, growAcc: 0, starveAcc: 0, lastManpowerRate: 0, lastFoodRate: 0, safePop: 0, pop: 0, infCells: 0, ...(f.econ || {}) };
      f.abilities = f.abilities || {};
      const add = fid === 'new_antioch' ? ['purge'] : fid === 'black_grail' ? ['great_pestilence', 'black_tide'] : [];
      for (const a of add) if (!f.abilities[a]) f.abilities[a] = { readyTick: 0 };
    }
    for (const sq of s.squads || []) {
      const def = UNITS[sq.type];
      if (sq.cap === undefined) sq.cap = def ? Math.max(sq.members.length, def.squadSize) : sq.members.length;
      if (sq.bq === undefined) sq.bq = null;
      if (sq.civ === undefined) sq.civ = null;
      if (sq.tideUntil === undefined) sq.tideUntil = 0;
      if (sq.fearUntil === undefined) sq.fearUntil = 0;
      if (sq.carryBy === undefined) sq.carryBy = null;
      if (sq.autoT === undefined) sq.autoT = 0;
      for (const m of sq.members) {
        if (m.burn === undefined) m.burn = 0;
        if (m.slow === undefined) m.slow = 0;
        if (m.rev === undefined) m.rev = 0;
      }
    }
    s.version = 3;
    return { ...save, version: 3 };
  },
  // Phase 3 -> Phase 4: auto reinforcement, commanders, operational lulls (off for a migrated
  // match: its war clock was planned without them), ruin garrisons (created on load from the
  // map, see sim/simulation.js p4init), garrison fields on soldiers, emplacement fields.
  3: (save) => {
    const s = save.state;
    s.settings = s.settings || {};
    if (s.settings.lulls === undefined) s.settings.lulls = 0;
    if (s.match && !s.match.lull) s.match.lull = { plan: [], idx: 0, active: 0, start: 0, end: 0, warned: 0, endWarned: 0, elapsed: 0, ext: 0 };
    for (const fid in s.factions || {}) {
      const f = s.factions[fid];
      if (f.autoReinf === undefined) f.autoReinf = 'off';
      if (!f.cmdr) {
        let unit = '';
        for (const id in UNITS) if (UNITS[id].faction === fid && UNITS[id].commander) unit = id;
        f.cmdr = { sq: 0, unit, deaths: 0, readyTick: 0, lostUntil: 0, abReady: 0, lastX: 0, lastZ: 0 };
        // an existing leader of that type becomes the commander
        const lead = (s.squads || []).find((q) => q.faction === fid && q.type === unit);
        if (lead) f.cmdr.sq = lead.id;
      }
    }
    for (const sq of s.squads || []) {
      if (sq.autoReinf === undefined) sq.autoReinf = -1;
      if (sq.autoReinfT === undefined) sq.autoReinfT = 0;
      if (sq.garrison === undefined) sq.garrison = 0;
      for (const m of sq.members) {
        if (m.gslot === undefined) m.gslot = -1;
        if (m.gexit === undefined) m.gexit = 0;
      }
    }
    s.p4init = 0; // ruin garrisons are added on load (they need the world geometry)
    s.version = 4;
    return { ...save, version: 4 };
  },
};

export function migrateSave(save) {
  if (!save || save.format !== SAVE_FORMAT) throw new Error('save.invalid_format');
  let cur = save;
  if (typeof cur.version !== 'number') throw new Error('save.invalid_format');
  if (cur.version > SAVE_VERSION) throw new Error('save.too_new');
  while (cur.version < SAVE_VERSION) {
    const fn = MIGRATIONS[cur.version];
    if (!fn) throw new Error('save.no_migration');
    cur = fn(cur);
  }
  return cur;
}

export function serializeSave(state, meta = {}) {
  return JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION, meta, state }, replacer);
}

export function deserializeSave(str) {
  const raw = JSON.parse(str, reviver);
  const save = migrateSave(raw);
  return { meta: save.meta || {}, state: save.state };
}
