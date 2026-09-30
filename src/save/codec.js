// Versioned save codec (pure, platform-independent). GameState -> JSON string and back.
// Typed arrays are encoded as { $ta: <type>, b64: <base64> }. Renderer/UI state never enters
// a save. Migrations upgrade older save versions step by step.
import { STATE_VERSION } from '../sim/constants.js';
import { UNITS } from '../data/units.js';
import { createRngState } from '../core/rng.js';
import { newStats } from '../sim/state.js';
import { createWeatherState } from '../sim/weather.js';
import { mapDef } from '../data/maps.js';
import { startingPackage } from '../data/packages.js';
import { placeInRegion } from '../sim/sides.js';
import { FOG_LAYERS, sideDef } from '../data/factions.js';
import { dist } from '../core/dmath.js';

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
  // Phase 4 -> Phase 4.1:
  //  - commanders -> passive ELITES: faction cmdr state and live 'command' effects are dropped (the
  //    Lieutenant / Lord squads themselves stay: they are ordinary elites now, auras from data)
  //  - auto reinforcement becomes POSITIONAL: the faction default and per-squad override go; a squad
  //    already holding a trench / garrison starts ON (posAuto), everyone else OFF; an automatic
  //    request of a squad out in the open field is dropped (walkers already out keep walking)
  //  - operational lulls: the old plan (ceasefire windows, war-clock extension) is replaced by the
  //    seeded never-a-ceasefire windows; a window running at save time simply closes; windows the
  //    old plan had not reached yet continue from the new schedule
  //  - endless flag, work gang AUTO SAFE HUNT, rain / traffic mud state, reinforcement notice guard
  4: (save) => {
    const s = save.state;
    s.settings = s.settings || {};
    if (s.settings.endless === undefined) s.settings.endless = false;
    if (s.settings.rain === undefined) s.settings.rain = 'auto';
    const m = s.match || {};
    if (m.endless === undefined) m.endless = 0;
    if (m.warMinutes === undefined) m.warMinutes = s.settings.warMinutes || 30;
    const old = m.lull || {};
    let cap = s.settings.lulls !== undefined ? s.settings.lulls : 'auto';
    // a Phase 3 save migrated through v4 had no lulls planned: keep it that way
    if (old.plan && old.plan.length === 0 && s.settings.lulls === 0) cap = 0;
    // the old design stretched the war clock by every lull: give that time back (never shorter)
    if (old.ext > 0 && m.warEndTick > 0) m.warEndTick -= Math.min(old.ext, Math.max(0, m.warEndTick - (s.tick || 0) - 20));
    m.lull = { idx: old.idx || 0, active: 0, start: 0, end: 0, warned: 0, endWarned: 0, cap };
    s.match = m;
    for (const fid in s.factions || {}) {
      const f = s.factions[fid];
      delete f.cmdr; delete f.autoReinf;
      if (f.reinfWait === undefined) f.reinfWait = 0;
    }
    for (const sq of s.squads || []) {
      const o = sq.order || {};
      const pos = o.t === 'hold_trench' ? o.sid || 0 : o.t === 'garrison' && o.phase === 'inside' ? o.sid || 0 : 0;
      sq.posId = pos;
      sq.posAuto = pos ? (sq.autoReinf === 0 ? 0 : 1) : 0;
      if (!pos && sq.reinf && sq.reinf.auto) sq.reinf = null;
      delete sq.autoReinf; delete sq.autoReinfT;
      if (sq.autoHunt === undefined) sq.autoHunt = 1;
    }
    s.effects = (s.effects || []).filter((e) => e.kind !== 'command');
    if (!s.mud || !s.weather || s.weather.auto === undefined) {
      const w = mapDef(s.mapId);
      const wx = createWeatherState({ type: (s.weather && s.weather.type) || 'overcast' }, s.settings.rain, w.width, w.height);
      s.weather = wx.weather;
      s.mud = wx.mud;
    }
    s.version = 5;
    return { ...save, version: 5 };
  },
  // Phase 4.1 -> Phase 5A (FACTION / SIDE / ROLE separation):
  //  - every save before 5A is the classic Lore preset: New Antioch = DEFENDER (south region),
  //    Black Grail = ATTACKER (north region); state.sides is added in slot order and each per-side
  //    state learns its faction / role / region / build zone (region data)
  //  - objectives become side-owned ({ id, type, structureId, side, role }); victory rule 'siege'
  //  - plague ownership: infected ground cells, infected soldiers' stacks and infected corpses
  //    all belong to the Black Grail (the only plague side a classic match can have)
  //  - setup mode 'lore', AI difficulty 'normal' (the old think interval)
  // Nothing else changes: resources, units, structures, corpses, pestilence, groups (save meta),
  // mud / weather, elites and reinforcement state are kept as they are.
  5: (save) => {
    const s = save.state;
    s.settings = s.settings || {};
    if (!s.settings.setupMode) s.settings.setupMode = 'lore';
    if (!s.settings.aiDifficulty) s.settings.aiDifficulty = 'normal';
    const map = mapDef(s.mapId) || {};
    const regions = map.regions || {};
    const W = map.width || 320, H = map.height || 576;
    const LORE = [
      { id: 'new_antioch', faction: 'new_antioch', role: 'defender', region: 'south', pop: 40 },
      { id: 'black_grail', faction: 'black_grail', role: 'attacker', region: 'north', pop: 0 },
    ];
    if (!Array.isArray(s.sides)) {
      s.sides = LORE.filter((sd) => s.factions && s.factions[sd.id]).map((sd) => ({ id: sd.id, faction: sd.faction, role: sd.role, region: sd.region }));
    }
    for (const sd of LORE) {
      const f = s.factions && s.factions[sd.id];
      if (!f) continue;
      if (!f.faction) f.faction = sd.faction;
      if (!f.role) f.role = sd.role;
      if (!f.region) f.region = sd.region;
      if (!f.zone) f.zone = regions[f.region] ? { ...regions[f.region].zone } : { x0: 0, z0: 0, x1: W, z1: H };
      if (f.popStart === undefined) f.popStart = sd.pop;
    }
    const m = s.match || {};
    if (!m.victory) m.victory = 'siege';
    s.match = m;
    const objs = [];
    for (const o of s.objectives || []) {
      if (o.side) { objs.push(o); continue; }
      const side = o.defender || 'new_antioch';
      objs.push({ id: 'defenderPrimaryObjective', type: 'siege', structureId: o.structureId || 0, side, role: 'defender' });
    }
    if (!objs.length) {
      const st = (s.structures || []).find((x) => x.objective);
      if (st) objs.push({ id: 'defenderPrimaryObjective', type: 'siege', structureId: st.id, side: st.faction, role: 'defender' });
    }
    s.objectives = objs;
    const inf = s.infection;
    if (inf && inf.v && !inf.o) {
      const o = new Uint8Array(inf.v.length);
      const layer = 2; // sideIndex('black_grail') + 1 in a classic match
      for (let i = 0; i < inf.v.length; i++) if (inf.v[i]) o[i] = layer;
      inf.o = o;
    }
    for (const sq of s.squads || []) {
      for (const mm of sq.members) if (mm.infBy === undefined) mm.infBy = mm.infection > 0 ? 'black_grail' : '';
    }
    for (const c of s.corpses || []) if (c.plague === undefined) c.plague = c.infected ? 'black_grail' : '';
    s.version = 6;
    return { ...save, version: 6 };
  },
  // Phase 5A -> Phase 05B: the third faction expands fog capacity and starting-package structure
  // shortcuts become persistent entity metadata. Assignment is package-authored (type + transformed
  // position), never "the first three structures on the map".
  6: (save) => {
    const s = save.state;
    const map = mapDef(s.mapId);
    const cells = s.fog.cols * s.fog.rows;
    while (s.fog.vis.length < FOG_LAYERS) s.fog.vis.push(new Uint8Array(cells));
    while (s.fog.seen.length < FOG_LAYERS) s.fog.seen.push(new Uint8Array(cells));
    for (const sd of s.sides || []) {
      const pkg = startingPackage(sd.faction, sd.role);
      for (const item of pkg.structures) {
        if (!item.quickSlot) continue;
        const p = placeInRegion(map, item, pkg.authored, sd.region);
        let best = null, bd = Infinity;
        for (const st of s.structures || []) {
          if (st.faction !== sd.id || st.type !== item.type || st.quickSlot) continue;
          const d = dist(st.x, st.z, p.x, p.z);
          if (d < bd) { bd = d; best = st; }
        }
        if (best && bd <= 40) best.quickSlot = item.quickSlot;
      }
    }
    s.version = 7;
    return { ...save, version: 7 };
  },
  // v7 -> v8: independent hunting preferences, autonomous pack/assault order fields are plain data.
  // Older trained and risen Thralls have no provenance marker: never guess from their squad size.
  7: (save) => {
    const s = save.state;
    for (const sq of s.squads || []) {
      if (sq.safeHunt === undefined) sq.safeHunt = 1;
      if (sq.huntMemo === undefined) sq.huntMemo = null;
      if (sq.autoHunt === undefined) sq.autoHunt = 1;
      // v3-v7 reanimations were the only campaign-created squads of the reanimation unit
      // whose ORIGINAL cap was <= maxBodies (8), instead of its trained cap (12+).
      // Never classify by surviving member count: a depleted trained squad keeps its cap.
      const r = sideDef(sq.faction)?.reanimation;
      if (!sq.autonomous && r && sq.type === r.unit && sq.spawnTick > 0 && sq.cap > 0 && sq.cap <= r.maxBodies) {
        sq.autonomous = 'risen'; sq.risenState = sq.members.some((m) => m.state === 'rising') ? 'RISE' : 'SEEK'; sq.risenNext = s.tick;
        sq.order = { t: 'idle' }; sq.path = null; sq.pathIndex = 0; sq.pathState = 'none'; sq.target = null;
        sq.aiGroup = 0; sq.reinf = null; sq.posAuto = 0;
      }
    }
    s.version = 8;
    return { ...save, version: 8 };
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
